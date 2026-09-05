# GuildForge AI

Build your Discord. Just describe it.

A responsive Discord community builder with a real server implementation and an explicitly labeled, credential-free demo. The full original brief is preserved in USER-BRIEF.md.

## What runs now

- Landing page, interactive Discord-like preview, AI workspace, 13 template entry points, dashboard, history and settings.
- Demo preset generation/modifications, validated draft diff, apply/cancel, draft undo, JSON export, and a mock executor using the same channel/role payload code as live deployment. Demo state lasts only for the current page visit and is labeled temporary.
- Discord OAuth authorization-code flow with one-time state, encrypted server-side access tokens, opaque sessions, logout and manageable-server selection.
- PostgreSQL schema for users, sessions, server mappings, builds, conversation history, approvals, deployments, operation logs and quotas.
- OpenAI Responses structured JSON generation followed by independent validation. AI never receives an execution tool.
- Real create/update/delete executor for GuildForge-managed categories, text/voice channels and access roles. Private channels and read-only channels use permission overwrites.
- Five-minute, single-use approvals tied to user, target guild, immutable plan hash and current guild snapshot. A deployment is rejected if the server changes after review.
- Shared PostgreSQL rate limits and monthly usage accounting. Free accounts get 3 AI requests/month, including modifications and failed provider attempts, to cap cost.
- Separate confirmation for irreversible deletion, durable per-guild deployment exclusion, and per-operation journal entries.

This is a runnable MVP, not a claim that production integrations have been verified. No Discord credentials, OpenAI key or hosted PostgreSQL database were supplied. No live Discord server was modified.

## Setup

Requires Node 22.13+ (Node 24 recommended), npm and a Neon PostgreSQL database for live mode. The Sites scaffold uses Vinext: React/TypeScript with Next.js-compatible App Router APIs, deployed as a Cloudflare Worker. No always-on Gateway bot process or privileged intents are needed for these REST operations.

```sh
npm ci
cp .env.example .env
npm run dev
```

The demo works without credentials. Open the local URL printed by the development server. Build and run the Worker locally:

```sh
npm run build
npm start
```

On Windows, use PowerShell Copy-Item .env.example .env. If npm's global cache is not writable, set npm_config_cache to a workspace directory; do not run as administrator.

## Environment variables

All secrets remain in server routes. No secret uses a NEXT_PUBLIC_ or VITE_ prefix. Never commit .env.

| Variable              | Purpose                                                                 |
| --------------------- | ----------------------------------------------------------------------- |
| APP_ORIGIN            | Exact trusted HTTPS production origin, or http://localhost:3000 locally |
| DISCORD_CLIENT_ID     | Application ID from Discord Developer Portal                            |
| DISCORD_CLIENT_SECRET | OAuth secret                                                            |
| DISCORD_BOT_TOKEN     | Bot token; never put in a client script                                 |
| DISCORD_REDIRECT_URI  | Exact registered callback, APP_ORIGIN + /api/auth/callback              |
| DATABASE_URL          | Neon PostgreSQL connection URL, SSL required                            |
| SESSION_SECRET        | Random secret, at least 32 characters; encryption key derivation input  |
| OPENAI_API_KEY        | Project-scoped OpenAI API key                                           |
| OPENAI_MODEL          | Available Responses model supporting strict structured outputs          |
| MOCK_DISCORD          | Defaults to true; set false only for intended live deployment           |
| ENABLE_LIVE_DEPLOY    | Defaults false; must be true together with MOCK_DISCORD=false           |

Production secrets should be configured through Sites environment-variable tools or the hosting provider's secret manager. Do not embed them into the build. Local .env and .env.example have matching keys. A private Sites access gate is separate from the application's Discord identity; Discord sessions authorize guild operations. The generated ChatGPT auth helper is available but is not used as a replacement for Discord OAuth.

## PostgreSQL

Create a Neon database and run db/001_initial.sql once in its SQL editor or with psql. This is PostgreSQL, not D1. The Neon HTTPS driver avoids raw TCP, which hosted Sites does not support. The supplied migration creates the schema, indexes and uniqueness constraints. Do not run it again on an existing database; add subsequent migration files for changes.

Use a dedicated application database role limited to the tables it needs. Back up the database. Expired sessions/OAuth states and old rate-limit buckets may be cleaned by an operational maintenance job; keep deployments and logs for reconciliation. Reconnect retains the managed object map. Disconnect marks the connection inactive; it does not destroy ownership metadata or uninstall the Discord bot.

## Discord Developer Portal

1. Create an application at https://discord.com/developers/applications and add a bot.
2. Copy its application ID, OAuth client secret and bot token into server configuration.
3. Register the exact callback URI in OAuth2 settings, for example https://your-site.example/api/auth/callback. Local and production callbacks are different.
4. Enable Guild Install with the bot scope. OAuth sign-in requests identify and guilds only. Do not enable privileged intents.
5. Create a server in the Discord client if you need a new one. Apps can no longer create guilds; the product intentionally uses server selection and installation instead.
6. Sign in, choose a server where you are the owner or have Manage Server/Administrator, install the bot, then click Verify connection.
7. Keep the GuildForge bot's role above all roles it should manage. It never requests Administrator.

Requested bot permissions: Manage Channels, Manage Roles, View Channels, Send Messages, Read Message History, Connect and Speak. The last five permit correct channel access and overwrite creation for the supported text/voice feature set. The bot validates its own permissions immediately before review and again before deployment.

Roles generated by this MVP are access labels with zero guild-level permissions. A role named Moderator is not granted moderation authority. Grant any elevated moderation permissions yourself in Discord after review. Administrators and server owners bypass private-channel restrictions under Discord's permission model.

