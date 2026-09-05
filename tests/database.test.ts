import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
test('PostgreSQL schema, atomic quotas, one-time OAuth state and guild deployment lock', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      await readFile(new URL('../db/001_initial.sql', import.meta.url), 'utf8'),
    );
    await db.query("INSERT INTO users(id,username) VALUES ('u','tester')");
    for (let i = 0; i < 5; i++) {
      const q = await db.query(
        "INSERT INTO monthly_usage(user_id,month,ai_calls) VALUES('u','2026-09',1) ON CONFLICT(user_id,month) DO UPDATE SET ai_calls=monthly_usage.ai_calls+1 WHERE monthly_usage.ai_calls<3 RETURNING ai_calls",
      );
      assert.equal(q.rows.length, i < 3 ? 1 : 0);
    }
    await db.query(
      "INSERT INTO oauth_states VALUES ('state',now()+interval '10 minutes')",
    );
    assert.equal(
      (
        await db.query(
          "DELETE FROM oauth_states WHERE id='state' AND expires_at>now() RETURNING id",
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (
        await db.query(
          "DELETE FROM oauth_states WHERE id='state' AND expires_at>now() RETURNING id",
        )
      ).rows.length,
      0,
    );
    await db.query(
      "INSERT INTO builds(id,user_id,server_id,prompt,plan) VALUES('b','u','g','test','{}')",
    );
    await db.query(
      "INSERT INTO approvals(id,user_id,build_id,server_id,plan_hash,snapshot_hash,changes,expires_at) VALUES('a','u','b','g','hash','snapshot','[]',now()+interval '5 minutes'),('a2','u','b','g','hash','snapshot','[]',now()+interval '5 minutes')",
    );
    await db.query(
      "INSERT INTO servers(id,name,owner_user_id,managed_plan) VALUES('g','Test','u','{}')",
    );
    const claim =
      "WITH locked AS (SELECT id FROM servers WHERE id='g' AND revision=0 FOR UPDATE), approved AS (UPDATE approvals SET consumed=true WHERE EXISTS (SELECT 1 FROM locked) AND id=$1 AND consumed=false AND expires_at>now() RETURNING id) INSERT INTO deployments(id,approval_id,build_id,user_id,server_id,status) SELECT $2,id,'b','u','g','running' FROM approved RETURNING id";
    assert.equal((await db.query(claim, ['a', 'd'])).rows.length, 1);
    assert.equal((await db.query(claim, ['a', 'd-repeat'])).rows.length, 0);
    await assert.rejects(
      () => db.query(claim, ['a2', 'd2']),
      /one_active_guild_deployment/,
    );
    assert.equal(
      (
        await db.query<{ consumed: boolean }>(
          "SELECT consumed FROM approvals WHERE id='a2'",
        )
      ).rows[0].consumed,
      false,
    );
    await db.query("UPDATE deployments SET status='uncertain' WHERE id='d'");
    await assert.rejects(
      () => db.query(claim, ['a2', 'd3']),
      /one_active_guild_deployment/,
    );
    await db.query("UPDATE deployments SET status='succeeded' WHERE id='d'");
    assert.equal((await db.query(claim, ['a2', 'd4'])).rows.length, 1);
  } finally {
    await db.close();
  }
});
