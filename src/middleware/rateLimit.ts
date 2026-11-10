/**
 * Rate Limiting Middleware
 * Protege contra brute-force e DDoS
 *
 * Correção do bug original: na primeira requisição de um IP,
 * `requests.get(ip)` era undefined e o código caía no branch `else`,
 * quebrando com "Cannot read properties of undefined (reading 'count')" —
 * todas as rotas retornavam 500.
 */

interface RateLimiterOptions {
  windowMs: number;
  max: number;
  message?: string;
}

interface RateRecord {
  count: number;
  resetTime: number;
}

function createRateLimiter(options: RateLimiterOptions) {
  const requests = new Map<string, RateRecord>();

  // Limpa registros expirados quando o mapa cresce demais
  function prune(now: number) {
    if (requests.size < 1000) return;
    for (const [ip, record] of requests) {
      if (now > record.resetTime) requests.delete(ip);
    }
  }

  return (req: any, res: any, next: any) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    prune(now);

    const record = requests.get(ip);

    if (!record || now > record.resetTime) {
      // Primeira requisição ou janela expirada → reinicia
      requests.set(ip, { count: 1, resetTime: now + options.windowMs });
      return next();
    }

    record.count++;
    if (record.count > options.max) {
      return res.status(429).json({
        error: options.message || 'Too many requests',
        retryAfter: Math.ceil((record.resetTime - now) / 1000),
      });
    }

    next();
  };
}

export { createRateLimiter };