## OpenAI

Configure OPENAI_API_KEY and OPENAI_MODEL from your own OpenAI project. Set a project budget/rate limit in the provider console as a second cost boundary. The server calls /v1/responses with strict JSON schema, store=false, a 6,000-output-token cap and a 60-second timeout. Prompts are capped at 2,000 characters, plans at 70 objects, and persisted context is bounded. Refusals, incomplete output and invalid plans cannot reach the executor.

No API key creation plugin was available in this task. For assisted key setup, enable the OpenAI Developers plugin in Codex; otherwise configure a key directly using your provider dashboard. Never send secrets in chat.

## Execution and recovery

Prompt → structured plan → validation → draft diff → apply to draft → live server revalidation → concrete review → explicit approval → executor.

The final review uses the last deployed managed plan as baseline, not the previous chat message. It never adopts unrelated existing objects automatically. Name collisions, missing mappings, role hierarchy issues, excessive object counts and changed server snapshots block execution. The server title/description and onboarding fields are design suggestions only; they are not silently applied.

Each operation is journaled as started before making a Discord request and succeeded only after the response is persisted. Every successfully returned object ID is checkpointed. Requests are sequential. Rate limits produce a retry delay message; mutations are never blindly retried. A stopped operation may have succeeded remotely, so the deployment remains uncertain and the guild lock remains active. Repeated clicks cannot duplicate a deployment.

For an uncertain or abandoned running deployment:

1. Read its operation logs through /api/deployments/:id as the owning user, and inspect the actual server in Discord.
2. An administrator must reconcile each started/uncertain operation and the servers.object_map/managed_plan with real Discord IDs. A missing response does not prove failure.
3. Only after reconciliation, mark the deployment resolved in the database (for example reconciled) and request a new approval. Never simply clear the lock or repeat the old request.

Recovery is intentionally manual in this MVP. There is no automatic rollback of Discord messages, role membership, or external changes. Draft undo restores a previous draft only. Review snapshots prevent changes made before deployment starts; Discord provides no multi-operation transaction, so edits made concurrently during deployment still require operational care.

## Verification

```sh
npm run typecheck
npm test
npm run build
npm audit
```

Tests cover schema boundaries, templates and modifications, destructive intent, permission payloads, creation order, role hierarchy, server snapshot drift, encryption/tamper rejection, CSRF, unauthenticated endpoints, OAuth state checks, rate limits and mock failures. PostgreSQL schema and atomic claim/quota behavior are exercised using PGlite's PostgreSQL engine; this is not verification of a live Neon account or its network connection.

No browser UI test was requested. Responsive styles are implemented but require manual device/accessibility QA before a public release. A feature-detected WebMCP tool stages a prompt without generating or deploying. No supported WebMCP validation context was available; its runtime registration is not claimed verified.

## Routes

GET: /api/config, /api/auth/discord, /api/auth/callback, /api/me, /api/servers, /api/discord/install?guild_id=..., /api/builds, /api/builds/:id, /api/deployments/:id.

POST: /api/auth/logout, /api/servers/connect, /api/servers/disconnect, /api/ai/generate, /api/ai/modify, /api/discord/validate, /api/discord/deploy, /api/demo/generate, /api/demo/deploy.

All POST requests enforce same origin and a custom request header. Authenticated writes also require a session CSRF token. Session cookies are HttpOnly, SameSite=Lax, and Secure on HTTPS. Production accounts, histories, quotas and approvals are server-owned. The no-cost demo has per-isolate throttling; it is not presented as a distributed paid-usage limiter.

## Production and remaining scope

Publish as a private Sites Worker, configure HTTPS origin and secrets, migrate PostgreSQL, and register the production Discord callback. Verify the complete OAuth → server selection → AI generation → review → explicit approval → Discord deployment journey in a disposable server before enabling general use.

The following are deliberately not marked complete: credentialed OAuth and bot verification; live Neon persistence and OpenAI responses; automatic onboarding deployment; server-setting edits; elevated role permission editing; importing arbitrary existing server objects for management; automatic deployment rollback/reconciliation; subscriptions/payments; analytics. Onboarding requires Community configuration, Manage Guild plus Manage Roles, and Discord-specific default-channel constraints. It remains an editable planning suggestion for future work rather than requesting excess permissions now.

The demo templates are starter structures with keyword-based variations, not AI calls. Unsupported natural-language requests can produce no changes. Live AI uses the full prompt and stored history. No payments are implemented.

## Troubleshooting

- Sign-in unavailable: fill all Discord/session/database/origin variables and register the exact callback. On private Sites, the external OAuth return must also pass the platform's access gate.
- No servers: you need ownership or Manage Server; sign in again after access changes.
- Bot not installed: use the selected-server installation link, then Verify connection.
- Missing permissions: update the bot's granted permissions and role position.
- Changed-server error: review again to get a fresh diff and approval.
- Deployment lock: follow manual reconciliation above; do not auto-retry.
- AI limit: free requests reset at the UTC calendar month boundary. Failed attempts count conservatively.
- Rate limit: wait for the stated window; avoid rapid retries.
- Invalid plan: simplify the prompt; no Discord action has occurred.

## Verified API references (2026-09-05)

- Discord guild creation deprecation: https://docs.discord.com/developers/change-log (July 28, 2025 entry).
- Discord guild/channel/role/onboarding endpoints: https://docs.discord.com/developers/resources/guild
- OAuth2: https://docs.discord.com/developers/topics/oauth2
- Permission model: https://docs.discord.com/developers/topics/permissions
- OpenAI structured outputs: https://developers.openai.com/api/docs/guides/structured-outputs
