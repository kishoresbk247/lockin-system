const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const { getDb } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'lockin-system-secret-key-2024';

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ============ AUTH MIDDLEWARE ============
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Not authenticated' });
  const token = header.replace('Bearer ', '');
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    req.username = decoded.username;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ============ AUTH ROUTES ============

app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    if (username.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
    if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
    if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.status(400).json({ error: 'Username: letters, numbers, underscores only' });

    const db = await getDb();
    const existing = db.queryOne('SELECT id FROM users WHERE username = ?', [username]);
    if (existing) return res.status(409).json({ error: 'Username already taken' });

    const hash = bcrypt.hashSync(password, 10);
    const result = db.runSql('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, hash]);
    db.saveDb();

    const token = jwt.sign({ userId: result.lastInsertRowid, username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: result.lastInsertRowid, username } });
  } catch (e) {
    console.error('Register error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const db = await getDb();
    const user = db.queryOne('SELECT * FROM users WHERE username = ?', [username]);
    if (!user) return res.status(401).json({ error: 'Invalid username or password' });

    if (!bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/me', auth, async (req, res) => {
  try {
    const db = await getDb();
    const user = db.queryOne('SELECT id, username, created_at FROM users WHERE id = ?', [req.userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (e) {
    console.error('Me error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ HABIT ROUTES ============

app.get('/api/habits', auth, async (req, res) => {
  try {
    const db = await getDb();
    const habits = db.queryAll('SELECT * FROM habits WHERE user_id = ? ORDER BY created_at ASC', [req.userId]);

    const result = habits.map(h => {
      const history = db.queryAll('SELECT date FROM habit_history WHERE habit_id = ?', [h.id]);
      const historyObj = {};
      history.forEach(row => { historyObj[row.date] = true; });
      return { ...h, history: historyObj };
    });

    res.json({ habits: result });
  } catch (e) {
    console.error('Get habits error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/habits', auth, async (req, res) => {
  try {
    const { name, sub, icon, color } = req.body;
    if (!name) return res.status(400).json({ error: 'Habit name required' });

    const db = await getDb();
    const result = db.runSql(
      'INSERT INTO habits (user_id, name, sub, icon, color) VALUES (?, ?, ?, ?, ?)',
      [req.userId, name, sub || '', icon || '\uD83D\uDCAA', color || '#7c5cff']
    );
    db.saveDb();

    res.json({
      habit: {
        id: result.lastInsertRowid,
        user_id: req.userId,
        name,
        sub: sub || '',
        icon: icon || '\uD83D\uDCAA',
        color: color || '#7c5cff',
        history: {}
      }
    });
  } catch (e) {
    console.error('Create habit error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/habits/:id', auth, async (req, res) => {
  try {
    const db = await getDb();
    const habit = db.queryOne('SELECT * FROM habits WHERE id = ? AND user_id = ?', [Number(req.params.id), req.userId]);
    if (!habit) return res.status(404).json({ error: 'Habit not found' });

    db.runSql('DELETE FROM habit_history WHERE habit_id = ?', [Number(req.params.id)]);
    db.runSql('DELETE FROM habits WHERE id = ?', [Number(req.params.id)]);
    db.saveDb();
    res.json({ success: true });
  } catch (e) {
    console.error('Delete habit error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/habits/:id/toggle', auth, async (req, res) => {
  try {
    const { date } = req.body;
    if (!date) return res.status(400).json({ error: 'Date required' });

    const db = await getDb();
    const habitId = Number(req.params.id);
    const habit = db.queryOne('SELECT * FROM habits WHERE id = ? AND user_id = ?', [habitId, req.userId]);
    if (!habit) return res.status(404).json({ error: 'Habit not found' });

    const existing = db.queryOne('SELECT id FROM habit_history WHERE habit_id = ? AND date = ?', [habitId, date]);
    if (existing) {
      db.runSql('DELETE FROM habit_history WHERE habit_id = ? AND date = ?', [habitId, date]);
    } else {
      db.runSql('INSERT INTO habit_history (habit_id, date) VALUES (?, ?)', [habitId, date]);
    }
    db.saveDb();

    const history = db.queryAll('SELECT date FROM habit_history WHERE habit_id = ?', [habitId]);
    const historyObj = {};
    history.forEach(row => { historyObj[row.date] = true; });

    res.json({ toggled: !existing, history: historyObj });
  } catch (e) {
    console.error('Toggle error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ FRIEND ROUTES ============

app.get('/api/users/search', auth, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json({ users: [] });

    const db = await getDb();
    const users = db.queryAll(
      'SELECT id, username FROM users WHERE username LIKE ? AND id != ? LIMIT 10',
      [`%${q}%`, req.userId]
    );
    res.json({ users });
  } catch (e) {
    console.error('Search error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/friends/request', auth, async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Username required' });

    const db = await getDb();
    const toUser = db.queryOne('SELECT id FROM users WHERE username = ?', [username]);
    if (!toUser) return res.status(404).json({ error: 'User not found' });
    if (toUser.id === req.userId) return res.status(400).json({ error: 'Cannot send request to yourself' });

    const alreadyFriends = db.queryOne(
      `SELECT id FROM friend_requests WHERE status = 'accepted' AND (
        (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))`,
      [req.userId, toUser.id, toUser.id, req.userId]
    );
    if (alreadyFriends) return res.status(400).json({ error: 'Already friends' });

    const existingRequest = db.queryOne(
      `SELECT id, status, from_user_id FROM friend_requests
       WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)`,
      [req.userId, toUser.id, toUser.id, req.userId]
    );

    if (existingRequest) {
      if (existingRequest.status === 'pending') {
        if (existingRequest.from_user_id === toUser.id) {
          db.runSql("UPDATE friend_requests SET status = 'accepted' WHERE id = ?", [existingRequest.id]);
          db.saveDb();
          return res.json({ message: 'Friend request accepted! You are now friends.', autoAccepted: true });
        }
        return res.status(400).json({ error: 'Friend request already sent' });
      }
      if (existingRequest.status === 'rejected') {
        db.runSql('DELETE FROM friend_requests WHERE id = ?', [existingRequest.id]);
      }
    }

    db.runSql('INSERT INTO friend_requests (from_user_id, to_user_id) VALUES (?, ?)', [req.userId, toUser.id]);
    db.saveDb();
    res.json({ message: 'Friend request sent!' });
  } catch (e) {
    console.error('Friend request error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/friends/requests', auth, async (req, res) => {
  try {
    const db = await getDb();
    const incoming = db.queryAll(
      `SELECT fr.id, fr.from_user_id, fr.created_at, u.username
       FROM friend_requests fr JOIN users u ON u.id = fr.from_user_id
       WHERE fr.to_user_id = ? AND fr.status = 'pending' ORDER BY fr.created_at DESC`,
      [req.userId]
    );
    const sent = db.queryAll(
      `SELECT fr.id, fr.to_user_id, fr.created_at, u.username
       FROM friend_requests fr JOIN users u ON u.id = fr.to_user_id
       WHERE fr.from_user_id = ? AND fr.status = 'pending' ORDER BY fr.created_at DESC`,
      [req.userId]
    );
    res.json({ incoming, sent });
  } catch (e) {
    console.error('Get requests error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/friends/accept/:requestId', auth, async (req, res) => {
  try {
    const db = await getDb();
    const request = db.queryOne(
      "SELECT * FROM friend_requests WHERE id = ? AND to_user_id = ? AND status = 'pending'",
      [Number(req.params.requestId), req.userId]
    );
    if (!request) return res.status(404).json({ error: 'Request not found' });

    db.runSql("UPDATE friend_requests SET status = 'accepted' WHERE id = ?", [Number(req.params.requestId)]);
    db.saveDb();
    res.json({ message: 'Friend request accepted!' });
  } catch (e) {
    console.error('Accept error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/friends/reject/:requestId', auth, async (req, res) => {
  try {
    const db = await getDb();
    const request = db.queryOne(
      "SELECT * FROM friend_requests WHERE id = ? AND to_user_id = ? AND status = 'pending'",
      [Number(req.params.requestId), req.userId]
    );
    if (!request) return res.status(404).json({ error: 'Request not found' });

    db.runSql("UPDATE friend_requests SET status = 'rejected' WHERE id = ?", [Number(req.params.requestId)]);
    db.saveDb();
    res.json({ message: 'Friend request rejected' });
  } catch (e) {
    console.error('Reject error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/friends', auth, async (req, res) => {
  try {
    const db = await getDb();
    const friends = db.queryAll(
      `SELECT u.id, u.username, u.created_at FROM users u
       WHERE u.id IN (
         SELECT CASE WHEN from_user_id = ? THEN to_user_id ELSE from_user_id END
         FROM friend_requests WHERE status = 'accepted' AND (from_user_id = ? OR to_user_id = ?)
       )`,
      [req.userId, req.userId, req.userId]
    );
    res.json({ friends });
  } catch (e) {
    console.error('Get friends error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/friends/:userId/portfolio', auth, async (req, res) => {
  try {
    const db = await getDb();
    const friendId = Number(req.params.userId);

    const areFriends = db.queryOne(
      `SELECT id FROM friend_requests WHERE status = 'accepted' AND (
        (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))`,
      [req.userId, friendId, friendId, req.userId]
    );
    if (!areFriends) return res.status(403).json({ error: 'Not friends with this user' });

    const user = db.queryOne('SELECT id, username, created_at FROM users WHERE id = ?', [friendId]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const habits = db.queryAll('SELECT * FROM habits WHERE user_id = ? ORDER BY created_at ASC', [friendId]);
    const result = habits.map(h => {
      const history = db.queryAll('SELECT date FROM habit_history WHERE habit_id = ?', [h.id]);
      const historyObj = {};
      history.forEach(row => { historyObj[row.date] = true; });
      return { ...h, history: historyObj };
    });

    res.json({ user, habits: result });
  } catch (e) {
    console.error('Portfolio error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/friends/:userId', auth, async (req, res) => {
  try {
    const db = await getDb();
    const friendId = Number(req.params.userId);
    db.runSql(
      `DELETE FROM friend_requests WHERE status = 'accepted' AND (
        (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))`,
      [req.userId, friendId, friendId, req.userId]
    );
    db.saveDb();
    res.json({ success: true });
  } catch (e) {
    console.error('Remove friend error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ SERVE FRONTEND ============
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'habit_tracker.html'));
});

app.get('*', (req, res) => {
  if (!req.path.startsWith('/api/')) {
    res.sendFile(path.join(__dirname, 'habit_tracker.html'));
  }
});

// ============ START SERVER ============
(async () => {
  await getDb(); // Initialize database before starting
  app.listen(PORT, () => {
    console.log(`\n  \uD83D\uDD12 Lock-In System server running on http://localhost:${PORT}\n`);
  });
})();
