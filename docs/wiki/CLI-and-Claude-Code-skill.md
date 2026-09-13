# CLI and Claude Code skill

## CLI

```bash
npm run build
node dist/cli/main.js --help        # or link it: timelimit-parent / tlp
```

`timelimit-parent <command> [args] [--json] [--dry-run] [--server URL] [--child NAME]`

| Command | What it does |
| --- | --- |
| `login [--mail M] [--device-name N]` | sign in with a mail code; prints the device token once |
| `status [child]` | time used and left, bans, loopholes |
| `usage [child] [--days N]` | time per category per day |
| `grant <category> <minutes>` | extra time for today |
| `allow <category>\|--all <20m\|21:30\|off>` | limits off until a time |
| `lock [child] [--until 30m\|HH:MM] [--off]` | block all root categories now |
| `ban list`, `ban add --days mo-fr --from 21:00 --to 07:00 (--categories a,b \| --all-categories) [--soft]`, `ban rm N` | bans |
| `limit set <category> <minutes\|off> [--days mo-fr]` | daily limit |
| `limit app <package> <minutes> [--title T]` | per-app limit via its own subcategory |
| `app move <package> <category\|none>` | move an app |
| `filter show \| set --allow a,b --block c,d \| off` | website filter |
| `export [child] [--out FILE]` | portable JSON: categories, limits, bans, apps, filter (no used time) |
| `import <file> [--new-child NAME --time-zone TZ] [--replace]` | apply as a difference, or create a new child |
| `template list \| show <names…> \| apply <names…> [--replace]` | templates |

- **`--dry-run`** prints the actions instead of sending them. Always use it first.
- **`--json`** for scripts and agents.
- The server comes from `--server`, `TIMELIMIT_SERVER` or `serverUrl` in the config. The built-in
  default is the author's server — set yours.

### The device token — never in a plaintext file

The parent device token grants full parent rights. Treat it as a password.

- `login` prints it once and never writes it to disk; only `serverUrl` and `ownDeviceId` go to
  `~/.config/timelimit-parent/config.json`.
- The CLI reads it from `TIMELIMIT_DEVICE_TOKEN` **or** runs `tokenCommand` from the config — a
  command that prints the token from an encrypted store, bare or as a YAML line
  `parent_device_token: <token>`:

```json
{
  "serverUrl": "https://timelimit.example.org",
  "tokenCommand": "pass show timelimit/parent-device-token"
}
```

  Any password manager works (`pass`, `bw get password …`, `ansible-vault view …`).
- Non-secret state (family cache without password hashes, action sequence number) lives in
  `~/.local/state/timelimit-parent/`, mode 0600.
- The web console keeps its token in the browser's local storage of the server origin; «Выйти»
  (sign out) erases it.

### Templates, export, import

Templates in `templates/`: `ночь` (night), `уроки` (school hours), `школьник-младший` (younger
pupil), `подросток` (teenager), `каникулы` (holidays), `только-учёба` (study only).

```bash
tlp template list
tlp template show подросток уроки              # result of composing them
tlp template apply школьник-младший уроки --dry-run
```

- Composition: bans are united, limits with the same days and window take the smaller one, site lists
  are united. So apply «каникулы» on its own with `--replace`, not on top of the school set.
- Default mode is **merge** — only adds what is missing. `--replace` removes rules and apps of the
  touched categories that are not in the file.
- Categories are matched by title, case-insensitive; `"*"` means all root categories except
  `exceptCategories`. A missing category is created empty with a warning — move apps into it.

```bash
tlp export Алиса --out alice.json
tlp import alice.json --child Боб --dry-run                                  # onto an existing child
tlp import alice.json --new-child Боб --time-zone Europe/Moscow --dry-run    # a new child
```

An exported file can be edited (by hand or by an LLM) and imported again — the way to change many
settings at once.

## Claude Code skill

`skill/SKILL.md` teaches [Claude Code](https://claude.com/claude-code) to drive the CLI. Install it
by copying the directory into `~/.claude/skills/timelimit-parent/`. Then ask, for example:
«how long did he play today», «why does he sit longer than the limit», «give him 30 more minutes»,
«set bedtime at 21:00», «apply the teenager template».

What the skill enforces:

- **Consent before changes**: it shows the `--dry-run` of every command and waits for an explicit
  «yes» on the concrete list; silence or «have a look» is not consent.
- **Token**: never prints, saves or asks for the token in chat; without a token it asks you to run
  `timelimit-parent login` yourself.
- **Loopholes first**: `status --json` → `usage --days 7 --json` → explains `no-rules`,
  `limits-disabled`, unassigned apps in words.
- It does not promise per-app or per-site statistics — the server has none.

## По-русски

CLI `timelimit-parent` (`tlp`) умеет всё, что пульт, плюс экспорт, импорт и шаблоны; `--dry-run`
показывает действия без отправки, `--json` — для скриптов. Токен устройства — секрет: `login` печатает
его один раз, CLI берёт его из `TIMELIMIT_DEVICE_TOKEN` или из `tokenCommand`, который достаёт токен из
зашифрованного хранилища; на диск открытым текстом он не пишется. Шаблоны накладываются по умолчанию
слиянием, `--replace` удаляет лишнее. Навык для Claude Code показывает `--dry-run` и применяет только
после явного согласия.
