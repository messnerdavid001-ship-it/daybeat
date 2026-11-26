# Research index (builder-research)

Last updated 2026-11-25. Each file starts with "what this means for us". Labels: **confirmed** = primary source or something I observed myself; **likely** = several secondary sources agree; **unverified** = single weak source or my own knowledge, test it.

| File | What it answers | Read it if you are |
|---|---|---|
| [01-feasibility.md](01-feasibility.md) | H1-H7: what a static site can legitimately get from Garmin (nothing live), Garmin Personal API (CORS-blocked), Export Your Data zip layout, .ics, alarms, messages, iOS home-screen limits, GitHub Pages limits and observed headers | everyone, first |
| [02-ios-pwa-quirks.md](02-ios-pwa-quirks.md) | Install steps (iOS 26), separate storage, backup export, safe area, status bar, icon, viewport units, input zoom, notifications/badges, test checklist | frontend, backend, QA |
| [03-competitors-and-complaints.md](03-competitors-and-complaints.md) | Garmin Connect, Garmin Messenger, Gadgetbridge, Streaks, Duolingo, Finch, Habitica, Strava, Apple rings: what people love, what they complain about, the gap we fill | lead, frontend |
| [04-retention-mechanics.md](04-retention-mechanics.md) | Ranked retention ideas (payoff vs effort), top 3 for v1, first 60 seconds, cringe list, microcopy tone | frontend, QA |
| [05-design-direction-and-names.md](05-design-direction-and-names.md) | Name checks (Daybeat recommended), visual direction, colour tokens with computed contrast, page ideas | frontend, lead |

## Decisions that depend on research (proposed for the brief's decisions log)
- No live Garmin sync is possible; app is an honest companion fed by local export-zip import, `.ics` file import and manual entry.
- Alarms are a hand-entered mirror; messages are a hand-captured "Pings" log; no promise of buzzing, push or scheduled notifications.
- The Safari tab and the installed iPhone app do not share data: install first, then add data (or export in Safari, import in the app).
- Backups go through the share sheet (`navigator.share` with files) with clipboard fallback; blob downloads are unreliable in installed iOS apps.
- Hash routing, relative URLs, `sw.js` version constant, update toast (GitHub Pages sends `max-age=600`).
- Name: Daybeat (backups Dayhop, Wristly). Do not use Tempo, Orbit or Cadence.
- v1 retention must-haves: forgiving streak, daily 3-task quest, weekly recap card; plus themes.

## Still unknown (needs a real iPhone or a real Garmin file)
- Exact field names and timestamp semantics in the Garmin export zip (no official schema; community only).
- Whether `navigator.share({files})` offers Calendar for an `.ics` file and Files for JSON on the current iOS.
- Whether Safari honours `max-age=600` for `sw.js` updates, and update behaviour in a home-screen app.
- Whether the Garmin Personal API ever allows browser calls (one probe returned 403 without CORS headers).
