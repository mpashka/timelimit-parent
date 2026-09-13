# timelimit-parent

**timelimit-parent** is a parent console for a [TimeLimit](https://codeberg.org/timelimit) sync
server. TimeLimit is an open-source parental-control app for Android: the child's device enforces
daily limits, bans and blocked apps, and a sync server keeps the family settings. This project lets a
parent manage the family **from a phone browser, a terminal or an LLM agent** instead of the parent
Android app.

| Part | What it gives you |
| --- | --- |
| Web console (`src/web`) | a mobile page for the parent phone (works on iPhone): time left, «+30», bans, limits, history, website filter; every action can be undone |
| CLI `timelimit-parent` / `tlp` (`src/cli`) | the same operations plus export/import and templates, with `--json` and `--dry-run` |
| Claude Code skill (`skill/SKILL.md`) | lets an agent read the state, find loopholes and propose rules — applied only after your consent |
| Templates (`templates/`) | composable rule sets: night, school hours, age presets, holidays |

The console signs in as **one more parent device** of the family: no parent password is needed
or stored. On a mail address without a family it creates the family, adds a child and shows the
code that links the child's device — the parent Android app is not needed at all.

<img src="images/05-home.png" alt="Home screen «Сейчас»" width="300"> <img src="images/07-ban-allow.png" alt="Active ban with «разрешить…»" width="300">

## Pages

- [[Installation]] — child device, parent console, server requirements
- [[Daily use|Daily-use]] — scenarios P1–P9 with screenshots and step counts
- [[Bans and limits|Bans-and-limits]] — how bans map to TimeLimit rules; hard vs soft; «allow for» vs extra time
- [[Website filter|Website-filter]] — Chrome allow/block lists
- [[CLI and Claude Code skill|CLI-and-Claude-Code-skill]] — commands, token handling, templates, export/import
- [[FAQ and limitations|FAQ]]

The UI of the web console is in Russian; button names are quoted in Russian with a translation.

License: AGPL-3.0. Protocol types are derived from timelimit-server by Jonas Lochmann.

## По-русски

Пульт родителя для сервера синхронизации TimeLimit: веб-страница для телефона родителя, CLI и
навык для Claude Code. Пульт входит в семью ещё одним устройством родителя — пароль не нужен. На
почте без семьи создаёт семью, добавляет ребёнка и показывает код для детского устройства, так что
Android-приложение родителю не нужно. Страницы вики: [[Установка|Installation]],
[[Каждый день|Daily-use]], [[Запреты и лимиты|Bans-and-limits]], [[Фильтр сайтов|Website-filter]],
[[CLI и навык|CLI-and-Claude-Code-skill]], [[Вопросы и ограничения|FAQ]].
