# timelimit-parent

Parent console for a [TimeLimit](https://codeberg.org/timelimit) sync server: a protocol client
(`src/core`, runs in Node and in the browser), a CLI for people and LLMs (`src/cli`), composable
templates (`templates/`) and a Claude Code skill (`skill/SKILL.md`).

The console signs in as one more parent device of the family, so parent actions are sent with
`integrity: "device"` — no parent password is needed or stored.

```bash
npm install
npm test               # hermetic, no network
npm run build          # dist/
node dist/cli/main.js --help
```

The device token is a secret: the CLI reads it from `TIMELIMIT_DEVICE_TOKEN` or from `tokenCommand`
in `~/.config/timelimit-parent/config.json`; `login` prints it and never saves it.

Design notes, the command list and how bans map to rules: `docs/parent-console.md` in the
surrounding `child-control/timelimit` workspace.

License: AGPL-3.0 (protocol types are derived from timelimit-server by Jonas Lochmann).
