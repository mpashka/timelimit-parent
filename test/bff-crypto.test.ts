import assert from 'node:assert/strict'
import { createCipheriv, createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { deflateSync } from 'node:zlib'
import { decryptContainer, generateEphemeralKey, generateSigningKey, sharedSecret, sign, unwrapContainerKey, verify } from '../src/bff/crypto.ts'

const hex = (value: string): Buffer => Buffer.from(value, 'hex')

interface Vector { pub: Buffer, msg: Buffer, sig: Buffer, topBit: boolean }

const vectors = (): Vector[] =>
  readFileSync('test/fixtures/curve25519-vectors.txt', 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('VEC '))
    .map((line) => {
      const field = Object.fromEntries(line.split(' ').slice(1).map((pair) => pair.split('=') as [string, string]))
      return { pub: hex(field.pub), msg: hex(field.msg), sig: hex(field.sig), topBit: field.sigTopBit === 'true' }
    })

const flip = (bytes: Buffer, index: number): Buffer => {
  const copy = Buffer.from(bytes)
  copy[index] ^= 1
  return copy
}

test('signatures made by curve25519-java verify, and any tampering is rejected', () => {
  const cases = vectors()
  assert.equal(cases.length, 6)
  for (const { pub, msg, sig, topBit } of cases) {
    assert.equal((sig[63] & 0x80) !== 0, topBit)
    assert.ok(verify(pub, msg, sig), `vector ${pub.toString('hex')} must verify`)
    assert.ok(!verify(pub, flip(msg, 3), sig), 'a tampered message must be rejected')
    assert.ok(!verify(pub, msg, flip(sig, 10)), 'a tampered signature must be rejected')
  }
})

test('what we sign we verify, and the sign bit of A lands in the top bit of the signature', () => {
  const message = Buffer.from('KeyRequestSignedData', 'utf8')
  for (let i = 0; i < 4; i++) {
    const key = generateSigningKey(createHash('sha256').update(`device ${i}`).digest())
    const signature = sign(key, message)
    assert.equal(signature[63] & 0x80, key.signBit)
    assert.ok(verify(key.publicKey, message, signature))
    assert.ok(!verify(key.publicKey, flip(message, 0), signature))
  }
})

test('X25519 agreement matches RFC 7748 §6.1 and agrees on ephemeral pairs', () => {
  const alicePrivate = hex('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a')
  const alicePublic = hex('8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a')
  const bobPrivate = hex('5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb')
  const bobPublic = hex('de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f')
  const expected = hex('4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742')
  assert.deepEqual(sharedSecret(alicePrivate, bobPublic), expected)
  assert.deepEqual(sharedSecret(bobPrivate, alicePublic), expected)

  const ours = generateEphemeralKey()
  const theirs = generateEphemeralKey()
  assert.equal(ours.publicKey.length, 32)
  assert.deepEqual(sharedSecret(ours.privateKey, theirs.publicKey), sharedSecret(theirs.privateKey, ours.publicKey))
})

test('the container key is unwrapped as a single AES-128 block — FIPS-197 C.1', () => {
  const secret = hex('000102030405060708090a0b0c0d0e0f')
  const encryptedKey = hex('69c4e0d86a7b0430d8cdb78070b4c55a')
  assert.deepEqual(unwrapContainerKey(encryptedKey, secret), hex('00112233445566778899aabbccddeeff'))
})

function buildContainer (key: Buffer, format: number, generation: bigint, counter: bigint, payload: Buffer): Buffer {
  const iv32 = 0x0badf00d
  const nonce = Buffer.alloc(12)
  nonce.writeInt32BE(iv32, 0)
  nonce.writeBigInt64BE(counter, 4)
  const aad = Buffer.alloc(format === 0 ? 8 : 12)
  aad.writeBigInt64BE(generation, 0)
  if (format !== 0) aad.writeInt32BE(format, 8)
  const cipher = createCipheriv('aes-128-gcm', key, nonce, { authTagLength: 16 })
  cipher.setAAD(aad)
  const ciphertext = Buffer.concat([cipher.update(deflateSync(payload)), cipher.final()])
  const header = Buffer.alloc(20)
  header.writeBigInt64BE(generation, 0)
  header.writeBigInt64BE(counter, 8)
  header.writeInt32BE(iv32, 16)
  return Buffer.concat([header, ciphertext, cipher.getAuthTag()])
}

test('a container round-trips through every known format version', () => {
  const key = hex('0f0e0d0c0b0a09080706050403020100')
  const payload = Buffer.from('a deflated payload, not JSON'.repeat(4), 'utf8')
  for (const format of [0, 1, 2]) {
    const container = decryptContainer(key, buildContainer(key, format, 7n, 42n, payload))
    assert.deepEqual(container, { generation: 7n, counter: 42n, format, data: payload })
  }
})

test('a container that is not ours is rejected by the GCM tag, not decoded to garbage', () => {
  const blob = buildContainer(hex('0f0e0d0c0b0a09080706050403020100'), 2, 1n, 1n, Buffer.from('secret'))
  assert.throws(() => decryptContainer(hex('000102030405060708090a0b0c0d0e0f'), blob), /did not decrypt/)
  assert.throws(() => decryptContainer(hex('000102030405060708090a0b0c0d0e0f'), blob.subarray(0, 30)), /shorter than/)
})
