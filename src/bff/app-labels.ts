import type { AppLabel } from '../core/apps.ts'
import type { BffStore, PlayApp, StoredIcon } from './store.ts'

// @tag:app-icon

const DAY_MS = 24 * 60 * 60 * 1000
export const PLAY_FOUND_TTL_MS = 30 * DAY_MS
export const PLAY_ABSENT_TTL_MS = 7 * DAY_MS
export const PLAY_RETRY_MS = 60 * 60 * 1000
const PLAY_GAP_MS = 500
const PLAY_TIMEOUT_MS = 15_000
const ICON_SIZE = 96

/** The address the browser loads an icon from, relative to the BFF root; the version changes with the bytes, so it may be cached for good. */
export const iconPath = (packageName: string, version: string): string => `icon/${encodeURIComponent(packageName)}?v=${version}`

/** Pseudo-apps (`.feature.*`) and TimeLimit itself are not in Play under their own name. */
export const askPlayAbout = (packageName: string): boolean =>
  !packageName.startsWith('.') && !packageName.startsWith('io.timelimit.android')

export function playLabel (app: PlayApp | undefined): AppLabel | undefined {
  if (!app?.found || app.title === null || app.iconVersion === null) return undefined
  return { title: app.title, icon: iconPath(app.packageName, app.iconVersion) }
}

export function isPlayDue (app: PlayApp | undefined, now: number): boolean {
  if (app === undefined) return true
  if (now - app.triedAt < PLAY_RETRY_MS) return false
  if (app.answeredAt === null) return true
  return now - app.answeredAt >= (app.found ? PLAY_FOUND_TTL_MS : PLAY_ABSENT_TTL_MS)
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

const decodeEntities = (text: string): string => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
  if (name[0] === '#') return String.fromCodePoint(name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1)))
  return ENTITIES[name.toLowerCase()] ?? whole
})

function metaProperty (html: string, property: string): string | undefined {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attributes = new Map([...tag.matchAll(/([a-z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map((m) => [m[1].toLowerCase(), m[2] ?? m[3]]))
    if (attributes.get('property') === property) return decodeEntities(attributes.get('content') ?? '').trim()
  }
  return undefined
}

/**
 * Title and icon from a Play details page. `og:title` reads «Приложения в Google Play – Name» (in
 * English «Name – Apps on Google Play»); the half naming the store is dropped, whatever the dash.
 */
export function parsePlayPage (html: string): { title: string, iconUrl: string } | null {
  const ogTitle = metaProperty(html, 'og:title')
  const ogImage = metaProperty(html, 'og:image')
  if (!ogTitle || !ogImage) return null
  const [first, ...rest] = ogTitle.split(/\s+[-–—]\s+/)
  const title = rest.length === 0 ? first
    : /google play/i.test(first) ? rest.join(' – ')
      : /google play/i.test(rest[rest.length - 1]) ? [first, ...rest.slice(0, -1)].join(' – ')
        : ogTitle
  if (title === '') return null
  return { title, iconUrl: ogImage.replace(/(=[^/]*)?$/, `=s${ICON_SIZE}`) }
}

type Lookup = { title: string, icon: StoredIcon } | null

class PlayFailure extends Error {
  readonly tooManyRequests: boolean
  constructor (message: string, tooManyRequests = false) {
    super(message)
    this.tooManyRequests = tooManyRequests
  }
}

/**
 * Asks Google Play about packages one at a time, in the background: a screen shows what is known
 * now and the next load already has Play's answer. `onFound` fires once the queue is drained and
 * something new was found, so open screens can re-ask.
 */
export class PlayCatalog {
  private readonly store: BffStore
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly onFound: () => void
  private readonly gapMs: number
  private readonly queue = new Set<string>()
  private pausedUntil = 0
  private running = false

  constructor ({ store, fetchImpl = (input, init) => globalThis.fetch(input, init), now = Date.now, onFound = () => {}, gapMs = PLAY_GAP_MS }: {
    store: BffStore, fetchImpl?: typeof fetch, now?: () => number, onFound?: () => void, gapMs?: number
  }) {
    this.store = store
    this.fetchImpl = fetchImpl
    this.now = now
    this.onFound = onFound
    this.gapMs = gapMs
  }

  label (packageName: string): AppLabel | undefined {
    return playLabel(this.store.findPlayApp(packageName))
  }

  request (packageNames: Iterable<string>): void {
    if (this.now() < this.pausedUntil) return
    for (const packageName of packageNames) {
      if (askPlayAbout(packageName) && isPlayDue(this.store.findPlayApp(packageName), this.now())) this.queue.add(packageName)
    }
    if (!this.running && this.queue.size > 0) void this.drain()
  }

  private async drain (): Promise<void> {
    this.running = true
    let found = false
    try {
      for (const packageName of this.queue) {
        this.queue.delete(packageName)
        try {
          const answer = await this.lookup(packageName)
          this.store.savePlayAnswer(packageName, answer, this.now())
          found ||= answer !== null
        } catch (error) {
          this.store.savePlayFailure(packageName, this.now())
          console.warn(`google play: ${packageName}: ${error instanceof Error ? error.message : String(error)} — next try in an hour`)
          if (error instanceof PlayFailure && error.tooManyRequests) {
            this.pausedUntil = this.now() + PLAY_RETRY_MS
            this.queue.clear()
          }
        }
        if (this.queue.size > 0) await new Promise((wake) => setTimeout(wake, this.gapMs))
      }
    } finally {
      this.running = false
    }
    if (found) this.onFound()
  }

  private async lookup (packageName: string): Promise<Lookup> {
    const page = await this.get(`https://play.google.com/store/apps/details?id=${encodeURIComponent(packageName)}&hl=ru`)
    if (page.status === 404) return null
    const parsed = parsePlayPage(await page.text())
    if (parsed === null) return null
    const image = await this.get(parsed.iconUrl)
    const type = image.headers.get('content-type')?.split(';')[0].trim() ?? ''
    if (image.status !== 200 || !type.startsWith('image/')) throw new PlayFailure(`icon ${parsed.iconUrl} answered HTTP ${image.status} ${type}`)
    return { title: parsed.title, icon: { bytes: new Uint8Array(await image.arrayBuffer()), type } }
  }

  private async get (url: string): Promise<Response> {
    let response: Response
    try {
      response = await this.fetchImpl(url, { headers: { 'Accept-Language': 'ru' }, signal: AbortSignal.timeout(PLAY_TIMEOUT_MS) })
    } catch (error) {
      throw new PlayFailure(`cannot reach ${new URL(url).host} (${error instanceof Error ? error.message : String(error)})`)
    }
    if (response.status === 429) throw new PlayFailure('HTTP 429, Play asks to slow down', true)
    if (!response.ok && response.status !== 404) throw new PlayFailure(`HTTP ${response.status} from ${url}`)
    return response
  }
}
