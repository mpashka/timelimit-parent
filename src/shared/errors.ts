// @tag:parent-console

export class ParentConsoleError extends Error {
  readonly hint: string | undefined

  constructor (message: string, hint?: string) {
    super(message)
    this.name = 'ParentConsoleError'
    this.hint = hint
  }
}
