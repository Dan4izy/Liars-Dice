CREATE TABLE users (
  id text PRIMARY KEY,
  name text NOT NULL,
  nick_key text NOT NULL UNIQUE,
  email text NOT NULL UNIQUE,
  email_verified boolean NOT NULL DEFAULT false,
  image text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE TABLE sessions (
  id text PRIMARY KEY,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  ip_address text,
  user_agent text,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE TABLE accounts (
  id text PRIMARY KEY,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX accounts_user_idx ON accounts(user_id);
CREATE TABLE verifications (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX verifications_identifier_idx ON verifications(identifier);
