# TEAM BRIEF: Daybeat, a tasks + alarms + calendar planner with Garmin tracking (installable PWA)

_Internal working notes from building Daybeat. The public description is in README.md._

> **CHANGE OF SCOPE, 2026-11-25 (supersedes sections 1 and 3 where they differ; sections 2, 5, 6, 8, 9 still apply):**
> The point of the app is **tracking tasks and alarms with a calendar**, plus the ability to **track Garmin numbers** as well.
> So Daybeat is first a planner: **Tasks + Alarms + Calendar** are the core and must be genuinely good to use every day. **Garmin tracking** is a first-class page next to them, not the whole app. The fun/retention layer (streak, XP, daily quest, weekly recap, themes) stays, but now it is driven by what the user actually does: completing tasks, checking in on alarms, hitting Garmin goals. Messages ("Pings") are no longer a main page: keep the code, move it out of the main navigation (More/Settings), do not spend new effort on it.
>
> **New/changed pages (v1 navigation):** Today, **Tasks** (new), Calendar, Alarms, **Garmin** (replaces Insights), Quests, Settings. Details in section 3A.

Lead = the Claude session that started you. Agents: `builder-research`, `builder-backend`, `builder-frontend`, `builder-qa`. Talk to each other with SendMessage (by agent name). Report to the lead.
Project folder: the folder this file lives in (its own git repo; nothing in the parent folder is part of this project; **do not touch the parent folder**). The lead gave every agent the absolute path in its prompt; do not write absolute paths or OS user names into any file in this repo.

## 1. Goal
A fun, installable web app that keeps your tasks, alarms and calendar in one place and also tracks Garmin numbers. It should make a 23-year-old want to come back to it, work on computer and phone, be hosted free on GitHub Pages and be added to an iPhone home screen. The repository must contain no private data; the repo is made public only after a privacy check.

## 2. Hard constraints (do not break)
1. **Static site, no server.** Plain HTML/CSS/JS (ES modules). No build step unless the lead approves. Hosted on GitHub Pages from the `main` branch root, under a sub-path (`https://<user>.github.io/<repo>/`), so **every URL in the code is relative**, never starts with `/`.
2. **Installable PWA that works on iPhone Safari "Add to Home Screen" and on desktop** (manifest, icons incl. 180x180 apple-touch-icon, `apple-mobile-web-app-*` meta, safe-area insets, service worker for offline, no pull-to-refresh/zoom glitches). Test at 375 px and desktop widths.
3. **The repo contains zero private data.** All of the user's data lives only in their own browser (IndexedDB/localStorage) on their own device. No analytics, no trackers, no third-party requests that carry user data, no accounts, no API keys, no credentials. Fixtures and demo data are obviously fake. First-run shows a **demo mode** with sample data so the app is fun to look at before any import.
4. **Honesty about Garmin.** Never fake "live Garmin sync" if it is not possible. Do not use Garmin's name, logo or trademarks as the app's name/branding; the about page says "unofficial, not affiliated with Garmin". Don't copy other apps' code, text, art or branding.
5. **User can back up and restore** everything (export/import one JSON file, done locally) and delete everything (with confirmation).
6. Accessibility basics: contrast, focus states, labelled icon buttons, `prefers-reduced-motion`, dark and light themes.

## 3. What the app is (starting point; research and front-end may refine)
Pages (each tracks a different thing): **Today** (home: what's next, streak, daily quest), **Calendar** (events), **Alarms** (the watch's alarms: view/plan/check-in), **Messages** (notifications/messages log), **Quests** (streaks, XP, levels, badges, challenges), **Insights** (stats, weekly recap, trends), **Settings & Data** (import/export, themes, privacy, install help).
Retention ideas to evaluate (research ranks by payoff vs. effort): streaks, XP/levels, daily quests, badges/trophies, weekly "wrapped" recap, playful microcopy and motion, themes/accent colours, goals, home-screen widget-like cards, shareable recap images (local only), surprise rewards, "on this day".

