# timelimit-parent

Parent console for a [TimeLimit](https://codeberg.org/timelimit) sync server: a protocol client
(`src/core`, runs in Node and in the browser), a CLI for people and LLMs (`src/cli`), a mobile web
console in Russian (`src/web`, Preact), composable templates (`templates/`) and a Claude Code skill
(`skill/SKILL.md`).

The console signs in as one more parent device of the family, so parent actions are sent with
`integrity: "device"` — no parent password is needed or stored.

```bash
npm install
npm test               # hermetic, no network
npm run build          # dist/ (CLI) and dist/web/ (web console)
node dist/cli/main.js --help
npm run web:mock       # web console on http://127.0.0.1:5173/console/ with a fake API
npm run web -- --server https://your-server   # same, API proxied to a real server
```

The web console must be served from the same origin as the sync server (the server sends CORS
headers only for `/admin`), e.g. `dist/web/` under `/console/` — not `/parent/`, which is a server API
path. Asset paths are relative. `GOOGLE_CLIENT_ID=... npm run build` enables Google sign-in.

The device token is a secret: the CLI reads it from `TIMELIMIT_DEVICE_TOKEN` or from `tokenCommand`
in `~/.config/timelimit-parent/config.json`; `login` prints it and never saves it.

Design notes, the command list and how bans map to rules: `docs/parent-console.md` in the
surrounding `child-control/timelimit` workspace.

License: AGPL-3.0 (protocol types are derived from timelimit-server by Jonas Lochmann).
