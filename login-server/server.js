const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { DatabaseSync } = require('node:sqlite');
const { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } = require('node:crypto');
const { promisify } = require('node:util');
const { mkdirSync } = require('node:fs');
const { join, dirname } = require('node:path');

const app = express();
const port = Number(process.env.PORT || 3000);
const deployed = process.env.RENDER === 'true' || process.env.NODE_ENV === 'production';
const connectionString = process.env.DATABASE_URL;
if (deployed && !connectionString) throw new Error('DATABASE_URL is required');
const dbPath = process.env.AUTH_DB_PATH || join(__dirname, 'data', 'auth.sqlite');
const schema = `
  CREATE TABLE IF NOT EXISTS accounts (
    username TEXT PRIMARY KEY, salt TEXT NOT NULL, password_hash TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    username TEXT NOT NULL REFERENCES accounts(username),
    expires_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY, username TEXT NOT NULL REFERENCES accounts(username),
    day TEXT NOT NULL, title TEXT NOT NULL, created_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS tasks_username_day ON tasks(username, day, created_at);
`;
let query;
async function initialize() {
  if (connectionString) {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 10000 });
    pool.on('error', (error) => console.error('Database connection error:', error.message));
    await pool.query(schema);
    query = (sql, values = []) => pool.query(sql, values);
    return;
  }
  mkdirSync(dirname(dbPath), { recursive: true });
  const database = new DatabaseSync(dbPath);
  database.exec(schema);
  query = async (sql, values = []) => {
    const statement = database.prepare(sql.replace(/\$\d+/g, '?'));
    const rows = statement.columns().length ? statement.all(...values) : [];
    const rowCount = statement.columns().length ? rows.length : statement.run(...values).changes;
    return { rows, rowCount };
  };
}

async function currentSession(req) {
  const key = sessionKey(req);
  if (!key) return null;
  const { rows } = await query('SELECT username FROM sessions WHERE token_hash = $1 AND expires_at > $2', [key, Date.now()]);
  return rows[0];
}

const deriveKey = promisify(scrypt);
const dummySalt = randomBytes(16).toString('hex');
const sessionAge = 24 * 60 * 60 * 1000;
const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: deployed, path: '/' };

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function sessionKey(req) {
  const token = /(?:^|;\s*)sid=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  return token ? hashToken(token) : '';
}

function credentials(req, res, next) {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || !/^[a-zA-Z0-9_]{3,24}$/.test(username)
      || typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: '아이디는 영문·숫자·밑줄 3~24자, 비밀번호는 8~128자로 입력해 주세요.' });
  }
  req.credentials = { username: username.toLowerCase(), password };
  next();
}

app.disable('x-powered-by');
if (process.env.RENDER === 'true') app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; base-uri 'none'"
  });
  next();
});
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (['POST', 'PATCH'].includes(req.method) && !req.is('application/json')) {
    return res.status(415).json({ error: 'JSON 요청이 필요합니다.' });
  }
  next();
}, express.json({ limit: '4kb' }));
const limitAuth = rateLimit({
  windowMs: 60_000, limit: 15,
  message: { error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' }
});

app.post('/api/register', limitAuth, credentials, async (req, res) => {
  const { username, password } = req.credentials;
  const salt = randomBytes(16).toString('hex');
  const hash = await deriveKey(password, salt, 64);
  if (!(await query('INSERT INTO accounts VALUES ($1, $2, $3) ON CONFLICT(username) DO NOTHING', [username, salt, hash.toString('hex')])).rowCount) {
    return res.status(409).json({ error: '이미 사용 중인 아이디입니다.' });
  }
  res.status(201).json({ username });
});

app.post('/api/login', limitAuth, credentials, async (req, res) => {
  const { username, password } = req.credentials;
  const { rows: [account] } = await query('SELECT salt, password_hash FROM accounts WHERE username = $1', [username]);
  const candidate = await deriveKey(password, account?.salt ?? dummySalt, 64);
  if (!account || !timingSafeEqual(candidate, Buffer.from(account.password_hash, 'hex'))) {
    return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
  }
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  await query('DELETE FROM sessions WHERE expires_at <= $1', [now]);
  await query('INSERT INTO sessions VALUES ($1, $2, $3)', [hashToken(token), username, now + sessionAge]);
  await query('DELETE FROM sessions WHERE token_hash = $1', [sessionKey(req)]);
  res.cookie('sid', token, { ...cookieOptions, maxAge: sessionAge }).json({ username });
});

app.get('/api/me', async (req, res) => {
  const session = await currentSession(req);
  if (!session) return res.status(401).json({ error: '로그인이 필요합니다.' });
  res.json(session);
});

app.post('/api/logout', async (req, res) => {
  await query('DELETE FROM sessions WHERE token_hash = $1', [sessionKey(req)]);
  res.clearCookie('sid', cookieOptions).status(204).end();
});

app.get('/health', async (req, res) => {
  await query('SELECT 1');
  res.sendStatus(200);
});

app.get('/todo', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!await currentSession(req)) return res.redirect('/');
  res.sendFile(join(__dirname, 'views', 'todo.html'));
});

app.use('/api/tasks', async (req, res, next) => {
  const user = await currentSession(req);
  if (!user) return res.status(401).json({ error: '로그인이 필요합니다.' });
  req.todoOwner = user.username;
  next();
});

app.get('/api/tasks', async (req, res) => {
  const { rows } = await query('SELECT id, day, title AS text FROM tasks WHERE username = $1 ORDER BY created_at, id', [req.todoOwner]);
  res.json(rows);
});

function validDay(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const date = new Date(day + 'T00:00:00Z');
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === day;
}

function taskText(req, res, next) {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text || text.length > 200 || text.includes('\0')) {
    return res.status(400).json({ error: '할 일을 1~200자로 입력해 주세요.' });
  }
  req.taskText = text;
  next();
}

app.post('/api/tasks', taskText, async (req, res) => {
  const { day } = req.body;
  if (!validDay(day)) return res.status(400).json({ error: '날짜를 확인해 주세요.' });
  const id = randomUUID();
  await query('INSERT INTO tasks (id, username, day, title, created_at) VALUES ($1, $2, $3, $4, $5)', [id, req.todoOwner, day, req.taskText, Date.now()]);
  res.status(201).json({ id, day, text: req.taskText });
});

app.patch('/api/tasks/:id', taskText, async (req, res) => {
  const { rows: [task] } = await query('UPDATE tasks SET title = $1 WHERE username = $2 AND id = $3 RETURNING id, day, title AS text', [req.taskText, req.todoOwner, req.params.id]);
  if (!task) return res.status(404).json({ error: '할 일을 찾을 수 없습니다.' });
  res.json(task);
});

app.delete('/api/tasks/:id', async (req, res) => {
  const result = await query('DELETE FROM tasks WHERE username = $1 AND id = $2', [req.todoOwner, req.params.id]);
  if (!result.rowCount) return res.status(404).json({ error: '할 일을 찾을 수 없습니다.' });
  res.status(204).end();
});

app.use(express.static(join(__dirname, 'public')));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.status === 400 || error.status === 413) {
    return res.status(error.status).json({ error: '요청 형식 또는 크기를 확인해 주세요.' });
  }
  console.error(error);
  res.status(500).json({ error: '서버 오류가 발생했습니다.' });
});

initialize().then(() => {
  app.listen(port, deployed ? '0.0.0.0' : '127.0.0.1', () => console.log('Listening on port', port));
}).catch((error) => {
  console.error('Database initialization failed:', error.message);
  process.exitCode = 1;
});