## 3A. Scope v2 (current): tasks + alarms + calendar + Garmin
**Tasks (new, core).** Add/edit/complete/delete; title, optional notes, due date and optional time, priority (none/low/med/high), list or tag, repeat (daily, weekdays, weekly, monthly, custom days), optional subtasks. **Fast quick-add** with light natural-language parsing in plain JS (e.g. "call mum tomorrow 5pm !high #home"; show what it understood before saving). Smart views: Overdue, Today, Upcoming, Someday, Done. Touch: swipe or tap to complete with an undo toast; mouse: keyboard shortcuts (N new, arrows, Enter). Completing a task earns XP and counts for the streak (new `game.award` type `task`, ledger id `task:<id>:<date>` so repeats are idempotent). New data kind `task` (backend defines the shape; recurring tasks complete per occurrence).
**Calendar (core).** Month, week and agenda views showing **events + tasks with due dates + alarms** together, colour-coded and filterable; tap a day to add a task, event or alarm; today marker; week start setting; jump-to-date. Events come from .ics file import (Apple/Google Calendar, Garmin Connect calendar export if it works) and manual entry.
**Alarms (core).** List/add/edit/enable-disable; label, time, weekdays; "next alarm in 6 h 20 min" countdown; wake-up check-in (mood) and a wake-up streak. Honest limits stay: a web app cannot ring or buzz when closed and cannot program the watch. **Make it real with the calendar bridge** (research to confirm what works): "Add to my Calendar" exports alarms and task reminders as an .ics file with alert components (VALARM), shared via the iOS share sheet or a file, so Apple/Google Calendar fire real notifications on the phone and, through the phone, the watch. While the app is open in the foreground it may show an in-app alert when an alarm or due time arrives, labelled as such. Never say "this will wake you up" unless the user has completed the calendar export.
**Garmin (first-class page; replaces Insights).** Honest, no live sync. Sources: Garmin "Export Your Data" zip imported locally (parser exists in `js/data/garmin-export.js`, tolerant), daily numbers entered by hand, watch alarms mirrored by hand, calendar via .ics. Show: steps, sleep, resting heart rate, HRV, stress, Body Battery, active minutes and recent activities where the data has them; 7/30/90-day trends, personal bests, goal rings, "last imported N days ago" with a friendly re-import nudge, per-metric empty states that explain how to get the data. Link Garmin numbers to the fun layer (step-goal streak, sleep consistency quest). Do not use Garmin logos; say "unofficial".
**Today (home).** One screen answering "what's next": next alarm, overdue + today's tasks (complete in place), next calendar events, today's quest, streak, a Garmin snapshot if data exists. First 60 seconds must feel good in demo mode.
**Fun layer.** As researched in docs/research/04: forgiving streak (any task done, check-in, or Garmin goal counts), 3 daily quests (now task-flavoured), weekly "Week Wrapped" recap (tasks done, best day, sleep/steps highlights), badges, themes, delightful microcopy. Not cringe, no guilt copy.
**Not in v1:** accounts, sync between devices, live Garmin data, push, sharing/collab, widgets.

## 4. Open research questions (research answers FIRST, tell lead + devs immediately)
**Round 3 (current, for scope v2) — answer these first:**
- R1 **Real-alert bridge.** Does an .ics with VALARM imported into Apple Calendar (iOS) keep its alerts? How does a web app hand the file to Calendar on iPhone (share sheet, tap-to-open `.ics` download, `text/calendar` MIME, `webcal:`), from a home-screen app and from Safari? What about Google Calendar (the "add event" URL template, .ics import)? Do Garmin watches buzz or show alerts for phone calendar events (Garmin Connect "Calendar" access, Smart Notifications for the Calendar app)? Recurring alarms as RRULE events with alerts: what works? Give the user a recipe that really works, with sources and caveats.
- R2 **Task/calendar/alarm app patterns.** Todoist, TickTick, Things, Apple Reminders, Microsoft To Do, Structured, Tiimo, Fantastical, Google Calendar, Alarmy, Sleep Cycle, Garmin Connect: quick-add/natural-language parsing, recurring-task semantics, swipe gestures, calendar views on a phone, overdue handling, what 18-28 year olds love, complaints, what makes people open it daily. Ranked ideas, effort vs payoff, for a static PWA.
- R3 **Garmin tracking page.** From the Export Your Data zip, which metrics are actually present and useful (steps, sleep stages and scores, resting HR, HRV, stress, Body Battery, activities, VO2 max, training status), how big, how fast to parse; what Garmin Connect already shows (so we add something different: streaks, trends, goals, weekly recap). Any newer export or "Personal API" change that matters.
- R4 **What to retire.** Given the pivot, is anything already built (Pings/messages, quests wording) worth keeping in v1 navigation? Recommend.

