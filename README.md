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
npm run web:mock       # web console on http://127.0.0.1:5173/console/ with a fake API
npm run web -- --server https://your-server   # same, API proxied to a real server
```

The server is taken from `--server`, `TIMELIMIT_SERVER` or `serverUrl` in the config; the built-in
default points to the author's own server, so set yours.

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

AGPL-3.0, see [LICENSE](LICENSE). Protocol types are derived from
[timelimit-server](https://codeberg.org/timelimit/timelimit-server) by Jonas Lochmann (AGPL-3.0).

## По-русски

Пульт родителя для сервера синхронизации TimeLimit: веб-консоль для телефона, CLI и навык для
Claude Code. Консоль входит в семью как ещё одно родительское устройство, пароль родителя не нужен;
на почту без семьи она создаёт семью, добавляет ребёнка и показывает код для детского устройства.
Фильтр сайтов и вход через Google требуют доработок сервера, которых пока нет в апстриме. Токен
устройства — секрет: CLI берёт его из переменной окружения или из команды `tokenCommand`, на диск
не пишет.
