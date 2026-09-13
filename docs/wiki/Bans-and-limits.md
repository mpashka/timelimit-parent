# Bans and limits

The console uses two parent-facing notions; underneath there are only ordinary TimeLimit **category
rules**, so the Android parent app and the console always see the same thing — the console has no
storage of its own.

## Limit

«N minutes a day» on a category (optionally on some days). It is a TimeLimit rule with
`maxTime = N` and `extraTime = false`, as the Android app creates it: with `extraTime = true`
extra time would hit the same limit and stop working.

A rule counts time only on its days and hours. **A category without a rule active now does not
record time at all** — this is the most common «he sits longer but the history is clean» loophole;
the console lists it under «История».

## Ban

A ban is `{days, from, to, hard}` on a set of categories: «nothing in these categories between
21:00 and 07:00 on these days».

- **Days are the days a ban starts.** `--days su-th --from 21:00 --to 07:00` means the nights
  before school days.
- `from ≤ to` → one rule `maxTime = 0` for the interval on each category.
- Across midnight (21:00–07:00 Mon–Fri) → two rules per category: evening `21:00–23:59` on Mon–Fri
  and morning `00:00–07:00` on the **next** days (the day mask is shifted cyclically, Sunday wraps to
  Monday).
- Reading back, the console glues an evening segment with a morning segment when the masks match
  shifted and the hardness is the same, then groups equal bans of different categories into one card.
- The old TimeLimit «blocked time» mask (`blockedMinutesInWeek`) is shown as «Из старой настройки
  приложения» and can only be edited in the app.

### Hard vs soft

| | Rule flag | Extra time («+30») |
| --- | --- | --- |
| **Hard** (default) | `extraTime = true` with `maxTime = 0` — TimeLimit treats it as a blocked zone | does **not** help |
| **Soft** (`--soft`) | `extraTime = false`, an ordinary zero limit | lifts it |

## Three different «give more»

They fix different things and are deliberately separate buttons:

| Parent says | Console | CLI | What happens |
| --- | --- | --- | --- |
| «+30 minutes of games» | «+30» on the category | `grant Игры 30` | extra time for today; a hard ban is not bypassed |
| «it's night, but allow 20 minutes» | «разрешить…» on the ban chip, or «Разрешить всё» | `allow Игры 20m`, `allow --all 20m` | limits and bans of the category (or the whole child) are off until the time (`disableLimitsUntil`) |
| «allow this app» | — | `app move <package> <category>` | the app moves to another category |

«Заблокировать» / `lock` is a fourth thing: a temporary block of all root categories
(`UPDATE_CATEGORY_TEMPORARILY_BLOCKED`), including «Разрешено».

## По-русски

Запрет — `{дни, с, до, жёсткий}` на наборе категорий; внутри это правила `time=0` на каждой
категории, через полночь — вечерний и утренний сегмент со сдвинутой маской дней. Дни — дни начала
запрета. Жёсткий запрет (по умолчанию) доп. временем не обходится, мягкий — обходится. Лимит
создаётся с `extraTime=false`. Категория без действующего сейчас правила время не записывает вовсе.
«+30» — доп. время, «разрешить…» — снятие лимитов до срока, перенос приложения — третье.