**Round 1 (done, see docs/research/01-05).**
Starting hypotheses to **confirm or kill with sources**:
- H1: Garmin's official APIs (Garmin Connect Developer Program: Health/Activity/etc.) are partner/business-only and server-side, so a static personal site cannot use them. Unofficial login-based libraries need the user's password on a server and risk the account; **we do not do that**.
- H2: Calendar events reach the watch from the phone's calendar app via Garmin Connect; the realistic route is **importing an .ics file or calendar feed** and/or manual entry. What does Garmin Connect's own calendar actually contain?
- H3: Watch **alarms** are set on the watch or in Garmin Connect (device settings) and are not exposed by any API. Realistic route: user mirrors them in the app (quick presets), plus fun wake-up check-ins/streaks.
- H4: **Messages** are phone notifications mirrored to the watch and are not stored anywhere reachable. Options: manual quick-capture, paste, **iOS Shortcuts opening the app with text in the URL fragment** (stays on-device), share sheet. What really works on iOS home-screen web apps?
- H5: Garmin's **"Export Your Data"** account download (zip of JSON/CSV/FIT) can be parsed **in the browser, locally** (file never uploaded) to power Insights (sleep, steps, activities, alarms/settings if present). What is in it, what format, how big?
- H6: iOS home-screen web app limits: push notifications (need a push server; iOS 16.4+), badges, background sync, storage eviction, `Add to Home Screen` quirks, file import, Web Share Target. What can a static site not do? How should the app reset expectations (no true alarms in a web app)?
- H7: GitHub Pages: free hosting requires a **public** repo on a free account (private Pages = paid plans); limits, HTTPS, custom 404, cache behaviour for service workers; how to keep user data out of the public repo.
- Then: top competitor/companion apps (App Store, Google Play: Garmin Connect, Garmin Messenger, Garmin Explore, Gadgetbridge, Strava, Streaks, Habitica, Finch, Duolingo, Apple Fitness, BeReal-era design trends), what 18-28 year olds like and complain about, retention mechanics, design patterns, names for the app (not using "Garmin").

Research output: `docs/research/NN-topic.md` + index `docs/research/README.md`; each file starts with "what this means for us".

## 5. File ownership (edit only your own files; ask the owner otherwise)
| Owner | Files |
|---|---|
| builder-frontend | `index.html`, `css/**`, `js/ui/**`, `js/pages/**`, `js/app.js`, `assets/**`, `icons/**`, `manifest.webmanifest` |
| builder-backend | `sw.js`, `js/data/**` (storage, models, import/export parsers, quest/XP rules engine), `tests/**`, `scripts/**` (local static server on a temp port, icon/asset generation helpers, privacy scan), `.nojekyll`, `404.html` |
| builder-qa | `qa/**` (test notes, scripts) only. No product code |
| builder-research | `docs/research/**` only. No product code |
| lead | `docs/TEAM_BRIEF.md` structure, `README.md`, `.gitignore`, git, GitHub (repo, Pages, publishing). **Agents never run `git push` or touch GitHub settings** |
Agents may append to the "Contract" and "Decisions" sections below; keep them current and short.

## 6. Contract (backend writes this BEFORE frontend builds on it; keep updated)
Status: **v1, 2026-11-25, owner builder-backend.** The UI imports ONLY `js/data/index.js` (from `js/app.js`: `./data/index.js`; from `js/pages/*.js`: `../data/index.js`). Everything is an ES module, no dependencies, no `eval`, no network access (CSP `connect-src 'self'` is enough). Anything not listed here is private and may change.

```js
import { store, game, demo, backup, ics, capture, dates, sw, DataError, KINDS, LIMITS } from '../data/index.js';
```

