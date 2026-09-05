import test from 'node:test';
import assert from 'node:assert/strict';
import { GET, POST } from '../app/api/[...path]/route';
const base = 'http://localhost:3000';
const req = (path: string, data: unknown, ip = 'test') =>
  new Request(base + '/api/' + path, {
    method: 'POST',
    headers: {
      origin: base,
      'x-guildforge': '1',
      'content-type': 'application/json',
      'cf-connecting-ip': ip,
    },
    body: JSON.stringify(data),
  });
test('credential-free API: demo generation, invalid plans, simulation, auth denial and rate limit', async () => {
  delete process.env.APP_ORIGIN;
  delete process.env.DATABASE_URL;
  delete process.env.DISCORD_BOT_TOKEN;
  delete process.env.DISCORD_CLIENT_ID;
  const config = await GET(new Request(base + '/api/config'));
  assert.equal(((await config.json()) as any).discord, false);
  const gen = await POST(
    req('demo/generate', { prompt: 'Create a Valorant community' }),
  );
  assert.equal(gen.status, 200);
  const data = (await gen.json()) as any;
  assert.equal(data.simulated, true);
  const sim = await POST(req('demo/deploy', { plan: data.plan }));
  assert.equal(sim.status, 200);
  assert.equal(((await sim.json()) as any).simulated, true);
  assert.equal((await GET(new Request(base + '/api/servers'))).status, 401);
  assert.equal(
    (await GET(new Request(base + '/api/auth/callback?state=fake&code=foo')))
      .status,
    403,
  );
  assert.equal(
    (await POST(req('discord/deploy', { confirm: true, approval: 'forged' })))
      .status,
    401,
  );
  assert.equal(
    (
      await POST(
        new Request(base + '/api/demo/generate', {
          method: 'POST',
          headers: { origin: 'https://evil.test' },
          body: '{}',
        }),
      )
    ).status,
    403,
  );
  assert.equal(
    (await POST(req('demo/generate', { prompt: 'x'.repeat(2001) }))).status,
    400,
  );
  for (let i = 0; i < 20; i++)
    await POST(req('demo/generate', { prompt: 'gaming' }, 'limited'));
  assert.equal(
    (await POST(req('demo/generate', { prompt: 'gaming' }, 'limited'))).status,
    429,
  );
});
