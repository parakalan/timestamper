// Constants
const API_URL = '/api';
const grid = document.getElementById('threadsGrid');
const addThreadBtn = document.getElementById('addThreadBtn');
const clearAllBtn = document.getElementById('clearAllBtn');
const exportBtn = document.getElementById('exportBtn');
const searchInput = document.getElementById('searchInput');
const emptySearch = document.getElementById('emptySearch');
const toastsEl = document.getElementById('toasts');
const picker = document.getElementById('emojiPicker');

const THEMES = ['paper', 'midnight', 'synthwave', 'terminal', 'bubblegum'];
const THEME_NAMES = {
    paper: '📜 Paper',
    midnight: '🌙 Midnight',
    synthwave: '🌆 Synthwave',
    terminal: '💻 Terminal',
    bubblegum: '🍬 Bubblegum'
};
const EMOJIS = [
    '🚀', '🧠', '🛠️', '📚', '🎯', '🐛', '☕', '🌱', '🎨', '🔥', '🪐', '🦄',
    '💡', '📝', '🧪', '📊', '🤝', '🎧', '🏃', '🍕', '🐙', '🦊', '🐢', '🌈',
    '⚡', '🧩', '🔒', '📦', '🧹', '🎮', '🏆', '❤️'
];
const COLORS = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9', '#4dabf7', '#9775fa', '#f783ac'];
const PROMPTS = [
    'What are you working on right now?',
    'What did you just figure out?',
    'Brain dump. Go.',
    'What is blocking you?',
    'What would make today a win?',
    'Log it before you forget it…',
    'Tiny progress is still progress.',
    'What did you ship?',
    'Talk to your future self.'
];
const WIN_RE = /(#win\b|✅|\bdone!|\bshipped\b|🎉)/i;
const POMODORO_SECONDS = 25 * 60;

// Persisted per-browser preferences
const store = {
    get(key, fallback) {
        try {
            const value = localStorage.getItem(`timestamper:${key}`);
            return value === null ? fallback : JSON.parse(value);
        } catch {
            return fallback;
        }
    },
    set(key, value) {
        try {
            localStorage.setItem(`timestamper:${key}`, JSON.stringify(value));
        } catch { /* storage unavailable: ignore */ }
    }
};

const state = {
    activity: new Map(), // 'YYYY-MM-DD' -> entries
    activeEditor: null,
    pendingDeletes: new Map() // thread id -> timeout
};

// Utility Functions
const pick = list => list[Math.floor(Math.random() * list.length)];

function showToast(message, { type = '', duration = 3000, action } = {}) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const text = document.createElement('span');
    text.textContent = message;
    toast.appendChild(text);

    const dismiss = () => {
        toast.classList.add('out');
        setTimeout(() => toast.remove(), 250);
    };

    if (action) {
        const button = document.createElement('button');
        button.textContent = action.label;
        button.addEventListener('click', () => {
            action.onClick();
            dismiss();
        });
        toast.appendChild(button);
    }

    toastsEl.appendChild(toast);
    setTimeout(dismiss, duration);
}

function showWarning(message, duration = 3000) {
    showToast(message, { type: 'warn', duration });
}

function getTimestamp() {
    const now = new Date();
    return `[${now.toLocaleDateString()} ${now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}] `;
}

function localDay(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function debounce(fn, wait) {
    let timer;
    const debounced = (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), wait);
    };
    debounced.flush = (...args) => {
        clearTimeout(timer);
        fn(...args);
    };
    return debounced;
}

function countEntries(text) {
    return text.split('\n').filter(line => /^\[[^\]]+\]\s*\S/.test(line)).length;
}

function countWords(text) {
    const words = text.replace(/^\[[^\]]+\]/gm, '').match(/\S+/g);
    return words ? words.length : 0;
}

