import { neon } from '@neondatabase/serverless';
import { AppError, cookie, hash, decrypt } from './security';
export function sql() {
  if (!process.env.DATABASE_URL)
    throw new AppError(
      'PostgreSQL is not configured. Demo mode is available without an account.',
      503,
    );
  return neon(process.env.DATABASE_URL);
}
export type Session = {
  user_id: string;
  username: string;
  avatar: string | null;
  access_token: string;
  csrf: string;
  session_id: string;
};
export async function session(req: Request): Promise<Session> {
  const token = cookie(req, 'gf_session');
  if (!token) throw new AppError('Sign in with Discord to continue.', 401);
  const rows =
    await sql()`SELECT s.id as session_id,s.user_id,s.token_encrypted,s.csrf,u.username,u.avatar FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=${hash(token)} AND s.expires_at>now()`;
  if (!rows[0])
    throw new AppError(
      'Your Discord session expired. Please sign in again.',
      401,
    );
  const r = rows[0];
  return {
    user_id: r.user_id,
    username: r.username,
    avatar: r.avatar,
    access_token: decrypt(r.token_encrypted),
    csrf: r.csrf,
    session_id: r.session_id,
  };
}
export async function limit(key: string, max: number, seconds: number) {
  const bucket = Math.floor(Date.now() / 1000 / seconds);
  const rows =
    await sql()`INSERT INTO usage_limits(key,bucket,count) VALUES(${key},${bucket},1) ON CONFLICT(key,bucket) DO UPDATE SET count=usage_limits.count+1 WHERE usage_limits.count<${max} RETURNING count`;
  if (!rows.length)
    throw new AppError(
      'Usage limit reached. Please wait for the next limit window.',
      429,
    );
  return Number(rows[0].count);
}
export async function monthly(user: string) {
  const month = new Date().toISOString().slice(0, 7);
  const rows =
    await sql()`INSERT INTO monthly_usage(user_id,month,ai_calls) VALUES(${user},${month},1) ON CONFLICT(user_id,month) DO UPDATE SET ai_calls=monthly_usage.ai_calls+1 WHERE monthly_usage.ai_calls<3 RETURNING ai_calls`;
  if (!rows.length)
    throw new AppError(
      'Your 3 free AI requests for this month have been used.',
      429,
    );
  return Number(rows[0].ai_calls);
}
export async function ownedBuild(id: string, user: string) {
  const rows =
    await sql()`SELECT * FROM builds WHERE id=${id} AND user_id=${user}`;
  if (!rows[0]) throw new AppError('Build not found.', 404);
  return rows[0];
}
