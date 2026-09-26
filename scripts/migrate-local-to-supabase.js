require('dotenv').config();

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const { createClient } = require('@supabase/supabase-js');

const DB_PATH = path.join(__dirname, '..', 'lockin.db');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function readRows(db, sql) {
  const result = db.exec(sql);
  if (!result.length) return [];
  const columns = result[0].columns;
  return result[0].values.map(values => Object.fromEntries(columns.map((column, index) => [column, values[index]])));
}

async function upload(table, rows) {
  if (!rows.length) return;
  const { error } = await supabase.from(table).upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
  if (error) throw error;
  console.log(`Migrated ${rows.length} ${table} row(s)`);
}

(async () => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`Local database not found: ${DB_PATH}`);
  }

  const SQL = await initSqlJs();
  const localDb = new SQL.Database(fs.readFileSync(DB_PATH));
  await upload('users', readRows(localDb, 'SELECT id, username, password_hash, created_at FROM users'));
  await upload('habits', readRows(localDb, 'SELECT id, user_id, name, sub, icon, color, created_at FROM habits'));
  await upload('habit_history', readRows(localDb, 'SELECT id, habit_id, date FROM habit_history'));
  await upload('friend_requests', readRows(localDb, 'SELECT id, from_user_id, to_user_id, status, created_at FROM friend_requests'));
  console.log('Migration complete. Run the sequence statements at the end of supabase-schema.sql if explicit IDs were imported.');
})().catch(error => {
  console.error('Migration failed:', error.message);
  process.exitCode = 1;
});
