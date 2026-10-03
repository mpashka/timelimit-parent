import { ParentConsoleError } from '../shared/errors.ts'

// @tag:parent-console

export { ParentConsoleError }

export class ApiError extends ParentConsoleError {
  readonly endpoint: string
  readonly status: number

  constructor ({ endpoint, status, body, hint }: { endpoint: string, status: number, body: string, hint?: string }) {
    const detail = messageOf(body).slice(0, 300)
    super(`${endpoint}: HTTP ${status}${detail ? ` — ${detail}` : ''}`, hint)
    this.name = 'ApiError'
    this.endpoint = endpoint
    this.status = status
  }
}

/** The sync server answers its errors with Express's default HTML page; the message is the first line of its <pre>. */
function messageOf (body: string): string {
  const pre = /<pre>([^<\n]*)/.exec(body)
  return (pre ? pre[1].replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&') : body).trim()
}
