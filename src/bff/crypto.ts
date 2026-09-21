import { createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, type KeyObject, randomBytes, sign as edSign, verify as edVerify } from 'node:crypto'
import { inflateSync } from 'node:zlib'

// @tag:parent-console

/**
 * Everything TimeLimit's key exchange and container encryption need, on `node:crypto` alone —
 * curve25519 signatures the way libsignal makes them, X25519 agreement, AES-GCM containers.
 * Node-only: nothing here ever reaches the browser.
 */

/** A device signing key: `seed` signs, `publicKey` is the Montgomery key uploaded to the family. */
export interface SigningKey {
  seed: Buffer
  publicKey: Buffer
  signBit: number
}

/** A one-shot X25519 pair — every shared secret is built on a fresh one. */
export interface EphemeralKey {
  publicKey: Buffer
  privateKey: Buffer
}

/** A decrypted container: `data` is still `InstalledAppsDer` or protobuf, not JSON. */
export interface Container {
  generation: bigint
  counter: bigint
  format: number
  data: Buffer
}

const P = (1n << 255n) - 19n

function leToBig (bytes: Buffer): bigint {
  let value = 0n
  for (let i = bytes.length - 1; i >= 0; i--) value = (value << 8n) | BigInt(bytes[i])
  return value
}

function bigToLe (value: bigint): Buffer {
  const bytes = Buffer.alloc(32)
  for (let i = 0; i < 32; i++) {
    bytes[i] = Number(value & 0xffn)
    value >>= 8n
  }
  return bytes
}

const modP = (value: bigint): bigint => ((value % P) + P) % P

function invP (value: bigint): bigint {
  let result = 1n
  let base = modP(value)
  let exponent = P - 2n
  while (exponent > 0n) {
    if (exponent & 1n) result = result * base % P
    base = base * base % P
    exponent >>= 1n
  }
  return result
}

const ED_SPKI = Buffer.from('302a300506032b6570032100', 'hex')
const ED_PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex')
const X_SPKI = Buffer.from('302a300506032b656e032100', 'hex')
const X_PKCS8 = Buffer.from('302e020100300506032b656e04220420', 'hex')

const edPrivateKey = (seed: Buffer): KeyObject => createPrivateKey({ key: Buffer.concat([ED_PKCS8, seed]), format: 'der', type: 'pkcs8' })
const edPublicKey = (raw: Buffer): KeyObject => createPublicKey({ key: Buffer.concat([ED_SPKI, raw]), format: 'der', type: 'spki' })
const xPrivateKey = (raw: Buffer): KeyObject => createPrivateKey({ key: Buffer.concat([X_PKCS8, raw]), format: 'der', type: 'pkcs8' })
const xPublicKey = (raw: Buffer): KeyObject => createPublicKey({ key: Buffer.concat([X_SPKI, raw]), format: 'der', type: 'spki' })

const rawOf = (key: KeyObject): Buffer => key.type === 'public'
  ? key.export({ format: 'der', type: 'spki' }).subarray(12)
  : key.export({ format: 'der', type: 'pkcs8' }).subarray(16)

export function generateSigningKey (seed: Buffer = randomBytes(32)): SigningKey {
  // The long-term key is kept as an Ed25519 *seed* and the X25519 scalar is derived from it,
  // because node's built-in Ed25519 signer starts from a seed and nothing else: sign from the
  // scalar and libsignal rejects the signature. The key only ever signs — shared secrets run on
  // ephemeral pairs — so seed storage costs nothing.
  const scalar = createHash('sha512').update(seed).digest().subarray(0, 32)
  scalar[0] &= 248
  scalar[31] &= 127
  scalar[31] |= 64
  const edwardsPublic = rawOf(createPublicKey(edPrivateKey(seed)))
  return { seed, publicKey: rawOf(createPublicKey(xPrivateKey(scalar))), signBit: edwardsPublic[31] & 0x80 }
}

export function sign (key: SigningKey, message: Buffer): Buffer {
  const signature = edSign(null, message, edPrivateKey(key.seed))
  // The sign of the Edwards point A rides in the top bit of `s`, free because s < L. That is the
  // scheme of libsignal's `curve_sigs.c`, not plain XEdDSA: the verifier rebuilds A from the
  // Montgomery key, which leaves its sign unknown, so without this bit nothing verifies.
  signature[63] |= key.signBit
  return signature
}

export function verify (montgomeryPublicKey: Buffer, message: Buffer, signature: Buffer): boolean {
  if (signature.length !== 64 || montgomeryPublicKey.length !== 32) return false
  const u = modP(leToBig(montgomeryPublicKey) & ((1n << 255n) - 1n))
  const edwardsPublic = bigToLe(modP((u - 1n) * invP(u + 1n)))
  edwardsPublic[31] = (edwardsPublic[31] & 0x7f) | (signature[63] & 0x80)
  const s = Buffer.from(signature)
  s[63] &= 0x7f
  try {
    return edVerify(null, message, edPublicKey(edwardsPublic), s)
  } catch {
    return false
  }
}

export function generateEphemeralKey (): EphemeralKey {
  const { publicKey, privateKey } = generateKeyPairSync('x25519')
  return { publicKey: rawOf(publicKey), privateKey: rawOf(privateKey) }
}

export const sharedSecret = (privateKey: Buffer, peerPublicKey: Buffer): Buffer =>
  diffieHellman({ privateKey: xPrivateKey(privateKey), publicKey: xPublicKey(peerPublicKey) })

export function unwrapContainerKey (encryptedKey: Buffer, secret: Buffer): Buffer {
  const decipher = createDecipheriv('aes-128-ecb', secret.subarray(0, 16), null)
  decipher.setAutoPadding(false)
  return Buffer.concat([decipher.update(encryptedKey), decipher.final()])
}

const HEADER_LENGTH = 20
const TAG_LENGTH = 16
const FORMATS = [0, 1, 2]

export function decryptContainer (key: Buffer, blob: Buffer): Container {
  if (blob.length < HEADER_LENGTH + TAG_LENGTH) {
    throw new Error(`container is ${blob.length} bytes, shorter than the ${HEADER_LENGTH}-byte header plus a ${TAG_LENGTH}-byte tag`)
  }
  const generation = blob.readBigInt64BE(0)
  const counter = blob.readBigInt64BE(8)
  const nonce = Buffer.alloc(12)
  nonce.writeInt32BE(blob.readInt32BE(16), 0)
  nonce.writeBigInt64BE(counter, 4)
  const body = blob.subarray(HEADER_LENGTH)
  const ciphertext = body.subarray(0, body.length - TAG_LENGTH)
  const tag = body.subarray(body.length - TAG_LENGTH)
  for (const format of FORMATS) {
    const aad = Buffer.alloc(format === 0 ? 8 : 12)
    aad.writeBigInt64BE(generation, 0)
    if (format !== 0) aad.writeInt32BE(format, 8)
    try {
      const decipher = createDecipheriv('aes-128-gcm', key, nonce, { authTagLength: TAG_LENGTH })
      decipher.setAAD(aad)
      decipher.setAuthTag(tag)
      const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()])
      return { generation, counter, format, data: inflateSync(compressed) }
    } catch {
      // wrong format version, or a key that is not this container's
    }
  }
  throw new Error(`container did not decrypt under any known format version (${FORMATS.join(', ')}): wrong container key, or a format this client does not know`)
}