### 6.1 Start-up and first run
```js
const info = await store.init();   // call once, before rendering; never throws for storage problems
// info = { backend:'indexeddb'|'localstorage'|'memory', persistent:boolean, degraded:boolean,
//          readOnly:boolean, firstRun:boolean, schemaVersion:number, migratedFrom:number|null, warnings:string[] }
```
- `info.degraded === true` means data will NOT survive closing the app (private mode, blocked storage, quota). The UI must say so plainly (use `info.warnings[0]` text) and offer "Export backup". It must never silently pretend data is saved.
- `info.readOnly === true`: stored data was written by a NEWER app version; every write throws `DataError('read_only')`. Show "Update the app" (the SW flow does this).
- `info.firstRun === true` on the very first launch of an empty store: the UI then calls `await demo.load()` (sample data) and shows the demo banner.
- `await store.requestPersistence()` -> boolean (`navigator.storage.persist()`); `await store.estimate()` -> `{usage, quota}|null`.
- After `store.wipeAll()` the app is EMPTY (not demo): `settings.initialized` stays true and `demoMode` false, so a reload does not refill it. `demo.load()` can be called again by a button.

### 6.2 Store (reads are synchronous from an in-memory snapshot; writes are async and durable BEFORE they resolve)
| Call | Returns | Notes |
|---|---|---|
| `store.list(kind, opts?)` | frozen record array | opts `{from,to,where,sort,desc,limit}`. `from`/`to` = ISO instant, `Date`, or day key `'YYYY-MM-DD'` (local day; `to` exclusive). Range works on `event` (overlap), `message`/`checkin`/`action` (`at`), `daily` (`date`). Default sort: event `start` asc, alarm `time` asc, message/checkin/action `at` desc, daily `date` asc |
| `store.get(kind, id)` | record or `undefined` | |
| `await store.put(kind, obj)` | saved record | upsert; no `id` -> generated; unknown fields dropped; `createdAt` kept, `updatedAt` set. Throws `DataError('invalid', details:[{field,message}])` |
| `await store.update(kind, id, patch)` | saved record | shallow merge; `not_found` if missing |
| `await store.remove(kind, id)` | boolean | true if it existed |
| `await store.putMany(kind, objs)` / `removeMany(kind, ids)` | arrays | ONE transaction: all or nothing |
| `await store.batch([{op:'put',kind,record},{op:'remove',kind,id}])` | `{put,removed}` | one transaction across kinds |
| `store.count(kind)`, `store.counts()` | number / `{kind:n}` | |
| `store.hasUserData()`, `store.isEmpty()` | boolean | `hasUserData` ignores `source:'demo'` records |
| `store.newId(kind)` | string | |
| `store.settings.get(key, fallback?)`, `await store.settings.set(key, value)`, `store.settings.all()` | | see 6.4 |
| `await store.wipeAll({confirmed:true})` | void | deletes records, settings, safety snapshots, theme mirror keys. Without `confirmed:true` throws `not_confirmed`. The UI owns the confirmation dialog |
| `store.onChange(cb)` | `unsubscribe()` | see below |

Records are **frozen**: copy before editing (`{...rec, title:'x'}`), then `put`. Every record has `id`, `createdAt`, `updatedAt` (ISO instants) and `source` (`'user'|'demo'|'import'`). All text fields are plain text: render with `textContent`, never `innerHTML`. Control characters, bidi-override characters and lone surrogates are stripped on write; single-line fields have newlines collapsed.

**Change notification:** `store.onChange(ev => ...)`, `ev = { reason:'put'|'remove'|'bulk'|'wipe'|'import'|'demo'|'settings'|'stale', kinds:string[], origin:'local'|'remote' }`. Fired after the write is durable, once per operation (a batch = one event). `origin:'remote'` = another tab/PWA window changed the data (BroadcastChannel); the snapshot is already refreshed when you get it. `reason:'stale'` = another tab upgraded the database; ask the user to reload. Callbacks that throw are logged and ignored. Re-render the pages whose kind is in `ev.kinds`; `kinds:['*']` means everything.

