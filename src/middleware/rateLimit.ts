/**
 * Rate Limiting Middleware
 * Protege contra brute-force e DDoS
 */

interface RateLimiterOptions {
  windowMs: number;
  max: number;
  message?: string;
}

function createRateLimiter(options: RateLimiterOptions) {
  const requests = new Map<string, { count: number; resetTime: number }>();

  return (req: any, res: any, next: any) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();
    const windowStart = requests.get(ip)?.resetTime || now;

    if (now > windowStart) {
      // Reset window
      requests.set(ip, { count: 1, resetTime: now + options.windowMs });
    } else {
      const record = requests.get(ip)!;
      record.count++;

      if (record.count > options.max) {
        res.status(429).json({
          error: options.message || 'Too many requests',
          retryAfter: Math.ceil((record.resetTime - now) / 1000),
        });
        return;
      }
    }

    next();
  };
}

export { createRateLimiter };
