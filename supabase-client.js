/* Free hosting mode: the browser talks directly to Supabase with the public anon key. */
(function () {
  const client = window.supabase.createClient(
    window.LOCKIN_SUPABASE_URL,
    window.LOCKIN_SUPABASE_ANON_KEY,
    { auth: { persistSession: true, autoRefreshToken: true } }
  );

  function fail(error) {
    if (error) throw new Error(error.message || 'Supabase request failed');
  }

  function emailForUsername(username) {
    return `${username.toLowerCase()}@lockin.local`;
  }

  async function sessionUser() {
    const result = await client.auth.getUser();
    fail(result.error);
    return result.data.user;
  }

  async function profile() {
    const authUser = await sessionUser();
    if (!authUser) throw new Error('Not authenticated');
    const result = await client.from('users').select('id, username, created_at').eq('auth_user_id', authUser.id).single();
    fail(result.error);
    return result.data;
  }

  async function habitsFor(userId) {
    const habitsResult = await client.from('habits').select('*').eq('user_id', userId).order('created_at', { ascending: true });
    fail(habitsResult.error);
    const result = [];
    for (const habit of habitsResult.data) {
      const historyResult = await client.from('habit_history').select('date').eq('habit_id', habit.id);
      fail(historyResult.error);
      const history = {};
      historyResult.data.forEach(row => { history[row.date] = true; });
      result.push({ ...habit, history });
    }
    return result;
  }

  async function usersByIds(ids) {
    if (!ids.length) return [];
    const result = await client.from('users').select('id, username, created_at').in('id', ids);
    fail(result.error);
    return result.data;
  }

  async function acceptedFriendIds(userId) {
    const outgoing = await client.from('friend_requests').select('to_user_id').eq('from_user_id', userId).eq('status', 'accepted');
    fail(outgoing.error);
    const incoming = await client.from('friend_requests').select('from_user_id').eq('to_user_id', userId).eq('status', 'accepted');
    fail(incoming.error);
    return [...outgoing.data.map(row => row.to_user_id), ...incoming.data.map(row => row.from_user_id)];
  }

  async function api(method, path, body) {
    const current = await profile().catch(error => {
      if (path === '/api/me') throw error;
      throw error;
    });

    if (method === 'GET' && path === '/api/me') return { user: current };

    if (method === 'GET' && path === '/api/habits') {
      return { habits: await habitsFor(current.id) };
    }

    if (method === 'POST' && path === '/api/habits') {
      const result = await client.from('habits').insert({
        user_id: current.id,
        name: body.name,
        sub: body.sub || '',
        icon: body.icon || '\uD83D\uDCAA',
        color: body.color || '#7c5cff',
      }).select('*').single();
      fail(result.error);
      return { habit: { ...result.data, history: {} } };
    }

    const habitMatch = path.match(/^\/api\/habits\/(\d+)(?:\/(toggle))?$/);
    if (habitMatch && method === 'DELETE') {
      const result = await client.from('habits').delete().eq('id', Number(habitMatch[1])).eq('user_id', current.id);
      fail(result.error);
      return { success: true };
    }

    if (habitMatch && method === 'POST' && habitMatch[2] === 'toggle') {
      const habitId = Number(habitMatch[1]);
      const existing = await client.from('habit_history').select('id').eq('habit_id', habitId).eq('date', body.date).maybeSingle();
      fail(existing.error);
      if (existing.data) {
        const result = await client.from('habit_history').delete().eq('id', existing.data.id);
        fail(result.error);
      } else {
        const result = await client.from('habit_history').insert({ habit_id: habitId, date: body.date });
        fail(result.error);
      }
      const historyResult = await client.from('habit_history').select('date').eq('habit_id', habitId);
      fail(historyResult.error);
      const history = {};
      historyResult.data.forEach(row => { history[row.date] = true; });
      return { toggled: !existing.data, history };
    }

    if (method === 'GET' && path.startsWith('/api/users/search?q=')) {
      const query = decodeURIComponent(path.split('=')[1] || '');
      if (query.length < 2) return { users: [] };
      const result = await client.from('users').select('id, username').ilike('username', `%${query}%`).neq('id', current.id).limit(10);
      fail(result.error);
      return { users: result.data };
    }

    if (method === 'POST' && path === '/api/friends/request') {
      const target = await client.from('users').select('id').ilike('username', body.username).maybeSingle();
      fail(target.error);
      if (!target.data) throw new Error('User not found');
      if (target.data.id === current.id) throw new Error('Cannot send request to yourself');
      const existing = await client.from('friend_requests').select('*').or(`and(from_user_id.eq.${current.id},to_user_id.eq.${target.data.id}),and(from_user_id.eq.${target.data.id},to_user_id.eq.${current.id})`).maybeSingle();
      fail(existing.error);
      if (existing.data && existing.data.status === 'accepted') throw new Error('Already friends');
      if (existing.data && existing.data.status === 'pending') {
        if (existing.data.from_user_id === target.data.id) {
          const accepted = await client.from('friend_requests').update({ status: 'accepted' }).eq('id', existing.data.id);
          fail(accepted.error);
          return { message: 'Friend request accepted! You are now friends.', autoAccepted: true };
        }
        throw new Error('Friend request already sent');
      }
      if (existing.data) {
        const removed = await client.from('friend_requests').delete().eq('id', existing.data.id);
        fail(removed.error);
      }
      const result = await client.from('friend_requests').insert({ from_user_id: current.id, to_user_id: target.data.id });
      fail(result.error);
      return { message: 'Friend request sent!' };
    }

    if (method === 'GET' && path === '/api/friends/requests') {
      const incoming = await client.from('friend_requests').select('id, from_user_id, created_at').eq('to_user_id', current.id).eq('status', 'pending').order('created_at', { ascending: false });
      fail(incoming.error);
      const sent = await client.from('friend_requests').select('id, to_user_id, created_at').eq('from_user_id', current.id).eq('status', 'pending').order('created_at', { ascending: false });
      fail(sent.error);
      const people = await usersByIds([...incoming.data.map(row => row.from_user_id), ...sent.data.map(row => row.to_user_id)]);
      const names = new Map(people.map(person => [person.id, person.username]));
      return {
        incoming: incoming.data.map(row => ({ ...row, username: names.get(row.from_user_id) })),
        sent: sent.data.map(row => ({ ...row, username: names.get(row.to_user_id) })),
      };
    }

    const requestMatch = path.match(/^\/api\/friends\/(accept|reject)\/(\d+)$/);
    if (requestMatch && method === 'POST') {
      const status = requestMatch[1] === 'accept' ? 'accepted' : 'rejected';
      const result = await client.from('friend_requests').update({ status }).eq('id', Number(requestMatch[2])).eq('to_user_id', current.id).eq('status', 'pending');
      fail(result.error);
      return { message: status === 'accepted' ? 'Friend request accepted!' : 'Friend request rejected' };
    }

    if (method === 'GET' && path === '/api/friends') {
      return { friends: await usersByIds(await acceptedFriendIds(current.id)) };
    }

    const portfolioMatch = path.match(/^\/api\/friends\/(\d+)\/portfolio$/);
    if (portfolioMatch && method === 'GET') {
      const friendId = Number(portfolioMatch[1]);
      const friends = await acceptedFriendIds(current.id);
      if (!friends.includes(friendId)) throw new Error('Not friends with this user');
      const userResult = await client.from('users').select('id, username, created_at').eq('id', friendId).single();
      fail(userResult.error);
      return { user: userResult.data, habits: await habitsFor(friendId) };
    }

    const removeFriendMatch = path.match(/^\/api\/friends\/(\d+)$/);
    if (removeFriendMatch && method === 'DELETE') {
      const friendId = Number(removeFriendMatch[1]);
      const result = await client.from('friend_requests').delete().or(`and(from_user_id.eq.${current.id},to_user_id.eq.${friendId}),and(from_user_id.eq.${friendId},to_user_id.eq.${current.id})`);
      fail(result.error);
      return { success: true };
    }

    throw new Error(`Unsupported request: ${method} ${path}`);
  }

  window.lockinSupabase = client;
  window.lockinApi = api;
  window.lockinAuth = {
    async register(username, password) {
      const result = await client.auth.signUp({
        email: emailForUsername(username),
        password,
        options: { data: { username } },
      });
      fail(result.error);
      if (!result.data.user || !result.data.session) {
        throw new Error('Disable email confirmation in Supabase Auth settings, then register again.');
      }
      const profileResult = await client.from('users').insert({ auth_user_id: result.data.user.id, username }).select('id, username').single();
      fail(profileResult.error);
      return { token: result.data.session.access_token, user: profileResult.data };
    },
    async login(username, password) {
      const result = await client.auth.signInWithPassword({ email: emailForUsername(username), password });
      fail(result.error);
      const userResult = await client.from('users').select('id, username').eq('auth_user_id', result.data.user.id).single();
      fail(userResult.error);
      return { token: result.data.session.access_token, user: userResult.data };
    },
    async restore() {
      const result = await client.auth.getSession();
      fail(result.error);
      if (!result.data.session) return null;
      return profile();
    },
    async logout() {
      const result = await client.auth.signOut();
      fail(result.error);
    },
  };
})();
