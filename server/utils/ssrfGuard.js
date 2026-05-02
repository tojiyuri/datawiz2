/**
 * SSRF guard.
 *
 * Before opening an outbound connection on behalf of a user (SQL connector,
 * REST API connector, etc.), validate that the host is not pointing at:
 *   - localhost / 127.0.0.0/8 / ::1
 *   - private IPv4 ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
 *   - link-local (169.254.0.0/16, fe80::/10)
 *   - the AWS metadata service (169.254.169.254)
 *   - reserved hostnames (.internal, .local, .localhost)
 *
 * Without this, a tenant on a multi-tenant deployment can use the SQL or
 * REST connector to probe the server's internal network — a classic SSRF.
 *
 * Override via env: ALLOWED_PRIVATE_HOSTS=10.0.0.5,db.internal allows specific
 * known-good internal targets (e.g., the customer's own VPC database).
 */

const net = require('net');
const dns = require('dns').promises;

const PRIVATE_RANGES = [
  // IPv4 private + loopback + link-local + reserved
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./,   // shared address space (CGNAT)
  /^192\.0\.[02]\./,           // documentation
  /^198\.1[89]\./,             // benchmark
  /^198\.51\.100\./,
  /^203\.0\.113\./,
  /^22[4-9]\./, /^23[0-9]\./,  // multicast
  /^24[0-9]\./, /^25[0-5]\./,  // reserved + broadcast
];

const PRIVATE_IPV6_PREFIXES = [
  '::1',
  'fc',     // unique local fc00::/7
  'fd',
  'fe80',   // link-local
  'fec0',   // deprecated site-local
  '::ffff:127.',  // IPv4-mapped loopback
  '::ffff:10.',
  '::ffff:192.168.',
  '::ffff:169.254.',
];

const RESERVED_HOST_SUFFIXES = ['.local', '.localhost', '.internal'];

function isPrivateIPv4(ip) {
  return PRIVATE_RANGES.some(r => r.test(ip));
}

function isPrivateIPv6(ip) {
  const lower = ip.toLowerCase();
  return PRIVATE_IPV6_PREFIXES.some(p => lower === p || lower.startsWith(p + ':') || lower.startsWith(p));
}

function getAllowList() {
  const env = process.env.ALLOWED_PRIVATE_HOSTS || '';
  return env.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

/**
 * Throws if the host should not be reachable from the server.
 * Resolves DNS and rejects if any A/AAAA record points into private space.
 */
async function assertPublicHost(host) {
  if (!host) throw new Error('Host is required');
  const lower = host.toLowerCase().trim();

  // Allow-list bypass for known-good internal targets
  const allowed = getAllowList();
  if (allowed.includes(lower)) return;

  // Block obvious things first (no DNS resolution needed)
  if (lower === 'localhost' || lower === '0.0.0.0' || lower === '::1') {
    throw new Error(`SSRF: connections to ${host} are not allowed`);
  }
  for (const suffix of RESERVED_HOST_SUFFIXES) {
    if (lower.endsWith(suffix)) {
      throw new Error(`SSRF: hostnames ending in ${suffix} are not allowed`);
    }
  }
  // Block AWS/GCP/Azure metadata IPs explicitly (case the regex doesn't catch)
  if (lower === '169.254.169.254' || lower === 'metadata.google.internal') {
    throw new Error('SSRF: cloud metadata endpoints are not allowed');
  }

  // If it's already an IP literal, validate directly
  if (net.isIP(lower)) {
    if (net.isIPv4(lower) && isPrivateIPv4(lower)) {
      throw new Error(`SSRF: private IPv4 ${host} is not allowed`);
    }
    if (net.isIPv6(lower) && isPrivateIPv6(lower)) {
      throw new Error(`SSRF: private IPv6 ${host} is not allowed`);
    }
    return;
  }

  // Otherwise resolve DNS and check ALL records (to defeat DNS rebinding
  // where the first record is public and the second is private).
  let records;
  try {
    records = await dns.lookup(host, { all: true });
  } catch (err) {
    throw new Error(`Could not resolve host ${host}: ${err.message}`);
  }
  for (const r of records) {
    if (r.family === 4 && isPrivateIPv4(r.address)) {
      throw new Error(`SSRF: ${host} resolves to private IPv4 ${r.address}`);
    }
    if (r.family === 6 && isPrivateIPv6(r.address)) {
      throw new Error(`SSRF: ${host} resolves to private IPv6 ${r.address}`);
    }
  }
}

module.exports = {
  assertPublicHost,
  // Exposed for tests
  isPrivateIPv4,
  isPrivateIPv6,
};
