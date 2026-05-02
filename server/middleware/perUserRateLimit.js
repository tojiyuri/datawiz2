/**
 * Per-user rate limiter for expensive endpoints.
 *
 * Why not just use express-rate-limit? Because it limits by IP, and:
 *   - One IP can be many users (corporate proxy, mobile carrier NAT)
 *   - One user can be many IPs (mobile, VPN switching)
 *   - We want to limit per *authenticated user* for noisy-neighbor protection
 *
 * Why not Redis? Because we don't have Redis. This is in-memory and works
 * fine for a single-instance deployment. If you scale horizontally, replace
 * this with a Redis-backed limiter — the interface stays the same.
 *
 * Algorithm: token bucket per user. Each user gets `capacity` tokens that
 * refill at `refillPerSec` per second. A request consumes one token. If
 * the bucket is empty, the request is rejected with 429.
 *
 * Defaults are tuned for analytics endpoints — these take 200-1000ms each,
 * so 5 per minute is enough for a real user but stops a runaway script.
 */

class TokenBucket {
  constructor(capacity, refillPerSec) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  tryConsume() {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
    this.lastRefill = now;
  }

  // Seconds until at least 1 token is available
  retryAfter() {
    if (this.tokens >= 1) return 0;
    return (1 - this.tokens) / this.refillPerSec;
  }
}

/**
 * Build a middleware that rate-limits per user (or per-IP for unauthenticated).
 *
 * @param options.capacity     max requests allowed in a burst (default 10)
 * @param options.refillPerSec how fast tokens refill (default 10/min = 0.166)
 * @param options.name         identifier shown in logs (default 'rate-limit')
 */
function perUserRateLimit({
  capacity = 10,
  refillPerSec = 10 / 60,             // 10 tokens per 60s = ~10 req/min sustained
  name = 'rate-limit',
} = {}) {
  // Map<userKey, TokenBucket>
  const buckets = new Map();
  const MAX_BUCKETS = 10000;          // bound the map to prevent memory growth

  return (req, res, next) => {
    const userKey = req.user?.id ? `u:${req.user.id}` : `ip:${req.ip}`;

    // Periodic cleanup — when the map grows too big, drop full buckets
    // (they're at capacity, so dropping them doesn't penalize the user)
    if (buckets.size > MAX_BUCKETS) {
      for (const [k, b] of buckets) {
        b.refill();
        if (b.tokens >= b.capacity) buckets.delete(k);
        if (buckets.size <= MAX_BUCKETS / 2) break;
      }
    }

    let bucket = buckets.get(userKey);
    if (!bucket) {
      bucket = new TokenBucket(capacity, refillPerSec);
      buckets.set(userKey, bucket);
    }

    if (!bucket.tryConsume()) {
      const retrySec = Math.ceil(bucket.retryAfter());
      res.setHeader('Retry-After', String(retrySec));
      console.warn(`[${name}] rate-limited ${userKey} (retry in ${retrySec}s)`);
      return res.status(429).json({
        error: 'Too many requests on this endpoint. Please slow down.',
        retryAfter: retrySec,
      });
    }
    next();
  };
}

module.exports = { perUserRateLimit, TokenBucket };
