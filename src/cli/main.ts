#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { basename } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import { TimelimitApi, TOKEN_LIFETIME_MS } from '../core/api.ts'
import { addBanActions, readBans, removeBanActions } from '../core/bans.ts'
import { exportChild, overlayConfigs, planImport, type PortableConfig } from '../core/config.ts'
import { ParentConsoleError } from '../core/errors.ts'
import {
  allowCategoryUntil, allowChildUntil, grantExtraTime, limitApp, lockChild, moveApp, setDailyLimit, setUrlFilter, unlockChild
} from '../core/operations.ts'
import { childOverview, findCategory, findChild, findDevice, usageHistory } from '../core/overview.ts'
import { ALL_DAYS, type ParentAction } from '../core/protocol.ts'
import { SyncClient } from '../core/session.ts'
import { childCategories, type FamilyState } from '../core/state.ts'
import { formatClock, formatDays, parseClock, parseDays, parseDurationMinutes, parseUntil } from '../core/time.ts'
import {
  configPath, FileStorage, ownDeviceId, readConfig, readDeviceToken, serverUrl, TOKEN_KEY, writeConfig
} from './environment.ts'
import { formatActions, formatOverview, hours, localDateTime, table } from './format.ts'

const usage = `timelimit-parent — parent console for a TimeLimit server

usage: timelimit-parent <command> [args] [--json] [--server URL] [--dry-run]

  login [--mail M] [--device-name N]      sign in with a mail code, print the device token
  device list                             devices of the family and who uses them
  device add                              code of five words for connecting a new device
  device assign <device> <child|none>     who uses the device; "none" frees it again
  status [child]                          time used/left, bans, loopholes
  usage [child] [--days N]                used time per category per day
  grant <category> <minutes>              extra time for today
  allow <category>|--all <duration|HH:MM|off>   switch limits off for a while
  lock [child] [--until DUR|HH:MM] [--off]      block all root categories now
  ban list [child]
  ban add --days mo-fr --from 21:00 --to 07:00 (--categories a,b | --all-categories) [--soft]
  ban rm <number> [--categories a,b]
  limit set <category> <minutes|off> [--days mo-fr]
  limit app <package> <minutes> [--title T] [--days D]
  app move <package> <category|none>
  filter show [child] | filter set [--allow a,b] [--block c,d] | filter off
  export [child] [--out FILE]
  import <file> [--new-child NAME --time-zone TZ] [--replace]
  template list | template show <name>... | template apply <name>... [--replace]

  --child NAME selects the child for commands without a child argument (needed with several children).
  Mutating commands send immediately; --dry-run prints the actions instead.
  Token: TIMELIMIT_DEVICE_TOKEN or "tokenCommand" in ${configPath()}.`

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    json: { type: 'boolean' },
    server: { type: 'string' },
    'dry-run': { type: 'boolean' },
    child: { type: 'string' },
    days: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    soft: { type: 'boolean' },
    categories: { type: 'string' },
    'all-categories': { type: 'boolean' },
    all: { type: 'boolean' },
    until: { type: 'string' },
    off: { type: 'boolean' },
    title: { type: 'string' },
    allow: { type: 'string' },
    block: { type: 'string' },
    out: { type: 'string' },
    'new-child': { type: 'string' },
    'time-zone': { type: 'string' },
    replace: { type: 'boolean' },
    mail: { type: 'string' },
    'device-name': { type: 'string' },
    'google-id-token': { type: 'string' },
    help: { type: 'boolean', short: 'h' }
  }
})

const print = (human: string, json: unknown) => console.log(options.json ? JSON.stringify(json, null, 2) : human)
const list = (value: string | undefined): string[] => (value ?? '').split(',').map((s) => s.trim()).filter(Boolean)

function need (value: string | undefined, what: string): string {
  if (!value) throw new ParentConsoleError(`missing ${what}`, 'see `timelimit-parent --help`')
  return value
}

const config = readConfig()
const api = new TimelimitApi({ serverUrl: serverUrl(config, options.server) })

function openSession (): SyncClient {
  const deviceId = ownDeviceId(config)
  return new SyncClient({
    api,
    subject: { kind: 'device', authToken: readDeviceToken(config), deviceId },
    storage: new FileStorage(`${new URL(api.serverUrl).host}-${deviceId ?? 'default'}`)
  })
}

