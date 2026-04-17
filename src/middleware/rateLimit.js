'use strict';

/** Simple in-memory rate limiter. No Redis required. */

const windows = new Map(); // ip -> { count, resetAt }

// Clean stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, w] of windows) {
    if (w.resetAt < now) windows.delete(ip);
  }
}, 300000).unref();

function createRateLimit(maxRequests = 10, windowMs = 60000) {
  return function rateLimitMiddleware(req, res, next) {
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
    const now = Date.now();

    let w = windows.get(ip);
    if (!w || w.resetAt < now) {
      w = { count: 0, resetAt: now + windowMs };
      windows.set(ip, w);
    }

    w.count++;
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - w.count));

    if (w.count > maxRequests) {
      return res.status(429).json({ error: 'Too many requests, please try again later', code: 'RATE_LIMITED' });
    }
    next();
  };
}

const loginRateLimit = createRateLimit(10, 60000);

module.exports = { createRateLimit, loginRateLimit };
