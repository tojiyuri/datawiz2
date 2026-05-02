/**
 * SQL Connector
 *
 * Connects to relational databases, runs a query, and converts the result
 * into a Data Wiz dataset. Supports Postgres, MySQL, and SQLite.
 *
 * Drivers are loaded lazily — users without `pg` installed can still use
 * MySQL, etc. If a driver is missing, we throw a helpful error.
 *
 * Note: This is the EXTRACT model — query once, pull the data, work with it.
 * It is not a live connection that re-queries on every chart interaction.
 * That's a much heavier feature (query pushdown, caching, materialized views)
 * and not in scope for v6.4.
 */

const path = require('path');
const ssrfGuard = require('./ssrfGuard');

// Lazy driver loaders
let pgClient = null;
let mysql2 = null;
let Database = null; // better-sqlite3

// SQLite file path validation. SQLite databases can only be opened from a
// specific allow-listed directory (default: ./uploads/sqlite/). This prevents
// a malicious user from passing /etc/something or a path that escapes the
// sandbox via "../../..".
function resolveSqlitePath(file) {
  if (!file) throw new Error('SQLite file path is required');
  const fs = require('fs');
  const allowedDir = path.resolve(
    process.env.SQLITE_ALLOWED_DIR || path.join(__dirname, '../uploads/sqlite')
  );
  const resolved = path.resolve(allowedDir, path.basename(file));
  if (!resolved.startsWith(allowedDir + path.sep) && resolved !== allowedDir) {
    throw new Error('SQLite file must be in the allowed directory');
  }
  if (!fs.existsSync(resolved)) {
    throw new Error('SQLite file not found in allowed directory');
  }
  return resolved;
}

function loadDriver(type) {
  if (type === 'postgres' || type === 'postgresql') {
    if (!pgClient) {
      try { pgClient = require('pg').Client; }
      catch (err) {
        throw new Error('Postgres driver not installed. Run: npm install pg');
      }
    }
    return pgClient;
  }
  if (type === 'mysql' || type === 'mariadb') {
    if (!mysql2) {
      try { mysql2 = require('mysql2/promise'); }
      catch (err) {
        throw new Error('MySQL driver not installed. Run: npm install mysql2');
      }
    }
    return mysql2;
  }
  if (type === 'sqlite' || type === 'sqlite3') {
    if (!Database) {
      try { Database = require('better-sqlite3'); }
      catch (err) {
        throw new Error('SQLite driver not installed. Run: npm install better-sqlite3');
      }
    }
    return Database;
  }
  throw new Error(`Unsupported database type: ${type}. Supported: postgres, mysql, sqlite.`);
}

/**
 * Test that a connection is reachable. Returns { ok, error, version, tables }.
 */