async function apply (session: SyncClient, actions: ParentAction[], warnings: string[] = []): Promise<void> {
  for (const warning of warnings) console.error(`warning: ${warning}`)
  if (options['dry-run'] || actions.length === 0) {
    print(formatActions(actions), { dryRun: Boolean(options['dry-run']), actions, warnings })
    return
  }
  const { pushed } = await session.push(actions)
  print(`applied ${pushed} action(s)`, { applied: pushed, actions, warnings })
}

const templateDirectory = new URL('../../templates/', import.meta.url)

function loadTemplate (name: string): PortableConfig {
  const path = name.endsWith('.json') ? name : new URL(`${name}.json`, templateDirectory)
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PortableConfig
  } catch (ex) {
    throw new ParentConsoleError(`cannot load template "${name}": ${(ex as Error).message}`, 'see `template list`')
  }
}

const templateNames = () => readdirSync(templateDirectory).filter((f) => f.endsWith('.json')).map((f) => basename(f, '.json')).sort()

async function login (): Promise<void> {
  const prompt = createInterface({ input: process.stdin, output: process.stderr })
  try {
    let mailAuthToken: string
    if (options['google-id-token']) {
      mailAuthToken = await api.signInByGoogle({ idToken: options['google-id-token'], locale: 'ru' })
    } else {
      const mail = options.mail ?? await prompt.question('parent mail: ')
      const mailLoginToken = await api.sendMailLoginCode({ mail: mail.trim(), locale: 'ru' })
      const code = await prompt.question(`code sent to ${mail.trim()}, enter it: `)
      mailAuthToken = await api.signInByMailCode({ mailLoginToken, receivedCode: code.trim() })
    }
    const deviceName = options['device-name'] ?? `timelimit-parent@${hostname()}`
    const result = await api.signInIntoFamily({ mailAuthToken, deviceName })
    writeConfig({ ...config, serverUrl: api.serverUrl, ownDeviceId: result.ownDeviceId })
    const instructions = [
      `signed in as parent device "${deviceName}" (${result.ownDeviceId}); ${configPath()} now has serverUrl and ownDeviceId`,
      '',
      'The device token below is a secret and is NOT saved. Store it encrypted (password manager, ansible-vault, pass),',
      `then set "tokenCommand" in ${configPath()} to a command printing the bare token or a YAML line "${TOKEN_KEY}: <token>",`,
      'or pass it for one shell as TIMELIMIT_DEVICE_TOKEN.',
      '',
      result.deviceAuthToken
    ]
    print(instructions.join('\n'), { ownDeviceId: result.ownDeviceId, deviceAuthToken: result.deviceAuthToken, tokenKey: TOKEN_KEY })
  } finally {
    prompt.close()
  }
}

