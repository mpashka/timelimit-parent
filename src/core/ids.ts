// @tag:parent-console

const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

export function generateId (): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

export const isId = (value: string): boolean => /^[a-zA-Z0-9]{6}$/.test(value)
