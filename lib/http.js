export function json(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(body);
}

export function method(req, res, allowed) {
  if (allowed.includes(req.method)) return true;
  res.setHeader('Allow', allowed.join(', '));
  json(res, 405, { error: 'method_not_allowed' });
  return false;
}

export function body(req) {
  if (!req.body) return {};
  return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
}

export async function rawBody(req, maximumBytes = 1_000_000) {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (typeof req.rawBody === 'string') return Buffer.from(req.rawBody);
  const chunks = [];
  let size = 0;
  if (req?.[Symbol.asyncIterator]) {
    for await (const chunk of req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > maximumBytes) throw new Error('request_too_large');
      chunks.push(bytes);
    }
  }
  if (chunks.length) return Buffer.concat(chunks);
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  if (req.body && typeof req.body === 'object') {
    throw new Error('raw_request_body_unavailable');
  }
  return Buffer.alloc(0);
}

export function assertSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  const expected = process.env.PUBLIC_APP_URL;
  if (!expected || new URL(origin).origin !== new URL(expected).origin) throw new Error('origin_mismatch');
}
