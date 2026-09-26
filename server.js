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

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const decoded = jwt.verify(header.replace('Bearer ', ''), JWT_SECRET);
    req.userId = decoded.userId;
    req.username = decoded.username;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

async function getUser(db, userId) {
  const { data, error } = await db.from('users').select('id, username, created_at').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

async function getHabitWithHistory(db, habit) {
  const { data: history, error } = await db.from('habit_history').select('date').eq('habit_id', habit.id);
  if (error) throw error;
  const historyObj = {};
  history.forEach(row => { historyObj[row.date] = true; });
  return { ...habit, history: historyObj };
}

async function getHabitsWithHistory(db, userId) {
  const { data: habits, error } = await db.from('habits').select('*').eq('user_id', userId).order('created_at', { ascending: true });
  if (error) throw error;
  return Promise.all(habits.map(habit => getHabitWithHistory(db, habit)));
}

async function getFriendRequest(db, fromUserId, toUserId) {
  const { data, error } = await db.from('friend_requests').select('*')
    .eq('from_user_id', fromUserId).eq('to_user_id', toUserId).maybeSingle();
  if (error) throw error;
  return data;
}

async function areFriends(db, firstUserId, secondUserId) {
  const [forward, reverse] = await Promise.all([
    getFriendRequest(db, firstUserId, secondUserId),
    getFriendRequest(db, secondUserId, firstUserId),
  ]);
  return (forward && forward.status === 'accepted') || (reverse && reverse.status === 'accepted');
}

app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    if (username.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
    if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
    if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.status(400).json({ error: 'Username: letters, numbers, underscores only' });

    const db = await getDb();
    const { data: existing, error: lookupError } = await db.from('users').select('id').ilike('username', username).maybeSingle();
    if (lookupError) throw lookupError;
    if (existing) return res.status(409).json({ error: 'Username already taken' });

    const { data: user, error } = await db.from('users').insert({
      username,
      password_hash: bcrypt.hashSync(password, 10),
    }).select('id, username').single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Username already taken' });
      throw error;
    }

    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user });
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
    const { data: user, error } = await db.from('users').select('*').ilike('username', username).maybeSingle();
    if (error) throw error;
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
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
    const user = await getUser(db, req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (e) {
    console.error('Me error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/habits', auth, async (req, res) => {
  try {
    const db = await getDb();
    res.json({ habits: await getHabitsWithHistory(db, req.userId) });
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
    const { data: habit, error } = await db.from('habits').insert({
      user_id: req.userId,
      name,
      sub: sub || '',
      icon: icon || '💪',
      color: color || '#7c5cff',
    }).select('*').single();
    if (error) throw error;
    res.json({ habit: { ...habit, history: {} } });
  } catch (e) {
    console.error('Create habit error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/habits/:id', auth, async (req, res) => {
  try {
    const db = await getDb();
    const habitId = Number(req.params.id);
    const { data: habit, error: findError } = await db.from('habits').select('id').eq('id', habitId).eq('user_id', req.userId).maybeSingle();
    if (findError) throw findError;
    if (!habit) return res.status(404).json({ error: 'Habit not found' });
    const { error } = await db.from('habits').delete().eq('id', habitId).eq('user_id', req.userId);
    if (error) throw error;
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
    const { data: habit, error: habitError } = await db.from('habits').select('id').eq('id', habitId).eq('user_id', req.userId).maybeSingle();
    if (habitError) throw habitError;
    if (!habit) return res.status(404).json({ error: 'Habit not found' });

    const { data: existing, error: findError } = await db.from('habit_history').select('id').eq('habit_id', habitId).eq('date', date).maybeSingle();
    if (findError) throw findError;
    if (existing) {
      const { error } = await db.from('habit_history').delete().eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await db.from('habit_history').insert({ habit_id: habitId, date });
      if (error) throw error;
    }
    const { data: history, error: historyError } = await db.from('habit_history').select('date').eq('habit_id', habitId);
    if (historyError) throw historyError;
    const historyObj = {};
    history.forEach(row => { historyObj[row.date] = true; });
    res.json({ toggled: !existing, history: historyObj });
  } catch (e) {
    console.error('Toggle error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/users/search', auth, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json({ users: [] });
    const db = await getDb();
    const { data, error } = await db.from('users').select('id, username').ilike('username', `%${q}%`).neq('id', req.userId).limit(10);
    if (error) throw error;
    res.json({ users: data });
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
    const { data: toUser, error: userError } = await db.from('users').select('id').ilike('username', username).maybeSingle();
    if (userError) throw userError;
    if (!toUser) return res.status(404).json({ error: 'User not found' });
    if (toUser.id === req.userId) return res.status(400).json({ error: 'Cannot send request to yourself' });
    if (await areFriends(db, req.userId, toUser.id)) return res.status(400).json({ error: 'Already friends' });

    const forward = await getFriendRequest(db, req.userId, toUser.id);
    const reverse = await getFriendRequest(db, toUser.id, req.userId);
    const existing = forward || reverse;
    if (existing) {
      if (existing.status === 'pending') {
        if (existing.from_user_id === toUser.id) {
          const { error } = await db.from('friend_requests').update({ status: 'accepted' }).eq('id', existing.id);
          if (error) throw error;
          return res.json({ message: 'Friend request accepted! You are now friends.', autoAccepted: true });
        }
        return res.status(400).json({ error: 'Friend request already sent' });
      }
      if (existing.status === 'rejected') {
        const { error } = await db.from('friend_requests').delete().eq('id', existing.id);
        if (error) throw error;
      }
    }

    const { error } = await db.from('friend_requests').insert({ from_user_id: req.userId, to_user_id: toUser.id });
    if (error) throw error;
    res.json({ message: 'Friend request sent!' });
  } catch (e) {
    console.error('Friend request error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/friends/requests', auth, async (req, res) => {
  try {
    const db = await getDb();
    const { data: incoming, error: incomingError } = await db.from('friend_requests').select('id, from_user_id, created_at').eq('to_user_id', req.userId).eq('status', 'pending').order('created_at', { ascending: false });
    if (incomingError) throw incomingError;
    const { data: sent, error: sentError } = await db.from('friend_requests').select('id, to_user_id, created_at').eq('from_user_id', req.userId).eq('status', 'pending').order('created_at', { ascending: false });
    if (sentError) throw sentError;
    const ids = [...incoming.map(r => r.from_user_id), ...sent.map(r => r.to_user_id)];
    let users = [];
    if (ids.length) {
      const { data, error } = await db.from('users').select('id, username').in('id', ids);
      if (error) throw error;
      users = data;
    }
    const names = new Map(users.map(user => [user.id, user.username]));
    res.json({
      incoming: incoming.map(row => ({ ...row, username: names.get(row.from_user_id) })),
      sent: sent.map(row => ({ ...row, username: names.get(row.to_user_id) })),
    });
  } catch (e) {
    console.error('Get requests error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

async function updateFriendRequest(req, res, status, message) {
  try {
    const db = await getDb();
    const { data: request, error: findError } = await db.from('friend_requests').select('id').eq('id', Number(req.params.requestId)).eq('to_user_id', req.userId).eq('status', 'pending').maybeSingle();
    if (findError) throw findError;
    if (!request) return res.status(404).json({ error: 'Request not found' });
    const { error } = await db.from('friend_requests').update({ status }).eq('id', request.id);
    if (error) throw error;
    res.json({ message });
  } catch (e) {
    console.error(`${status} request error:`, e);
    res.status(500).json({ error: 'Server error' });
  }
}

app.post('/api/friends/accept/:requestId', (req, res) => updateFriendRequest(req, res, 'accepted', 'Friend request accepted!'));
app.post('/api/friends/reject/:requestId', (req, res) => updateFriendRequest(req, res, 'rejected', 'Friend request rejected'));

app.get('/api/friends', auth, async (req, res) => {
  try {
    const db = await getDb();
    const [outgoing, incoming] = await Promise.all([
      db.from('friend_requests').select('to_user_id').eq('from_user_id', req.userId).eq('status', 'accepted'),
      db.from('friend_requests').select('from_user_id').eq('to_user_id', req.userId).eq('status', 'accepted'),
    ]);
    if (outgoing.error) throw outgoing.error;
    if (incoming.error) throw incoming.error;
    const ids = [...outgoing.data.map(row => row.to_user_id), ...incoming.data.map(row => row.from_user_id)];
    if (!ids.length) return res.json({ friends: [] });
    const { data: friends, error } = await db.from('users').select('id, username, created_at').in('id', ids);
    if (error) throw error;
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
    if (!(await areFriends(db, req.userId, friendId))) return res.status(403).json({ error: 'Not friends with this user' });
    const user = await getUser(db, friendId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user, habits: await getHabitsWithHistory(db, friendId) });
  } catch (e) {
    console.error('Portfolio error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/friends/:userId', auth, async (req, res) => {
  try {
    const db = await getDb();
    const friendId = Number(req.params.userId);
    const first = await getFriendRequest(db, req.userId, friendId);
    const second = await getFriendRequest(db, friendId, req.userId);
    const ids = [first, second].filter(Boolean).filter(row => row.status === 'accepted').map(row => row.id);
    if (ids.length) {
      const { error } = await db.from('friend_requests').delete().in('id', ids);
      if (error) throw error;
    }
    res.json({ success: true });
  } catch (e) {
    console.error('Remove friend error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'habit_tracker.html')));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api/')) res.sendFile(path.join(__dirname, 'habit_tracker.html'));
});

app.listen(PORT, () => {
  console.log(`\n  Lock-In System server running on http://localhost:${PORT}\n`);
});