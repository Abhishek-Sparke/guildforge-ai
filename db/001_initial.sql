CREATE TABLE users(id text PRIMARY KEY,username text NOT NULL,avatar text,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE oauth_states(id text PRIMARY KEY,expires_at timestamptz NOT NULL);
CREATE TABLE sessions(id text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id),token_encrypted text NOT NULL,csrf text NOT NULL,expires_at timestamptz NOT NULL);
CREATE TABLE servers(id text PRIMARY KEY,name text NOT NULL,owner_user_id text NOT NULL REFERENCES users(id),bot_status text NOT NULL DEFAULT 'connected',revision integer NOT NULL DEFAULT 0,managed_plan jsonb NOT NULL,object_map jsonb NOT NULL DEFAULT '{}',updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE builds(id text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id),server_id text NOT NULL,prompt text NOT NULL,plan jsonb NOT NULL,messages jsonb NOT NULL DEFAULT '[]',status text NOT NULL DEFAULT 'draft',created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX builds_user_time ON builds(user_id,created_at DESC);
CREATE TABLE approvals(id text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id),build_id text NOT NULL REFERENCES builds(id),server_id text NOT NULL,plan_hash text NOT NULL,snapshot_hash text NOT NULL,changes jsonb NOT NULL,expires_at timestamptz NOT NULL,consumed boolean NOT NULL DEFAULT false);
CREATE TABLE deployments(id text PRIMARY KEY,approval_id text UNIQUE NOT NULL REFERENCES approvals(id),build_id text NOT NULL REFERENCES builds(id),user_id text NOT NULL REFERENCES users(id),server_id text NOT NULL,status text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX one_active_guild_deployment ON deployments(server_id) WHERE status IN ('running','uncertain');
CREATE TABLE deployment_logs(id bigserial PRIMARY KEY,deployment_id text NOT NULL REFERENCES deployments(id),action jsonb NOT NULL,discord_object_id text,status text NOT NULL,error text,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE usage_limits(key text NOT NULL,bucket bigint NOT NULL,count integer NOT NULL,PRIMARY KEY(key,bucket));
CREATE TABLE monthly_usage(user_id text NOT NULL REFERENCES users(id),month text NOT NULL,ai_calls integer NOT NULL DEFAULT 0,PRIMARY KEY(user_id,month));

