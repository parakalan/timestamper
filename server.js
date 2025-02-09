// server.js
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const morgan = require('morgan');
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors({
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST', 'PUT', 'DELETE']
}));
app.use(express.json());
app.use(morgan('dev')); // Request logging

// Serve static files from 'public' directory
app.use(express.static('public'));

// Database setup
let db;
try {
    db = new Database('threads.db', { verbose: console.log });
    
    // Create threads table if it doesn't exist
    db.exec(`
        CREATE TABLE IF NOT EXISTS threads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT DEFAULT '',
            content TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
} catch (err) {
    console.error('Database initialization failed:', err);
    process.exit(1);
}

// Prepare statements
const getThreadsStmt = db.prepare('SELECT * FROM threads ORDER BY created_at ASC');
const createThreadStmt = db.prepare(`
    INSERT INTO threads (title, content) 
    VALUES ($title, $content)
`);
const updateThreadStmt = db.prepare(`
    UPDATE threads 
    SET title = COALESCE($title, title),
        content = COALESCE($content, content)
    WHERE id = $id
`);
const getThreadByIdStmt = db.prepare('SELECT * FROM threads WHERE id = ?');
const clearThreadStmt = db.prepare(`
    UPDATE threads 
    SET title = '', content = ''
    WHERE id = ?
`);

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
            content: ''
        });
        
        const thread = getThreadByIdStmt.get(result.lastInsertRowid);
        res.status(201).json({ thread });
    } catch (err) {
        console.error('Error creating thread:', err);
        res.status(500).json({ error: 'Failed to create thread' });
    }
});

// PUT /api/threads/:id - Update thread
apiRouter.put('/threads/:id', (req, res) => {
    const { id } = req.params;
    const { title, content } = req.body;

    try {
        // Verify thread exists
        const existingThread = getThreadByIdStmt.get(id);
        if (!existingThread) {
            return res.status(404).json({ error: 'Thread not found' });
        }

        // Update thread
        updateThreadStmt.run({
            id: parseInt(id),
            title,
            content
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
    console.log(`Server running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Closing database connection...');
    db.close();
    process.exit(0);
});