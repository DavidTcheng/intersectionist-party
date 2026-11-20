CREATE TABLE party_email_accounts (
  account_id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE party_email_links (
  token_hash TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX party_email_links_expiry ON party_email_links (expires_at);
--> statement-breakpoint
CREATE INDEX party_email_links_address ON party_email_links (email);
--> statement-breakpoint
CREATE TABLE party_email_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES party_email_accounts (account_id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX party_email_sessions_expiry ON party_email_sessions (expires_at);
--> statement-breakpoint
CREATE INDEX party_email_sessions_account ON party_email_sessions (account_id);
--> statement-breakpoint
CREATE TABLE party_email_rate_limits (
  rate_key TEXT PRIMARY KEY NOT NULL,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count > 0)
);
--> statement-breakpoint
CREATE INDEX party_email_rate_limits_age ON party_email_rate_limits (window_start);
--> statement-breakpoint
ALTER TABLE members ADD COLUMN contact_rate TEXT NOT NULL DEFAULT 'weekly'
  CHECK (contact_rate IN ('daily', 'weekly'));
--> statement-breakpoint
CREATE TABLE idea_email_deliveries (
  idea_id TEXT NOT NULL REFERENCES ideas (id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES members (account_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('prepared', 'sending', 'sent')),
  PRIMARY KEY (idea_id, account_id)
);
--> statement-breakpoint
CREATE INDEX idea_email_deliveries_time ON idea_email_deliveries (account_id, created_at);