function download(filename, text) {
    const blob = new Blob([text], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function threadToMarkdown(title, emoji, content) {
    return `# ${emoji ? emoji + ' ' : ''}${title}\n\n${content.trim()}\n`;
}

// API Functions
async function request(path, options = {}) {
    const response = await fetch(`${API_URL}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
}

async function fetchThreads() {
    try {
        const data = await request('/threads');
        return data.threads;
    } catch (error) {
        console.error('Error fetching threads:', error);
        showWarning('Failed to load threads');
        return [];
    }
}

async function createThread() {
    try {
        const data = await request('/threads', { method: 'POST' });
        return data.thread;
    } catch (error) {
        console.error('Error creating thread:', error);
        showWarning('Failed to create new thread');
        return null;
    }
}

async function updateThread(id, updates) {
    try {
        const data = await request(`/threads/${id}`, {
            method: 'PUT',
            body: JSON.stringify(updates)
        });
        return data.thread;
    } catch (error) {
        console.error('Error updating thread:', error);
        showWarning('Failed to save changes');
        return null;
    }
}

async function clearThread(id) {
    try {
        const data = await request(`/threads/${id}/clear`, { method: 'POST' });
        return data.thread;
    } catch (error) {
        console.error('Error clearing thread:', error);
        showWarning('Failed to clear thread');
        return null;
    }
}

async function deleteThread(id, { keepalive = false } = {}) {
    try {
        await request(`/threads/${id}`, { method: 'DELETE', keepalive });
        return true;
    } catch (error) {
        console.error('Error deleting thread:', error);
        showWarning('Failed to delete thread');
        return false;
    }
}

async function saveOrder() {
    const ids = [...grid.querySelectorAll('.thread-container')].map(el => Number(el.dataset.threadId));
    try {
        await request('/threads/reorder', { method: 'PUT', body: JSON.stringify({ ids }) });
    } catch (error) {
        console.error('Error saving order:', error);
        showWarning('Failed to save order');
    }
}

async function fetchActivity() {
    try {
        const data = await request('/activity');
        state.activity = new Map(data.activity.map(row => [row.day, row.entries]));
    } catch (error) {
        console.error('Error fetching activity:', error);
    }
}

async function logEntry(lineText) {
    const day = localDay();
    state.activity.set(day, (state.activity.get(day) || 0) + 1);

    const hour = new Date().getHours();
    if (hour < 4) store.set('nightOwl', true);
    if (hour >= 4 && hour < 7) store.set('earlyBird', true);
    if (WIN_RE.test(lineText)) {
        store.set('wins', store.get('wins', 0) + 1);
        confetti();
    }

    renderStats();
    checkAchievements();

    try {
        await request('/activity', { method: 'POST', body: JSON.stringify({ day, entries: 1 }) });
    } catch (error) {
        console.error('Error logging activity:', error);
    }
}

// Stats, streaks & levels
function computeStats() {
    let total = 0;
    for (const n of state.activity.values()) total += n;

    // Streak counts back from today; if nothing yet today, yesterday still keeps it alive
    let streak = 0;
    const cursor = new Date();
    if (!state.activity.has(localDay(cursor))) cursor.setDate(cursor.getDate() - 1);
    while (state.activity.has(localDay(cursor))) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
    }

    let best = 0;
    let run = 0;
    let prev = null;
    for (const day of [...state.activity.keys()].sort()) {
        const date = new Date(`${day}T00:00:00`);
        run = prev && (date - prev) / 86400000 === 1 ? run + 1 : 1;
        best = Math.max(best, run);
        prev = date;
    }

    const level = Math.floor(Math.sqrt(total / 5)) + 1;
    const floor = 5 * (level - 1) ** 2;
    const ceil = 5 * level ** 2;
    const progress = (total - floor) / (ceil - floor);

    return {
        total,
        streak,
        best,
        today: state.activity.get(localDay()) || 0,
        days: state.activity.size,
        level,
        progress,
        threads: grid.querySelectorAll('.thread-container').length,
        wins: store.get('wins', 0),
        pomodoros: store.get('pomodoros', 0)
    };
}

let lastLevel = null;
function renderStats() {
    const stats = computeStats();
    document.getElementById('streakValue').textContent = stats.streak;
    document.getElementById('todayValue').textContent = stats.today;
    document.getElementById('levelValue').textContent = stats.level;
    document.getElementById('xpFill').style.width = `${Math.round(stats.progress * 100)}%`;

    const streakIcon = document.getElementById('streakIcon');
    streakIcon.classList.toggle('cold', stats.streak === 0);
    streakIcon.classList.toggle('hot', stats.streak >= 3);

    if (lastLevel !== null && stats.level > lastLevel) {
        showToast(`⭐ Level up! You're now level ${stats.level}`, { type: 'achievement', duration: 4000 });
        confetti(160);
    }
    lastLevel = stats.level;
    return stats;
}

const ACHIEVEMENTS = [
    { id: 'first', icon: '🐣', name: 'Hello, world', desc: 'Write your first entry', test: s => s.total >= 1 },
    { id: 'ten', icon: '✋', name: 'High ten', desc: '10 entries', test: s => s.total >= 10 },
    { id: 'fifty', icon: '📒', name: 'Chronicler', desc: '50 entries', test: s => s.total >= 50 },
    { id: 'hundred', icon: '💯', name: 'Centurion', desc: '100 entries', test: s => s.total >= 100 },
    { id: 'thousand', icon: '🏛️', name: 'Historian', desc: '1000 entries', test: s => s.total >= 1000 },
    { id: 'busy', icon: '🐝', name: 'Busy bee', desc: '20 entries in one day', test: s => s.today >= 20 },
    { id: 'streak3', icon: '🔥', name: 'On fire', desc: '3 day streak', test: s => s.best >= 3 },
    { id: 'streak7', icon: '🌋', name: 'Unstoppable', desc: '7 day streak', test: s => s.best >= 7 },
    { id: 'streak30', icon: '☄️', name: 'Legendary', desc: '30 day streak', test: s => s.best >= 30 },
    { id: 'juggler', icon: '🤹', name: 'Juggler', desc: 'Have 8 threads going', test: s => s.threads >= 8 },
    { id: 'win', icon: '🎉', name: 'Winner', desc: 'Log a #win', test: s => s.wins >= 1 },
    { id: 'tomato', icon: '🍅', name: 'Tomato timer', desc: 'Finish a pomodoro', test: s => s.pomodoros >= 1 },
    { id: 'owl', icon: '🦉', name: 'Night owl', desc: 'Write between midnight and 4am', test: () => store.get('nightOwl', false) },
    { id: 'bird', icon: '🐦', name: 'Early bird', desc: 'Write between 4am and 7am', test: () => store.get('earlyBird', false) },
    { id: 'painter', icon: '🎨', name: 'Interior designer', desc: 'Try every theme', test: () => store.get('themesSeen', []).length >= THEMES.length }
];

function checkAchievements({ silent = false } = {}) {
    const stats = computeStats();
    const unlocked = new Set(store.get('achievements', []));
    for (const achievement of ACHIEVEMENTS) {
        if (!unlocked.has(achievement.id) && achievement.test(stats)) {
            unlocked.add(achievement.id);
            if (!silent) {
                showToast(`🏆 Achievement unlocked: ${achievement.icon} ${achievement.name}`, { type: 'achievement', duration: 4500 });
                confetti(120);
            }
        }
    }
    store.set('achievements', [...unlocked]);
}

function openStats() {
    const stats = computeStats();
    const cards = [
        ['🔥', stats.streak, 'current streak'],
        ['🏅', stats.best, 'best streak'],
        ['✍️', stats.total, 'total entries'],
        ['📅', stats.days, 'days journaled'],
        ['🎉', stats.wins, 'wins logged'],
        ['🍅', stats.pomodoros, 'pomodoros']
    ];
    document.getElementById('statCards').innerHTML = cards
        .map(([icon, value, label]) => `<div class="stat-card">${icon}<strong>${value}</strong><span>${label}</span></div>`)
        .join('');

    // Heatmap: 20 weeks of columns, Sunday on top
    const heatmap = document.getElementById('heatmap');
    heatmap.innerHTML = '';
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - (20 * 7 - 1) - today.getDay());
    for (let date = new Date(start); localDay(date) <= localDay(today) || date.getDay() !== 0; date.setDate(date.getDate() + 1)) {
        const cell = document.createElement('div');
        const day = localDay(date);
        const entries = state.activity.get(day) || 0;
        const level = entries === 0 ? 0 : entries < 3 ? 1 : entries < 8 ? 2 : entries < 15 ? 3 : 4;
        cell.className = `cell l${level}${date > today ? ' future' : ''}`;
        cell.title = `${day}: ${entries} entr${entries === 1 ? 'y' : 'ies'}`;
        heatmap.appendChild(cell);
    }

    const unlocked = new Set(store.get('achievements', []));
    document.getElementById('badges').innerHTML = ACHIEVEMENTS.map(a => `
        <div class="badge ${unlocked.has(a.id) ? '' : 'locked'}">
            <span class="badge-icon">${a.icon}</span>
            <div><strong>${a.name}</strong><small>${a.desc}</small></div>
        </div>`).join('');

    openModal('statsModal');
}

// Confetti
const confettiCanvas = document.getElementById('confetti');
const confettiCtx = confettiCanvas.getContext('2d');
let particles = [];
let confettiRunning = false;

function confetti(count = 90, origin) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    confettiCanvas.width = window.innerWidth;
    confettiCanvas.height = window.innerHeight;
    const x = origin?.x ?? window.innerWidth / 2;
    const y = origin?.y ?? window.innerHeight / 3;
    const palette = [...COLORS, getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()];
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 4 + Math.random() * 8;
        particles.push({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 6,
            size: 5 + Math.random() * 6,
            rotation: Math.random() * Math.PI,
            spin: (Math.random() - 0.5) * 0.3,
            color: pick(palette),
            life: 0
        });
    }
    if (!confettiRunning) {
        confettiRunning = true;
        requestAnimationFrame(drawConfetti);
    }
}

