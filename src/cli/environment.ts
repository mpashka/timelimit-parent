import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SERVER_URL } from '../core/api.ts'
import { ParentConsoleError } from '../core/errors.ts'
import type { KeyValueStorage } from '../core/session.ts'

export const TOKEN_KEY = 'parent_device_token'

export interface CliConfig {
  serverUrl?: string
  ownDeviceId?: string
  tokenCommand?: string
}

const configDir = () => join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'timelimit-parent')
export const configPath = () => process.env.TIMELIMIT_CONFIG ?? join(configDir(), 'config.json')
const stateRoot = () => join(process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'), 'timelimit-parent')

export function readConfig (): CliConfig {
  try {
    return JSON.parse(readFileSync(configPath(), 'utf8')) as CliConfig
  } catch (ex) {
    if ((ex as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw new ParentConsoleError(`cannot read ${configPath()}: ${(ex as Error).message}`, 'fix the JSON or delete the file')
  }
}

export function writeConfig (config: CliConfig): void {
  mkdirSync(configDir(), { recursive: true })
  writeFileSync(configPath(), JSON.stringify(config, null, 2) + '\n')
}

export const serverUrl = (config: CliConfig, override?: string): string =>
  override ?? process.env.TIMELIMIT_SERVER ?? config.serverUrl ?? DEFAULT_SERVER_URL

export const ownDeviceId = (config: CliConfig): string | undefined => process.env.TIMELIMIT_DEVICE_ID ?? config.ownDeviceId

export function readDeviceToken (config: CliConfig): string {
  const fromEnv = process.env.TIMELIMIT_DEVICE_TOKEN?.trim()
  if (fromEnv) return fromEnv
  if (!config.tokenCommand) {
    throw new ParentConsoleError(
      'no parent device token',
      `set TIMELIMIT_DEVICE_TOKEN, or put "tokenCommand" into ${configPath()} — a command printing the token from an encrypted store; run \`login\` to get a token`
    )
  }
  let output: string
  try {
    output = execFileSync('sh', ['-c', config.tokenCommand], { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] })
  } catch (ex) {
    throw new ParentConsoleError(`tokenCommand failed: ${(ex as Error).message.split('\n')[0]}`, `check "tokenCommand" in ${configPath()}`)
  }
  const keyed = new RegExp(`^\\s*${TOKEN_KEY}\\s*:\\s*["']?([^"'\\s]+)`, 'm').exec(output)
  const token = keyed ? keyed[1] : output.trim()
  if (!token || /\s/.test(token)) {
    throw new ParentConsoleError('tokenCommand printed no usable token', `it must print the bare token or a YAML line "${TOKEN_KEY}: <token>"`)
  }
  return token
}

export class FileStorage implements KeyValueStorage {
  private readonly directory: string

  constructor (scope: string) {
    this.directory = join(stateRoot(), scope.replace(/[^a-zA-Z0-9.-]+/g, '_'))
  }

  async get (key: string): Promise<string | undefined> {
    try {
      return readFileSync(join(this.directory, key), 'utf8')
    } catch (ex) {
      if ((ex as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw ex
    }
  }

  async set (key: string, value: string): Promise<void> {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    writeFileSync(join(this.directory, key), value, { mode: 0o600 })
  }
}
