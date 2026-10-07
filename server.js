// server.js
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const morgan = require('morgan');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: `http://localhost:${PORT}`,
    methods: ['GET', 'POST', 'PUT', 'DELETE']
}));
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev')); // Request logging

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Database setup
let db;
try {
    db = new Database(process.env.DB_PATH || path.join(__dirname, 'threads.db'));

    db.exec(`
        CREATE TABLE IF NOT EXISTS threads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT DEFAULT '',
            content TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        -- One row per local day the user wrote something; powers streaks + heatmap
        CREATE TABLE IF NOT EXISTS activity (
            day TEXT PRIMARY KEY,
            entries INTEGER NOT NULL DEFAULT 0
        );
    `);

    // Lightweight migrations for databases created by older versions
    const columns = db.prepare('PRAGMA table_info(threads)').all().map(c => c.name);
    const migrations = {
        emoji: "ALTER TABLE threads ADD COLUMN emoji TEXT DEFAULT ''",
        color: "ALTER TABLE threads ADD COLUMN color TEXT DEFAULT ''",
        pinned: 'ALTER TABLE threads ADD COLUMN pinned INTEGER DEFAULT 0',
        position: 'ALTER TABLE threads ADD COLUMN position INTEGER',
        updated_at: 'ALTER TABLE threads ADD COLUMN updated_at TIMESTAMP'
    };
    for (const [column, sql] of Object.entries(migrations)) {
        if (!columns.includes(column)) db.exec(sql);
    }
    db.exec('UPDATE threads SET position = id WHERE position IS NULL');
} catch (err) {
    console.error('Database initialization failed:', err);
    process.exit(1);
}

// Prepare statements
const getThreadsStmt = db.prepare('SELECT * FROM threads ORDER BY pinned DESC, position ASC, id ASC');
const createThreadStmt = db.prepare(`
    INSERT INTO threads (title, content, emoji, color, position, updated_at)
    VALUES ($title, $content, $emoji, $color,
            (SELECT COALESCE(MAX(position), 0) + 1 FROM threads), CURRENT_TIMESTAMP)
`);
const updateThreadStmt = db.prepare(`
    UPDATE threads
    SET title = COALESCE($title, title),
        content = COALESCE($content, content),
        emoji = COALESCE($emoji, emoji),
        color = COALESCE($color, color),
        pinned = COALESCE($pinned, pinned),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $id
`);
const getThreadByIdStmt = db.prepare('SELECT * FROM threads WHERE id = ?');
const clearThreadStmt = db.prepare(`
    UPDATE threads
    SET title = '', content = '', updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
`);
const deleteThreadStmt = db.prepare('DELETE FROM threads WHERE id = ?');
const setPositionStmt = db.prepare('UPDATE threads SET position = ? WHERE id = ?');
const logActivityStmt = db.prepare(`
    INSERT INTO activity (day, entries) VALUES (?, ?)
    ON CONFLICT(day) DO UPDATE SET entries = entries + excluded.entries
`);
const getActivityStmt = db.prepare('SELECT day, entries FROM activity ORDER BY day ASC');

const reorderThreads = db.transaction(ids => {
    ids.forEach((id, index) => setPositionStmt.run(index + 1, id));
});

const STARTER_EMOJIS = ['🚀', '🧠', '🛠️', '📚', '🎯', '🐛', '☕', '🌱', '🎨', '🔥', '🪐', '🦄'];
const STARTER_COLORS = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#4dabf7', '#9775fa', '#f783ac', '#38d9a9'];
const pick = list => list[Math.floor(Math.random() * list.length)];

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// API Routes
const apiRouter = express.Router();

// GET /api/threads - Get all threads
apiRouter.get('/threads', (req, res) => {
    try {
        const threads = getThreadsStmt.all();
        res.json({ threads });
    } catch (err) {
        console.error('Error fetching threads:', err);
        res.status(500).json({ error: 'Failed to fetch threads' });
    }
});

