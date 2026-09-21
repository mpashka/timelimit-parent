# timelimit-parent

Parent console for a [TimeLimit](https://codeberg.org/timelimit) sync server. TimeLimit is an
open-source parental control app for Android; this project lets a parent manage the family from a
phone browser, a terminal or an LLM agent instead of the parent Android app.

- `src/core` — protocol client and state logic, runs in Node and in the browser;
- `src/cli` — CLI `timelimit-parent` (alias `tlp`) for people and LLMs: status, usage, extra time,
  lock, bans, limits, apps, URL filter, export/import, templates;
- `src/web` — mobile web console (Preact, Russian UI) with undo for every action;
- `templates/` — composable rule templates (night, school hours, age presets);
- `skill/SKILL.md` — a [Claude Code](https://claude.com/claude-code) skill driving the CLI.

User guide with screenshots: the [wiki](https://github.com/mpashka/timelimit-parent/wiki)
(`git@github.com:mpashka/timelimit-parent.wiki.git`).

The console signs in as one more parent device of the family, so parent actions are sent with
`integrity: "device"` — no parent password is needed or stored. A mail address without a family
gets one created from the web console (the parent password is hashed in the browser and only
unlocks parent mode on the child's device); the console then adds a child and shows the code that
links the child's device, so the parent Android app is not needed at all.

## Requirements

- Node.js 22.18 or newer.
- A TimeLimit sync server that allows `sign-in-into-family` for your family.
- The URL filter and Google sign-in need server changes that are not in upstream
  timelimit-server yet (not published so far); without them these two features are unavailable,
  the rest works with the upstream server.

## Build and run

```bash
npm install
npm test               # hermetic, no network
TIMELIMIT_E2E_SERVER_DIR=../timelimit-server npm run test:e2e   # against a built local server, see below
npm run typecheck
npm run build          # dist/ (CLI) and dist/web/ (web console)
node dist/cli/main.js --help
node dist/cli/main.js login --server https://your-server
npm run web:mock       # web console on http://127.0.0.1:5180/console/ with a fake API
npm run web -- --server https://your-server   # same, API proxied to a real server
```

The server is taken from `--server`, `TIMELIMIT_SERVER` or `serverUrl` in the config; the built-in
default points to the author's own server, so set yours.

### The BFF: on its own, or with the sync server in one process

The web console talks only to the BFF (`src/bff`), and the BFF talks only to the sync server's
HTTP API. Where that server runs is a deployment choice, and there are two:

```bash
# on its own — the sync server is somewhere else and already running
TIMELIMIT_SERVER=https://your-server npm run bff

# merged — the sync server runs inside this process, from a built clone next door
TIMELIMIT_SERVER_ENTRY=../timelimit-server/build/index.js \
  DATABASE_URL=sqlite://./bff-dev.db PORT=8080 npm run bff
```

`TIMELIMIT_SERVER_ENTRY` is the whole switch: unset, nothing changes and the BFF runs alone; set,
it is the path to the sync server's built entry file (`<clone>/build/index.js`, made there by
`npm install && npm run build`). That file ends with `main().catch(...)`, so importing it starts
the server — that, and only that, is what the merged mode uses. No function of the server is
called and nothing of it is imported by name; the BFF keeps talking HTTP, now through the loopback
into itself. Everything else the server needs (`DATABASE_URL`, `PORT`, mail, `ALWAYS_PRO`) it
still reads from the environment itself.

In the merged mode `TIMELIMIT_SERVER` defaults to `http://127.0.0.1:$PORT` — the server next door,
never the public built-in default. The BFF waits for that address to answer `/time` before it
starts listening, for up to two minutes, and says which address and which entry file gave up if it
does not.

The `Dockerfile` here builds the merged image, so its build context is the directory holding
**both** clones:

```bash
cd ..                                            # the directory with timelimit-server/ and timelimit-parent/
docker build -f timelimit-parent/Dockerfile -t timelimit .
```

### Protocol types are generated, not written

`src/core/protocol.generated.ts` comes from the schemas the sync server publishes and validates
requests against (`timelimit-server/docs/schema/*.schema.json`); `src/core/protocol.ts` only gives
those types the names this client uses and adds its own constants. The generated file is committed,
so a build without a server clone works; `npm test` and `npm run build` regenerate it in memory and
fail when the committed file no longer matches, so a protocol change is caught here instead of by a
family whose request gets rejected.

```bash
npm run protocol:types                                          # from ../timelimit-server
TIMELIMIT_SERVER_DIR=/path/to/clone npm run protocol:types      # from somewhere else
```

Without a server clone the check says where it looked and builds on the committed file as it is.

The web console must be served from the same origin as the sync server (the server sends CORS
headers only for `/admin`), e.g. `dist/web/` under `/console/` — not `/parent/`, which is a server
API path. Asset paths are relative. `GOOGLE_CLIENT_ID=... npm run build` enables Google sign-in.

`npm run test:e2e` starts `node build/index.js` from `TIMELIMIT_E2E_SERVER_DIR` (a timelimit-server
checkout built with `npm ci && npm run build:json && npx tsc`) with SQLite in a temporary directory
and `NODE_ENV=development`, reads login codes from its output and walks the parent workflow: create
family, add child, categories, bans, limits, grants, lock, URL filter, export/import, add-device code.
It is slow-ish (≈ 5 s) and needs the server, so it is not part of `npm test`.

## Security: the device token

The parent device token grants full parent rights over the family. Treat it as a password.

- `login` prints the token once and never writes it to disk; only `serverUrl` and `ownDeviceId`
  go to `~/.config/timelimit-parent/config.json`.
- The CLI reads the token from `TIMELIMIT_DEVICE_TOKEN` or runs `tokenCommand` from the config — a
  command that prints the token from an encrypted store (password manager, `pass`, `ansible-vault`),
  either bare or as a YAML line `parent_device_token: <token>`.
- The web console keeps its token in the browser's local storage of the server origin.
- The skill tells the agent never to print, save or ask for the token in chat.

## License

AGPL-3.0, see [LICENSE](LICENSE). Protocol types are generated from the schemas of
[timelimit-server](https://codeberg.org/timelimit/timelimit-server) by Jonas Lochmann (AGPL-3.0).

## По-русски

Веб-админка родителя для сервера синхронизации TimeLimit: веб-приложение для телефона, CLI и навык для
Claude Code. Она входит в семью как ещё одно родительское устройство, пароль родителя не нужен;
на почту без семьи она создаёт семью, добавляет ребёнка и показывает код для детского устройства.
Фильтр сайтов и вход через Google требуют доработок сервера, которых пока нет в апстриме. Токен
устройства — секрет: CLI берёт его из переменной окружения или из команды `tokenCommand`, на диск
не пишет.
