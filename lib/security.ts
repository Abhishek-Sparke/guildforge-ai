import { z } from 'zod';
import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';
export class AppError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export const randomToken = () => Buffer.from(randomBytes(32)).toString('base64url');
export function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32)
    throw new AppError(
      'Configure a session secret of at least 32 characters.',
      503,
    );
  return createHash('sha256').update(s).digest();
}
export function encrypt(value: string) {
  const iv = randomBytes(12),
    c = createCipheriv('aes-256-gcm', secret(), iv);
  return Buffer.concat([
    iv,
    c.update(value, 'utf8'),
    c.final(),
    c.getAuthTag(),
  ]).toString('base64url');
}
export function decrypt(value: string) {
  const b = Buffer.from(value, 'base64url');
  const c = createDecipheriv('aes-256-gcm', secret(), b.subarray(0, 12));
  c.setAuthTag(b.subarray(-16));
  return Buffer.concat([c.update(b.subarray(12, -16)), c.final()]).toString(
    'utf8',
  );
}
export function origin(req?: Request) {
  const v =
    process.env.APP_ORIGIN ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);
  if (v) {
    try {
      return new URL(v).origin;
    } catch {}
  }
  if (req) {
    try {
      return new URL(req.url).origin;
    } catch {}
  }
  return 'http://localhost:3000';
}
export function checkOrigin(req: Request) {
  const actual = req.headers.get('origin');
  const expected = origin(req);
  if (
    actual &&
    actual !== expected &&
    actual !== new URL(req.url).origin
  )
    throw new AppError('Request origin could not be verified.', 403);
  if (req.headers.get('x-guildforge') !== '1')
    throw new AppError('Request origin could not be verified.', 403);
}
export function cookie(req: Request, name: string) {
  return (req.headers.get('cookie') || '')
    .split(';')
    .map((x) => x.trim())
    .find((x) => x.startsWith(name + '='))
    ?.slice(name.length + 1);
}
export function sessionCookie(name: string, value: string, age = 3600) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${process.env.APP_ORIGIN?.startsWith('https:') ? '; Secure' : ''}`;
}
export async function body(req: Request) {
  if (Number(req.headers.get('content-length')) > 100000)
    throw new AppError('Request is too large.', 413);
  const reader = req.body?.getReader();
  if (!reader) throw new AppError('A JSON body is required.');
  let size = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 100000) {
      await reader.cancel();
      throw new AppError('Request is too large.', 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
      throw Error();
    return parsed;
  } catch {
    throw new AppError('Invalid JSON request.');
  }
}
export function canManage(g: { owner?: boolean; permissions: string }) {
  return (
    g.owner === true ||
    (BigInt(g.permissions) & 8n) !== 0n ||
    (BigInt(g.permissions) & 32n) !== 0n
  );
}
export function assertDestruction(
  prompt: string,
  changes: { action: string }[],
) {
  if (
    changes.some((c) => c.action === 'delete') &&
    !/\b(remove|delete|undo)\b/i.test(prompt)
  )
    throw new AppError(
      'Destructive changes require an explicit remove or delete request.',
    );
}
export function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
export function fail(e: unknown, id: string) {
  if (e instanceof z.ZodError)
    return json(
      {
        error:
          'Plan validation failed. Check names, object types and required fields.',
        requestId: id,
      },
      422,
    );
  console.error(
    JSON.stringify({
      event: 'request_failed',
      requestId: id,
      error: e instanceof AppError ? e.message : 'internal_error',
    }),
  );
  return json(
    {
      error:
        e instanceof AppError
          ? e.message
          : 'The request could not be completed. Please try again or check server configuration.',
      requestId: id,
    },
    e instanceof AppError ? e.status : 500,
  );
}
