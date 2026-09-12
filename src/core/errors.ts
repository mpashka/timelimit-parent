// @tag:parent-console

export class ParentConsoleError extends Error {
  readonly hint: string | undefined

  constructor (message: string, hint?: string) {
    super(message)
    this.name = 'ParentConsoleError'
    this.hint = hint
  }
}

export class ApiError extends ParentConsoleError {
  readonly endpoint: string
  readonly status: number

  constructor ({ endpoint, status, body, hint }: { endpoint: string, status: number, body: string, hint?: string }) {
    const detail = body.trim().slice(0, 300)
    super(`${endpoint}: HTTP ${status}${detail ? ` — ${detail}` : ''}`, hint)
    this.name = 'ApiError'
    this.endpoint = endpoint
    this.status = status
  }
}