async function main (): Promise<void> {
  const [command, ...args] = positionals
  if (!command || options.help) {
    console.log(usage)
    return
  }
  if (command === 'login') return login()
  if (command === 'template' && (args[0] === 'list' || args[0] === 'show')) {
    if (args[0] === 'list') {
      const templates = templateNames().map((name) => ({ name, description: loadTemplate(name).description ?? '' }))
      print(templates.map((t) => `${t.name}\n  ${t.description}`).join('\n'), templates)
    } else {
      const merged = overlayConfigs(args.slice(1).map(loadTemplate))
      console.log(JSON.stringify(merged, null, 2))
    }
    return
  }

  const session = openSession()
  const state = await session.sync()
  const now = Date.now()
  const child = (query?: string) => findChild(state, query ?? options.child)
  const category = (query: string | undefined, childQuery?: string) => {
    const owner = child(childQuery)
    return findCategory(childCategories(state, owner.id), need(query, 'category'))
  }

  switch (command) {
    case 'status': {
      const overview = childOverview(state, child(args[0]).id, now)
      if (state.message) console.error(`server message: ${state.message}`)
      return print(formatOverview(overview), overview)
    }
    case 'device': {
      if (args[0] === 'list') {
        const rows = state.devices.data.map((device) => [
          device.deviceId, device.name, device.model,
          device.currentUserId ? (state.users.data.find((u) => u.id === device.currentUserId)?.name ?? device.currentUserId) : 'not assigned yet'
        ])
        return print(table(['id', 'name', 'model', 'used by'], rows), state.devices.data)
      }
      if (args[0] === 'add') {
        const added = await session.createAddDeviceToken()
        const until = localDateTime(now + TOKEN_LIFETIME_MS, child().timeZone)
        return print(
          `code: ${added.token}\nenter it on the new device (setup: connected mode → code from another TimeLimit installation)\nvalid until ${until}; a new code cancels this one`,
          { ...added, validUntil: now + TOKEN_LIFETIME_MS }
        )
      }
      if (args[0] === 'assign') {
        const device = findDevice(state, need(args[1], 'device id or name'))
        const target = need(args[2], 'child name or none')
        return apply(session, [{ type: 'SET_DEVICE_USER', deviceId: device.deviceId, userId: target === 'none' ? '' : child(target).id }])
      }
      throw new ParentConsoleError(`unknown device subcommand "${args[0] ?? ''}"`, 'use device list | device add | device assign')
    }
    case 'usage': {
      const owner = child(args[0])
      const history = usageHistory(state, owner.id, now, Number(options.days ?? 7))
      const rows = history.days.map((d) => [d.date, ...history.categories.map((c) => hours(d.byCategory[c.id] ?? 0))])
      return print(table(['day', ...history.categories.map((c) => c.title)], rows), history)
    }
    case 'grant':
      return apply(session, grantExtraTime({ state, category: category(args[0]), minutes: parseDurationMinutes(need(args[1], 'minutes')), now }))
    case 'allow': {
      const owner = child()
      const value = need(options.all ? args[0] : args[1], 'duration, HH:MM or off')
      const until = value === 'off' ? 0 : parseUntil(value, now, owner.timeZone)
      if (value !== 'off') console.error(`limits off until ${localDateTime(until, owner.timeZone)} (${owner.timeZone})`)
      return apply(session, options.all ? allowChildUntil(owner, until) : allowCategoryUntil(category(args[0]), until))
    }
    case 'lock': {
      const owner = child(args[0])
      if (options.off) return apply(session, unlockChild({ state, child: owner }))
      return apply(session, lockChild({ state, child: owner, until: options.until ? parseUntil(options.until, now, owner.timeZone) : undefined }))
    }
    case 'ban':
      return ban(session, state, args, now)
    case 'limit': {
      const owner = child()
      const days = options.days ? parseDays(options.days) : ALL_DAYS
      if (args[0] === 'set') {
        const value = need(args[2], 'minutes or off')
        return apply(session, setDailyLimit({ category: category(args[1]), minutes: value === 'off' ? null : parseDurationMinutes(value), days }))
      }
      if (args[0] === 'app') {
        return apply(session, limitApp({ state, childId: owner.id, packageName: need(args[1], 'package'), minutes: parseDurationMinutes(need(args[2], 'minutes')), title: options.title, days }))
      }
      throw new ParentConsoleError(`unknown limit subcommand "${args[0] ?? ''}"`, 'use limit set | limit app')
    }
    case 'app': {
      if (args[0] !== 'move') throw new ParentConsoleError(`unknown app subcommand "${args[0] ?? ''}"`, 'use app move <package> <category|none>')
      const owner = child()
      const target = need(args[2], 'category or none')
      return apply(session, moveApp({ state, childId: owner.id, packageName: need(args[1], 'package'), target: target === 'none' ? null : category(target) }))
    }
    case 'filter': {
      const owner = child(args[0] === 'show' ? args[1] : undefined)
      if (args[0] === 'show') {
        const filter = owner.urlFilter ?? null
        return print(filter ? `enabled: ${filter.enabled}\nallow: ${filter.allow.join(' ') || '-'}\nblock: ${filter.block.join(' ') || '-'}` : `no url filter (server apiLevel ${state.apiLevel})`, filter)
      }
      if (args[0] === 'set') return apply(session, setUrlFilter({ state, childId: owner.id, filter: { enabled: true, allow: list(options.allow), block: list(options.block) } }))
      if (args[0] === 'off') return apply(session, setUrlFilter({ state, childId: owner.id, filter: { enabled: false, allow: owner.urlFilter?.allow ?? [], block: owner.urlFilter?.block ?? [] } }))
      throw new ParentConsoleError(`unknown filter subcommand "${args[0] ?? ''}"`, 'use filter show | set | off')
    }
    case 'export': {
      const exported = exportChild(state, child(args[0]).id)
      const text = JSON.stringify(exported, null, 2) + '\n'
      if (options.out) {
        writeFileSync(options.out, text)
        console.error(`written ${options.out}`)
      } else {
        process.stdout.write(text)
      }
      return
    }
    case 'import': {
      const file = need(args[0], 'config file')
      const imported = JSON.parse(readFileSync(file, 'utf8')) as PortableConfig
      return importConfig(session, state, imported)
    }
    case 'template': {
      if (args[0] !== 'apply') throw new ParentConsoleError(`unknown template subcommand "${args[0] ?? ''}"`, 'use template list | show | apply')
      if (args.length < 2) throw new ParentConsoleError('name at least one template', `templates: ${templateNames().join(', ')}`)
      return importConfig(session, state, overlayConfigs(args.slice(1).map(loadTemplate)))
    }
    default:
      throw new ParentConsoleError(`unknown command "${command}"`, 'see `timelimit-parent --help`')
  }
}