### 6.3 Entities (kinds: `event`, `alarm`, `message`, `checkin`, `daily`, `action`)
**TIME MODEL (answers QA 1):** timed values are UTC instants (`'2026-11-25T14:30:00.000Z'`); all-day values are date-only strings; alarms are wall-clock `HH:MM` + weekdays resolved in the DEVICE time zone at the moment of use; "today" = device-local day key `'YYYY-MM-DD'` (`dates.todayKey(now)`). ICS floating times are interpreted in the device zone at import; ICS `TZID` times are converted with `Intl` (no tz database shipped).
| Kind | Fields (R = required) |
|---|---|
| `event` | `title` R 1-200; `allDay` bool; `start` R, `end` (default = start): timed -> ISO instant (end exclusive); allDay -> `'YYYY-MM-DD'` and `end` is the LAST day (inclusive; one-day event has start === end); `location` <=200; `notes` <=2000; `uid` <=200 (ICS UID, used to de-duplicate re-imports). One record = one occurrence (ICS repeats are expanded at import) |
| `alarm` | `time` R `'HH:MM'` 24h; `days` int[] 0-6 (0 = Sunday), `[]` = once; `enabled` bool (default true); `label` <=60; `note` <=200. This mirrors the watch; the app cannot ring or program the watch |
| `message` | `text` R 1-4000; `from` <=80; `at` ISO instant (default now); `via` `'manual'|'paste'|'shortcut'|'import'`; `pinned` bool; `tags` string[] (<=5, each <=24) |
| `checkin` | `day` R `'YYYY-MM-DD'`; `at` ISO instant; `alarmId` (id or `''`); `mood` 0-5 (0 = none); `note` <=200. A wake-up check-in |
| `daily` | `id` = `date` = `'YYYY-MM-DD'`; `steps`, `sleepMinutes`, `restingHr`, `activeMinutes`: non-negative int or `null` (unknown); `note` <=200. One row per day; filled by manual entry or a future importer (provisional field list) |
| `action` | XP ledger row, written by `game.award()`; the UI normally does not write it. `type`, `day`, `at`, `xp` int >= 0, `ref` |

Idempotency (answers QA 7): a ledger row id is `type:ref` (or `visit:<day>`, `quest:<day>:<questId>`, `weekly:<weekKey>`, `badge:<badgeId>`, `recap:<weekKey>`), so awarding twice for the same ref/day is a no-op.

### 6.4 Settings (`store.settings`)
Allowed keys (anything else -> `invalid`), also included in backups: `theme` `'system'|'light'|'dark'`, `accent` string <=24 (UI palette id), `name` <=40 (nickname, private), `weekStart` 0|1|6, `timeFormat` `'auto'|'12h'|'24h'`, `reduceMotion` `'system'|'on'|'off'`, `demoMode` bool, `initialized` bool, `onboardingDone` bool, `installHintDismissed` bool, `lastBackupAt` ISO|`''`, plus free UI keys named `ui_<name>` (value string <=200, number or boolean). `theme` and `accent` are mirrored to `localStorage` keys `app.theme` / `app.accent` for the flash-free boot script (the data layer writes them; the boot script only reads).

### 6.5 Game / rules engine (pure maths + one write path)
```js
const s = game.snapshot({ now? });  // sync
// s = { today, xp, level, levelProgress(0..1), xpIntoLevel, xpForNext,
//       streak:{current,best,activeToday,atRisk,lastDay},
//       quests:[{id,title,desc,icon,xp,goal,progress,done}],      // 3 daily quests, same for the same day
//       weekly:{id,title,desc,icon,xp,goal,progress,done,weekKey},
//       badges:[{id,title,desc,icon,earned,earnedAt|null}],        // all badges, locked ones included
//       totals:{checkin,message,event,alarm,quest,badge} }
const r = await game.award(type, { ref, now?, at? });
// r = { action|null, xpGained, level, leveledUp, streak, questsCompleted:[quest], badgesEarned:[badge], weeklyCompleted:bool, capped:boolean }
```
`type` is one of `game.TYPES` = `visit` (call once when the app opens; 5 XP, counts for the streak), `checkin`, `message`, `event`, `alarm`, `import`, `recap` (viewing the weekly recap). **`ref` = the id of the record just saved** (required for all but `visit`/`recap`). Call `award` AFTER the `put` succeeded and show the toast/confetti from the returned object. One call = one transaction (action + quest + badge rows together), so XP can never be half-written. Streak: a day counts when it has any ledger row of a streak type (all types above); `atRisk` = yesterday active, today not yet. Level n needs `50*n*(n-1)` total XP (L2 = 100, L3 = 300). `game.catalog()` lists all badge/quest definitions (static). Pure core for tests: `game.compute(actions, {today, weekStart})`. All functions take an injectable `now` (Date | ISO | ms).