function drawConfetti() {
    confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    particles = particles.filter(p => p.y < confettiCanvas.height + 20 && p.life < 240);
    for (const p of particles) {
        p.vy += 0.25;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.spin;
        p.life++;
        confettiCtx.save();
        confettiCtx.translate(p.x, p.y);
        confettiCtx.rotate(p.rotation);
        confettiCtx.fillStyle = p.color;
        confettiCtx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        confettiCtx.restore();
    }
    if (particles.length) {
        requestAnimationFrame(drawConfetti);
    } else {
        confettiRunning = false;
        confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    }
}

// Popover (emoji + color pickers)
let pickerCleanup = null;

function openPicker(anchor, items, render, onPick) {
    closePicker();
    picker.innerHTML = '';
    for (const item of items) {
        const button = document.createElement('button');
        render(button, item);
        button.addEventListener('click', () => {
            onPick(item);
            closePicker();
        });
        picker.appendChild(button);
    }
    picker.hidden = false;
    const rect = anchor.getBoundingClientRect();
    const left = Math.min(rect.left + window.scrollX, window.scrollX + window.innerWidth - picker.offsetWidth - 12);
    picker.style.left = `${Math.max(8, left)}px`;
    picker.style.top = `${rect.bottom + window.scrollY + 6}px`;

    const onDocClick = event => {
        if (!picker.contains(event.target) && event.target !== anchor) closePicker();
    };
    setTimeout(() => document.addEventListener('click', onDocClick));
    pickerCleanup = () => document.removeEventListener('click', onDocClick);
}

