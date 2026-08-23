/**
 * Session + interaction log.
 *
 * Uses MySQL when DB_HOST is configured; otherwise falls back to a JSON file so
 * the bot can be run and tested before any database exists. The JSON fallback is
 * for development only — it is not safe for concurrent writes.
 */
const fs = require('fs');
const path = require('path');

const useDb = !!process.env.DB_HOST;
let pool = null;

const FILE = path.join(__dirname, 'data', 'store.json');
function readFile() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return { sessions: {}, log: [] }; }
}
function writeFile(d) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(d, null, 2), 'utf8');
}

const DDL_SESSIONS = `
CREATE TABLE IF NOT EXISTS wa_sessions (
  phone       VARCHAR(32)  NOT NULL PRIMARY KEY,
  company     VARCHAR(255) NULL,
  requester   VARCHAR(255) NULL,
  pending_q   TEXT         NULL,
  created_at  DATETIME     NOT NULL,
  updated_at  DATETIME     NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

const DDL_LOG = `
CREATE TABLE IF NOT EXISTS wa_log (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  log_date     DATE         NOT NULL,
  log_time     VARCHAR(5)   NOT NULL,
  phone        VARCHAR(32)  NOT NULL,
  company      VARCHAR(255) NULL,
  requester    VARCHAR(255) NULL,
  question     TEXT         NOT NULL,
  category     VARCHAR(64)  NOT NULL,
  domains      VARCHAR(128) NULL,
  source_cited VARCHAR(255) NULL,
  escalated    TINYINT(1)   NOT NULL DEFAULT 0,
  needs_human  TINYINT(1)   NOT NULL DEFAULT 0,
  uncertain    TINYINT(1)   NOT NULL DEFAULT 0,
  created_at   DATETIME     NOT NULL,
  INDEX ix_wa_log_date (log_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

async function init() {
  if (!useDb) {
    console.log('[store] MySQL not configured (DB_HOST unset) — using JSON file at ' + FILE);
    return;
  }
  const mysql = require('mysql2/promise');
  pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: 5,
    timezone: 'Z'
  });
  await pool.query(DDL_SESSIONS);
  await pool.query(DDL_LOG);
  console.log('[store] MySQL ready (' + process.env.DB_NAME + ')');
}

async function getSession(phone) {
  if (!useDb) return readFile().sessions[phone] || null;
  const [rows] = await pool.query('SELECT * FROM wa_sessions WHERE phone = ?', [phone]);
  return rows[0] || null;
}

async function setSession(phone, patch) {
  const now = new Date();
  if (!useDb) {
    const d = readFile();
    d.sessions[phone] = Object.assign(
      { phone, company: null, requester: null, pending_q: null, created_at: now.toISOString() },
      d.sessions[phone] || {}, patch, { updated_at: now.toISOString() }
    );
    writeFile(d);
    return d.sessions[phone];
  }
  const cur = await getSession(phone);
  const next = Object.assign({ company: null, requester: null, pending_q: null }, cur || {}, patch);
  if (cur) {
    await pool.query(
      'UPDATE wa_sessions SET company=?, requester=?, pending_q=?, updated_at=? WHERE phone=?',
      [next.company, next.requester, next.pending_q, now, phone]
    );
  } else {
    await pool.query(
      'INSERT INTO wa_sessions (phone, company, requester, pending_q, created_at, updated_at) VALUES (?,?,?,?,?,?)',
      [phone, next.company, next.requester, next.pending_q, now, now]
    );
  }
  return next;
}

async function clearSession(phone) {
  if (!useDb) {
    const d = readFile(); delete d.sessions[phone]; writeFile(d); return;
  }
  await pool.query('DELETE FROM wa_sessions WHERE phone = ?', [phone]);
}

const pad = n => (n < 10 ? '0' : '') + n;
const dstr = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const tstr = d => pad(d.getHours()) + ':' + pad(d.getMinutes());

async function log(rec) {
  const now = new Date();
  const row = {
    log_date: dstr(now), log_time: tstr(now),
    phone: rec.phone, company: rec.company || null, requester: rec.requester || null,
    question: rec.question, category: rec.category,
    domains: (rec.domains && rec.domains.length) ? rec.domains.join(', ') : '-',
    source_cited: rec.cite || '-',
    escalated: rec.escalated ? 1 : 0,
    needs_human: rec.needsHuman ? 1 : 0,
    uncertain: rec.uncertain ? 1 : 0
  };
  if (!useDb) {
    const d = readFile();
    d.log.push(Object.assign({ created_at: now.toISOString() }, row));
    writeFile(d);
    return row;
  }
  await pool.query(
    `INSERT INTO wa_log (log_date, log_time, phone, company, requester, question, category,
       domains, source_cited, escalated, needs_human, uncertain, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [row.log_date, row.log_time, row.phone, row.company, row.requester, row.question,
     row.category, row.domains, row.source_cited, row.escalated, row.needs_human,
     row.uncertain, now]
  );
  return row;
}

async function dailyRows(date) {
  if (!useDb) {
    return readFile().log.filter(r => r.log_date === date)
      .sort((a, b) => a.log_time.localeCompare(b.log_time));
  }
  const [rows] = await pool.query(
    'SELECT * FROM wa_log WHERE log_date = ? ORDER BY log_time, id', [date]
  );
  return rows;
}

async function close() { if (pool) await pool.end(); }

module.exports = { init, getSession, setSession, clearSession, log, dailyRows, close, dstr, useDb };