// POST /api/threads - Create new thread
apiRouter.post('/threads', (req, res) => {
    try {
        const result = createThreadStmt.run({
            title: '',
            content: '',
            emoji: pick(STARTER_EMOJIS),
            color: pick(STARTER_COLORS)
        });

        const thread = getThreadByIdStmt.get(result.lastInsertRowid);
        res.status(201).json({ thread });
    } catch (err) {
        console.error('Error creating thread:', err);
        res.status(500).json({ error: 'Failed to create thread' });
    }
});

// PUT /api/threads/reorder - Persist drag-and-drop order
apiRouter.put('/threads/reorder', (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.every(Number.isInteger)) {
        return res.status(400).json({ error: 'ids must be an array of integers' });
    }

    try {
        reorderThreads(ids);
        res.json({ ok: true });
    } catch (err) {
        console.error('Error reordering threads:', err);
        res.status(500).json({ error: 'Failed to reorder threads' });
    }
});

// PUT /api/threads/:id - Update thread
apiRouter.put('/threads/:id', (req, res) => {
    const { id } = req.params;
    const { title, content, emoji, color, pinned } = req.body;

    try {
        // Verify thread exists
        const existingThread = getThreadByIdStmt.get(id);
        if (!existingThread) {
            return res.status(404).json({ error: 'Thread not found' });
        }

        // Update thread
        updateThreadStmt.run({
            id: parseInt(id),
            title: title ?? null,
            content: content ?? null,
            emoji: emoji ?? null,
            color: color ?? null,
            pinned: pinned === undefined ? null : (pinned ? 1 : 0)
        });

        const updatedThread = getThreadByIdStmt.get(id);
        res.json({ thread: updatedThread });
    } catch (err) {
        console.error('Error updating thread:', err);
        res.status(500).json({ error: 'Failed to update thread' });
    }
});

// POST /api/threads/:id/clear - Clear thread
apiRouter.post('/threads/:id/clear', (req, res) => {
    const { id } = req.params;

    try {
        // Verify thread exists
        const existingThread = getThreadByIdStmt.get(id);
        if (!existingThread) {
            return res.status(404).json({ error: 'Thread not found' });
        }

        // Clear thread
        clearThreadStmt.run(id);

        const clearedThread = getThreadByIdStmt.get(id);
        res.json({ thread: clearedThread });
    } catch (err) {
        console.error('Error clearing thread:', err);
        res.status(500).json({ error: 'Failed to clear thread' });
    }
});

// DELETE /api/threads/:id - Delete thread entirely
apiRouter.delete('/threads/:id', (req, res) => {
    const { id } = req.params;

    try {
        const existingThread = getThreadByIdStmt.get(id);
        if (!existingThread) {
            return res.status(404).json({ error: 'Thread not found' });
        }

        deleteThreadStmt.run(id);
        res.json({ thread: existingThread });
    } catch (err) {
        console.error('Error deleting thread:', err);
        res.status(500).json({ error: 'Failed to delete thread' });
    }
});

// POST /api/activity - Log journal entries for a (client-local) day
apiRouter.post('/activity', (req, res) => {
    const { day, entries = 1 } = req.body;
    if (!DAY_RE.test(day || '') || !Number.isInteger(entries) || entries < 1 || entries > 1000) {
        return res.status(400).json({ error: 'Invalid activity payload' });
    }

    try {
        logActivityStmt.run(day, entries);
        res.status(201).json({ ok: true });
    } catch (err) {
        console.error('Error logging activity:', err);
        res.status(500).json({ error: 'Failed to log activity' });
    }
});

// GET /api/activity - All logged days
apiRouter.get('/activity', (req, res) => {
    try {
        res.json({ activity: getActivityStmt.all() });
    } catch (err) {
        console.error('Error fetching activity:', err);
        res.status(500).json({ error: 'Failed to fetch activity' });
    }
});

// Mount API routes under /api
app.use('/api', apiRouter);

// Serve index.html for all other routes (SPA support)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something broke!' });
});

// Start server
app.listen(PORT, () => {
    console.log(`⏱️  Timestamper running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Closing database connection...');
    db.close();
    process.exit(0);
});
