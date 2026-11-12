// Hub SQLite schema with forward-only migrations, tracked in `meta.schema_version`.

const MIGRATIONS: string[] = [
  // 1: initial schema
  `
  CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  CREATE TABLE tokens (hash TEXT PRIMARY KEY, role TEXT NOT NULL, subject TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE INDEX tokens_subject ON tokens (role, subject);
  CREATE TABLE sources (
    id TEXT PRIMARY KEY, host TEXT NOT NULL, user TEXT NOT NULL, privacy TEXT NOT NULL, allow_messages INTEGER NOT NULL,
    daemon_version TEXT NOT NULL, adapters TEXT NOT NULL, last_seen INTEGER NOT NULL, created_at INTEGER NOT NULL,
    offline_notified INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE sessions (
    source_id TEXT NOT NULL, id TEXT NOT NULL, agent TEXT NOT NULL, state TEXT NOT NULL, state_since INTEGER NOT NULL,
    started_at INTEGER NOT NULL, turn_started_at INTEGER, updated_at INTEGER NOT NULL, caps TEXT NOT NULL, sealed TEXT,
    PRIMARY KEY (source_id, id)
  );
  CREATE TABLE requests (
    id TEXT PRIMARY KEY, source_id TEXT NOT NULL, session_id TEXT NOT NULL, kind TEXT NOT NULL,
    created_at INTEGER NOT NULL, status TEXT NOT NULL, closed_at INTEGER, answerable INTEGER NOT NULL, sealed TEXT NOT NULL
  );
  CREATE INDEX requests_status ON requests (status, closed_at);
  CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL, session_id TEXT NOT NULL, at INTEGER NOT NULL,
    kind TEXT NOT NULL, sealed TEXT
  );
  CREATE INDEX events_session ON events (source_id, session_id, at);
  CREATE TABLE devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL);
  CREATE TABLE push_subs (
    endpoint TEXT PRIMARY KEY, device_id TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE TABLE pairings (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, wrapped TEXT NOT NULL, source_id TEXT NOT NULL, expires_at INTEGER NOT NULL,
    meta TEXT NOT NULL
  );
  CREATE TABLE commands (
    id TEXT PRIMARY KEY, device_id TEXT NOT NULL, source_id TEXT NOT NULL, envelope TEXT NOT NULL, status TEXT NOT NULL,
    detail TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  `,
]

export function migrate(sql: SqlStorage): void {
  sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)')
  const row = sql.exec<{ v: string }>(`SELECT v FROM meta WHERE k = 'schema_version'`).toArray()[0]
  let version = row ? Number(row.v) : 0
  while (version < MIGRATIONS.length) {
    sql.exec(MIGRATIONS[version]!)
    version++
    sql.exec(`INSERT OR REPLACE INTO meta (k, v) VALUES ('schema_version', ?)`, String(version))
  }
}
