import { canonical } from '@/lib/canonical';
import {
  AppError,
  hash,
  randomToken,
  encrypt,
  origin,
  checkOrigin,
  cookie,
  sessionCookie,
  body,
  json,
  fail,
  assertDestruction,
} from '@/lib/security';
import { sql, session, limit, monthly, ownedBuild } from '@/lib/db';
import { validatePlan, emptyPlan, diffPlans, demoPlan, type Plan } from '@/lib/plan';
import {
  guilds,
  botGuilds,
  snapshot,
  snapshotHash,
  checkOperations,
  executeChange,
  discordClient,
  REQUIRED,
  mockExecute,
} from '@/lib/discord';
import { generate, isAiConfigured, getAiProviderInfo } from '@/lib/ai';
export const dynamic = 'force-dynamic';
const demoWindows = new Map<string, { count: number; until: number }>();
function demoLimit(req: Request) {
  const key = req.headers.get('cf-connecting-ip') || 'local-demo';
  const now = Date.now();
  if (demoWindows.size > 1000)
    for (const [k, v] of demoWindows) if (v.until < now) demoWindows.delete(k);
  let v = demoWindows.get(key);
  if (!v || v.until < now) {
    v = { count: 0, until: now + 60000 };
    demoWindows.set(key, v);
  }
  if (++v.count > 20)
    throw new AppError(
      'Please wait a minute before generating another demo.',
      429,
    );
}
function configured() {
  return Boolean(
    process.env.DISCORD_CLIENT_ID &&
    process.env.DISCORD_CLIENT_SECRET
  );
}
function getRedirectUri(req: Request) {
  if (process.env.DISCORD_REDIRECT_URI && process.env.DISCORD_REDIRECT_URI.trim()) {
    const configuredUri = process.env.DISCORD_REDIRECT_URI.trim();
    const isLocalhost =
      configuredUri.includes('localhost') || configuredUri.includes('127.0.0.1');
    const reqOrigin = origin(req);
    const isRemoteReq =
      !reqOrigin.includes('localhost') && !reqOrigin.includes('127.0.0.1');
    if (!(isLocalhost && isRemoteReq)) {
      return configuredUri;
    }
  }
  return `${origin(req)}/api/auth/callback`;
}
export async function GET(req: Request) {
  const requestId = randomToken().slice(0, 12);
  try {
    const url = new URL(req.url),
      path = url.pathname.replace(/^\/api\//, '');
    if (path === 'config') {
      const aiInfo = getAiProviderInfo();
      return json({
        discord: configured(),
        clientId: process.env.DISCORD_CLIENT_ID || null,
        botConfigured: Boolean(process.env.DISCORD_BOT_TOKEN),
        databaseConfigured: Boolean(process.env.DATABASE_URL),
        ai: aiInfo.configured,
        aiProvider: aiInfo.provider,
        aiModel: aiInfo.model,
        redirectUri: getRedirectUri(req),
        mockDiscord: process.env.MOCK_DISCORD !== 'false',
        liveDeploy: process.env.ENABLE_LIVE_DEPLOY === 'true',
        demo: true,
      });
    }
    if (path === 'auth/discord') {
      if (!configured())
        throw new AppError(
          'Discord sign-in is not configured yet. Set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET.',
          503,
        );
      try {
        await limit(
          'oauth:' + hash(req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || 'local'),
          10,
          300,
        );
      } catch {}
      const state = randomToken();
      try {
        await sql()`INSERT INTO oauth_states(id,expires_at) VALUES(${hash(state)},now()+interval '10 minutes')`;
      } catch (e) {
        console.warn('OAuth state db insert skipped:', e);
      }
      const redirectUri = getRedirectUri(req);
      const target = new URL('https://discord.com/oauth2/authorize');
      target.search = new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID!,
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: 'identify guilds',
        state,
      }).toString();
      return new Response(null, {
        status: 302,
        headers: {
          Location: target.toString(),
          'Set-Cookie': sessionCookie('gf_oauth', state, 600),
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
        },
      });
    }
    if (path === 'auth/callback') {
      const state = url.searchParams.get('state'),
        code = url.searchParams.get('code');
      if (!state || !code || cookie(req, 'gf_oauth') !== state)
        throw new AppError(
          'Discord sign-in verification failed. Please start again.',
          403,
        );
      try {
        const used =
          await sql()`DELETE FROM oauth_states WHERE id=${hash(state)} AND expires_at>now() RETURNING id`;
        if (process.env.DATABASE_URL && !used.length)
          throw new AppError(
            'This sign-in attempt expired or was already used.',
            403,
          );
      } catch (err) {
        if (err instanceof AppError) throw err;
      }
      const redirectUri = getRedirectUri(req);
      const result = await fetch('https://discord.com/api/v10/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.DISCORD_CLIENT_ID!,
          client_secret: process.env.DISCORD_CLIENT_SECRET!,
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!result.ok)
        throw new AppError(
          'Discord could not complete sign-in. Please try again.',
          401,
        );
      const token = (await result.json()) as any;
      const profile = await discordClient(
        token.access_token,
        true,
      )('/users/@me');
      const sid = randomToken(),
        csrf = randomToken();
      try {
        await sql().transaction([
          sql()`INSERT INTO users(id,username,avatar) VALUES(${profile.id},${profile.username},${profile.avatar}) ON CONFLICT(id) DO UPDATE SET username=excluded.username,avatar=excluded.avatar`,
          sql()`INSERT INTO sessions(id,user_id,token_encrypted,csrf,expires_at) VALUES(${hash(sid)},${profile.id},${encrypt(token.access_token)},${csrf},now()+(${Math.min(Number(token.expires_in) || 3600, 3600)} * interval '1 second'))`,
        ]);
      } catch (err) {
        console.warn('DB session save failed, falling back:', err);
      }
      const headers = new Headers({
        Location: origin(req) + '/?view=dashboard',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      });
      headers.append('Set-Cookie', sessionCookie('gf_session', sid));
      headers.append('Set-Cookie', sessionCookie('gf_oauth', '', 0));
      return new Response(null, { status: 302, headers });
    }
    const s = await session(req);
    await limit('api:' + s.user_id, 120, 60);
    if (path === 'me') {
      let aiCalls = 0;
      try {
        const usage =
          await sql()`SELECT ai_calls FROM monthly_usage WHERE user_id=${s.user_id} AND month=${new Date().toISOString().slice(0, 7)}`;
        aiCalls = Number(usage[0]?.ai_calls || 0);
      } catch {}
      return json({
        id: s.user_id,
        username: s.username,
        avatar: s.avatar,
        csrf: s.csrf,
        used: aiCalls,
        limit: 3,
      });
    }
    if (path === 'servers') {
      const [list, botInstalledSet] = await Promise.all([
        guilds(s.access_token),
        botGuilds(),
      ]);
      let connected: any[] = [];
      try {
        connected =
          await sql()`SELECT id,updated_at FROM servers WHERE owner_user_id=${s.user_id}`;
      } catch (err) {
        console.warn('Could not query connected servers from DB:', err);
      }
      return json({
        servers: list.map((g) => {
          const isBotInstalled = botInstalledSet.has(g.id);
          const isConnected = connected.some((c) => c.id === g.id);
          return {
            ...g,
            connected: isConnected,
            botInstalled: isBotInstalled,
            updatedAt: connected.find((c) => c.id === g.id)?.updated_at,
          };
        }),
      });
    }
    if (path === 'discord/install') {
      const id = url.searchParams.get('guild_id');
      if (id && (await guilds(s.access_token)).every((g) => g.id !== id))
        throw new AppError('Select a server you manage.', 403);
      if (!process.env.DISCORD_CLIENT_ID)
        throw new AppError('Discord Client ID is not configured.', 503);
      const target = new URL('https://discord.com/oauth2/authorize');
      const params: Record<string, string> = {
        client_id: process.env.DISCORD_CLIENT_ID,
        scope: 'bot',
        permissions: REQUIRED.toString(),
        integration_type: '0',
      };
      if (id) {
        params.guild_id = id;
        params.disable_guild_select = 'true';
      }
      target.search = new URLSearchParams(params).toString();
      return Response.redirect(target.toString(), 302);
    }
    if (path === 'builds') {
      return json({
        builds:
          await sql()`SELECT id,server_id,prompt,plan,status,created_at FROM builds WHERE user_id=${s.user_id} ORDER BY created_at DESC LIMIT 50`,
      });
    }
    if (path.startsWith('builds/'))
      return json(await ownedBuild(path.slice(7), s.user_id));
    if (path.startsWith('deployments/')) {
      const id = path.slice(12);
      const rows =
        await sql()`SELECT * FROM deployments WHERE id=${id} AND user_id=${s.user_id}`;
      if (!rows[0]) throw new AppError('Deployment not found.', 404);
      return json({
        ...rows[0],
        logs: await sql()`SELECT action,discord_object_id,status,error,created_at FROM deployment_logs WHERE deployment_id=${id} ORDER BY id`,
      });
    }
    throw new AppError('Endpoint not found.', 404);
  } catch (e) {
    return fail(e, requestId);
  }
}
export async function POST(req: Request) {
  const requestId = randomToken().slice(0, 12);
  try {
    checkOrigin(req);
    const path = new URL(req.url).pathname.replace(/^\/api\//, '');
    const input = await body(req);
    if (path === 'demo/generate') {
      demoLimit(req);
      if (
        typeof input.prompt !== 'string' ||
        input.prompt.trim().length < 3 ||
        input.prompt.length > 2000
      )
        throw new AppError('Use a prompt between 3 and 2,000 characters.');
      const current = input.current ? validatePlan(input.current) : undefined;
      let plan: Plan;
      let aiUsed = false;
      if (isAiConfigured()) {
        try {
          plan = await generate(input.prompt, current || null, [], null);
          aiUsed = true;
        } catch (e) {
          console.warn('Live AI demo generation failed, using preset:', e);
          plan = demoPlan(input.prompt, current);
        }
      } else {
        plan = demoPlan(input.prompt, current);
      }
      return json({
        plan,
        changes: diffPlans(current || emptyPlan, plan),
        simulated: true,
        aiUsed,
        message: aiUsed
          ? 'Generated with ' + (getAiProviderInfo().provider || 'AI')
          : 'Demo uses preset generation rules. Live AI requires GEMINI_API_KEY.',
      });
    }
    if (path === 'demo/deploy') {
      demoLimit(req);
      return json(await mockExecute(validatePlan(input.plan)));
    }
    const s = await session(req);
    if (req.headers.get('x-csrf-token') !== s.csrf)
      throw new AppError(
        'Session verification failed. Refresh and try again.',
        403,
      );
    await limit('api:' + s.user_id, 120, 60);
    if (path === 'auth/logout') {
      await sql()`DELETE FROM sessions WHERE id=${s.session_id}`;
      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': sessionCookie('gf_session', '', 0),
          'Cache-Control': 'no-store',
        },
      });
    }
    if (path === 'servers/connect') {
      const live = await snapshot(input.serverId, s.access_token);
      const existing =
        await sql()`SELECT * FROM servers WHERE id=${input.serverId}`;
      if (existing[0] && existing[0].owner_user_id !== s.user_id)
        throw new AppError(
          'This server is already managed by another GuildForge account.',
          409,
        );
      await sql()`INSERT INTO servers(id,name,owner_user_id,managed_plan) VALUES(${input.serverId},${live.guild.name},${s.user_id},${JSON.stringify(emptyPlan)}::jsonb) ON CONFLICT(id) DO UPDATE SET name=excluded.name,bot_status='connected',updated_at=now() WHERE servers.owner_user_id=${s.user_id}`;
      return json({
        ok: true,
        name: live.guild.name,
        channels: live.channels.length,
        roles: live.roles.length,
        plan: existing[0]?.managed_plan || emptyPlan,
      });
    }
    if (path === 'servers/disconnect') {
      const active =
        await sql()`SELECT id FROM deployments WHERE server_id=${input.serverId} AND user_id=${s.user_id} AND status IN ('running','uncertain')`;
      if (active.length)
        throw new AppError(
          'Reconcile the active deployment before disconnecting.',
          409,
        );
      await sql()`UPDATE servers SET bot_status='disconnected' WHERE id=${input.serverId} AND owner_user_id=${s.user_id}`;
      return json({
        ok: true,
        message:
          'Disconnected in GuildForge. Remove the bot in Discord if you want to revoke its access.',
      });
    }
    if (path === 'ai/generate' || path === 'ai/modify') {
      await limit('ai:' + s.user_id, 4, 60);
      if (
        typeof input.prompt !== 'string' ||
        input.prompt.trim().length < 3 ||
        input.prompt.length > 2000
      )
        throw new AppError('Use a prompt between 3 and 2,000 characters.');
      const server =
        await sql()`SELECT * FROM servers WHERE id=${input.serverId} AND owner_user_id=${s.user_id} AND bot_status='connected'`;
      if (!server[0]) throw new AppError('Connect a Discord server first.');
      const previous = input.buildId
        ? await ownedBuild(input.buildId, s.user_id)
        : null;
      if (previous && previous.server_id !== input.serverId)
        throw new AppError('Build belongs to another server.', 403);
      const live = await snapshot(input.serverId, s.access_token);
      if (!isAiConfigured())
        throw new AppError(
          'Live AI is not configured. Set GEMINI_API_KEY (or OPENAI_API_KEY) to enable.',
          503,
        );
      const used = await monthly(s.user_id);
      const current = previous?.plan || server[0].managed_plan;
      const plan = await generate(
        input.prompt,
        current,
        previous?.messages || [],
        {
          name: live.guild.name,
          channels: live.channels.map((c) => ({ name: c.name, type: c.type })),
          roles: live.roles.map((r) => ({ name: r.name })),
        },
      );
      const changes = diffPlans(current, plan);
      assertDestruction(input.prompt, changes);
      const id = crypto.randomUUID();
      const messages = [
        ...(previous?.messages || []),
        { role: 'user', content: input.prompt },
        { role: 'assistant', content: 'Plan generated for review.' },
      ].slice(-20);
      await sql()`INSERT INTO builds(id,user_id,server_id,prompt,plan,messages) VALUES(${id},${s.user_id},${input.serverId},${input.prompt},${JSON.stringify(plan)}::jsonb,${JSON.stringify(messages)}::jsonb)`;
      console.info(
        JSON.stringify({
          event: 'ai_plan_validated',
          requestId,
          userId: s.user_id,
          buildId: id,
        }),
      );
      return json({ id, plan, changes, used, messages });
    }
    if (path === 'discord/validate') {
      await limit('review:' + s.user_id, 10, 60);
      const build = await ownedBuild(input.buildId, s.user_id);
      const server =
        await sql()`SELECT * FROM servers WHERE id=${build.server_id} AND owner_user_id=${s.user_id} AND bot_status='connected'`;
      if (!server[0]) throw new AppError('Connect this server first.');
      const plan = validatePlan(build.plan),
        changes = diffPlans(server[0].managed_plan, plan);
      if (!changes.length)
        throw new AppError(
          'This plan has no deployable changes. Server title and onboarding are suggestions only.',
        );
      const live = await snapshot(build.server_id, s.access_token);
      checkOperations(plan, changes, live, server[0].object_map);
      const id = randomToken();
      await sql()`INSERT INTO approvals(id,user_id,build_id,server_id,plan_hash,snapshot_hash,changes,expires_at) VALUES(${hash(id)},${s.user_id},${build.id},${build.server_id},${hash(JSON.stringify(plan))},${snapshotHash(live)},${JSON.stringify(changes)}::jsonb,now()+interval '5 minutes')`;
      return json({
        approval: id,
        changes,
        serverName: live.guild.name,
        serverId: build.server_id,
        expiresIn: 300,
        destructive: changes.some((c) => c.action === 'delete'),
        notes: [
          'Roles provide identity and channel access, with no administrative privileges.',
          'Server name, description and onboarding remain suggestions.',
          'Existing unmanaged channels and roles are preserved.',
        ],
      });
    }
    if (path === 'discord/deploy') {
      await limit('deploy:' + s.user_id, 3, 300);
      if (input.confirm !== true)
        throw new AppError('Explicit approval is required.', 403);
      if (
        process.env.MOCK_DISCORD !== 'false' ||
        process.env.ENABLE_LIVE_DEPLOY !== 'true'
      )
        throw new AppError(
          'Live Discord deployment is disabled. Use the separate deployment simulation.',
          503,
        );
      const a = (
        await sql()`SELECT * FROM approvals WHERE id=${hash(String(input.approval))} AND user_id=${s.user_id} AND expires_at>now() AND consumed=false`
      )[0];
      if (!a)
        throw new AppError(
          'Review expired or already used. Review changes again.',
          409,
        );
      const b = await ownedBuild(a.build_id, s.user_id);
      const plan = validatePlan(b.plan);
      if (
        hash(JSON.stringify(plan)) !== a.plan_hash ||
        input.serverId !== a.server_id
      )
        throw new AppError(
          'Approved plan or server changed. Review again.',
          409,
        );
      if (
        a.changes.some((c: any) => c.action === 'delete') &&
        input.confirmDelete !== true
      )
        throw new AppError('Confirm irreversible deletions separately.', 403);
      const server = (
        await sql()`SELECT * FROM servers WHERE id=${a.server_id} AND owner_user_id=${s.user_id} AND bot_status='connected'`
      )[0];
      if (!server) throw new AppError('Server is disconnected.', 409);
      const live = await snapshot(a.server_id, s.access_token);
      if (
        snapshotHash(live) !== a.snapshot_hash ||
        canonical(diffPlans(server.managed_plan, plan)) !== canonical(a.changes)
      )
        throw new AppError(
          'The Discord server or managed state changed after review. Review the fresh diff.',
          409,
        );
      checkOperations(plan, a.changes, live, server.object_map);
      const deploymentId = crypto.randomUUID();
      let claim;
      try {
        claim =
          await sql()`WITH locked AS (SELECT id FROM servers WHERE id=${a.server_id} AND revision=${server.revision} FOR UPDATE), approved AS (UPDATE approvals SET consumed=true WHERE EXISTS (SELECT 1 FROM locked) AND id=${a.id} AND consumed=false AND expires_at>now() RETURNING id) INSERT INTO deployments(id,approval_id,build_id,user_id,server_id,status) SELECT ${deploymentId},id,${b.id},${s.user_id},${a.server_id},'running' FROM approved RETURNING id`;
      } catch {
        throw new AppError(
          'A deployment is already active or needs reconciliation for this server.',
          409,
        );
      }
      if (!claim.length)
        throw new AppError('This approval was already used.', 409);
      const map = { ...server.object_map };
      try {
        for (const change of a.changes) {
          const log = (
            await sql()`INSERT INTO deployment_logs(deployment_id,action,status) VALUES(${deploymentId},${JSON.stringify(change)}::jsonb,'started') RETURNING id`
          )[0];
          const objectId = await executeChange(
            discordClient(),
            a.server_id,
            live.botId,
            change,
            map,
          );
          await sql().transaction([
            sql()`UPDATE deployment_logs SET status='succeeded',discord_object_id=${objectId} WHERE id=${log.id}`,
            sql()`UPDATE servers SET revision=revision+1,object_map=${JSON.stringify(map)}::jsonb,updated_at=now() WHERE id=${a.server_id}`,
          ]);
        }
        await sql().transaction([
          sql()`UPDATE servers SET revision=revision+1,managed_plan=${JSON.stringify(plan)}::jsonb,object_map=${JSON.stringify(map)}::jsonb,updated_at=now() WHERE id=${a.server_id}`,
          sql()`UPDATE deployments SET status='succeeded',updated_at=now() WHERE id=${deploymentId}`,
          sql()`UPDATE builds SET status='deployed' WHERE id=${b.id}`,
        ]);
        return json({ id: deploymentId, status: 'succeeded' });
      } catch (e) {
        await sql()`UPDATE deployments SET status='uncertain',updated_at=now() WHERE id=${deploymentId}`;
        await sql()`UPDATE deployment_logs SET status='uncertain',error=${e instanceof AppError ? e.message : 'Execution or persistence failed. Reconcile before retry.'} WHERE deployment_id=${deploymentId} AND status='started'`;
        return json(
          {
            id: deploymentId,
            status: 'uncertain',
            error:
              'Deployment stopped. Some operations may have succeeded. Inspect the logs and reconcile before another deployment.',
          },
          502,
        );
      }
    }
    throw new AppError('Endpoint not found.', 404);
  } catch (e) {
    return fail(e, requestId);
  }
}
