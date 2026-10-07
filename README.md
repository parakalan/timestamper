# ⏱️ Timestamper

A multi-threaded work journal where every line gets a timestamp. Now with confetti.

```
npm install
npm start        # http://localhost:3000
```

Set `PORT` or `DB_PATH` env vars to change where it runs and where the SQLite database lives.

## What it does

- **Threads**: separate journals side by side. Press <kbd>Enter</kbd> and the new line is stamped `[date time]`; <kbd>Shift</kbd>+<kbd>Enter</kbd> gives a plain line.
- **Make them yours**: give each thread an emoji and a color, pin it to the top, or drag it by its emoji to reorder.
- **Focus mode** (<kbd>Alt</kbd>+<kbd>F</kbd>) blows up one thread to fill the screen.
- **Search** (<kbd>/</kbd>) filters threads by title and content.
- **Export** one thread or all of them as Markdown.
- **Delete with undo**: you get 5 seconds to change your mind.

## The fun bits

- 🔥 **Streaks** and a ✍️ count of today's entries in the header
- ⭐ **XP and levels**: every entry counts toward the next level
- 📈 **Stats** (click your level): a GitHub-style activity heatmap and 15 achievements to unlock
- 🎉 **Confetti** when an entry ends with `#win`, `✅`, `done!`, or `shipped`
- 🍅 **Pomodoro timer**: a finished session gets logged in the thread you're working in
- 🎨 **Five themes** (<kbd>Alt</kbd>+<kbd>T</kbd>): Paper, Midnight, Synthwave, Terminal, Bubblegum

Press <kbd>?</kbd> in the app for every shortcut.
