'use client';
import { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  ArrowUp,
  ArrowLeft,
  Check,
  Users,
  Sparkles,
  Plus,
  Undo2,
  Download,
  Sun,
  Moon,
  Settings2,
  Blocks,
  Clock,
  Gamepad2,
  Code2,
  GraduationCap,
  Mic,
  MessageSquare,
  ArrowRight,
  LoaderCircle,
  Link2,
  LogOut,
  CheckCircle2,
  Rocket,
  Command,
  Eye,
  Shield,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import {
  demoPlan,
  emptyPlan,
  templates,
  diffPlans,
  flatten,
  type Plan,
  type Change,
} from '@/lib/plan';
import { Brand, Changes, Preview } from './preview';
type View =
  | 'home'
  | 'builder'
  | 'dashboard'
  | 'templates'
  | 'history'
  | 'settings';
type Build = {
  id: string;
  plan: Plan;
  prompt: string;
  created_at: string;
  status: string;
  server_id?: string;
};
type Server = {
  id: string;
  name: string;
  connected: boolean;
  updatedAt?: string;
};
const starter = demoPlan(
  'Create a professional gaming community with Valorant, Minecraft, tournaments, creators, staff and voice rooms.',
);
const templateIcons = [
  Gamepad2,
  Shield,
  Users,
  Code2,
  GraduationCap,
  GraduationCap,
  Blocks,
  Blocks,
  Users,
  Mic,
  Mic,
  Rocket,
  MessageSquare,
];
export default function Workspace() {
  const [view, setView] = useState<View>('home');
  const [plan, setPlan] = useState<Plan>(starter);
  const [prompt, setPrompt] = useState('');
  const [demo, setDemo] = useState(true);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [config, setConfig] = useState<any>({
    discord: false,
    mockDiscord: true,
  });
  const [user, setUser] = useState<any>(null);
  const [servers, setServers] = useState<Server[]>([]);
  const [serverId, setServerId] = useState('');
  const [buildId, setBuildId] = useState<string | undefined>();
  const [history, setHistory] = useState<Build[]>([]);
  const [messages, setMessages] = useState<{ role: string; content: string }[]>(
    [],
  );
  const [pending, setPending] = useState<{
    plan: Plan;
    changes: Change[];
    id?: string;
    prompt: string;
  } | null>(null);
  const [undo, setUndo] = useState<{ plan: Plan; id?: string } | null>(null);
  const [review, setReview] = useState<any>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [theme, setTheme] = useState('dark');
  const [language, setLanguage] = useState('English');
  const [mobileTab, setMobileTab] = useState('chat');
  function go(v: View) {
    setView(v);
    window.history.replaceState(null, '', '#' + v);
    setError('');
  }
  async function request(path: string, data?: unknown) {
    const r = await fetch('/api/' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers:
        data === undefined
          ? {}
          : {
              'Content-Type': 'application/json',
              'X-GuildForge': '1',
              'X-CSRF-Token': user?.csrf || '',
            },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const value: any = await r.json();
    if (!r.ok) {
      if (value.id) setResult(value);
      throw Error(value.error || 'This request failed.');
    }
    return value;
  }
  async function run(action: () => Promise<void>, label: string) {
    setBusy(label);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy('');
    }
  }
  useEffect(() => {
    const stored = localStorage.getItem('guildforge-theme') || 'dark';
    setTheme(stored);
    document.documentElement.dataset.theme = stored;
    document.documentElement.classList.toggle('dark', stored === 'dark');
    const target =
      window.location.hash.slice(1) ||
      new URLSearchParams(window.location.search).get('view');
    if (
      [
        'home',
        'builder',
        'dashboard',
        'templates',
        'history',
        'settings',
      ].includes(target || '')
    )
      setView(target as View);
    fetch('/api/config')
      .then((r) => r.json())
      .then(setConfig)
      .catch(() =>
        setError('Could not reach the backend. Refresh to try again.'),
      );
    fetch('/api/me')
      .then(async (r) => {
        if (r.ok) setUser(await r.json());
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    const context = (document as any).modelContext;
    if (!context?.registerTool) return;
    const controller = new AbortController();
    Promise.resolve(
      context.registerTool(
        {
          name: 'stage_community_prompt',
          description:
            'Open GuildForge and stage a prompt for user generation and review. Does not generate or deploy.',
          inputSchema: {
            type: 'object',
            properties: {
              prompt: { type: 'string', minLength: 3, maxLength: 2000 },
            },
            required: ['prompt'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false },
          execute(input: any) {
            if (
              !input ||
              typeof input.prompt !== 'string' ||
              input.prompt.length < 3 ||
              input.prompt.length > 2000 ||
              Object.keys(input).some((k) => k !== 'prompt')
            )
              throw Error('A prompt of 3–2,000 characters is required.');
            setPrompt(input.prompt);
            setView('builder');
            return {
              staged: true,
              prompt: input.prompt,
              requiresUserGeneration: true,
            };
          },
        },
        { signal: controller.signal },
      ),
    ).catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (user && (view === 'dashboard' || connectOpen))
      run(
        async () => setServers((await request('servers')).servers),
        'Loading servers',
      );
    if (user && view === 'history' && !demo)
      run(
        async () => setHistory((await request('builds')).builds),
        'Loading history',
      );
  }, [user, view, connectOpen, demo]);
  function switchTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('guildforge-theme', next);
    document.documentElement.dataset.theme = next;
    document.documentElement.classList.toggle('dark', next === 'dark');
  }
  function start(template?: string) {
    if (!demo) setHistory([]);
    setDemo(true);
    setPlan(template ? demoPlan('Create a ' + template) : starter);
    setBuildId(undefined);
    setPending(null);
    setUndo(null);
    setMessages([]);
    setPrompt(
      template
        ? 'Create a ' +
            template +
            ' with useful channels, roles and voice rooms.'
        : '',
    );
    go('builder');
  }
  async function send() {
    if (!prompt.trim() || busy || pending) return;
    await run(async () => {
      const text = prompt.trim();
      const data = await request(
        demo ? 'demo/generate' : buildId ? 'ai/modify' : 'ai/generate',
        demo
          ? {
              prompt: text,
              current:
                messages.length === 0 &&
                /^(create|build|design|start)\b/i.test(text)
                  ? undefined
                  : plan,
            }
          : {
              prompt: text + '\nPreferred language: ' + language,
              serverId,
              buildId,
            },
      );
      setPending({
        plan: data.plan,
        changes: diffPlans(plan, data.plan),
        id: data.id,
        prompt: text,
      });
      setMessages((m) => [
        ...m,
        { role: 'user', content: text },
        {
          role: 'assistant',
          content: demo
            ? 'I’ve prepared a demo plan using preset rules. Review the changes before applying them.'
            : 'Your plan passed validation. Review the changes below before applying them to your draft.',
        },
      ]);
      if (data.used) setUser((u: any) => ({ ...u, used: data.used }));
      setPrompt('');
    }, 'Designing your community');
  }
  function apply() {
    if (!pending) return;
    setUndo({ plan, id: buildId });
    setPlan(pending.plan);
    setBuildId(pending.id);
    if (demo)
      setHistory((h) => [
        {
          id: crypto.randomUUID(),
          plan: pending.plan,
          prompt: pending.prompt,
          created_at: new Date().toISOString(),
          status: 'demo draft',
        },
        ...h,
      ]);
    setPending(null);
    setNotice('Draft updated. Discord has not been changed.');
  }
  async function reviewDeploy() {
    setConfirmDelete(false);
    if (demo) {
      setReview({
        demo: true,
        changes: diffPlans(emptyPlan, plan),
        serverName: plan.server.name,
      });
      return;
    }
    if (!buildId) {
      setError('Generate and apply a plan first.');
      return;
    }
    await run(
      async () => setReview(await request('discord/validate', { buildId })),
      'Checking server and permissions',
    );
  }
  async function deploy() {
    await run(
      async () => {
        if (review.demo) {
          const r = await request('demo/deploy', { plan });
          setResult({
            status: 'simulated',
            objects: r.objects,
            logs: r.calls.map((c: any) => ({
              status: 'simulated',
              action: { object: { name: c.data?.name || 'Object' } },
            })),
          });
        } else {
          const r = await request('discord/deploy', {
            approval: review.approval,
            serverId: review.serverId,
            confirm: true,
            confirmDelete,
          });
          setResult(await request('deployments/' + r.id));
        }
        setReview(null);
      },
      review.demo ? 'Simulating deployment' : 'Applying approved changes',
    );
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'guildforge-plan.json';
    a.click();
    URL.revokeObjectURL(url);
  }
  const shown = pending?.plan || plan;
  const counts = {
    channels: shown.categories.reduce((n, c) => n + c.channels.length, 0),
    roles: shown.roles.length,
    categories: shown.categories.length,
  };
  const chat = (
    <section className="chat-panel">
      <div className="panel-top">
        <span>
          <Sparkles size={16} /> Forge assistant
        </span>
        <span className="status-dot">{demo ? 'Demo' : 'AI'}</span>
      </div>
      <div className="conversation">
        <div className="assistant-intro">
          <span className="assistant-avatar">
            <Command size={22} />
          </span>
          <small>LET’S BUILD SOMETHING GREAT</small>
          <h2>
            Your community.
            <br />
            Your rules.
          </h2>
          <p>
            Tell me who it’s for and what you have in mind. I’ll help with the
            structure.
          </p>
        </div>
        {messages.length === 0 && (
          <>
            <div className="example-prompt">
              “Add a Minecraft category and a private moderator section.”
            </div>
            <div className="starter-chips">
              {[
                'Add Minecraft',
                'Add a creator role',
                'Rename general to community-chat',
              ].map((t) => (
                <button key={t} onClick={() => setPrompt(t)}>
                  {t}
                  <ArrowUpRight size={13} />
                </button>
              ))}
            </div>
          </>
        )}
        {messages.map((m, i) => (
          <div className={'message ' + m.role} key={i}>
            <span>{m.role === 'user' ? 'YOU' : 'GUILDFORGE'}</span>
            <p>{m.content}</p>
          </div>
        ))}
        {pending && (
          <div className="staged">
            <div className="staged-title">
              <CheckCircle2 size={17} /> Plan ready to review
            </div>
            <Changes changes={pending.changes} />
            <div className="action-row">
              <Button onClick={apply}>
                Apply to draft <Check size={14} />
              </Button>
              <Button variant="ghost" onClick={() => setPending(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {busy && (
          <p className="working">
            <LoaderCircle className="spin" size={16} />
            {busy}…
          </p>
        )}
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={2000}
          placeholder="Describe your community or a change…"
          aria-label="Community prompt"
          disabled={!!busy || !!pending}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="composer-bottom">
          <span>
            <Sparkles size={13} />
            {demo ? 'Preset demo engine' : 'Structured AI plan'} ·{' '}
            {prompt.length}/2000
          </span>
          <Button
            aria-label="Generate server plan"
            type="submit"
            disabled={!!busy || !!pending || prompt.trim().length < 3}
          >
            <ArrowUp size={18} />
          </Button>
        </div>
      </form>
      <p className="chat-footnote">
        {demo
          ? 'Temporary demo · export your plan to keep it.'
          : 'Plans are saved to your account.'}{' '}
        Review before deployment.
      </p>
    </section>
  );
  const preview = (
    <section className="preview-panel">
      <div className="panel-top">
        <span>
          <Eye size={16} /> Live preview
        </span>
        <span className="preview-label">
          {pending ? 'PENDING CHANGES' : 'DRAFT'}
        </span>
      </div>
      <Preview plan={shown} />
      <div className="preview-footer">
        <span>
          <i />
          {counts.channels} channels <b>·</b> {counts.roles} roles <b>·</b>{' '}
          {counts.categories} categories
        </span>
        <span>
          <Shield size={14} /> Safe to explore
        </span>
      </div>
    </section>
  );
  return (
    <div className="forge">
      <header className="main-header">
        <button
          className="brand-button"
          onClick={() => go('home')}
          aria-label="GuildForge home"
        >
          <Brand />
        </button>
        <nav aria-label="Main navigation">
          {(['builder', 'templates', 'dashboard'] as View[]).map((v) => (
            <button
              className={view === v ? 'active' : ''}
              key={v}
              onClick={() => go(v)}
            >
              {v === 'builder' ? 'Workspace' : v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </nav>
        <div className="header-actions">
          <Button
            variant="ghost"
            size="icon"
            onClick={switchTheme}
            aria-label="Toggle light or dark theme"
          >
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </Button>
          {user ? (
            <Button variant="outline" onClick={() => go('settings')}>
              {user.username}
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setConnectOpen(true)}>
              Connect Discord <ArrowUpRight size={15} />
            </Button>
          )}
        </div>
      </header>
      {(error || notice) && (
        <div
          role={error ? 'alert' : 'status'}
          className={'notice ' + (error ? 'error' : 'success')}
        >
          <span>{error || notice}</span>
          <button
            onClick={() => {
              setError('');
              setNotice('');
            }}
            aria-label="Dismiss message"
          >
            ×
          </button>
        </div>
      )}
      {view === 'home' && (
        <>
          <section className="landing-hero">
            <div className="hero-copy">
              <div className="eyebrow">
                <i /> YOUR NEXT COMMUNITY STARTS HERE
              </div>
              <h1>
                Build your Discord.
                <br />
                <em>Just describe it.</em>
              </h1>
              <p>
                Tell AI what kind of community you want.
                <br /> Get channels, roles and permissions — ready for your
                approval.
              </p>
              <div className="hero-buttons">
                <Button className="primary-cta" onClick={() => start()}>
                  Build with AI <ArrowUpRight size={18} />
                </Button>
                <a href="#how-it-works" className="secondary-link">
                  See how it works <ArrowRight size={16} />
                </a>
              </div>
              <div className="hero-assurance">
                <span>
                  <Check size={14} /> Free to explore
                </span>
                <span>
                  <Check size={14} /> Review every change
                </span>
                <span>
                  <Check size={14} /> No coding needed
                </span>
              </div>
            </div>
            <div className="hero-index">
              <span>01 / IDEAS BECOME PLACES</span>
              <p>
                A little less setup.
                <br />A lot more community.
              </p>
              <ArrowUpRight size={45} />
            </div>
          </section>
          <section className="showcase">
            <div className="showcase-toolbar">
              <div className="window-dots">
                <i />
                <i />
                <i />
              </div>
              <span>
                <Command size={13} /> guildforge / the-gathering
              </span>
              <span className="demo-badge">INTERACTIVE PREVIEW</span>
            </div>
            <div className="showcase-body">
              <div className="showcase-chat">
                <span className="assistant-avatar">
                  <Command size={23} />
                </span>
                <h3>
                  From “what if”
                  <br />
                  to “welcome in.”
                </h3>
                <div className="hero-prompt">
                  <span>YOUR IDEA</span>
                  <p>
                    “Create a gaming community with Valorant, Minecraft,
                    tournaments and voice rooms.”
                  </p>
                </div>
                <div className="hero-answer">
                  <Sparkles size={18} />
                  <div>
                    <b>A home for your community.</b>
                    <p>
                      Thoughtful channels. Clear roles.
                      <br />
                      Room to grow.
                    </p>
                  </div>
                </div>
                <Button variant="outline" onClick={() => start()}>
                  Make it yours <ArrowUpRight size={16} />
                </Button>
              </div>
              <Preview plan={starter} compact />
            </div>
            <div className="showcase-bottom">
              <span>
                <Shield size={14} /> Preview first. Deploy only when you’re
                ready.
              </span>
              <span>Example structure · demo mode</span>
            </div>
          </section>
          <section id="how-it-works" className="how">
            <small>LESS CONFIGURATION. MORE CONNECTION.</small>
            <h2>Your idea. Three simple steps.</h2>
            <div className="steps">
              {[
                {
                  n: '01',
                  Icon: MessageSquare,
                  title: 'Describe',
                  text: 'Tell AI who your community is for and what it needs.',
                },
                {
                  n: '02',
                  Icon: Eye,
                  title: 'Preview',
                  text: 'Explore every channel, role and permission. Refine it with a prompt.',
                },
                {
                  n: '03',
                  Icon: Rocket,
                  title: 'Deploy',
                  text: 'Connect an existing Discord server and approve the exact changes.',
                },
              ].map((s) => (
                <article key={s.n}>
                  <div>
                    <s.Icon size={24} />
                    <span>{s.n}</span>
                  </div>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </article>
              ))}
            </div>
          </section>
          <section className="template-strip">
            <div>
              <small>A RUNNING START</small>
              <h2>Find your kind of community.</h2>
            </div>
            <Button variant="outline" onClick={() => go('templates')}>
              Explore templates <ArrowRight size={16} />
            </Button>
          </section>
          <footer>
            <Brand />
            <span>Made for communities that deserve a great beginning.</span>
            <span>GuildForge AI · 2026</span>
          </footer>
        </>
      )}
      {view === 'builder' && (
        <main className="builder-page">
          <div className="workspace-heading">
            <div>
              <div className="breadcrumbs">
                <button onClick={() => go('dashboard')}>Your workspace</button>
                <span>/</span>
                <span>
                  {demo
                    ? 'Demo playground'
                    : servers.find((s) => s.id === serverId)?.name ||
                      'Select a server'}
                </span>
              </div>
              <h1>
                {shown.server.name}
                <span className="draft-tag">{demo ? 'DEMO' : 'DRAFT'}</span>
              </h1>
            </div>
            <div className="workspace-actions">
              <Button
                variant="ghost"
                disabled={!undo || !!pending || !!busy}
                onClick={() => {
                  if (undo) {
                    setPlan(undo.plan);
                    setBuildId(undo.id);
                    setUndo(null);
                    setNotice(
                      'Previous draft restored. This does not undo a Discord deployment.',
                    );
                  }
                }}
                aria-label="Undo last draft change"
              >
                <Undo2 size={17} />
                <span>Undo</span>
              </Button>
              <Button variant="outline" onClick={download}>
                <Download size={16} />
                <span>Export</span>
              </Button>
              <Button disabled={!!busy || !!pending} onClick={reviewDeploy}>
                <Rocket size={16} />
                {demo ? 'Test deployment' : 'Deploy to Discord'}
              </Button>
            </div>
          </div>
          <div className="mode-banner">
            <span>
              <i />
              {demo
                ? 'Demo playground — preset generation, temporary drafts, no Discord changes.'
                : 'Connected workspace — AI drafts require approval before deployment.'}
            </span>
            {demo && (
              <button onClick={() => setConnectOpen(true)}>
                Connect a server <ArrowRight size={14} />
              </button>
            )}
          </div>
          <div className="desktop-workspace">
            {chat}
            {preview}
          </div>
          <Tabs
            className="mobile-workspace"
            value={mobileTab}
            onValueChange={(v) => setMobileTab(String(v))}
          >
            <TabsList>
              <TabsTrigger value="chat">
                <Sparkles /> AI Chat
              </TabsTrigger>
              <TabsTrigger value="preview">
                <Eye /> Preview {pending && '•'}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="chat">{chat}</TabsContent>
            <TabsContent value="preview">{preview}</TabsContent>
          </Tabs>
          <div className="workspace-bottom">
            <span>
              <Shield size={14} /> Every plan is validated. You stay in control.
            </span>
            <button onClick={() => go('history')}>
              <Clock size={14} /> Build history
            </button>
            <button onClick={() => go('settings')}>
              <Settings2 size={14} /> Settings
            </button>
          </div>
        </main>
      )}
      {view === 'templates' && (
        <main className="content-page">
          <div className="eyebrow">A GOOD PLACE TO START</div>
          <h1>A template for your people.</h1>
          <p className="page-subtitle">
            Choose a starting point. Make every detail your own.
          </p>
          <div className="template-grid">
            {templates.map((t, i) => {
              const Icon = templateIcons[i];
              return (
                <button
                  key={t}
                  className="template-card"
                  onClick={() => start(t)}
                >
                  <span className={'template-icon tone-' + (i % 4)}>
                    <Icon size={26} />
                  </span>
                  <h3>{t}</h3>
                  <p>
                    {i === 0
                      ? 'Game nights, LFG and a place to hang out.'
                      : i === 3
                        ? 'Build, share and solve things together.'
                        : i === 4
                          ? 'Focus sessions and shared discoveries.'
                          : 'A thoughtful foundation for your community.'}
                  </p>
                  <span className="template-use">
                    Use template <ArrowUpRight size={17} />
                  </span>
                </button>
              );
            })}
            <button
              className="template-card blank-template"
              onClick={() => {
                start();
                setPlan(emptyPlan);
              }}
            >
              <Plus size={28} />
              <h3>Start from scratch</h3>
              <p>Have something different in mind?</p>
              <span className="template-use">
                Create your own <ArrowUpRight size={17} />
              </span>
            </button>
          </div>
        </main>
      )}
      {view === 'dashboard' && (
        <main className="content-page">
          <div className="page-heading">
            <div>
              <small>YOUR WORKSPACE</small>
              <h1>
                {user
                  ? 'Welcome back, ' + user.username + '.'
                  : 'Your next community awaits.'}
              </h1>
              <p className="page-subtitle">
                Great communities begin with a little intention.
              </p>
            </div>
            <Button onClick={() => start()}>
              <Plus size={17} /> Create with AI
            </Button>
          </div>
          <div className="dashboard-stats">
            <div>
              <span>Connected servers</span>
              <b>{servers.filter((s) => s.connected).length}</b>
            </div>
            <div>
              <span>AI requests this month</span>
              <b>
                {user ? user.used : '—'}
                <small> / 3 free</small>
              </b>
            </div>
            <div>
              <span>Current mode</span>
              <b>{demo ? 'Playground' : 'Live workspace'}</b>
            </div>
          </div>
          <div className="section-heading">
            <h2>Your Discord servers</h2>
            <Button variant="outline" onClick={() => setConnectOpen(true)}>
              <Link2 size={16} /> Connect server
            </Button>
          </div>
          {!user ? (
            <div className="empty-state">
              <span className="empty-icon">
                <Users size={30} />
              </span>
              <h2>A place for all your communities.</h2>
              <p>
                Sign in with Discord to see the servers you manage.
                <br />
                You can explore the full demo first.
              </p>
              <div className="action-row">
                <Button onClick={() => setConnectOpen(true)}>
                  Sign in with Discord <ArrowUpRight size={16} />
                </Button>
                <Button variant="ghost" onClick={() => start()}>
                  Explore demo
                </Button>
              </div>
            </div>
          ) : (
            <div className="server-grid">
              {servers.length ? (
                servers.map((s) => (
                  <article className="server-card" key={s.id}>
                    <div className="server-card-head">
                      <span className="server-orb">{s.name.slice(0, 2)}</span>
                      <span className="draft-tag">
                        {s.connected ? 'CONNECTED' : 'INSTALL BOT'}
                      </span>
                    </div>
                    <h3>{s.name}</h3>
                    <p className="mono">{s.id}</p>
                    <p>
                      Last connected:{' '}
                      {s.updatedAt
                        ? new Date(s.updatedAt).toLocaleDateString()
                        : 'Not yet'}
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setServerId(s.id);
                        setConnectOpen(true);
                      }}
                    >
                      Open builder <ArrowUpRight size={16} />
                    </Button>
                  </article>
                ))
              ) : (
                <div className="empty-state">
                  <h3>No manageable servers found.</h3>
                  <p>
                    Create a server in Discord or ask its owner for Manage
                    Server access.
                  </p>
                </div>
              )}
            </div>
          )}
          <section className="free-card">
            <div>
              <span className="draft-tag">FREE PLAN</span>
              <h3>Small beginnings. Big possibilities.</h3>
              <p>
                3 AI requests per month · Channels, access roles and reviewed
                deployment
              </p>
            </div>
            <div>
              <Progress
                value={user ? (user.used / 3) * 100 : 0}
                aria-label="Monthly AI usage"
              />
              <span>
                {user ? Math.max(0, 3 - user.used) : 3} requests remaining
              </span>
            </div>
          </section>
        </main>
      )}
      {view === 'history' && (
        <main className="content-page">
          <div className="page-heading">
            <div>
              <small>EVERY IDEA, EVERY ITERATION</small>
              <h1>Build history</h1>
              <p className="page-subtitle">
                {demo
                  ? 'Temporary demo history for this visit. Export a plan to keep it.'
                  : 'Your saved plans and deployment status.'}
              </p>
            </div>
            <Button variant="outline" onClick={() => go('builder')}>
              <ArrowLeft size={16} /> Back to builder
            </Button>
          </div>
          {history.length ? (
            <div className="history-list">
              {history.map((h) => (
                <button
                  key={h.id}
                  onClick={() => {
                    setPlan(h.plan);
                    setBuildId(demo ? undefined : h.id);
                    if (h.server_id) setServerId(h.server_id);
                    setPending(null);
                    go('builder');
                  }}
                >
                  <span className="history-icon">
                    <Clock size={20} />
                  </span>
                  <div>
                    <h3>{h.plan.server.name}</h3>
                    <p>{h.prompt}</p>
                    <small>
                      {new Date(h.created_at).toLocaleString()} ·{' '}
                      {
                        flatten(h.plan).filter((o) => o.kind === 'channel')
                          .length
                      }{' '}
                      channels · {h.plan.roles.length} roles
                    </small>
                  </div>
                  <span className="draft-tag">{h.status}</span>
                  <ArrowUpRight size={18} />
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <Clock size={36} />
              <h2>Your first idea starts the story.</h2>
              <p>Generated and applied plans will appear here.</p>
              <Button onClick={() => go('builder')}>
                Start building <ArrowRight size={16} />
              </Button>
            </div>
          )}
        </main>
      )}
      {view === 'settings' && (
        <main className="content-page settings-page">
          <small>MAKE YOURSELF AT HOME</small>
          <h1>Workspace settings</h1>
          <section className="settings-card">
            <h2>Discord connection</h2>
            <p>
              {user
                ? 'Signed in as ' + user.username
                : 'Not connected to Discord'}
            </p>
            <div className="setting-row">
              <span>Selected server</span>
              <b>
                {servers.find((s) => s.id === serverId)?.name ||
                  'Demo playground'}
              </b>
            </div>
            <div className="setting-row">
              <span>Bot deployment</span>
              <span className="draft-tag">
                {config.mockDiscord
                  ? 'SIMULATION ONLY'
                  : config.liveDeploy
                    ? 'LIVE ENABLED'
                    : 'DISABLED'}
              </span>
            </div>
            <p className="muted">
              Required: Manage Channels, Manage Roles, View Channels, Send
              Messages, Read Message History, Connect and Speak. Administrator
              is never requested.
            </p>
            <div className="action-row">
              <Button variant="outline" onClick={() => setConnectOpen(true)}>
                Manage connection
              </Button>
              {user && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    run(async () => {
                      await request('auth/logout', {});
                      setUser(null);
                      setDemo(true);
                      setHistory([]);
                      setServerId('');
                      setPlan(starter);
                      setBuildId(undefined);
                      setMessages([]);
                      setNotice('Signed out.');
                    }, 'Signing out')
                  }
                >
                  <LogOut size={15} /> Sign out
                </Button>
              )}
              {user && serverId && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    run(async () => {
                      const r = await request('servers/disconnect', {
                        serverId,
                      });
                      setServerId('');
                      setDemo(true);
                      setNotice(r.message);
                    }, 'Disconnecting')
                  }
                >
                  Disconnect server
                </Button>
              )}
            </div>
          </section>
          <section className="settings-card">
            <h2>AI preferences</h2>
            <div className="setting-row">
              <div>
                <b>Default language</b>
                <p>Included in live AI requests. Demo examples use English.</p>
              </div>
              <Select
                value={language}
                onValueChange={(v) => setLanguage(String(v))}
              >
                <SelectTrigger aria-label="Default language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[
                    'English',
                    'Hindi',
                    'Spanish',
                    'French',
                    'German',
                    'Japanese',
                  ].map((l) => (
                    <SelectItem key={l} value={l}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="setting-row">
              <span>AI provider</span>
              <b>{config.ai ? 'OpenAI configured' : 'Preset demo engine'}</b>
            </div>
            <div className="setting-row">
              <span>Appearance</span>
              <Button variant="outline" onClick={switchTheme}>
                {theme === 'dark' ? <Moon size={15} /> : <Sun size={15} />}{' '}
                {theme} theme
              </Button>
            </div>
          </section>
          <section className="settings-card">
            <h2>Deployment boundaries</h2>
            <p>
              GuildForge modifies its own channels, categories and access roles
              after approval. Server name, description and onboarding are
              suggestions for manual setup. Draft undo does not restore deleted
              Discord messages or reverse a deployment.
            </p>
            <Button variant="outline" onClick={() => go('history')}>
              <Clock size={16} /> View build history
            </Button>
          </section>
        </main>
      )}
      <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
        <DialogContent className="forge-dialog">
          <DialogTitle>Connect your community</DialogTitle>
          <DialogDescription>
            Discord apps can update existing servers. Create a server in Discord
            first, then select it here.
          </DialogDescription>
          {!user ? (
            <>
              <div className="connect-steps">
                <p>
                  <b>01</b> Sign in to see servers you manage.
                </p>
                <p>
                  <b>02</b> Install the bot with limited permissions.
                </p>
                <p>
                  <b>03</b> Design, review and approve your changes.
                </p>
              </div>
              {config.discord ? (
                <a className="button-link" href="/api/auth/discord">
                  Sign in with Discord <ArrowUpRight size={17} />
                </a>
              ) : (
                <div className="setup-note">
                  <Shield size={20} />
                  <p>
                    Discord sign-in needs external configuration. The demo is
                    ready to explore. No real connection or deployment is being
                    simulated as live.
                  </p>
                </div>
              )}
              <Button
                variant="outline"
                onClick={() => {
                  setConnectOpen(false);
                  start();
                }}
              >
                Explore the demo
              </Button>
            </>
          ) : (
            <>
              <Select
                value={serverId || null}
                onValueChange={(v) => setServerId(String(v))}
              >
                <SelectTrigger aria-label="Select Discord server">
                  <SelectValue placeholder="Select a server you manage" />
                </SelectTrigger>
                <SelectContent>
                  {servers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {serverId && (
                <>
                  <a
                    className="button-link outline"
                    target="_blank"
                    rel="noreferrer"
                    href={
                      '/api/discord/install?guild_id=' +
                      encodeURIComponent(serverId)
                    }
                  >
                    Install bot in selected server <ArrowUpRight size={16} />
                  </a>
                  <Button
                    disabled={!!busy}
                    onClick={() =>
                      run(async () => {
                        const r = await request('servers/connect', {
                          serverId,
                        });
                        setDemo(false);
                        setHistory([]);
                        setPlan(r.plan || emptyPlan);
                        setMessages([]);
                        setBuildId(undefined);
                        setPending(null);
                        setConnectOpen(false);
                        go('builder');
                        setNotice(
                          r.name +
                            ' connected. Describe the structure you want to add.',
                        );
                      }, 'Validating bot permissions')
                    }
                  >
                    Verify connection & open builder
                  </Button>
                </>
              )}
              {!servers.length && (
                <p>
                  No manageable servers found. Create one in Discord, then
                  reopen this dialog.
                </p>
              )}
            </>
          )}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!review}
        onOpenChange={(v) => {
          if (!busy && !v) setReview(null);
        }}
      >
        <DialogContent className="forge-dialog review-dialog">
          <DialogTitle>
            {review?.demo ? 'Test your deployment' : 'Approve Discord changes'}
          </DialogTitle>
          <DialogDescription>
            {review?.demo
              ? 'This test uses a mock executor. It cannot change a real Discord server.'
              : 'These exact changes will be applied to ' +
                review?.serverName +
                '. Approval expires in five minutes.'}
          </DialogDescription>
          <div className="review-target">
            <Shield size={18} />
            <div>
              <b>{review?.serverName}</b>
              <p>
                {review?.demo
                  ? 'SIMULATION · NO DISCORD CONNECTION'
                  : review?.serverId}
              </p>
            </div>
          </div>
          {review && <Changes changes={review.changes} />}
          <div className="review-notes">
            {(
              review?.notes || ['Connect Discord to deploy to a real server.']
            ).map((n: string) => (
              <p key={n}>
                <Check size={14} />
                {n}
              </p>
            ))}
          </div>
          {review?.destructive && (
            <label className="delete-confirm">
              <Checkbox
                checked={confirmDelete}
                onCheckedChange={(v) => setConfirmDelete(Boolean(v))}
              />
              I approve the listed deletions. Deleted messages cannot be
              recovered.
            </label>
          )}
          <Button
            disabled={!!busy || (review?.destructive && !confirmDelete)}
            onClick={deploy}
          >
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Rocket size={16} />
            )}{' '}
            {review?.demo
              ? 'Run simulation'
              : 'Approve & deploy to this server'}
          </Button>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!result}
        onOpenChange={(v) => {
          if (!v) setResult(null);
        }}
      >
        <DialogContent className="forge-dialog">
          <DialogTitle>
            {result?.status === 'simulated'
              ? 'Simulation complete'
              : result?.status === 'succeeded'
                ? 'Deployment complete'
                : 'Deployment needs attention'}
          </DialogTitle>
          <DialogDescription>
            {result?.status === 'simulated'
              ? `${result.objects} objects passed through the mock executor. No Discord server was changed.`
              : result?.error || 'Your approved structure has been applied.'}
          </DialogDescription>
          <div className="result-logs">
            {result?.logs?.map((l: any, i: number) => (
              <p key={i}>
                <CheckCircle2 size={15} />
                <span>{l.action?.object?.name || 'Operation'}</span>
                <small>{l.status}</small>
              </p>
            ))}
          </div>
          {result?.id && (
            <Button
              variant="outline"
              onClick={() =>
                run(
                  async () =>
                    setResult(await request('deployments/' + result.id)),
                  'Loading deployment logs',
                )
              }
            >
              Refresh deployment logs
            </Button>
          )}
          <Button onClick={() => setResult(null)}>Back to workspace</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
