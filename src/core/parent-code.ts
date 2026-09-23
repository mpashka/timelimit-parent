import { createHmac } from 'node:crypto'

// @tag:parent-code

export const PARENT_CODE_STEP_MS = 30_000

const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function decodeBase32 (text: string): Buffer {
  const bytes: number[] = []
  let bits = 0
  let value = 0
  for (const char of text.replace(/=+$/, '').toUpperCase()) {
    const index = base32Alphabet.indexOf(char)
    if (index < 0) throw new Error(`the parent code secret is not base32: "${char}"`)
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

/** RFC 6238 TOTP, HMAC-SHA1, six digits — what the child's tablet checks without network. */
export function parentCode (secret: string, now: number): { code: string, validUntil: number } {
  const step = Math.floor(now / PARENT_CODE_STEP_MS)
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const hmac = createHmac('sha1', decodeBase32(secret)).update(counter).digest()
  const offset = hmac[hmac.length - 1] & 15
  const number = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000
  return { code: String(number).padStart(6, '0'), validUntil: (step + 1) * PARENT_CODE_STEP_MS }
}
