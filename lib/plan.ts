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

  // Helper slugger
  const toSlug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50) || 'item';

  // Helper channel builder
  const makeChannel = (name: string, type: 'text' | 'voice' = 'text', read_only = false, visible_to: string[] = []): Channel => ({
    key: toSlug(name),
    name: toSlug(name),
    type,
    topic: '',
    read_only,
    visible_to,
  });

  // If we are modifying an existing plan
  if (!isCurrentEmpty && !isFullBuildPrompt && current) {
    const p: Plan = structuredClone(current);

    // 1. Check for single or multiple channel removal (e.g. "Remove the memes channel" or "delete #memes")
    const removeChanMatches = prompt.matchAll(/(?:remove|delete)\s+(?:the\s+)?(?:channel\s+)?#?([a-zA-Z0-9_-]+)(?:\s+channel)?/gi);
    for (const rm of removeChanMatches) {
      const targetName = toSlug(rm[1]);
      if (targetName && !/^(category|role)/i.test(targetName)) {
        for (const cat of p.categories) {
          cat.channels = cat.channels.filter((c) => c.name !== targetName && c.key !== targetName);
        }
      }
    }

    // 2. Check for category removal
    const removeCatMatch = prompt.match(/(?:remove|delete)\s+(?:the\s+)?category\s*[:#]?\s*([a-zA-Z0-9 _-]+)/i);
    if (removeCatMatch) {
      const catSlug = toSlug(removeCatMatch[1]);
      p.categories = p.categories.filter((c) => toSlug(c.name) !== catSlug && c.key !== 'cat-' + catSlug);
    }

    // 3. Check for permission/visibility changes (e.g. "Make Python projects visible only to the Python role")
    const visMatch = prompt.match(/make\s+(?:the\s+)?#?([a-zA-Z0-9 _-]+?)\s+(?:visible\s+only\s+to|private\s+to|restricted\s+to)\s+(?:the\s+)?([a-zA-Z0-9 _-]+?)(?:\s+role)?$/i);
    if (visMatch) {
      const targetObjName = toSlug(visMatch[1]);
      const roleRaw = visMatch[2].trim();
      const roleKey = 'role-' + toSlug(roleRaw);
      
      // Ensure role exists
      if (!p.roles.some((r) => r.key === roleKey || r.name.toLowerCase() === roleRaw.toLowerCase())) {
        p.roles.push({ key: roleKey, name: roleRaw.charAt(0).toUpperCase() + roleRaw.slice(1), color: '#9b59b6' });
      }
      const actualRole = p.roles.find((r) => r.key === roleKey || r.name.toLowerCase() === roleRaw.toLowerCase())!;

      // Check if target is a channel
      let matchedChannel = false;
      for (const cat of p.categories) {
        for (const ch of cat.channels) {
          if (ch.name === targetObjName || ch.name.includes(targetObjName) || targetObjName.includes(ch.name)) {
            ch.visible_to = [actualRole.key];
            matchedChannel = true;
          }
        }
      }

      // Check if target is a category
      if (!matchedChannel) {
        for (const cat of p.categories) {
          if (toSlug(cat.name) === targetObjName || cat.name.toLowerCase().includes(targetObjName)) {
            cat.visible_to = [actualRole.key];
          }
        }
      }
    }

    // 4. Check for adding a category (e.g. "Add a Python category" or "Add category Python")
    const catNameMatch =
      prompt.match(/(?:add|create|new)\s+(?:a\s+)?([a-zA-Z0-9_-]+)\s+category\b/i) ||
      prompt.match(/(?:add|create|new)\s+(?:a\s+)?category\s*[:#]?\s*([a-zA-Z0-9 _-]+)/i);

    if (catNameMatch) {
      const catName = catNameMatch[1].trim().replace(/[.,;]+$/, '');
      const catKey = 'cat-' + toSlug(catName);
      if (catName && !/^(channel|role)/i.test(catName)) {
        let cat = p.categories.find((c) => c.key === catKey || c.name.toLowerCase() === catName.toLowerCase());
        if (!cat) {
          cat = {
            key: catKey,
            name: catName.toUpperCase(),
            visible_to: [],
            channels: [makeChannel(toSlug(catName) + '-chat')],
          };
          p.categories.push(cat);
        }
      }
    }

    // 5. Check for compound channel additions (e.g. "Add Python help and Python projects")
    const compoundMatch = prompt.match(/(?:add|create|new)\s+(?:channels?\s+)?([a-zA-Z0-9 _-]+?)\s+and\s+([a-zA-Z0-9 _-]+?)(?:\s+(?:under|in|to)\s+(?:category\s+)?([a-zA-Z0-9 _-]+))?$/i);
    if (compoundMatch && !/category|role/i.test(compoundMatch[1])) {
      const chan1 = toSlug(compoundMatch[1]);
      const chan2 = toSlug(compoundMatch[2]);
      const specifiedCat = compoundMatch[3]?.trim();
      let targetCat = specifiedCat 
        ? p.categories.find(c => c.name.toLowerCase().includes(specifiedCat.toLowerCase()))
        : p.categories.find(c => chan1.includes(toSlug(c.name)) || chan2.includes(toSlug(c.name))) || p.categories.at(-1);

      if (!targetCat) {
        targetCat = { key: 'cat-general', name: 'GENERAL', visible_to: [], channels: [] };
        p.categories.push(targetCat);
      }
      if (!targetCat.channels.some(c => c.name === chan1)) {
        targetCat.channels.push(makeChannel(chan1));
      }
      if (!targetCat.channels.some(c => c.name === chan2)) {
        targetCat.channels.push(makeChannel(chan2));
      }
    }

    // 6. Check for individual channel additions (e.g. "Add voice channel Tournament Finals" or "Add channel clips")
    const addChanMatches = prompt.matchAll(/(?:add|create|new)\s+(?:a\s+)?(?:(voice|text)\s+)?channel\s*[:#]?\s*([a-zA-Z0-9 _-]+?)(?:\s+(?:under|in|to)\s+(?:category\s+)?([a-zA-Z0-9 _-]+))?$/gi);
    for (const m of addChanMatches) {
      const isVoice = m[1]?.toLowerCase() === 'voice' || /voice/i.test(prompt);
      const rawName = m[2].trim().replace(/[.,;]+$/, '');
      const chanName = toSlug(rawName);
      const specifiedCat = m[3]?.trim();
      if (chanName && !/^(category|role)/i.test(chanName)) {
        let targetCat = specifiedCat 
          ? p.categories.find(c => c.name.toLowerCase().includes(specifiedCat.toLowerCase()))
          : p.categories.find(c => chanName.includes(toSlug(c.name))) || p.categories.at(-1);

        if (!targetCat) {
          targetCat = { key: 'cat-general', name: 'COMMUNITY', visible_to: [], channels: [] };
          p.categories.push(targetCat);
        }
        if (!targetCat.channels.some(c => c.name === chanName)) {
          targetCat.channels.push(makeChannel(chanName, isVoice ? 'voice' : 'text'));
        }
      }
    }

    // 7. Check for role additions (e.g. "Add role Python Developer")
    const addRoleMatches = prompt.matchAll(/(?:add|create|new)\s+role\s*[:#]?\s*([a-zA-Z0-9 _-]+)/gi);
    for (const m of addRoleMatches) {
      const rName = m[1].trim().replace(/[.,;]+$/, '');
      const rKey = 'role-' + toSlug(rName);
      if (rName && !p.roles.some((r) => r.key === rKey || r.name.toLowerCase() === rName.toLowerCase())) {
        p.roles.push({ key: rKey, name: rName, color: '#9b59b6' });
      }
    }

    // 8. Check for channel renaming (e.g. "Rename general to community-chat")
    const rename = prompt.match(/rename\s+([\w-]+)\s+to\s+([\w-]+)/i);
    if (rename) {
      for (const c of p.categories) {
        for (const ch of c.channels) {
          if (ch.name === rename[1]) {
            ch.name = toSlug(rename[2]);
          }
        }
      }
    }

    // 9. Check for "Make that category private"
    if (/make (?:that|the last) category private/i.test(prompt)) {
      const c = p.categories.at(-1);
      if (c) c.visible_to = ['moderator'];
    }

    return validatePlan(p);
  }

  // --- BRAND NEW SERVER GENERATION ---
  // Derive a dynamic server name directly from user prompt
  let serverName = 'My Community';
  const nameExplicitMatch = prompt.match(/(?:named|called|title)\s+["']?([^"',.;\n]+)["']?/i);
  if (nameExplicitMatch) {
    serverName = nameExplicitMatch[1].trim();
  } else if (/gaming|valorant|minecraft|esports|game/i.test(prompt)) {
    if (/valorant/i.test(prompt) && /minecraft/i.test(prompt)) serverName = 'Gaming Community';
    else if (/valorant/i.test(prompt)) serverName = 'Valorant Protocol';
    else if (/minecraft/i.test(prompt)) serverName = 'Minecraft Realm';
    else serverName = 'Gaming Community';
  } else if (/developer|coding|python|software|tech|engineer/i.test(prompt)) {
    serverName = 'Developer Hub';
  } else if (/study|school|university|academic/i.test(prompt)) {
    serverName = 'Study Room';
  } else if (/music|audio|producer|beat/i.test(prompt)) {
    serverName = 'Music Lounge';
  } else if (/art|design|creative/i.test(prompt)) {
    serverName = 'Creative Studio';
  } else {
    // Pick the most prominent descriptive words from prompt
    const words = prompt.replace(/[^\w\s]/g, '').split(/\s+/).filter(w => !/^(create|a|an|the|server|for|with|and|discord|community|build|new)$/i.test(w));
    if (words.length >= 2) {
      serverName = words.slice(0, 2).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') + ' Community';
    } else if (words.length === 1) {
      serverName = words[0].charAt(0).toUpperCase() + words[0].slice(1) + ' Server';
    }
  }

  const p: Plan = {
    server: {
      name: serverName.slice(0, 80),
      description: prompt.slice(0, 300),
    },
    roles: [
      { key: 'admin', name: 'Admin', color: '#f1c40f' },
      { key: 'moderator', name: 'Moderator', color: '#2ecc71' },
      { key: 'member', name: 'Member', color: '#3498db' },
    ],
    categories: [
      {
        key: 'information',
        name: 'INFORMATION',
        visible_to: [],
        channels: [
          makeChannel('announcements', 'text', true),
          makeChannel('rules', 'text', true),
        ],
      },
    ],
    onboarding: [],
  };

  const isDev = /developer|coding|python|javascript|web|software/i.test(prompt);
  const isGaming = /gaming|valorant|minecraft|esports|game|tournament/i.test(prompt);

  if (isDev) {
    p.roles.push({ key: 'developer', name: 'Developer', color: '#e67e22' });
    if (/python/i.test(prompt)) {
      p.roles.push({ key: 'python', name: 'Python', color: '#3498db' });
    }

    p.categories.push({
      key: 'development',
      name: 'DEVELOPMENT',
      visible_to: [],
      channels: [
        makeChannel('general'),
        makeChannel('python'),
        makeChannel('javascript'),
        makeChannel('web-development'),
      ],
    });

    p.categories.push({
      key: 'projects',
      name: 'PROJECTS',
      visible_to: [],
      channels: [
        makeChannel('project-showcase'),
        makeChannel('project-help'),
      ],
    });

    p.categories.push({
      key: 'voice',
      name: 'VOICE',
      visible_to: [],
      channels: [
        makeChannel('coding-room', 'voice'),
        makeChannel('chill-room', 'voice'),
      ],
    });
  } else if (isGaming) {
    const hasValorant = /valorant/i.test(prompt);
    const hasMinecraft = /minecraft/i.test(prompt);
    const hasTournaments = /tournament/i.test(prompt);

    p.categories.push({
      key: 'community',
      name: 'COMMUNITY',
      visible_to: [],
      channels: [
        makeChannel('general'),
        makeChannel('memes'),
      ],
    });

    if (hasValorant) {
      p.roles.push({ key: 'valorant-player', name: 'Valorant', color: '#e74c3c' });
      p.categories.push({
        key: 'valorant',
        name: 'VALORANT',
        visible_to: [],
        channels: [
          makeChannel('valorant-chat'),
          makeChannel('looking-for-team'),
          makeChannel('clips'),
        ],
      });
    }

    if (hasMinecraft) {
      p.roles.push({ key: 'miner', name: 'Minecraft', color: '#27ae60' });
      p.categories.push({
        key: 'minecraft',
        name: 'MINECRAFT',
        visible_to: [],
        channels: [
          makeChannel('minecraft-chat'),
          makeChannel('server-ip'),
        ],
      });
    }

    if (hasTournaments) {
      p.roles.push({ key: 'tournament-player', name: 'Tournament Player', color: '#9b59b6' });
      p.categories.push({
        key: 'tournaments',
        name: 'TOURNAMENTS',
        visible_to: [],
        channels: [
          makeChannel('tournament-announcements', 'text', true),
          makeChannel('tournament-chat'),
          makeChannel('brackets-and-matches'),
        ],
      });
    }

    if (!hasValorant && !hasMinecraft) {
      p.categories.push({
        key: 'gaming',
        name: 'GAMING',
        visible_to: [],
        channels: [
          makeChannel('game-chat'),
          makeChannel('lfg'),
          makeChannel('clips'),
        ],
      });
    }

    p.categories.push({
      key: 'voice',
      name: 'VOICE',
      visible_to: [],
      channels: [
        makeChannel('gaming-room', 'voice'),
        makeChannel('chill-lounge', 'voice'),
      ],
    });
  } else {
    // General community
    p.categories.push({
      key: 'community',
      name: 'COMMUNITY',
      visible_to: [],
      channels: [
        makeChannel('general'),
        makeChannel('introductions'),
        makeChannel('discussions'),
      ],
    });
    p.categories.push({
      key: 'voice',
      name: 'VOICE',
      visible_to: [],
      channels: [
        makeChannel('lobby', 'voice'),
        makeChannel('lounge', 'voice'),
      ],
    });
  }

  // Handle staff / moderator request
  if (/staff|mod-only|private moderator/i.test(prompt)) {
    p.categories.push({
      key: 'staff',
      name: 'STAFF',
      visible_to: ['moderator'],
      channels: [
        makeChannel('staff-chat', 'text', false, ['moderator']),
        makeChannel('mod-logs', 'text', false, ['moderator']),
      ],
    });
  }

  return validatePlan(p);
}
