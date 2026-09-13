import bcrypt from 'bcryptjs'
import { ParentConsoleError } from './errors.ts'

// @tag:parent-console

/** Wire form of a parent password, as `ParentPassword.createSync` in the Android client builds it without a DH key. */
export interface ParentPassword {
  hash: string
  secondHash: string
  secondSalt: string
}

/** `PasswordValidator.MINIMAL_CHAR_AMOUNT` of the Android client: the child's device accepts nothing shorter. */
export const PARENT_PASSWORD_MIN_LENGTH = 2

const BCRYPT_ROUNDS = 10

// The server accepts only the `$2a$` prefix (`optionalPasswordRegex`); bcryptjs 3 writes `$2b$`, the algorithm is the same.
const saltA = (): string => bcrypt.genSaltSync(BCRYPT_ROUNDS).replace(/^\$2b\$/, '$2a$')

export function validateParentPassword (password: string): void {
  if (password.length < PARENT_PASSWORD_MIN_LENGTH) {
    throw new ParentConsoleError(`the parent password must have at least ${PARENT_PASSWORD_MIN_LENGTH} characters`)
  }
}

/** `hash` unlocks parent mode on the child's device; `secondHash` with `secondSalt` signs actions of password-signed devices. */
export async function hashParentPassword (password: string): Promise<ParentPassword> {
  validateParentPassword(password)
  const secondSalt = saltA()
  const [hash, secondHash] = await Promise.all([bcrypt.hash(password, saltA()), bcrypt.hash(password, secondSalt)])
  return { hash, secondHash, secondSalt }
}