### 6.6 Demo data
`await demo.load({ now?, seed? })` replaces any earlier demo data with obviously fake sample data around `now` (events in the past and next 2 weeks, alarms, messages from "Sample Sam" etc., check-ins, 60 days of daily numbers, a 6-day streak at level 3), every row has `source:'demo'`, sets `demoMode` true. `await demo.clear()` removes ONLY `source:'demo'` rows and sets `demoMode` false; the user's own rows stay. `demo.isActive()` -> boolean. UI rule: while `demoMode` is true show a visible "Sample data" banner with "Clear sample data".

### 6.7 Backup, restore, wipe
```js
const obj  = backup.exportAll({ includeDemo?: true });   // plain object, pure (no side effects)
const text = backup.exportJSON(opts);                     // JSON string
const f    = await backup.exportFile(opts);               // { filename, blob, text, bytes }; also sets settings.lastBackupAt
const rep  = await backup.importAll(textOrObject, { mode:'merge'|'replace', dryRun?:boolean, strict?:boolean });
// rep = { ok, mode, dryRun, backupVersion, exportedAt, added, updated, skipped, counts:{kind:{added,updated,skipped}},
//         errors:[{kind,index,id,message}] (max 100, then errorsTruncated:true), settingsApplied:boolean, undoAvailable:boolean }
backup.canUndo() -> {takenAt,label}|null;  await backup.undoLastImport();   // restores the snapshot taken just before the last real import
```
File format (version field = `version`, currently **1**):
`{ "format":"watch-companion-backup", "version":1, "exportedAt":ISO, "counts":{kind:n}, "settings":{...}, "data":{ "event":[...], "alarm":[...], "message":[...], "checkin":[...], "daily":[...], "action":[...] } }`.
It carries everything (records, settings incl. theme and demo flag, the whole XP ledger, so streaks/badges/quests/levels are reproduced exactly): wipe -> import -> export is a lossless round trip apart from `exportedAt`.
Import rules (answers QA 4): the file is parsed and EVERY record validated first (whitelisted fields only, so `__proto__`/`constructor`/unknown keys are dropped); invalid records are skipped and listed in `errors` (with `strict:true` ANY invalid record aborts with `invalid` and nothing is written); valid records are then applied in ONE transaction after a safety snapshot. `merge`: same id -> the record with the newer `updatedAt` wins (tie: existing stays), device settings are kept, backup settings fill only keys that are unset. `replace`: everything is replaced including settings. Use `dryRun:true` first to show the user the counts. Limits: file <= 25 MB, <= 100,000 records per kind; bigger -> `DataError('too_large')`. Not JSON / wrong `format` -> `bad_format`; `version` newer than the app -> `unsupported_version`; older versions are migrated.

### 6.8 Importers (parse locally; they RETURN drafts and never write; the UI previews then `store.putMany`)
```js
const res = ics.parse(text, { now?, windowDays?:{before:90, after:365} });
// res = { events:[event drafts, ready for store.putMany('event', ...)], errors:[{index,message}], skipped:number, truncated:boolean, stats:{components,expanded} }
const sel = await ics.importFile(file)   // File/Blob -> same shape, enforces the size limit
```
ICS limits: <= 5 MB, <= 20,000 components, <= 5,000 events out, RRULE expansion inside the window and <= 520 occurrences per series with a hard iteration cap (COUNT=999999 or no UNTIL cannot hang), bad components land in `errors[]` and the rest continues. Handles BOM, CRLF/LF, line folding, `VALUE=DATE`, `TZID`, `Z`, floating, `EXDATE`, `DTEND < DTSTART` (-> end = start). Re-import is de-duplicated through `uid` + start (`store.putMany` upserts with a stable id `ics:<hash>`), so importing the same file twice adds nothing.
`capture.fromText(text, {at?})` -> `{drafts:[message drafts], truncated}` (paste box: blank-line separated blocks, optional `Name: text` prefix, <= 100 drafts). `capture.fromQuery(searchString)` -> same shape for hash routes like `#/messages?text=Hello&from=Sam&at=2026-11-25T10:00:00Z` (`text`, `from`, `at`; plain text only). **A URL is hostile input**: the UI must show the draft and ask "Add this message?" before saving, then strip the fragment with `history.replaceState`. Garmin "Export Your Data" parsing is NOT built yet: it waits for research.