function closePicker() {
    picker.hidden = true;
    if (pickerCleanup) pickerCleanup();
    pickerCleanup = null;
}

// Modals
function openModal(id) {
    document.getElementById(id).hidden = false;
}

function closeModals() {
    document.querySelectorAll('.modal-backdrop').forEach(m => (m.hidden = true));
}

document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', event => {
        if (event.target === backdrop || event.target.hasAttribute('data-close')) closeModals();
    });
});

// Focus mode
function toggleFocus(container) {
    const current = document.querySelector('.thread-container.focused');
    if (current) {
        current.classList.remove('focused');
        document.body.classList.remove('has-focus');
        if (current === container || !container) return;
    }
    if (!container) return;
    container.classList.add('focused');
    document.body.classList.add('has-focus');
    container.querySelector('.editor').focus();
}

// DOM Functions
function threadTitleFallback(thread) {
    return `Thread ${thread.id}`;
}

function checkDuplicateTitle(container, newTitle) {
    const normalized = newTitle.toLowerCase();
    return [...grid.querySelectorAll('.thread-container')].some(other =>
        other !== container && other.querySelector('.thread-title').textContent.trim().toLowerCase() === normalized
    );
}

function updateFooter(container) {
    const editor = container.querySelector('.editor');
    const entries = countEntries(editor.value);
    const words = countWords(editor.value);
    container.querySelector('.counts').textContent =
        `${entries} entr${entries === 1 ? 'y' : 'ies'} · ${words} word${words === 1 ? '' : 's'}`;
}

