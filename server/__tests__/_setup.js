/**
 * Test setup.
 *
 * Each test process gets its own temp directory so the SQLite DB and any
 * uploaded dataset files are fully isolated. Cleaned up on process exit.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Create a per-process temp directory and override the DB path
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'datawiz-test-'));
process.env.DATAWIZ_TEST_DIR = testDir;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-do-not-use-in-prod-very-long-random-string';

// Create datasets subdirectory
fs.mkdirSync(path.join(testDir, 'datasets'), { recursive: true });

// Cleanup on exit
const cleanup = () => {
  try { fs.rmSync(testDir, { recursive: true, force: true }); }
  catch (_) {}
};
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(); });

console.log('[test] Using temp dir:', testDir);
