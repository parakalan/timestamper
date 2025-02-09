// Constants
const API_URL = '/api'; // Changed to relative path
const grid = document.getElementById('threadsGrid');
const addThreadBtn = document.getElementById('addThreadBtn');
const clearAllBtn = document.getElementById('clearAllBtn');
const warningElement = document.getElementById('warning');

// Utility Functions
function showWarning(message, duration = 3000) {
    warningElement.textContent = message;
    warningElement.style.display = 'block';
    setTimeout(() => {
        warningElement.style.display = 'none';
    }, duration);
}

function getTimestamp() {
    const now = new Date();
    return `[${now.toLocaleDateString()} ${now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}] `;
}

// API Functions
async function fetchThreads() {
    try {
        const response = await fetch(`${API_URL}/threads`);
        const data = await response.json();
        return data.threads;
    } catch (error) {
        console.error('Error fetching threads:', error);
        showWarning('Failed to load threads');
        return [];
    }
}

async function createThread() {
    try {
        const response = await fetch(`${API_URL}/threads`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        const data = await response.json();
        return data.thread;
    } catch (error) {
        console.error('Error creating thread:', error);
        showWarning('Failed to create new thread');
        return null;
    }
}

async function updateThread(id, updates) {
    try {
        const response = await fetch(`${API_URL}/threads/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updates)
        });
        const data = await response.json();
        return data.thread;
    } catch (error) {
        console.error('Error updating thread:', error);
        showWarning('Failed to save changes');
        return null;
    }
}

async function clearThread(id) {
    try {
        const response = await fetch(`${API_URL}/threads/${id}/clear`, {
            method: 'POST'
        });
        const data = await response.json();
        return data.thread;
    } catch (error) {
        console.error('Error clearing thread:', error);
        showWarning('Failed to clear thread');
        return null;
    }
}

// DOM Functions
function createThreadElement(thread) {
    const container = document.createElement('div');
    container.className = 'thread-container';
    container.dataset.threadId = thread.id;

    // Create header
    const header = document.createElement('div');
    header.className = 'thread-header';

    // Create title
    const title = document.createElement('h3');
    title.className = 'thread-title';
    title.contentEditable = true;
    title.textContent = thread.title || `Thread ${thread.id}`;

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

    // Create button group
    const buttonGroup = document.createElement('div');
    buttonGroup.className = 'button-group';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn btn-copy';
    copyBtn.textContent = 'Copy';

    const clearBtn = document.createElement('button');
    clearBtn.className = 'btn btn-clear';
    clearBtn.textContent = 'Clear';

    // Create editor
    const editor = document.createElement('textarea');
    editor.className = 'editor';
    editor.placeholder = 'Start typing...';
    editor.value = thread.content || '';

    // Event Listeners
    let lastLineCount = editor.value.split('\n').length;
    let lastValue = editor.value;

    // Title blur event
    title.addEventListener('blur', async () => {
        const newTitle = title.textContent.trim();
        if (newTitle === '') {
            title.textContent = `Thread ${thread.id}`;
            return;
        }
        await updateThread(thread.id, { title: newTitle });
    });

    // Editor input event
    editor.addEventListener('input', async function() {
        const lines = this.value.split('\n');
        const oldLines = lastValue.split('\n');
        const currentLineCount = lines.length;

        // Handle timestamp modifications
        if (currentLineCount > lastLineCount) {
            const timestamp = getTimestamp();
            if (!lines[currentLineCount - 1].startsWith('[')) {
                lines[currentLineCount - 1] = timestamp + lines[currentLineCount - 1];
            }
        }

        this.value = lines.join('\n');
        lastValue = this.value;
        lastLineCount = currentLineCount;

        // Save to backend
        await updateThread(thread.id, { content: this.value });
    });

    // Editor focus event
    editor.addEventListener('focus', function() {
        if (this.value === '') {
            this.value = getTimestamp();
            lastValue = this.value;
        }
        document.querySelectorAll('.editor').forEach(ed => ed.classList.remove('active'));
        this.classList.add('active');
    });

    // Copy button click
    copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(editor.value);
        const originalText = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        setTimeout(() => copyBtn.textContent = originalText, 1000);
    });

    // Clear button click
    clearBtn.addEventListener('click', async () => {
        if (confirm('Clear this thread?')) {
            const clearedThread = await clearThread(thread.id);
            if (clearedThread) {
                editor.value = '';
                title.textContent = `Thread ${thread.id}`;
            }
        }
    });

    // Assemble the thread element
    buttonGroup.appendChild(copyBtn);
    buttonGroup.appendChild(clearBtn);
    header.appendChild(title);
    header.appendChild(buttonGroup);
    container.appendChild(header);
    container.appendChild(editor);

    return container;
}

// Initialize the application
async function initializeApp() {
    // Load existing threads
    const threads = await fetchThreads();
    threads.forEach(thread => {
        grid.appendChild(createThreadElement(thread));
    });

    // If no threads exist, create initial threads
    if (threads.length === 0) {
        for (let i = 0; i < 4; i++) {
            const newThread = await createThread();
            if (newThread) {
                grid.appendChild(createThreadElement(newThread));
            }
        }
    }
}

// Event Listeners
addThreadBtn.addEventListener('click', async () => {
    const newThread = await createThread();
    if (newThread) {
        const threadElement = createThreadElement(newThread);
        grid.appendChild(threadElement);
        // Scroll to new thread
        window.scrollTo({
            top: document.body.scrollHeight,
            behavior: 'smooth'
        });
    }
});

clearAllBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear ALL threads? This cannot be undone.')) {
        const threads = await fetchThreads();
        for (const thread of threads) {
            await clearThread(thread.id);
        }
        // Refresh the page to show cleared state
        window.location.reload();
    }
});

// Start the application
initializeApp();