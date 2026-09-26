import { createHash, randomBytes } from 'node:crypto'
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
  CREATE TABLE IF NOT EXISTS play_apps (
    package_name TEXT PRIMARY KEY,
    found INTEGER,
    title TEXT,
    icon BLOB,
    icon_type TEXT,
    icon_version TEXT,
    answered_at INTEGER,
    tried_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tablet_apps (
    family_id TEXT NOT NULL,
    package_name TEXT NOT NULL,
    title TEXT NOT NULL,
    icon BLOB NOT NULL,
    icon_version TEXT NOT NULL,
    PRIMARY KEY (family_id, package_name)
  );
`

/**
 * What Google Play said about a package. `found` is null until Play has answered at all;
 * `triedAt` moves on every attempt, `answeredAt` only on a definite answer.
 */
// @tag:app-icon
export interface PlayApp {
  packageName: string
  found: boolean | null
  title: string | null
  iconVersion: string | null
  answeredAt: number | null
  triedAt: number
}

export interface StoredIcon { bytes: Uint8Array, type: string }

const iconVersion = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex').slice(0, 12)

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

  // --- названия и значки приложений: Google Play на всех, планшеты — по семье -----------

  findPlayApp (packageName: string): PlayApp | undefined {
    const row = this.db.prepare('SELECT package_name, found, title, icon_version, answered_at, tried_at FROM play_apps WHERE package_name = ?')
      .get(packageName) as Record<string, string | number | null> | undefined
    if (!row) return undefined
    return {
      packageName,
      found: row.found === null ? null : row.found === 1,
      title: row.title as string | null,
      iconVersion: row.icon_version as string | null,
      answeredAt: row.answered_at as number | null,
      triedAt: row.tried_at as number
    }
  }

  /** A definite answer: the app with its title and icon, or `null` — Play has no such app. */
  savePlayAnswer (packageName: string, answer: { title: string, icon: StoredIcon } | null, at: number): void {
    this.db.prepare(`
      INSERT INTO play_apps (package_name, found, title, icon, icon_type, icon_version, answered_at, tried_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (package_name) DO UPDATE SET found = excluded.found, title = excluded.title, icon = excluded.icon, icon_type = excluded.icon_type,
        icon_version = excluded.icon_version, answered_at = excluded.answered_at, tried_at = excluded.tried_at
    `).run(packageName, answer === null ? 0 : 1, answer?.title ?? null, answer?.icon.bytes ?? null, answer?.icon.type ?? null,
      answer === null ? null : iconVersion(answer.icon.bytes), at, at)
  }

  /** No answer this time (network, 429): an earlier answer stays, only the attempt is recorded. */
  savePlayFailure (packageName: string, at: number): void {
    this.db.prepare('INSERT INTO play_apps (package_name, tried_at) VALUES (?, ?) ON CONFLICT (package_name) DO UPDATE SET tried_at = excluded.tried_at')
      .run(packageName, at)
  }

  findTabletApp (familyId: string, packageName: string): { title: string, iconVersion: string } | undefined {
    const row = this.db.prepare('SELECT title, icon_version FROM tablet_apps WHERE family_id = ? AND package_name = ?')
      .get(familyId, packageName) as { title: string, icon_version: string } | undefined
    return row && { title: row.title, iconVersion: row.icon_version }
  }

  saveTabletApp (familyId: string, packageName: string, title: string, png: Uint8Array): void {
    this.db.prepare(`
      INSERT INTO tablet_apps (family_id, package_name, title, icon, icon_version) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (family_id, package_name) DO UPDATE SET title = excluded.title, icon = excluded.icon, icon_version = excluded.icon_version
    `).run(familyId, packageName, title, png, iconVersion(png))
  }

  /** The icon the family sees for a package: Google Play's when Play knows the app, the tablet's otherwise. */
  findIcon (familyId: string, packageName: string): StoredIcon | undefined {
    const play = this.db.prepare('SELECT icon, icon_type FROM play_apps WHERE package_name = ? AND found = 1')
      .get(packageName) as { icon: Uint8Array, icon_type: string } | undefined
    if (play) return { bytes: play.icon, type: play.icon_type }
    const tablet = this.db.prepare('SELECT icon FROM tablet_apps WHERE family_id = ? AND package_name = ?')
      .get(familyId, packageName) as { icon: Uint8Array } | undefined
    return tablet && { bytes: tablet.icon, type: 'image/png' }
  }

  close (): void {
    this.db.close()
  }
}