function createThreadElement(thread) {
    const container = document.createElement('div');
    container.className = 'thread-container';
    container.dataset.threadId = thread.id;
    container.style.setProperty('--thread-color', thread.color || COLORS[thread.id % COLORS.length]);
    container.classList.toggle('pinned', !!thread.pinned);

    container.innerHTML = `
        <div class="thread-header">
            <button class="thread-emoji" title="Change emoji · drag to reorder"></button>
            <button class="color-dot" title="Change color"></button>
            <h3 class="thread-title" contenteditable="true" spellcheck="false"></h3>
            <div class="button-group">
                <button class="btn btn-pin" title="Pin">📌</button>
                <button class="btn btn-focus" title="Focus mode (Alt+F)">🔍</button>
                <button class="btn btn-copy" title="Copy">📋</button>
                <button class="btn btn-export" title="Download as Markdown">💾</button>
                <button class="btn btn-clear" title="Clear">🧽</button>
                <button class="btn btn-delete" title="Delete thread">🗑️</button>
            </div>
        </div>
        <textarea class="editor" spellcheck="true"></textarea>
        <div class="thread-footer">
            <span class="counts"></span>
            <span class="save-state">✓ saved</span>
        </div>`;

    const emojiBtn = container.querySelector('.thread-emoji');
    const colorDot = container.querySelector('.color-dot');
    const title = container.querySelector('.thread-title');
    const editor = container.querySelector('.editor');
    const saveState = container.querySelector('.save-state');
    const pinBtn = container.querySelector('.btn-pin');

    emojiBtn.textContent = thread.emoji || '📝';
    title.textContent = thread.title || threadTitleFallback(thread);
    editor.value = thread.content || '';
    editor.placeholder = pick(PROMPTS);
    pinBtn.classList.toggle('on', !!thread.pinned);
    updateFooter(container);

    // Saving
    const saveContent = debounce(async () => {
        const saved = await updateThread(thread.id, { content: editor.value });
        saveState.classList.remove('saving');
        saveState.textContent = saved ? '✓ saved' : '⚠️ not saved';
    }, 400);

    function markDirty() {
        saveState.classList.add('saving');
        saveState.textContent = '… saving';
        updateFooter(container);
        saveContent();
    }

    // Title
    title.addEventListener('focus', function() {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(this);
        selection.removeAllRanges();
        selection.addRange(range);
    });

    title.addEventListener('keydown', function(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            this.blur();
        }
    });

    title.addEventListener('blur', async () => {
        const newTitle = title.textContent.trim();
        if (newTitle === '') {
            title.textContent = threadTitleFallback(thread);
            return;
        }
        if (checkDuplicateTitle(container, newTitle)) {
            showWarning('Duplicate title detected! Each thread should have a unique name.');
            container.classList.remove('wiggle');
            void container.offsetWidth;
            container.classList.add('wiggle');
        }
        await updateThread(thread.id, { title: newTitle });
    });

    // Editor: Enter starts a new timestamped entry, Shift+Enter is a plain newline
    editor.addEventListener('keydown', function(event) {
        if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
        event.preventDefault();

        const lineStart = this.value.lastIndexOf('\n', this.selectionStart - 1) + 1;
        const finishedLine = this.value.slice(lineStart, this.selectionStart);
        const hasContent = finishedLine.replace(/^\[[^\]]*\]\s*/, '').trim().length > 0;

        this.setRangeText(`\n${getTimestamp()}`, this.selectionStart, this.selectionEnd, 'end');
        markDirty();
        if (hasContent) logEntry(finishedLine);
    });

    // Handles typing, paste and anything keydown didn't catch (e.g. mobile keyboards)
    editor.addEventListener('input', function(event) {
        if (event.inputType === 'insertLineBreak' || event.inputType === 'insertParagraph') {
            const lines = this.value.split('\n');
            const lineIndex = this.value.slice(0, this.selectionStart).split('\n').length - 1;
            if (!lines[lineIndex].startsWith('[')) {
                const cursor = this.selectionStart;
                const timestamp = getTimestamp();
                lines[lineIndex] = timestamp + lines[lineIndex];
                this.value = lines.join('\n');
                this.selectionStart = this.selectionEnd = cursor + timestamp.length;
            }
        }
        markDirty();
    });

    editor.addEventListener('focus', function() {
        if (this.value === '') {
            this.value = getTimestamp();
            markDirty();
        }
        state.activeEditor = this;
    });

    // Emoji & color
    emojiBtn.addEventListener('click', () => {
        openPicker(emojiBtn, EMOJIS, (b, e) => (b.textContent = e), async emoji => {
            emojiBtn.textContent = emoji;
            await updateThread(thread.id, { emoji });
        });
    });

    colorDot.addEventListener('click', () => {
        openPicker(colorDot, COLORS, (b, c) => {
            b.className = 'swatch';
            b.style.background = c;
            b.title = c;
        }, async color => {
            container.style.setProperty('--thread-color', color);
            await updateThread(thread.id, { color });
        });
    });

    // Buttons
    pinBtn.addEventListener('click', async () => {
        const pinned = !container.classList.contains('pinned');
        container.classList.toggle('pinned', pinned);
        pinBtn.classList.toggle('on', pinned);
        if (pinned) {
            grid.prepend(container);
        } else {
            const lastPinned = [...grid.querySelectorAll('.thread-container.pinned')].pop();
            lastPinned ? lastPinned.after(container) : grid.prepend(container);
        }
        await updateThread(thread.id, { pinned });
        await saveOrder();
        showToast(pinned ? '📌 Pinned to the top' : 'Unpinned', { duration: 1500 });
    });

    container.querySelector('.btn-focus').addEventListener('click', () => toggleFocus(container));

    const copyBtn = container.querySelector('.btn-copy');
    copyBtn.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(editor.value);
            copyBtn.textContent = '✅';
        } catch {
            copyBtn.textContent = '❌';
        }
        setTimeout(() => (copyBtn.textContent = '📋'), 1000);
    });

    container.querySelector('.btn-export').addEventListener('click', () => {
        const name = title.textContent.trim() || threadTitleFallback(thread);
        download(`${name.replace(/[^\w-]+/g, '_')}.md`, threadToMarkdown(name, emojiBtn.textContent, editor.value));
    });

    container.querySelector('.btn-clear').addEventListener('click', async () => {
        if (confirm('Clear this thread? 🧽')) {
            const clearedThread = await clearThread(thread.id);
            if (clearedThread) {
                editor.value = '';
                title.textContent = threadTitleFallback(thread);
                updateFooter(container);
            }
        }
    });

    container.querySelector('.btn-delete').addEventListener('click', () => {
        if (container.classList.contains('focused')) toggleFocus();
        saveContent.flush();
        container.classList.add('leaving');
        const placeholder = document.createComment('deleted thread');
        setTimeout(() => container.replaceWith(placeholder), 280);

        const timeout = setTimeout(async () => {
            state.pendingDeletes.delete(thread.id);
            placeholder.remove();
            await deleteThread(thread.id);
            renderStats();
        }, 5000);
        state.pendingDeletes.set(thread.id, timeout);

        showToast(`🗑️ Deleted “${title.textContent.trim()}”`, {
            duration: 5000,
            action: {
                label: 'Undo',
                onClick: () => {
                    clearTimeout(timeout);
                    state.pendingDeletes.delete(thread.id);
                    setTimeout(() => {
                        container.classList.remove('leaving');
                        if (placeholder.isConnected) placeholder.replaceWith(container);
                    }, 300);
                }
            }
        });
    });

    // Drag & drop reordering (grab the emoji)
    emojiBtn.addEventListener('mousedown', () => (container.draggable = true));
    container.addEventListener('dragstart', event => {
        container.classList.add('dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(thread.id));
    });
    container.addEventListener('dragend', () => {
        container.draggable = false;
        container.classList.remove('dragging');
        grid.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
    });
    container.addEventListener('dragover', event => {
        if (!grid.querySelector('.dragging') || container.classList.contains('dragging')) return;
        event.preventDefault();
        container.classList.add('drop-target');
    });
    container.addEventListener('dragleave', () => container.classList.remove('drop-target'));
    container.addEventListener('drop', async event => {
        event.preventDefault();
        container.classList.remove('drop-target');
        const dragged = grid.querySelector('.dragging');
        if (!dragged || dragged === container) return;
        const draggedBefore = [...grid.children].indexOf(dragged) < [...grid.children].indexOf(container);
        draggedBefore ? container.after(dragged) : container.before(dragged);
        await saveOrder();
    });

    return container;
}

