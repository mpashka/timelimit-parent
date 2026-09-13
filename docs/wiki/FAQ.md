# FAQ and limitations

**Can I see time per app on the parent phone?**
No. TimeLimit records time per **category** on the server. Per-app time is only on the child's
tablet (a «time by app» screen in the patched Android build, or `adb shell dumpsys usagestats`). To see
an app separately, give it its own subcategory («Лимит на приложение…»).

**He installed a new app — why can't I approve it from the console?**
The server now returns the list of installed apps only **encrypted** for the family's Android devices
(`devices2`); the plain `apps` field is empty. The console can not decrypt it, so «apps without a
category» are unknown and P6 is not available. Approve it on the tablet or in the parent Android app,
or move it by package name: `tlp app move <package> <category>`. Apps without a category are blocked
unless the child has a category for unassigned apps.

**Where is «Войти через Google»?**
Google sign-in needs a Google **OAuth client** (web client id) registered by the server owner, the
patched server with `GOOGLE_CLIENT_ID`, and a console built with `GOOGLE_CLIENT_ID=…`. Without them
the button is hidden; sign in with the mail code.

**Can I use the upstream cloud `api.timelimit.io`?**
Not with the web console: it must be served from the same origin as the server (CORS is open only
on `/admin`). The CLI does not have this restriction, but it was not tried against the cloud; there extra time,
«allow for» and lock also need premium.

**Does the console need the parent password?**
No. It signs in as another parent device; actions are signed `integrity: "device"`. The password is
only for parent mode on the child's device.

**An action failed with «server rejected at least one of actions».**
The server does not say which one. The console/CLI re-syncs the whole state; compare `--dry-run`
with a fresh `status` instead of retrying blindly.

**Other limitations**

- Error texts from the core are in English; the web UI is in Russian.
- No push updates (socket.io) — the console polls every 30 s. No offline mode.
- Website filter works only in Chrome and needs device owner + patched builds — [[Website filter|Website-filter]].
- The action sequence number is stored in a 32-bit server column — valid until 2038.

## По-русски

Время по приложениям — только на планшете: на сервер идёт время по категориям. Одобрить новое
приложение из пульта нельзя — список установленных сервер отдаёт зашифрованным; переносите по имени
пакета через `tlp app move`. Вход через Google требует OAuth-клиента Google, доработанного сервера и
сборки пульта с `GOOGLE_CLIENT_ID`. С облаком апстрима веб-пульт не работает (CORS). Пароль родителя
пульту не нужен.
