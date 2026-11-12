import { setTimeout as sleep } from 'node:timers/promises';

export function duration(milliseconds) {
  return `${Math.ceil(Math.max(0, milliseconds) / 60000)} min`;
}

export function createQueue(unitsPerMinute, { now = Date.now, wait = sleep, log = console.log, diagnostic = () => {} } = {}) {
  if (!Number.isFinite(unitsPerMinute) || unitsPerMinute < 20) throw new Error('Invalid quota budget.');
  let nextRequest = 0;
  return async function request(cost, operation) {
    for (let attempt = 0; ; attempt++) {
      // Space requests evenly to avoid bursts at minute boundaries.
      await wait(Math.max(0, nextRequest - now()));
      nextRequest = now() + cost * 60000 / unitsPerMinute;
      try {
        return await operation();
      } catch (error) {
        const status = Number(error.response?.status || error.code);
        const details = error.response?.data?.error?.errors;
        const reasons = Array.isArray(details) ? details : [];
        const rateLimited = status === 429 || (status === 403 && reasons.some(item => ['rateLimitExceeded', 'userRateLimitExceeded'].includes(item.reason)));
        const aborted = [error, error.cause].some(item => ['AbortError', 'TimeoutError'].includes(item?.name) || ['ABORT_ERR', 'UND_ERR_CONNECT_TIMEOUT'].includes(item?.code)) || /operation was aborted/i.test(error.message || '');
        const transient = aborted || [500, 502, 503, 504].includes(status) || ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED'].includes(error.code);
        diagnostic('request-error', { attempt, status: Number.isFinite(status) ? status : undefined, name: error.name, code: String(error.code || ''), aborted });
        if ((!rateLimited && !transient) || attempt >= 10) throw error;
        // Honor server cooldowns, then apply bounded backoff to transient errors.
        const headers = error.response?.headers;
        const retryAfter = headers?.get?.('retry-after') ?? headers?.['retry-after'];
        const serverDelay = retryAfter ? (Number.isFinite(Number(retryAfter)) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - now()) : 0;
        const delay = Math.max(serverDelay || 0, Math.min(300000, 1000 * 2 ** attempt), rateLimited ? 60000 : 0);
        diagnostic('retry', { attempt: attempt + 1, delayMs: delay });
        log(`API pause: retrying in ${duration(delay)} (attempt ${attempt + 1}/10).`);
        // Split very long Retry-After values to avoid Node timer overflow.
        let remaining = delay;
        while (remaining > 0) {
          const chunk = Math.min(remaining, 60000);
          await wait(chunk);
          remaining -= chunk;
        }
      }
    }
  };
}

export function progress(label, done, total, started, unitsPerMinute) {
  const remaining = Math.max(0, total - done);
  const perItem = Math.max(1200000 / unitsPerMinute, done ? (Date.now() - started) / done : 0);
  const fraction = total ? Math.min(1, done / total) : 1;
  const filled = Math.floor(fraction * 20);
  console.log(`${label} [${'#'.repeat(filled)}${'-'.repeat(20 - filled)}] ${done}/${total} | ETA ${duration(remaining * perItem)}`);
}