function applySearch() {
    const query = searchInput.value.trim().toLowerCase();
    let visible = 0;
    grid.querySelectorAll('.thread-container').forEach(container => {
        const haystack = `${container.querySelector('.thread-title').textContent}\n${container.querySelector('.editor').value}`.toLowerCase();
        const match = !query || haystack.includes(query);
        container.classList.toggle('hidden', !match);
        if (match) visible++;
    });
    emptySearch.hidden = visible > 0 || !query;
}

// Theme
function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    store.set('theme', theme);
    const seen = new Set(store.get('themesSeen', []));
    seen.add(theme);
    store.set('themesSeen', [...seen]);
}

function cycleTheme() {
    const current = document.documentElement.dataset.theme;
    const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
    applyTheme(next);
    showToast(`Theme: ${THEME_NAMES[next]}`, { duration: 1200 });
    checkAchievements();
}

// Header: clock, greeting
function greet() {
    const hour = new Date().getHours();
    const options =
        hour < 5 ? ['Burning the midnight oil? 🌙', 'The bugs come out at night. 🐛', 'Shh, the code is sleeping.'] :
        hour < 12 ? ['Good morning! ☀️', 'Fresh day, fresh threads.', 'Coffee first, then commits. ☕'] :
        hour < 17 ? ['Good afternoon! 🌤️', 'Keep that momentum going.', 'Post-lunch productivity mode. 🍝'] :
        hour < 21 ? ['Good evening! 🌇', 'Wrapping up? Log your wins.', 'Golden hour for brain dumps.'] :
        ['Late night thoughts? 🌌', 'One more entry, then sleep. 😴', 'Night mode engaged.'];
    document.getElementById('greeting').textContent = pick(options);
}

