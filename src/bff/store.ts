import { randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { KeyValueStorage } from '../core/session.ts'

// @tag:parent-console

/**
 * One parent session as the BFF holds it: the browser knows only `cookieId`, the sync server only
 * `sessionToken`. Splitting them is the point — the token never reaches the browser.
 */
export interface StoredSession {
  cookieId: string
  sessionToken: string
  sessionId: string
  familyId: string
  userId: string
  lastUsedAt: number
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sessions (
    cookie_id TEXT PRIMARY KEY,
    session_token TEXT NOT NULL,
    session_id TEXT NOT NULL,
    family_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS session_data (
    cookie_id TEXT NOT NULL REFERENCES sessions(cookie_id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (cookie_id, key)
  );
`

/**
 * The file holds sync-server session tokens, so it is a secret store: create it 0600 and keep it
 * out of the source tree — docs/implementation/web-admin.md, "Хранилище".
 */
export class BffStore {
  private readonly db: DatabaseSync

  constructor (path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec(SCHEMA)
  }

  createSession (session: Omit<StoredSession, 'cookieId' | 'lastUsedAt'>): StoredSession {
    const cookieId = randomBytes(32).toString('base64url')
    const now = Date.now()
    this.db.prepare(
      'INSERT INTO sessions (cookie_id, session_token, session_id, family_id, user_id, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(cookieId, session.sessionToken, session.sessionId, session.familyId, session.userId, now, now)
    return { ...session, cookieId, lastUsedAt: now }
  }

  findSession (cookieId: string): StoredSession | undefined {
    const row = this.db.prepare('SELECT * FROM sessions WHERE cookie_id = ?').get(cookieId) as Record<string, string | number> | undefined
    if (!row) return undefined
    return {
      cookieId: row.cookie_id as string,
      sessionToken: row.session_token as string,
      sessionId: row.session_id as string,
      familyId: row.family_id as string,
      userId: row.user_id as string,
      lastUsedAt: row.last_used_at as number
    }
  }

  touchSession (cookieId: string): void {
    this.db.prepare('UPDATE sessions SET last_used_at = ? WHERE cookie_id = ?').run(Date.now(), cookieId)
  }

  deleteSession (cookieId: string): void {
    this.db.prepare('DELETE FROM session_data WHERE cookie_id = ?').run(cookieId)
    this.db.prepare('DELETE FROM sessions WHERE cookie_id = ?').run(cookieId)
  }

  listSessions (): StoredSession[] {
    const rows = this.db.prepare('SELECT cookie_id FROM sessions').all() as Array<{ cookie_id: string }>
    return rows.map((row) => this.findSession(row.cookie_id)).filter((s): s is StoredSession => s !== undefined)
  }

  /** The cached family state and the action counter of one session, as `SyncClient` expects them. */
  storageFor (cookieId: string): KeyValueStorage {
    const db = this.db
    return {
      async get (key) {
        const row = db.prepare('SELECT value FROM session_data WHERE cookie_id = ? AND key = ?').get(cookieId, key) as { value: string } | undefined
        return row?.value
      },
      async set (key, value) {
        db.prepare('INSERT INTO session_data (cookie_id, key, value) VALUES (?, ?, ?) ON CONFLICT (cookie_id, key) DO UPDATE SET value = excluded.value')
          .run(cookieId, key, value)
      }
    }
  }

  close (): void {
    this.db.close()
  }
}
