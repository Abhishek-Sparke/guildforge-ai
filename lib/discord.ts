import { AppError, canManage, hash } from './security';
import { flatten, validatePlan, type Plan, type Change } from './plan';
import { canonical } from './canonical';
export const REQUIRED =
  16n | 268435456n | 1024n | 2048n | 65536n | 1048576n | 2097152n;
export type DiscordRole = {
  id: string;
  name: string;
  permissions: string;
  position: number;
  managed?: boolean;
};
export type DiscordChannel = {
  id: string;
  name: string;
  type: number;
  parent_id: string | null;
  topic?: string;
  permission_overwrites?: {
    id: string;
    type: number;
    allow: string;
    deny: string;
  }[];
};
export type Snapshot = {
  guild: { id: string; name: string; owner_id: string; features: string[] };
  channels: DiscordChannel[];
  roles: DiscordRole[];
  botId: string;
  botPermissions: string;
  botPosition: number;
};
export type DiscordCall = (
  path: string,
  method?: string,
  data?: unknown,
) => Promise<any>;
export function discordClient(
  token = process.env.DISCORD_BOT_TOKEN,
  bearer = false,
): DiscordCall {
  return async (path, method = 'GET', data) => {
    if (!token)
      throw new AppError('Discord bot credentials are not configured.', 503);
    let response: Response;
    try {
      response = await fetch('https://discord.com/api/v10' + path, {
        method,
        headers: {
          Authorization: (bearer ? 'Bearer ' : 'Bot ') + token,
          'Content-Type': 'application/json',
          ...(!bearer && method !== 'GET'
            ? { 'X-Audit-Log-Reason': 'GuildForge approved community plan' }
            : {}),
        },
        body: data === undefined ? undefined : JSON.stringify(data),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new AppError(
        'Discord did not confirm the request. Reconcile deployment logs before retrying.',
        502,
      );
    }
    if (response.status === 429) {
      const data = (await response.json()) as { retry_after?: number };
      throw new AppError(
        `Discord rate limit reached. Try again after ${Math.ceil(data.retry_after || 5)} seconds.`,
        429,
      );
    }
    if (!response.ok) {
      const message =
        response.status === 403
          ? 'The bot or user lacks the required permissions. Check Manage Channels, Manage Roles and role hierarchy.'
          : response.status === 404
            ? 'The bot is not installed, or the Discord object no longer exists.'
            : response.status === 401
              ? 'Discord authorization expired. Sign in again or check bot credentials.'
              : 'Discord rejected the operation. Review the deployment logs.';
      throw new AppError(message, response.status === 401 ? 401 : 502);
    }
    return response.status === 204 ? null : response.json();
  };
}
export async function guilds(access: string) {
  const call = discordClient(access, true);
  let list: any[] = [];
  let after = '';
  for (let page = 0; page < 10; page++) {
    const rows = await call(
      '/users/@me/guilds?limit=200' + (after ? '&after=' + after : ''),
    );
    list.push(...rows);
    if (rows.length < 200) break;
    after = rows.at(-1).id;
  }
  return list
    .filter(canManage)
    .map((g) => ({
      id: g.id,
      name: g.name,
      icon: g.icon,
      permissions: g.permissions,
      owner: g.owner,
    }));
}
export async function botGuilds(): Promise<Set<string>> {
  if (!process.env.DISCORD_BOT_TOKEN) return new Set();
  try {
    const call = discordClient(process.env.DISCORD_BOT_TOKEN);
    let list: any[] = [];
    let after = '';
    for (let page = 0; page < 10; page++) {
      const rows = await call(
        '/users/@me/guilds?limit=200' + (after ? '&after=' + after : ''),
      );
      if (!Array.isArray(rows)) break;
      list.push(...rows);
      if (rows.length < 200) break;
      after = rows.at(-1).id;
    }
    return new Set(list.map((g: any) => String(g.id)));
  } catch (err) {
    console.warn('Could not query bot guilds from Discord API:', err);
    return new Set();
  }
}
export async function snapshot(
  guildId: string,
  access: string,
): Promise<Snapshot> {
  if (!/^\d{17,20}$/.test(guildId)) throw new AppError('Invalid server ID.');
  const allowed = await guilds(access);
  if (!allowed.some((g) => g.id === guildId))
    throw new AppError(
      'You no longer have permission to manage this server.',
      403,
    );
  const call = discordClient();
  let guild: any, channels: any, roles: any, bot: any;
  try {
    [guild, channels, roles, bot] = await Promise.all([
      call('/guilds/' + guildId),
      call('/guilds/' + guildId + '/channels'),
      call('/guilds/' + guildId + '/roles'),
      call('/users/@me'),
    ]);
  } catch (err: any) {
    if (err instanceof AppError && (err.status === 404 || err.status === 403)) {
      throw new AppError(
        "GuildForge is connected to your Discord account, but the bot isn't installed in this server yet.",
        404,
      );
    }
    throw err;
  }
  let member: any;
  try {
    member = await call('/guilds/' + guildId + '/members/' + bot.id);
  } catch {
    throw new AppError(
      "GuildForge is connected to your Discord account, but the bot isn't installed in this server yet.",
      404,
    );
  }
  const mine = (roles as DiscordRole[]).filter(
    (r) => r.id === guildId || member.roles.includes(r.id),
  );
  const bits = mine.reduce((a, r) => a | BigInt(r.permissions), 0n);
  if (!(bits & 8n) && (bits & REQUIRED) !== REQUIRED)
    throw new AppError(
      'The GuildForge bot is installed but lacks required permissions. It needs Manage Channels, Manage Roles, View Channels, Send Messages, Read Message History, Connect and Speak.',
      403,
    );
  return {
    guild: {
      id: guild.id,
      name: guild.name,
      owner_id: guild.owner_id,
      features: guild.features,
    },
    channels,
    roles,
    botId: bot.id,
    botPermissions: bits.toString(),
    botPosition: Math.max(...mine.map((r) => r.position)),
  };
}
export function snapshotHash(s: Snapshot) {
  return hash(
    canonical({
      guild: {
        id: s.guild.id,
        name: s.guild.name,
        owner_id: s.guild.owner_id,
        features: [...(s.guild.features || [])].sort(),
      },
      channels: [...s.channels]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type,
          parent_id: c.parent_id || null,
          topic: c.topic || '',
          permission_overwrites: [...(c.permission_overwrites || [])]
            .sort((a, b) => a.id.localeCompare(b.id))
            .map((po) => ({
              id: po.id,
              type: po.type,
              allow: String(po.allow),
              deny: String(po.deny),
            })),
        })),
      roles: [...s.roles]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((r) => ({
          id: r.id,
          name: r.name,
          permissions: String(r.permissions),
          position: r.position,
        })),
      botPermissions: s.botPermissions,
      botPosition: s.botPosition,
    }),
  );
}
export function checkOperations(
  p: Plan,
  changes: Change[],
  s: Snapshot,
  map: Record<string, string>,
) {
  validatePlan(p);
  if (
    s.channels.length +
      changes.filter((c) => c.action === 'create' && c.object.kind !== 'role')
        .length >
    500
  )
    throw new AppError('This server would exceed Discord’s channel limit.');
  if (
    s.roles.length +
      changes.filter((c) => c.action === 'create' && c.object.kind === 'role')
        .length >
    250
  )
    throw new AppError('This server would exceed Discord’s role limit.');
  for (const c of changes) {
    const o = c.object,
      id = map[o.key];
    if (c.action !== 'create') {
      if (!id)
        throw new AppError(
          'A managed object mapping is missing. Reconcile the server before deploying.',
        );
      if (o.kind === 'role') {
        const r = s.roles.find((r) => r.id === id);
        if (
          !r ||
          r.managed ||
          r.id === s.guild.id ||
          r.position >= s.botPosition ||
          BigInt(r.permissions) !== 0n
        )
          throw new AppError(
            'A role cannot be managed because it is missing, managed by another app, above the bot, or has elevated permissions outside this access-role model.',
          );
      } else {
        const ch = s.channels.find((ch) => ch.id === id);
        if (!ch)
          throw new AppError(
            'A managed channel was removed. Reconcile before deploying.',
          );
        if (
          o.kind === 'category' &&
          c.action === 'delete' &&
          s.channels.some(
            (ch) => ch.parent_id === id && !Object.values(map).includes(ch.id),
          )
        )
          throw new AppError(
            'This category contains unmanaged channels and cannot be removed.',
          );
      }
    } else if (o.kind === 'role') {
      const existing = s.roles.find(
        (r) => r.name.toLowerCase() === o.name.toLowerCase(),
      );
      if (existing) {
        if (
          existing.managed ||
          existing.id === s.guild.id ||
          existing.position >= s.botPosition
        ) {
          throw new AppError(
            `An existing role named ${o.name} would conflict with this plan (it is managed by another integration or above the GuildForge bot). Rename the planned role.`,
          );
        }
        map[o.key] = existing.id;
      }
    } else if (o.kind === 'category') {
      const existing = s.channels.find(
        (ch) => ch.type === 4 && ch.name.toLowerCase() === o.name.toLowerCase(),
      );
      if (existing) {
        map[o.key] = existing.id;
      }
    } else if (o.kind === 'channel') {
      const parentKey = o.data.parent ? String(o.data.parent) : null;
      if (parentKey) {
        const resolvedParentId = map[parentKey];
        if (resolvedParentId) {
          const existing = s.channels.find(
            (ch) =>
              ch.type !== 4 &&
              ch.parent_id === resolvedParentId &&
              ch.name.toLowerCase() === o.name.toLowerCase(),
          );
          if (existing) {
            map[o.key] = existing.id;
          }
        }
      } else {
        const existing = s.channels.find(
          (ch) =>
            ch.type !== 4 &&
            ch.parent_id === null &&
            ch.name.toLowerCase() === o.name.toLowerCase(),
        );
        if (existing) {
          map[o.key] = existing.id;
        }
      }
    }
  }
}
export function overwrites(
  guild: string,
  bot: string,
  visible: string[],
  readOnly: boolean,
  map: Record<string, string>,
) {
  const privateAccess = visible.length > 0;
  const result = [
    {
      id: guild,
      type: 0,
      allow: '0',
      deny: ((privateAccess ? 1024n : 0n) | (readOnly ? 2048n : 0n)).toString(),
    },
  ];
  for (const role of visible) {
    if (!map[role]) throw new AppError('Missing role for private access.');
    result.push({
      id: map[role],
      type: 0,
      allow: '1024',
      deny: readOnly ? '2048' : '0',
    });
  }
  result.push({ id: bot, type: 1, allow: REQUIRED.toString(), deny: '0' });
  return result;
}
export async function executeChange(
  call: DiscordCall,
  guild: string,
  bot: string,
  change: Change,
  map: Record<string, string>,
  live?: { roles?: any[]; channels?: any[] },
) {
  const { object: o, action } = change;
  let id = map[o.key];

  // If creating and we already mapped this object, return the existing ID
  if (action === 'create' && id) {
    return id;
  }

  // Deduplication on retry: check if object already exists in live Discord state
  if (action === 'create' && !id && live) {
    if (o.kind === 'role' && Array.isArray(live.roles)) {
      const existing = live.roles.find(
        (r) => r.name.toLowerCase() === o.name.toLowerCase() && r.name !== '@everyone',
      );
      if (existing) {
        id = existing.id;
        map[o.key] = id;
      }
    } else if (o.kind === 'category' && Array.isArray(live.channels)) {
      const existing = live.channels.find(
        (c) => c.type === 4 && c.name.toLowerCase() === o.name.toLowerCase(),
      );
      if (existing) {
        id = existing.id;
        map[o.key] = id;
      }
    } else if (o.kind === 'channel' && Array.isArray(live.channels)) {
      const parentId = o.data.parent ? map[String(o.data.parent)] : undefined;
      const expectedType = o.data.type === 'voice' ? 2 : 0;
      const existing = live.channels.find(
        (c) =>
          c.type === expectedType &&
          c.name.toLowerCase() === o.name.toLowerCase() &&
          (parentId ? c.parent_id === parentId : true),
      );
      if (existing) {
        id = existing.id;
        map[o.key] = id;
      }
    }
  }

  const root =
    o.kind === 'role' ? `/guilds/${guild}/roles` : `/guilds/${guild}/channels`;
  const target = o.kind === 'role' ? root + '/' + id : '/channels/' + id;

  if (action === 'delete') {
    if (!id) return null;
    await call(target, 'DELETE');
    delete map[o.key];
    return id;
  }

  let data: Record<string, unknown> = { name: o.name };
  if (o.kind === 'role') {
    data = {
      ...data,
      permissions: '0',
      color: parseInt(String(o.data.color).slice(1), 16),
      mentionable: false,
      hoist: false,
    };
  } else {
    const visible = (o.data.visible_to || []) as string[];
    data.permission_overwrites = overwrites(
      guild,
      bot,
      visible,
      Boolean(o.data.read_only),
      map,
    );
    if (o.kind === 'category') {
      if (!id && action === 'create') data.type = 4;
    } else {
      if (!map[String(o.data.parent)])
        throw new AppError(`Missing category mapping for channel "${o.name}".`);
      data.parent_id = map[String(o.data.parent)];
      if (!id && action === 'create') data.type = o.data.type === 'voice' ? 2 : 0;
      if (o.data.type === 'text') data.topic = o.data.topic;
    }
  }

  const isCreateNew = action === 'create' && !id;
  const method = isCreateNew ? 'POST' : 'PATCH';
  const url = isCreateNew ? root : target;

  const result = await call(url, method, data);
  const finalId = result?.id || id;
  if (finalId) {
    map[o.key] = finalId;
  }
  return finalId;
}
export async function mockExecute(plan: Plan) {
  const calls: { path: string; method: string; data: unknown }[] = [];
  let seq = 0;
  const map: Record<string, string> = {};
  const call: DiscordCall = async (path, method = 'GET', data) => {
    calls.push({ path, method, data });
    return { id: 'mock-' + ++seq };
  };
  for (const o of flatten(validatePlan(plan)))
    await executeChange(
      call,
      'mock-guild',
      'mock-bot',
      { action: 'create', object: o },
      map,
    );
  return { simulated: true, objects: seq, calls };
}