async function testConnection(config) {
  const { type } = config;
  try {
    if (type !== 'sqlite') {
      await ssrfGuard.assertPublicHost(config.host || 'localhost');
    }
    if (type === 'postgres') {
      const Client = loadDriver('postgres');
      const c = new Client(buildPgConfig(config));
      await c.connect();
      const v = await c.query('SELECT version() AS v');
      const t = await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name LIMIT 100");
      await c.end();
      return { ok: true, version: v.rows[0]?.v?.split(' ').slice(0, 2).join(' '), tables: t.rows.map(r => r.table_name) };
    }
    if (type === 'mysql') {
      const mysql = loadDriver('mysql');
      const c = await mysql.createConnection(buildMysqlConfig(config));
      const [v] = await c.query('SELECT VERSION() AS v');
      const [t] = await c.query('SHOW TABLES');
      await c.end();
      return {
        ok: true,
        version: 'MySQL ' + v[0]?.v,
        tables: t.map(row => Object.values(row)[0]),
      };
    }
    if (type === 'sqlite') {
      const Db = loadDriver('sqlite');
      const db = new Db(resolveSqlitePath(config.file), { readonly: true, fileMustExist: true });
      const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
      const v = db.prepare("SELECT sqlite_version() AS v").get();
      db.close();
      return { ok: true, version: 'SQLite ' + v.v, tables: t.map(r => r.name) };
    }
    throw new Error(`Unsupported type: ${type}`);
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Run a query and return the resulting rows. The rows can then be passed
 * to dataProcessor to build a full dataset.
 *
 * Caps at 200_000 rows by default — same limit as our CSV ingestion path.
 */
async function runQuery(config, query, rowLimit = 200000) {
  const { type } = config;
  if (!query || !query.trim()) throw new Error('Query is empty');

  // SSRF: block connections to localhost / private IPs / metadata endpoints
  // unless the operator has explicitly allow-listed them via env.
  if (type !== 'sqlite') {
    await ssrfGuard.assertPublicHost(config.host || 'localhost');
  }

  // Reject DML/DDL on the connector path. Strip line and block comments
  // first so users can't bypass the regex with `/* SELECT */ DELETE FROM ...`.
  const normalized = query
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();
  const blocked = /^\s*(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|EXEC|EXECUTE|CALL|MERGE|REPLACE|RENAME|COMMENT|VACUUM|ATTACH|PRAGMA)\b/i;
  if (blocked.test(normalized)) {
    throw new Error('Only SELECT queries are allowed via the SQL connector.');
  }
  // Multi-statement guard: reject if there's a `;` followed by anything other
  // than whitespace/comments. Postgres + sqlite both honor multi-statement
  // strings. (mysql2 has multipleStatements: false, but defense-in-depth.)
  const stripped = normalized.replace(/;+\s*$/, '');
  if (stripped.includes(';')) {
    throw new Error('Multi-statement queries are not allowed. Submit one SELECT at a time.');
  }

  if (type === 'postgres') {
    const Client = loadDriver('postgres');
    const c = new Client(buildPgConfig(config));
    await c.connect();
    try {
      // Use a cursor would be ideal for huge results, but pg's basic query
      // already streams to memory. For our row cap, a wrapping LIMIT works.
      const wrapped = wrapLimit(query, rowLimit);
      const r = await c.query(wrapped);
      return { rows: r.rows, columns: r.fields.map(f => f.name) };
    } finally {
      await c.end();
    }
  }
  if (type === 'mysql') {
    const mysql = loadDriver('mysql');
    const c = await mysql.createConnection(buildMysqlConfig(config));
    try {
      const wrapped = wrapLimit(query, rowLimit);
      const [rows, fields] = await c.query(wrapped);
      return { rows, columns: (fields || []).map(f => f.name) };
    } finally {
      await c.end();
    }
  }
  if (type === 'sqlite') {
    const Db = loadDriver('sqlite');
    const db = new Db(resolveSqlitePath(config.file), { readonly: true, fileMustExist: true });
    try {
      const wrapped = wrapLimit(query, rowLimit);
      const stmt = db.prepare(wrapped);
      const rows = stmt.all();
      const columns = stmt.columns().map(c => c.name);
      return { rows, columns };
    } finally {
      db.close();
    }
  }
  throw new Error(`Unsupported type: ${type}`);
}

function wrapLimit(query, rowLimit) {
  // If the user already wrote a LIMIT, don't add another.
  if (/\bLIMIT\s+\d+/i.test(query)) return query;
  // Strip trailing semicolons before wrapping.
  const stripped = query.trim().replace(/;+\s*$/, '');
  return `SELECT * FROM (${stripped}) AS _datawiz_q LIMIT ${rowLimit}`;
}

function buildPgConfig(c) {
  return {
    host: c.host || 'localhost',
    port: parseInt(c.port || 5432, 10),
    user: c.user || c.username,
    password: c.password,
    database: c.database,
    ssl: c.ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 8000,
  };
}

function buildMysqlConfig(c) {
  return {
    host: c.host || 'localhost',
    port: parseInt(c.port || 3306, 10),
    user: c.user || c.username,
    password: c.password,
    database: c.database,
    connectTimeout: 8000,
    multipleStatements: false,
  };
}

module.exports = { testConnection, runQuery };
