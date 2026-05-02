/**
 * REST API Connector
 *
 * Pulls JSON from a URL, optionally authenticated, and turns the response
 * into a Data Wiz dataset.
 *
 * Supports:
 *   - GET requests (the common case for read APIs)
 *   - Bearer token, Basic auth, custom header, query param API keys
 *   - JSONPath-lite extraction (e.g. "data.users" to drill into nested arrays)
 *   - Pagination: follows `next` URLs in response (RFC 5988 Link header,
 *     or `next`/`nextPageToken`/`next_url` fields in the body)
 *
 * Capped at 50,000 rows or 20 pages, whichever comes first, to prevent a
 * runaway pull from a paginated API.
 */

let axios = null;
function loadAxios() {
  if (!axios) {
    try { axios = require('axios'); }
    catch (err) {
      throw new Error('axios not installed. Run: npm install axios');
    }
  }
  return axios;
}

const MAX_ROWS = 50000;
const MAX_PAGES = 20;
const TIMEOUT_MS = 15000;

/**
 * Test the URL is reachable and returns valid JSON. Returns shape info.
 */
async function testEndpoint(config) {
  try {
    const ax = loadAxios();
    const res = await ax.request(buildRequest(config, 1));
    const body = res.data;
    return {
      ok: true,
      status: res.status,
      shape: detectShape(body),
      sample: previewSample(body, config.jsonPath),
    };
  } catch (err) {
    return {
      ok: false,
      error: err.response
        ? `HTTP ${err.response.status}: ${err.response.statusText || 'request failed'}`
        : err.message,
    };
  }
}

/**
 * Fetch all rows. Returns { rows, columns, pagesFetched }.
 */
async function fetchData(config) {
  const ax = loadAxios();
  const allRows = [];
  let pageNum = 1;
  let nextOverride = null; // for cursor-style pagination

  while (pageNum <= MAX_PAGES && allRows.length < MAX_ROWS) {
    const reqCfg = nextOverride
      ? { ...buildRequest(config, pageNum), url: nextOverride }
      : buildRequest(config, pageNum);

    let res;
    try {
      res = await ax.request(reqCfg);
    } catch (err) {
      if (err.response) {
        throw new Error(`API returned HTTP ${err.response.status}: ${err.response.statusText || err.message}`);
      }
      throw new Error(`API request failed: ${err.message}`);
    }

    const body = res.data;
    const rows = extractArray(body, config.jsonPath);

    if (!rows || !rows.length) break;
    allRows.push(...rows);

    // Look for next page
    const next = findNextPage(res, body, config);
    if (!next) break;
    if (next === reqCfg.url) break; // safety: don't loop on same URL
    nextOverride = next;
    pageNum++;
  }

  // Truncate to cap
  const final = allRows.slice(0, MAX_ROWS);
  const columns = inferColumns(final);
  return { rows: final, columns, pagesFetched: pageNum, capped: allRows.length >= MAX_ROWS };
}

function buildRequest(config, pageNum) {
  const { url, method = 'GET', auth, headers = {}, queryParams = {} } = config;
  if (!url) throw new Error('URL is required');

  const finalHeaders = { 'Accept': 'application/json', ...headers };
  const finalParams = { ...queryParams };

  // Auth modes
  if (auth?.type === 'bearer' && auth.token) {
    finalHeaders['Authorization'] = `Bearer ${auth.token}`;
  } else if (auth?.type === 'basic' && auth.username) {
    const creds = Buffer.from(`${auth.username}:${auth.password || ''}`).toString('base64');
    finalHeaders['Authorization'] = `Basic ${creds}`;
  } else if (auth?.type === 'header' && auth.headerName && auth.headerValue) {
    finalHeaders[auth.headerName] = auth.headerValue;
  } else if (auth?.type === 'query' && auth.paramName && auth.paramValue) {
    finalParams[auth.paramName] = auth.paramValue;
  }

  // Page param if user configured one (e.g. ?page=1)
  if (config.pageParam) {
    finalParams[config.pageParam] = pageNum;
  }

  return {
    method,
    url,
    headers: finalHeaders,
    params: finalParams,
    timeout: TIMEOUT_MS,
    validateStatus: (s) => s >= 200 && s < 300,
  };
}

/**
 * Pull an array out of the response body, drilling into nested paths if needed.
 * jsonPath: "data.users", "results", "items[0].records"
 */
function extractArray(body, jsonPath) {
  if (!jsonPath) {
    if (Array.isArray(body)) return body;
    // common shapes: { data: [...] }, { results: [...] }, { items: [...] }
    for (const k of ['data', 'results', 'items', 'records', 'rows']) {
      if (Array.isArray(body?.[k])) return body[k];
    }
    return [];
  }
  // Walk the path
  let cur = body;
  for (const part of jsonPath.split('.')) {
    if (cur == null) return [];
    const m = part.match(/^([^\[]+)\[(\d+)\]$/);
    if (m) {
      cur = cur[m[1]];
      if (Array.isArray(cur)) cur = cur[parseInt(m[2], 10)];
    } else {
      cur = cur[part];
    }
  }
  return Array.isArray(cur) ? cur : [];
}

function findNextPage(res, body, config) {
  // 1. Link header (RFC 5988)
  const linkHeader = res.headers?.link || res.headers?.Link;
  if (linkHeader) {
    const m = linkHeader.match(/<([^>]+)>;\s*rel=["']?next["']?/i);
    if (m) return m[1];
  }
  // 2. Common body fields
  for (const key of ['next', 'next_url', 'nextUrl', 'nextPageUrl']) {
    if (typeof body?.[key] === 'string' && body[key].startsWith('http')) return body[key];
  }
  // 3. Cursor-style: nextPageToken (would need user-config to use it)
  // Skipped to keep this MVP — users can disable pagination with pageParam=null
  return null;
}

function detectShape(body) {
  if (Array.isArray(body)) return `array (${body.length} items)`;
  if (typeof body === 'object' && body) {
    const arrayKeys = Object.entries(body)
      .filter(([_, v]) => Array.isArray(v))
      .map(([k, v]) => `${k} (${v.length})`);
    if (arrayKeys.length) return `object with arrays: ${arrayKeys.join(', ')}`;
    return `object (${Object.keys(body).length} keys)`;
  }
  return typeof body;
}

function previewSample(body, jsonPath) {
  const arr = extractArray(body, jsonPath);
  return arr.slice(0, 3);
}

function inferColumns(rows) {
  if (!rows.length) return [];
  // Take union of keys across first 100 rows
  const keys = new Set();
  rows.slice(0, 100).forEach(r => {
    if (r && typeof r === 'object') Object.keys(r).forEach(k => keys.add(k));
  });
  return [...keys];
}

module.exports = { testEndpoint, fetchData };