### 6.9 Dates and service worker
`dates.todayKey(now?)`, `dates.dayKey(dateOrIso, tz?)`, `dates.parseDayKey(key)` (local midnight Date), `dates.addDays(key, n)`, `dates.weekStart(key, weekStartsOn=1)`, `dates.eventSpan(event)` -> `{startMs,endMs}`, `dates.nextAlarm(alarm, now?, tz?)` -> `Date|null`. DST rule for alarms: a wall time that does not exist (02:30 on spring-forward) fires at the first valid moment after the gap (03:30); an ambiguous wall time (01:30 on fall-back) fires on its FIRST occurrence. This is the app's own model, not a claim about what the watch does.
`sw` (js/data/sw-client.js): `sw.register({ onUpdateReady(applyFn), onOfflineReady(), onError(err) })` -> `Promise<{status, applyUpdate(), checkNow()}>`; call it after `load`; it registers `./sw.js` with scope `./`, never throws, and `applyUpdate()` (user clicked "Reload for the new version") sends `SKIP_WAITING` and reloads exactly once on `controllerchange`. `await sw.version()` -> build id string for the About page.
`sw.js` precaches the list in the GENERATED `sw-manifest.js` (made by `node scripts/build-sw-manifest.mjs`: all of `index.html`, `manifest.webmanifest`, root `favicon.*`, `css/**`, `js/**`, `icons/**` images, `assets/**`); the frontend does not maintain a list, the lead runs the generator before every publish and `node --test` fails if it is stale. The cache is named by content hash, so every deploy that changes a file also changes the cache, and old caches are deleted on activate. Navigation requests are answered with the cached `index.html` shell when offline. Nothing user-specific ever enters CacheStorage: the SW only caches its own precache list and never handles non-GET or cross-origin requests.

### 6.10 Errors
All data-layer failures are `DataError` (`err.code`, `err.message` plain English, `err.details`). Codes: `invalid`, `not_found`, `not_confirmed`, `not_initialized`, `read_only`, `quota_exceeded`, `storage_failed`, `too_large`, `bad_format`, `unsupported_version`, `parse_error`. UI pattern: `try { await store.put(...) } catch (e) { toast(e.message) }`.

### 6.11 Tools (commands)
- Dev server: `node scripts/dev-server.mjs [--base /repo/] [--port N] [--host 127.0.0.1] [--ttl SECONDS]`; no port given or `PORT=0` = random free port; prints `LISTENING http://127.0.0.1:PORT/<base>` on its first stdout line; `Cache-Control: no-store`; Host header checked; `--base /repo/` serves the site under a sub-path like GitHub Pages (404 outside it).
- Tests: `node scripts/run-tests.mjs` (runs `node --test tests/` under several time zones) or plain `node --test tests/`.
- Privacy scan: `node scripts/privacy-scan.mjs [--git] [--strict] [--json]`; exit 1 on findings.
- SW manifest: `node scripts/build-sw-manifest.mjs` (`--check` only verifies).

## 7. Phases
**Scope v2 plan (current).** A. Research round 3 (R1-R4), feasibility of the calendar bridge first. B. Backend: `task` kind + recurrence rules + `game` task awards + ICS export with alerts (`ics.build(...)` returning a file) + Garmin-export importer finished and tested against synthetic fixtures; update section 6 BEFORE the UI builds on it. C. Frontend: Tasks page and quick-add, Calendar showing events + tasks + alarms (month/week/agenda), Alarms upgrade with "Add to Calendar", Garmin page, Today rebuilt around "what's next", nav changed, Pings moved out of the main nav. D. QA after each piece; final full pass; lead runs the privacy scan, makes the first commit, and publishes only if clean.
Original phases (for reference):
0. **Original phase 0:** research does feasibility H1-H7 and reports early. Backend: static dev server on a temp port, PWA/SW skeleton, storage layer, demo data, tests. Frontend: app shell (nav that works as bottom tab bar on phone and sidebar on desktop), design tokens, theme, install/manifest/icons. QA: test plan, install-ability checklist. **Do not build Garmin-specific features until research reports.**
1. Pages and importers built to what research confirms. Fun layer: streaks, XP, quests, badges, recap, microcopy, animations.
2. QA full pass (iPhone-size viewport, desktop, offline, install, data export/import, wipe, fresh load console clean), privacy scan of every file.
3. Lead audits and publishes.

