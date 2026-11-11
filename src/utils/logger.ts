/**
 * PACHECO SOLUTIONS — Logger simples com timestamps
 * (substitui o @utils/logger que era importado mas não existia no projeto original)
 */

const timestamp = () => new Date().toISOString();

export const logger = {
  info: (...args: unknown[]) =>
    console.log(`[${timestamp()}] INFO `, ...args),
  warn: (...args: unknown[]) =>
    console.warn(`[${timestamp()}] WARN `, ...args),
  error: (...args: unknown[]) =>
    console.error(`[${timestamp()}] ERROR`, ...args),
};
