import { ParentConsoleError } from '../shared/errors.ts'

// @tag:parent-console

export { ParentConsoleError }

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