function tickClock() {
    document.getElementById('clock').textContent = new Date().toLocaleTimeString();
}

// Pomodoro
const pomodoro = { remaining: POMODORO_SECONDS, timer: null };
const pomodoroBtn = document.getElementById('pomodoroBtn');
const pomodoroTime = document.getElementById('pomodoroTime');

function formatSeconds(total) {
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function renderPomodoro() {
    pomodoroTime.textContent = formatSeconds(pomodoro.remaining);
    pomodoroBtn.classList.toggle('running', !!pomodoro.timer);
    document.title = pomodoro.timer ? `🍅 ${formatSeconds(pomodoro.remaining)} · Timestamper` : 'Timestamper';
}

function stopPomodoro() {
    clearInterval(pomodoro.timer);
    pomodoro.timer = null;
    pomodoro.remaining = POMODORO_SECONDS;
    renderPomodoro();
}

function beep() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        [0, 0.25, 0.5].forEach((offset, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.frequency.value = [660, 880, 1320][i];
            gain.gain.setValueAtTime(0.15, ctx.currentTime + offset);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.2);
            osc.connect(gain).connect(ctx.destination);
            osc.start(ctx.currentTime + offset);
            osc.stop(ctx.currentTime + offset + 0.2);
        });
    } catch { /* no audio: fine */ }
}

function completePomodoro() {
    stopPomodoro();
    store.set('pomodoros', store.get('pomodoros', 0) + 1);
    beep();
    confetti(150);
    showToast('🍅 Pomodoro complete! Take a 5 minute break.', { type: 'achievement', duration: 5000 });

    const editor = state.activeEditor?.isConnected ? state.activeEditor : grid.querySelector('.editor');
    if (editor) {
        const prefix = editor.value && !editor.value.endsWith('\n') ? '\n' : '';
        editor.value += `${prefix}${getTimestamp()}🍅 Finished a 25 minute focus session`;
        editor.dispatchEvent(new Event('input'));
        logEntry('pomodoro');
    }
    checkAchievements();
}