async function importConfig (session: SyncClient, state: FamilyState, config: PortableConfig): Promise<void> {
  const target = options['new-child']
    ? { newChild: { name: options['new-child'], timeZone: options['time-zone'] } }
    : { childId: findChild(state, options.child).id }
  const plan = planImport({ state, target, config, mode: options.replace ? 'replace' : 'merge' })
  return apply(session, plan.actions, plan.warnings)
}

async function ban (session: SyncClient, state: FamilyState, args: string[], now: number): Promise<void> {
  const [sub, ...rest] = args
  const owner = findChild(state, sub === 'list' ? rest[0] ?? options.child : options.child)
  const categories = childCategories(state, owner.id)
  const bans = readBans(categories)
  if (sub === 'list') {
    const overview = childOverview(state, owner.id, now)
    const titles = new Map(categories.map((c) => [c.id, c.base.title]))
    const rows = overview.bans.map((b, i) => [String(i + 1), `${formatClock(b.start)}-${formatClock((b.end + 1) % 1440)}`, formatDays(b.days), b.hard ? 'hard' : 'soft', b.activeNow ? 'yes' : '', b.categoryIds.map((id) => titles.get(id)).join(', ')])
    return print(table(['#', 'time', 'days', 'kind', 'active', 'categories'], rows), overview.bans)
  }
  const selected = () => options['all-categories'] ? categories : list(options.categories).map((q) => findCategory(categories, q))
  if (sub === 'add') {
    const targets = selected()
    if (targets.length === 0) throw new ParentConsoleError('a ban needs categories', 'pass --categories a,b or --all-categories')
    const start = parseClock(need(options.from, '--from')) % 1440
    const end = (parseClock(need(options.to, '--to')) + 1439) % 1440
    return apply(session, addBanActions(targets, { days: parseDays(options.days ?? 'all'), start, end, hard: !options.soft }))
  }
  if (sub === 'rm') {
    const index = Number(need(rest[0], 'ban number from `ban list`')) - 1
    const target = bans[index]
    if (!target) throw new ParentConsoleError(`no ban number ${index + 1}`, `there are ${bans.length} bans, see \`ban list\``)
    return apply(session, removeBanActions(target, options.categories ? selected().map((c) => c.id) : undefined))
  }
  throw new ParentConsoleError(`unknown ban subcommand "${sub ?? ''}"`, 'use ban list | add | rm')
}

main().catch((ex: unknown) => {
  if (ex instanceof ParentConsoleError) {
    const payload = { error: ex.message, hint: ex.hint }
    if (options.json) console.log(JSON.stringify(payload, null, 2))
    else console.error(`error: ${ex.message}${ex.hint ? `\n  what to do: ${ex.hint}` : ''}`)
  } else {
    console.error(ex)
  }
  process.exitCode = 1
})
