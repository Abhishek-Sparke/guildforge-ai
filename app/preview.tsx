'use client';
import { useState } from 'react';
import {
  Command,
  ChevronDown,
  Lock,
  Hash,
  Volume2,
  Gamepad2,
  Plus,
  Users,
  Shield,
  Sparkles,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import type { Plan, Change } from '@/lib/plan';
export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark">
        <Command size={22} />
      </span>
      GuildForge<span className="ai-label">AI</span>
    </span>
  );
}
export function Changes({ changes }: { changes: Change[] }) {
  return (
    <div className="change-list">
      {changes.length ? (
        changes.map((c, i) => (
          <div className={'change ' + c.action} key={i}>
            <span>
              {c.action === 'create' ? '+' : c.action === 'delete' ? '−' : '~'}
            </span>
            <div>
              <b>
                {c.action === 'create'
                  ? 'Add'
                  : c.action === 'delete'
                    ? 'Remove'
                    : 'Update'}{' '}
                {c.object.kind}: {c.object.name}
              </b>
              {c.action === 'update' && (
                <p>
                  {c.before?.name !== c.object.name
                    ? `${c.before?.name} → ${c.object.name}. `
                    : ''}
                  Properties or access settings changed.
                </p>
              )}
              {(c.object.data.visible_to as string[])?.length > 0 && (
                <p>
                  Restricted to:{' '}
                  {(c.object.data.visible_to as string[]).join(', ')}
                </p>
              )}
              {c.object.data.read_only === true && <p>Read-only for members</p>}
              {c.action === 'delete' && (
                <p>Discord messages and role assignments cannot be restored.</p>
              )}
              <details className="exact-change">
                <summary>Inspect exact properties</summary>
                <pre>
                  {JSON.stringify(
                    {
                      before: c.before?.data || null,
                      after: c.action === 'delete' ? null : c.object.data,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </div>
          </div>
        ))
      ) : (
        <p>No structural changes detected.</p>
      )}
    </div>
  );
}
export function Preview({
  plan,
  compact = false,
}: {
  plan: Plan;
  compact?: boolean;
}) {
  const [selected, setSelected] = useState('announcements');
  const [tab, setTab] = useState('channels');
  const channels = plan.categories.flatMap((c) =>
    c.channels.map((ch) => ({
      ...ch,
      visible_to: ch.visible_to.length ? ch.visible_to : c.visible_to,
    })),
  );
  const active = channels.find((c) => c.key === selected) || channels[0];
  return (
    <div className={'discord-preview ' + (compact ? 'compact' : '')}>
      <div className="discord-rail">
        <span className="discord-orb">
          <Command size={23} />
        </span>
        <span className="rail-divider" />
        <span className="server-orb">
          {plan.server.name.slice(0, 2).toUpperCase()}
        </span>
        <span className="rail-add">
          <Plus size={20} />
        </span>
      </div>
      <div className="channel-tree">
        <div className="server-title">
          <span>{plan.server.name}</span>
          <ChevronDown size={16} />
        </div>
        <div className="server-banner">
          <Gamepad2 size={27} />
          <span>A place for your people.</span>
        </div>
        <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
          <TabsList className="tree-tabs">
            <TabsTrigger value="channels">Channels</TabsTrigger>
            <TabsTrigger value="roles">Roles</TabsTrigger>
          </TabsList>
          <TabsContent value="channels">
            <div className="tree-scroll">
              {plan.categories.map((cat) => (
                <details open key={cat.key}>
                  <summary>
                    <ChevronDown size={12} />
                    {cat.name}
                    {cat.visible_to.length > 0 && <Lock size={12} />}
                  </summary>
                  {cat.channels.map((ch) => (
                    <button
                      className={
                        'channel ' + (ch.key === active?.key ? 'selected' : '')
                      }
                      key={ch.key}
                      onClick={() => setSelected(ch.key)}
                    >
                      {ch.type === 'voice' ? (
                        <Volume2 size={17} />
                      ) : (
                        <Hash size={18} />
                      )}
                      <span>{ch.name}</span>
                      {(ch.read_only ||
                        ch.visible_to.length > 0 ||
                        cat.visible_to.length > 0) && <Lock size={12} />}
                    </button>
                  ))}
                </details>
              ))}
            </div>
          </TabsContent>
          <TabsContent value="roles">
            <div className="roles-list">
              {plan.roles.map((r) => (
                <div className="role-item" key={r.key}>
                  <i style={{ background: r.color }} />
                  <span>{r.name}</span>
                  <small>ACCESS ROLE</small>
                </div>
              ))}
              <p className="muted">
                Roles grant identity and selected channel access. No
                administrator permissions.
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </div>
      <div className="channel-detail">
        <div className="channel-heading">
          {active?.type === 'voice' ? (
            <Volume2 size={20} />
          ) : (
            <Hash size={20} />
          )}
          <b>{active?.name || 'Your first channel'}</b>
          <span className="preview-label">PREVIEW</span>
        </div>
        <div className="channel-welcome">
          <div className="welcome-icon">
            {active?.type === 'voice' ? (
              <Volume2 size={30} />
            ) : (
              <Hash size={32} />
            )}
          </div>
          <h3>
            Welcome to
            <br />#{active?.name || 'your-community'}
          </h3>
          <p>{active?.topic || 'This is the beginning of something great.'}</p>
          <div className="permission-chip">
            {active?.visible_to.length ? (
              <Lock size={14} />
            ) : (
              <Users size={14} />
            )}{' '}
            {active?.visible_to.length
              ? active.visible_to
                  .map((k) => plan.roles.find((r) => r.key === k)?.name || k)
                  .join(', ')
              : 'Everyone can view'}
          </div>
          <div className="permission-chip">
            <Shield size={14} />{' '}
            {active?.read_only
              ? 'Members can read, but cannot send messages'
              : 'Members can participate'}
          </div>
          <div className="preview-note">
            <Sparkles size={16} />
            <span>
              Draft structure verified.
              <br />
              Ready to deploy when approved.
            </span>
          </div>
        </div>
        <div className="preview-input">
          {active?.read_only ? <Lock size={15} /> : <Plus size={17} />} Message #{active?.name || 'channel'}
        </div>
      </div>
    </div>
  );
}