pomodoroBtn.addEventListener('click', () => {
    if (pomodoro.timer) {
        stopPomodoro();
        showToast('Pomodoro cancelled', { duration: 1500 });
        return;
    }
    pomodoro.timer = setInterval(() => {
        pomodoro.remaining--;
        if (pomodoro.remaining <= 0) completePomodoro();
        else renderPomodoro();
    }, 1000);
    renderPomodoro();
    showToast('🍅 Focus for 25 minutes. You got this!', { duration: 2000 });
});

// Initialize the application
async function initializeApp() {
    applyTheme(store.get('theme', THEMES[0]));
    greet();
    tickClock();
    setInterval(tickClock, 1000);

    const [threads] = await Promise.all([fetchThreads(), fetchActivity()]);
    threads.forEach(thread => grid.appendChild(createThreadElement(thread)));

    // If no threads exist, create initial threads
    if (threads.length === 0) {
        for (let i = 0; i < 4; i++) {
            const newThread = await createThread();
            if (newThread) grid.appendChild(createThreadElement(newThread));
        }
        showToast('👋 Welcome! Click a thread and start typing. Press ? for tricks.', { duration: 6000 });
    }

    renderStats();
    checkAchievements({ silent: true });
}

// Event Listeners
async function addThread() {
    const newThread = await createThread();
    if (newThread) {
        const threadElement = createThreadElement(newThread);
        grid.appendChild(threadElement);
        threadElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const rect = threadElement.getBoundingClientRect();
        confetti(40, { x: rect.left + rect.width / 2, y: Math.min(rect.top + 40, window.innerHeight - 100) });
        renderStats();
        checkAchievements();
    }
}

addThreadBtn.addEventListener('click', addThread);

clearAllBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear ALL threads? This cannot be undone. 😱')) {
        const threads = await fetchThreads();
        for (const thread of threads) {
            await clearThread(thread.id);
        }
        window.location.reload();
    }
});

exportBtn.addEventListener('click', () => {
    const sections = [...grid.querySelectorAll('.thread-container')].map(container =>
        threadToMarkdown(
            container.querySelector('.thread-title').textContent.trim(),
            container.querySelector('.thread-emoji').textContent,
            container.querySelector('.editor').value
        )
    );
    download(`timestamper-${localDay()}.md`, sections.join('\n---\n\n'));
    showToast('📦 Exported all threads');
});

searchInput.addEventListener('input', applySearch);
document.getElementById('themeBtn').addEventListener('click', cycleTheme);
document.getElementById('helpBtn').addEventListener('click', () => openModal('helpModal'));
document.getElementById('levelBtn').addEventListener('click', openStats);

document.getElementById('brandLogo').addEventListener('click', event => {
    const logo = event.currentTarget;
    logo.classList.remove('spin');
    void logo.offsetWidth;
    logo.classList.add('spin');
    confetti(50, { x: event.clientX, y: event.clientY });
    greet();
});

document.addEventListener('keydown', event => {
    const typing = event.target.matches('input, textarea, [contenteditable="true"]');

    if (event.key === 'Escape') {
        closePicker();
        closeModals();
        if (document.querySelector('.thread-container.focused')) toggleFocus();
        if (event.target === searchInput) {
            searchInput.value = '';
            applySearch();
            searchInput.blur();
        }
        return;
    }

    if (event.altKey && !event.ctrlKey && !event.metaKey) {
        const key = event.code;
        if (key === 'KeyN') { event.preventDefault(); addThread(); }
        if (key === 'KeyT') { event.preventDefault(); cycleTheme(); }
        if (key === 'KeyF') {
            event.preventDefault();
            const container = document.activeElement?.closest('.thread-container') || state.activeEditor?.closest('.thread-container');
            if (container) toggleFocus(container);
            else showToast('Click into a thread first 🙂', { duration: 1500 });
        }
        return;
    }

    if (typing) return;
    if (event.key === '/') { event.preventDefault(); searchInput.focus(); }
    if (event.key === '?') openModal('helpModal');
});

// Make sure pending deletes go through if the tab closes during the undo window
window.addEventListener('beforeunload', () => {
    for (const [id, timeout] of state.pendingDeletes) {
        clearTimeout(timeout);
        deleteThread(id, { keepalive: true });
    }
});

// Start the application
initializeApp();
