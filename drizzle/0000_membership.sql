CREATE TABLE members (
  account_id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended')),
  email_updates INTEGER NOT NULL CHECK (email_updates IN (0, 1)),
  email TEXT,
  unsubscribe_token TEXT UNIQUE,
  joined_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (email_updates = 0 AND email IS NULL AND unsubscribe_token IS NULL) OR
    (email_updates = 1 AND status = 'active' AND email IS NOT NULL AND unsubscribe_token IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE TABLE ideas (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  published_at TEXT NOT NULL,
  UNIQUE (title, body)
);
--> statement-breakpoint
CREATE INDEX ideas_publication_order ON ideas(published_at DESC, id DESC);
