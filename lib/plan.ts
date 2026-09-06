import { canonical } from './canonical';
import { z } from 'zod';
const key = z.string().regex(/^[a-z][a-z0-9-]{0,49}$/);
const name = z.string().trim().min(1).max(80);
export const RoleSchema = z.strictObject({
  key,
  name,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export const ChannelSchema = z.strictObject({
  key,
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  type: z.enum(['text', 'voice']),
  topic: z.string().max(500),
  read_only: z.boolean(),
  visible_to: z.array(key).max(10),
});
export const PlanSchema = z.strictObject({
  server: z.strictObject({
    name: name.min(2),
    description: z.string().max(300),
  }),
  categories: z
    .array(
      z.strictObject({
        key,
        name,
        visible_to: z.array(key).max(10),
        channels: z.array(ChannelSchema).max(20),
      }),
    )
    .max(10),
  roles: z.array(RoleSchema).max(15),
  onboarding: z
    .array(
      z.strictObject({
        question: z.string().min(1).max(100),
        options: z.array(z.string().min(1).max(60)).min(2).max(8),
      }),
    )
    .max(3),
});
export type Plan = z.infer<typeof PlanSchema>;
export type Channel = z.infer<typeof ChannelSchema>;
export type FlatObject = {
  kind: 'role' | 'category' | 'channel';
  key: string;
  name: string;
  data: Record<string, unknown>;
};
export function flatten(p: Plan): FlatObject[] {
  return [
    ...p.roles.map((r) => ({
      kind: 'role' as const,
      key: r.key,
      name: r.name,
      data: { ...r },
    })),
    ...p.categories.flatMap((c) => [
      {
        kind: 'category' as const,
        key: c.key,
        name: c.name,
        data: { key: c.key, name: c.name, visible_to: c.visible_to },
      },
      ...c.channels.map((ch) => ({
        kind: 'channel' as const,
        key: ch.key,
        name: ch.name,
        data: {
          ...ch,
          parent: c.key,
          visible_to: ch.visible_to.length ? ch.visible_to : c.visible_to,
        },
      })),
    ]),
  ];
}
export function validatePlan(value: unknown): Plan {
  const p = PlanSchema.parse(value);
  const all = flatten(p);
  if (all.length > 70) throw Error('A plan can contain at most 70 objects.');
  if (new Set(all.map((x) => x.key)).size !== all.length)
    throw Error('Every object must have a unique stable key.');
  const names = all.map(
    (x) =>
      x.kind + ':' + String(x.data.parent || '') + ':' + x.name.toLowerCase(),
  );
  if (new Set(names).size !== names.length)
    throw Error('Duplicate names in the same category are not allowed.');
  const roles = new Set(p.roles.map((r) => r.key));
  for (const x of all) {
    for (const r of (x.data.visible_to || []) as string[])
      if (!roles.has(r))
        throw Error('Private access references an unknown role.');
  }
  return p;
}
export const emptyPlan: Plan = {
  server: { name: 'New community', description: '' },
  roles: [],
  categories: [],
  onboarding: [],
};
export type Change = {
  action: 'create' | 'update' | 'delete';
  object: FlatObject;
  before?: FlatObject;
};
export function diffPlans(before: Plan, after: Plan): Change[] {
  const a = new Map(flatten(before).map((o) => [o.key, o]));
  const b = new Map(flatten(after).map((o) => [o.key, o]));
  const changes: Change[] = [];
  for (const o of b.values()) {
    const old = a.get(o.key);
    if (old && old.kind !== o.kind)
      throw Error('Object types cannot change. Create a new object instead.');
    if (old && o.kind === 'channel' && old.data.type !== o.data.type)
      throw Error('Channel types cannot change.');
    if (!old) changes.push({ action: 'create', object: o });
    else if (canonical(old) !== canonical(o))
      changes.push({ action: 'update', object: o, before: old });
  }
  for (const o of [...a.values()].reverse())
    if (!b.has(o.key)) changes.push({ action: 'delete', object: o, before: o });
  return changes;
}
export const templates = [
  'Gaming Community',
  'Esports',
  'Creator Community',
  'Developer Community',
  'Study Group',
  'School/College',
  'Business',
  'NFT/Web3',
  'Friends',
  'Podcast',
  'Content Creator',
  'Event',
  'Support Community',
];
export function demoPlan(prompt: string, current?: Plan): Plan {
  const isCurrentEmpty =
    !current ||
    (current.categories.length === 0 && current.roles.length === 0);
  const isFullBuildPrompt =
    /^(create|build|start|design|setup|new|generate)\s+(?:a\s+)?(?:new\s+)?(?:discord\s+)?(?:server|community)\b/i.test(
      prompt,
    );

  const p: Plan =
    !isCurrentEmpty && !isFullBuildPrompt && current
      ? structuredClone(current)
      : {
          server: {
            name: /gaming|valorant|esports/i.test(prompt)
              ? 'The Gathering'
              : /study|school/i.test(prompt)
                ? 'The Study Room'
                : /develop/i.test(prompt)
                  ? 'Dev Collective'
                  : 'Our Community',
            description: prompt.slice(0, 300),
          },
          roles: [
            { key: 'moderator', name: 'Moderator', color: '#c4f76b' },
            { key: 'member', name: 'Member', color: '#aeb7c2' },
          ],
          categories: [
            {
              key: 'information',
              name: 'INFORMATION',
              visible_to: [],
              channels: [ch('announcements', true), ch('rules', true)],
            },
            {
              key: 'community',
              name: 'COMMUNITY',
              visible_to: [],
              channels: [ch('general'), ch('introductions'), ch('memes')],
            },
            {
              key: 'voice',
              name: 'VOICE LOUNGE',
              visible_to: [],
              channels: [
                { ...ch('lobby'), type: 'voice' },
                { ...ch('hangout'), type: 'voice' },
              ],
            },
          ],
          onboarding: [],
        };
  const add = (title: string, names: string[], privateRole?: string) => {
    const k = 'cat-' + slug(title);
    let cat = p.categories.find(
      (c) => c.key === k || c.name.toLowerCase() === title.toLowerCase(),
    );
    if (!cat) {
      cat = {
        key: k,
        name: title.toUpperCase(),
        visible_to: privateRole ? [privateRole] : [],
        channels: [],
      };
      p.categories.push(cat);
    }
    for (const n of names) {
      const cSlug = slug(n);
      if (!cat.channels.some((c) => c.name === cSlug)) {
        cat.channels.push({
          key: cat.key + '-' + cSlug,
          name: cSlug,
          type: 'text',
          topic: '',
          read_only: false,
          visible_to: [],
        });
      }
    }
  };

  // Dynamic "Add category: <name>" or "Add category <name>"
  const catMatches = prompt.matchAll(
    /(?:add|create|new)\s+category\s*[:#]?\s*([a-zA-Z0-9 _-]+)/gi,
  );
  for (const m of catMatches) {
    const title = m[1].trim().replace(/[.,;]+$/, '');
    if (title && !/^(channel|role)/i.test(title)) {
      add(title, [slug(title) + '-chat']);
    }
  }

  // Dynamic "Add [voice|text] channel: <name>" or "Add channel <name>"
  const chanMatches = prompt.matchAll(
    /(?:add|create|new)\s+(?:a\s+)?(?:(voice|text)\s+)?channel\s*[:#]?\s*([a-zA-Z0-9_-]+)/gi,
  );
  for (const m of chanMatches) {
    const isVoice = m[1]?.toLowerCase() === 'voice' || /voice/i.test(prompt);
    const rawName = m[2].trim().replace(/[.,;]+$/, '');
    const chanName = slug(rawName);
    if (chanName) {
      let targetCat = p.categories.at(-1);
      if (!targetCat) {
        add('General', []);
        targetCat = p.categories[0];
      }
      if (!targetCat.channels.some((c) => c.name === chanName)) {
        targetCat.channels.push({
          key: targetCat.key + '-' + chanName,
          name: chanName,
          type: isVoice ? 'voice' : 'text',
          topic: '',
          read_only: false,
          visible_to: [],
        });
      }
    }
  }

  // Dynamic "Add role: <name>" or "Add role <name>"
  const roleMatches = prompt.matchAll(
    /(?:add|create|new)\s+role\s*[:#]?\s*([a-zA-Z0-9 _-]+)/gi,
  );
  for (const m of roleMatches) {
    const rName = m[1].trim().replace(/[.,;]+$/, '');
    const rKey = slug(rName);
    if (rName && !p.roles.some((r) => r.key === rKey)) {
      p.roles.push({ key: rKey, name: rName, color: '#c7a3ff' });
    }
  }

  if (/minecraft/i.test(prompt))
    add('Minecraft', ['minecraft-chat', 'minecraft-lfg']);
  if (/valorant|esports/i.test(prompt))
    add('Valorant', ['valorant-chat', 'looking-for-team', 'clips']);
  if (/tournament|event/i.test(prompt)) {
    if (!p.roles.some((r) => r.key === 'participant'))
      p.roles.push({
        key: 'participant',
        name: 'Tournament Player',
        color: '#c7a3ff',
      });
    add(
      'Tournaments',
      ['tournaments', 'tournament-chat'],
      /private|only|participant/i.test(prompt) ? 'participant' : undefined,
    );
  }
  if (/staff|moderator|private moderator/i.test(prompt))
    add('Staff', ['staff-chat', 'mod-logs'], 'moderator');
  if (/developer|coding/i.test(prompt))
    add('Development', ['code-review', 'help', 'showcase']);
  if (/study|school|college/i.test(prompt))
    add('Study', ['resources', 'homework-help', 'study-sessions']);
  if (/creator|podcast/i.test(prompt)) {
    add('Creators', ['new-content', 'feedback']);
    if (!p.roles.some((r) => r.key === 'creator'))
      p.roles.push({ key: 'creator', name: 'Creator', color: '#ffb782' });
  }
  const rename = prompt.match(/rename\s+([\w-]+)\s+to\s+([\w-]+)/i);
  if (rename)
    for (const c of p.categories)
      for (const ch of c.channels)
        if (ch.name === rename[1]) ch.name = slug(rename[2]);
  const remove = prompt.match(
    /(?:remove|delete)\s+(?:the\s+)?([\w-]+)(?:\s+channel)?/i,
  );
  if (remove)
    for (const c of p.categories)
      c.channels = c.channels.filter((ch) => ch.name !== remove[1]);
  if (current && /make (?:that|the last) category private/i.test(prompt)) {
    const c = p.categories.at(-1);
    if (c) c.visible_to = ['moderator'];
  }
  return validatePlan(p);
}
function slug(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50) || 'community'
  );
}
function ch(name: string, read_only = false): Channel {
  return {
    key: name,
    name,
    type: 'text',
    topic: '',
    read_only,
    visible_to: [],
  };
}