## 8. Testing rules
Use a **temporary port and temporary data**; never the user's real browser data. Service workers need `localhost` or HTTPS. Clean up every process and temp folder you start. Node 25 and Python 3 are installed; prefer `node --test` for tests. No new dependencies without telling the lead.

## 9. Decisions log (append; newest last)
- 2026-11-25 lead: static PWA, data stays on-device, GitHub Pages from `main` root, repo private until audited. App name TBD (research + frontend propose 3 options; must not contain "Garmin"). Git commits use the GitHub noreply address.
- 2026-11-25 lead (research round 2 accepted; see docs/research/README.md, files 02-05): **App name: Daybeat** (repo `daybeat`; backups Dayhop, Wristly). Look: "pocket scoreboard" per docs/research/05, system fonts only (no third-party requests), contrast-checked accent themes. v1 retention must-haves: forgiving day streak (one tiny action counts, 1 rest day a week plus 2 freezes, kind copy, milestones 3/7/14/30/50/100/365), daily quest of 3 sub-minute tasks, weekly "Week Wrapped" recap with a local share image, themes. Page label "Messages" becomes **"Pings"** (subtitle: your messages), because Garmin Messenger is a different app. Safari tab and installed iPhone app do NOT share storage: install help says "install first, then add your data". No Shortcut-by-URL capture feature (if the page opens with `#add=` in a plain Safari tab, show "copy this, paste it in the installed app" and store nothing); Messages/Pings = quick add + "Paste from clipboard". Use hash routing, relative URLs, a VERSION constant in sw.js and an "update ready" toast. No live sync, push, scheduled notifications, widgets or leaderboards promised anywhere; About page and UI copy say so. Export-zip parser must be tolerant (layout is community-documented only: DI_CONNECT/DI-Connect-Fitness, -Wellness, -Aggregator), with a JS inflate fallback because DecompressionStream is buggy on older iOS. Agents: send messages with raw agent ids (names do not resolve in this session).
- 2026-11-25 research (accepted by lead; see docs/research/01-feasibility.md): no live Garmin sync is possible for a static site (no API for calendar, alarms or messages; Garmin's new Personal API is read-only for health stats, blocks browser calls via CORS and needs a secret key, so do NOT build on it; no unofficial login libraries). The app is an honest companion fed by: local import of Garmin's "Export Your Data" zip (parsed in the browser, tolerant parser, never uploaded), .ics FILE import from Apple/Google Calendar (no live feed URLs), and manual entry. Alarms are mirrored by hand. Messages are captured by hand (quick-capture, paste, or text in the URL fragment from an iOS Shortcut; still being verified). No push or local-notification promises (iPhone web apps cannot do them without a server). Backups: navigator.share({files}) plus copy-to-clipboard fallback, because blob downloads from a standalone iPhone web app are fragile; remind users to back up now and then. GitHub: free Pages requires a public repo; bump a VERSION in sw.js each deploy and show an "update ready" toast (Pages caches for about 10 minutes).
- 2026-11-25 frontend: **UI conventions** (all in js/ui, js/pages): pages are `export function mount(root, ctx)` and get the data layer as `ctx.data` (no page imports js/data itself); route ids stay `today|calendar|alarms|messages|quests|insights|settings` but 'messages' is labelled **Pings**. All DOM is built with `h()` (js/ui/dom.js): strings are text nodes, no `html` option, string `on*`/`style`/`srcdoc` ignored, URL attributes filtered; the only `innerHTML` is the constant SVG icon markup. Meta CSP in index.html (`default-src 'self'`, `connect-src 'self'`, no inline scripts: the pre-paint theme script is js/ui/boot.js). Hash routing; plain `#anchors` are ignored by the router (skip link). Look: 'pocket scoreboard' tokens in css/tokens.css (dark = ink + accent, light = cream paper + 2px ink outlines + hard shadows); accents volt (default), bubblegum, sky, sunset, grape, mint (ink-on-fill and accent-as-text contrast checked). iOS status bar style `default` (readable in both themes; `black-translucent` would force white text on the light theme). URL text (`#add=` / `?text=`) is shown, never saved (copy only; 'Use in quick add' only outside an iPhone browser tab). Backup on iOS: `navigator.share({files})`, then Download / Copy backup text / read-only textarea. Delete everything needs typing DELETE. Developer switch: `localStorage.app.nosw = '1'` skips service-worker registration while editing.
