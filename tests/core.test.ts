import test from 'node:test';
import assert from 'node:assert/strict';
import {
  demoPlan,
  validatePlan,
  diffPlans,
  emptyPlan,
  flatten,
  templates,
} from '../lib/plan';
import {
  checkOrigin,
  encrypt,
  decrypt,
  canManage,
  assertDestruction,
  sessionCookie,
  body,
} from '../lib/security';
import {
  executeChange,
  overwrites,
  mockExecute,
  snapshotHash,
  checkOperations,
  REQUIRED,
  discordClient,
  type Snapshot,
} from '../lib/discord';
const sample = demoPlan('gaming valorant minecraft staff tournaments');
test('every template produces a validated bounded plan', () => {
  for (const t of templates) {
    const p = demoPlan(t);
    assert.deepEqual(validatePlan(p), p);
    assert.ok(flatten(p).length <= 70);
  }
});
test('untrusted AI JSON cannot grant permissions or execute commands', () => {
  assert.throws(() => validatePlan({ ...sample, execute: 'delete all' }));
  const p = structuredClone(sample);
  (p.roles[0] as any).permissions = '8';
  assert.throws(() => validatePlan(p));
});
test('duplicate keys, invalid names and unresolved access roles are rejected', () => {
  const p = structuredClone(sample);
  p.roles[1].key = p.roles[0].key;
  assert.throws(() => validatePlan(p));
  const q = structuredClone(sample);
  q.categories[0].channels[0].name = 'Bad Name';
  assert.throws(() => validatePlan(q));
  const r = structuredClone(sample);
  r.categories[0].visible_to = ['missing'];
  assert.throws(() => validatePlan(r));
});
test('modification preserves keys, current context and creates a rename diff', () => {
  const p = demoPlan('Rename general to community-chat', sample);
  const d = diffPlans(sample, p);
  assert.equal(d.length, 1);
  assert.equal(d[0].action, 'update');
  assert.equal(d[0].object.key, 'general');
  assert.equal(p.categories.length, sample.categories.length);
});
test('deletion intent is required and precise', () => {
  const p = demoPlan('Remove memes channel', sample);
  const d = diffPlans(sample, p);
  assert.equal(d[0].action, 'delete');
  assert.throws(() => assertDestruction('make it better', d));
  assert.doesNotThrow(() => assertDestruction('remove memes', d));
});
test('privacy changes flow to child channel diff and payloads', () => {
  const base = demoPlan('gaming valorant');
  const p = demoPlan('Make that category private', base);
  const d = diffPlans(base, p);
  assert.ok(d.some((x) => x.object.kind === 'category'));
  assert.ok(d.some((x) => x.object.kind === 'channel'));
  const result = overwrites('guild', 'bot', ['moderator'], true, {
    moderator: 'role',
  });
  assert.equal(result[0].deny, '3072');
  assert.equal(result[1].allow, '1024');
  assert.equal(result[1].deny, '2048');
  assert.equal(result.at(-1)?.type, 1);
  assert.throws(() => overwrites('guild', 'bot', ['missing'], false, {}));
});
test('mock executor creates roles, categories and channels in dependency order', async () => {
  const result = await mockExecute(sample);
  assert.equal(result.objects, flatten(sample).length);
  assert.ok(result.calls[0].path.endsWith('/roles'));
  assert.equal((result.calls[0].data as any).permissions, '0');
  const category = result.calls.findIndex((c) => (c.data as any)?.type === 4);
  const channel = result.calls.findIndex((c) => (c.data as any)?.type === 0);
  assert.ok(category < channel);
  assert.ok((result.calls[channel].data as any).parent_id);
});
test('failed API operation is never retried or falsely mapped', async () => {
  const map: Record<string, string> = {};
  let attempts = 0;
  await assert.rejects(() =>
    executeChange(
      async () => {
        attempts++;
        throw Error('Discord unavailable');
      },
      'guild',
      'bot',
      diffPlans(emptyPlan, sample)[0],
      map,
    ),
  );
  assert.equal(attempts, 1);
  assert.deepEqual(map, {});
});
test('permission validation and snapshots detect permission drift', () => {
  const s: Snapshot = {
    guild: { id: 'guild', name: 'Test', owner_id: 'user', features: [] },
    channels: [],
    roles: [],
    botId: 'bot',
    botPermissions: REQUIRED.toString(),
    botPosition: 10,
  };
  const a = snapshotHash(s);
  s.botPermissions = '0';
  assert.notEqual(snapshotHash(s), a);
  const role = sample.roles[0];
  s.roles = [{ id: 'role', name: role.name, permissions: '0', position: 15 }];
  const updated = structuredClone(sample);
  updated.roles[0].color = '#ffffff';
  assert.throws(
    () =>
      checkOperations(updated, diffPlans(sample, updated), s, {
        [role.key]: 'role',
      }),
    /above the bot/,
  );
});
test('server authorization uses BigInt permissions, never frontend claims', () => {
  assert.equal(canManage({ permissions: '0' }), false);
  assert.equal(canManage({ permissions: '32' }), true);
  assert.equal(canManage({ permissions: '8' }), true);
  assert.equal(canManage({ owner: true, permissions: '0' }), true);
  assert.equal(canManage({ permissions: '1099511627776' }), false);
});
test('CSRF rejects cross-origin and missing custom headers', () => {
  process.env.APP_ORIGIN = 'https://guildforge.test';
  assert.throws(() =>
    checkOrigin(
      new Request('https://guildforge.test/api', {
        headers: { origin: 'https://evil.test', 'x-guildforge': '1' },
      }),
    ),
  );
  assert.throws(() =>
    checkOrigin(
      new Request('https://guildforge.test/api', {
        headers: { origin: 'https://guildforge.test' },
      }),
    ),
  );
  assert.doesNotThrow(() =>
    checkOrigin(
      new Request('https://guildforge.test/api', {
        headers: { origin: 'https://guildforge.test', 'x-guildforge': '1' },
      }),
    ),
  );
});
test('tokens are encrypted and tampering fails; production cookie is secure', () => {
  process.env.SESSION_SECRET = 'a-test-secret-with-at-least-32-characters';
  process.env.APP_ORIGIN = 'https://guildforge.test';
  const encrypted = encrypt('discord-secret');
  assert.ok(!encrypted.includes('discord-secret'));
  assert.equal(decrypt(encrypted), 'discord-secret');
  assert.throws(() => decrypt(encrypted.slice(0, -5) + 'xxxxx'));
  assert.match(
    sessionCookie('gf_session', 'opaque'),
    /HttpOnly; SameSite=Lax; Max-Age=3600; Secure/,
  );
});
test('body rejects overlarge payloads', async () => {
  await assert.rejects(
    () =>
      body(
        new Request('https://example.test', {
          method: 'POST',
          body: 'x'.repeat(100001),
        }),
      ),
    /too large/,
  );
});
test('Discord rate-limit response returns a clear error without retry', async () => {
  const old = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ retry_after: 7 }, { status: 429 });
  };
  try {
    await assert.rejects(
      () => discordClient('test-token')('/guilds/123'),
      /7 seconds/,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = old;
  }
});

test('PostgreSQL JSONB key reordering does not produce spurious changes', () => {
  function reorder(v: any): any {
    return Array.isArray(v)
      ? v.map(reorder)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, reorder(x)]),
          )
        : v;
  }
  assert.equal(diffPlans(reorder(sample), sample).length, 0);
});
