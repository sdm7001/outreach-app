require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = 3848;
const JWT_SECRET = crypto.randomBytes(32).toString('hex');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'TexMG2026';
const ENV_PATH = path.join(__dirname, '.env');

// ---------- JWT helpers ----------
function signJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 86400000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyJwt(token) {
  try {
    const [header, body, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const payload = verifyJwt(auth.slice(7));
  if (!payload) return res.status(401).json({ error: 'Token expired or invalid' });
  req.user = payload;
  next();
}

// ---------- Auth ----------
app.post('/api/auth/login', (req, res) => {
  const { password } = req.body;
  // Re-read from .env each time in case it changed
  const currentPassword = readEnvValue('ADMIN_PASSWORD') || 'TexMG2026';
  if (password !== currentPassword) return res.status(401).json({ error: 'Invalid password' });
  const token = signJwt({ role: 'admin' });
  res.json({ token });
});

// ---------- Stats ----------
app.get('/api/stats', (req, res) => {
  try {
    const db = getDb();
    const today = new Date().toISOString().split('T')[0];

    const todayStats = db.prepare('SELECT * FROM daily_stats WHERE date = ?').get(today) || {
      prospects_found: 0, emails_sent: 0, emails_opened: 0, clicks: 0, replies: 0, bounces: 0, unsubscribes: 0
    };

    const totals = db.prepare(`
      SELECT
        COUNT(*) as total_prospects,
        SUM(CASE WHEN status IN ('sent','opened','replied','clicked') THEN 1 ELSE 0 END) as total_sent,
        SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) as total_opened,
        SUM(CASE WHEN replied_at IS NOT NULL THEN 1 ELSE 0 END) as total_replied,
        SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END) as total_bounced,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as total_pending,
        SUM(CASE WHEN status = 'unsubscribed' THEN 1 ELSE 0 END) as total_unsubscribed
      FROM prospects
    `).get();

    const recentProspects = db.prepare(`
      SELECT company_name, industry, contact_name, contact_email, status, score, sent_at, opened_at, replied_at
      FROM prospects ORDER BY created_at DESC LIMIT 10
    `).all();

    const openRate = totals.total_sent > 0 ? ((totals.total_opened / totals.total_sent) * 100).toFixed(1) : '0.0';
    const replyRate = totals.total_sent > 0 ? ((totals.total_replied / totals.total_sent) * 100).toFixed(1) : '0.0';

    res.json({ today: todayStats, totals: { ...totals, open_rate: openRate, reply_rate: replyRate }, recent: recentProspects });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Prospects ----------
app.get('/api/prospects', (req, res) => {
  try {
    const db = getDb();
    const { status, search, page = 1, limit = 25 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let where = '1=1';
    const params = [];
    if (status && status !== 'all') { where += ' AND status = ?'; params.push(status); }
    if (search) { where += ' AND (company_name LIKE ? OR contact_name LIKE ? OR contact_email LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }

    const countRow = db.prepare(`SELECT COUNT(*) as count FROM prospects WHERE ${where}`).get(...params);
    const rows = db.prepare(`SELECT * FROM prospects WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, parseInt(limit), offset);

    res.json({ prospects: rows, total: countRow.count, page: parseInt(page), pages: Math.ceil(countRow.count / parseInt(limit)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Pipeline trigger ----------
app.post('/api/pipeline/run', authMiddleware, (req, res) => {
  try {
    execSync('cd /var/www/outreach-app && node -e "require(\'./index\').runFullPipeline()" &', { timeout: 5000 });
    res.json({ status: 'Pipeline triggered', message: 'Running in background. Check Telegram for progress updates.' });
  } catch (err) {
    // The process launches in background, so timeout is expected
    res.json({ status: 'Pipeline triggered', message: 'Running in background. Check Telegram for progress updates.' });
  }
});

// ---------- Admin config ----------
app.get('/api/admin/config', authMiddleware, (req, res) => {
  try {
    const envContent = fs.readFileSync(ENV_PATH, 'utf8');
    const config = {};
    const keys = ['ANTHROPIC_API_KEY', 'APOLLO_API_KEY', 'HUNTER_API_KEY', 'SMTP_USER', 'SMTP_PASS', 'FROM_EMAIL', 'FROM_NAME', 'ADMIN_PASSWORD'];
    const icpKeys = ['DAILY_PROSPECT_LIMIT', 'EMAILS_PER_DAY', 'SEND_WINDOW_START', 'SEND_WINDOW_END'];

    for (const key of [...keys, ...icpKeys]) {
      const val = readEnvValue(key);
      if (['ANTHROPIC_API_KEY', 'APOLLO_API_KEY', 'HUNTER_API_KEY', 'SMTP_PASS', 'ADMIN_PASSWORD'].includes(key)) {
        config[key] = val ? '****' + val.slice(-4) : '';
      } else {
        config[key] = val || '';
      }
    }

    // Read ICP settings from config.js defaults
    config.TARGET_INDUSTRIES = readEnvValue('TARGET_INDUSTRIES') || 'Healthcare,Legal,Accounting,Financial';
    config.TARGET_CITIES = readEnvValue('TARGET_CITIES') || 'Houston';
    config.DAILY_PROSPECT_LIMIT = readEnvValue('DAILY_PROSPECT_LIMIT') || '10';
    config.EMAILS_PER_DAY = readEnvValue('EMAILS_PER_DAY') || '10';
    config.SEND_WINDOW_START = readEnvValue('SEND_WINDOW_START') || '8';
    config.SEND_WINDOW_END = readEnvValue('SEND_WINDOW_END') || '17';

    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/config', authMiddleware, (req, res) => {
  try {
    const updates = req.body;
    let envContent = fs.readFileSync(ENV_PATH, 'utf8');

    for (const [key, value] of Object.entries(updates)) {
      // Skip masked values (unchanged)
      if (typeof value === 'string' && value.startsWith('****')) continue;
      if (value === '') continue;

      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, `${key}=${value}`);
      } else {
        envContent += `\n${key}=${value}`;
      }
    }

    fs.writeFileSync(ENV_PATH, envContent);

    // Restart outreach-app to pick up new env
    try {
      execSync('pm2 restart outreach-app', { timeout: 10000 });
    } catch (e) {
      console.error('PM2 restart failed:', e.message);
    }

    res.json({ status: 'Config saved and app restarted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Test connections ----------
app.post('/api/admin/test/:service', authMiddleware, async (req, res) => {
  const { service } = req.params;
  try {
    switch (service) {
      case 'anthropic': {
        const key = req.body.key || readEnvValue('ANTHROPIC_API_KEY');
        if (!key) return res.json({ success: false, message: 'No API key configured' });
        const resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'claude-haiku-4-20250414', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] })
        });
        res.json({ success: resp.ok, message: resp.ok ? 'Claude API connected' : `Error: ${resp.status}` });
        break;
      }
      case 'apollo': {
        const key = req.body.key || readEnvValue('APOLLO_API_KEY');
        if (!key) return res.json({ success: false, message: 'No API key configured' });
        const resp = await fetch('https://api.apollo.io/api/v1/auth/health', {
          headers: { 'x-api-key': key, 'Content-Type': 'application/json' }
        });
        res.json({ success: resp.ok, message: resp.ok ? 'Apollo.io connected' : `Error: ${resp.status}` });
        break;
      }
      case 'hunter': {
        const key = req.body.key || readEnvValue('HUNTER_API_KEY');
        if (!key) return res.json({ success: false, message: 'No API key configured' });
        const resp = await fetch(`https://api.hunter.io/v2/account?api_key=${key}`);
        const data = await resp.json();
        res.json({ success: resp.ok, message: resp.ok ? `Hunter.io: ${data.data?.requests?.searches?.available || 0} searches remaining` : 'Error connecting' });
        break;
      }
      case 'smtp': {
        const nodemailer = require('nodemailer');
        const user = req.body.user || readEnvValue('SMTP_USER');
        const pass = req.body.pass || readEnvValue('SMTP_PASS');
        if (!user || !pass) return res.json({ success: false, message: 'SMTP credentials not configured' });
        const transport = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 587, secure: false, auth: { user, pass } });
        await transport.verify();
        transport.close();
        res.json({ success: true, message: 'SMTP connection verified' });
        break;
      }
      default:
        res.status(400).json({ success: false, message: 'Unknown service' });
    }
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// ---------- Serve dashboard ----------
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------- Helpers ----------
function readEnvValue(key) {
  try {
    const content = fs.readFileSync(ENV_PATH, 'utf8');
    const match = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return match ? match[1].trim() : '';
  } catch { return ''; }
}

let _db = null;
function getDb() {
  if (!_db) {
    const Database = require('better-sqlite3');
    _db = new Database(path.join(__dirname, 'outreach.db'), { readonly: true });
  }
  return _db;
}

// ---------- Start ----------
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Dashboard] Outreach dashboard running on port ${PORT}`);
  console.log(`[Dashboard] http://localhost:${PORT}`);
});
