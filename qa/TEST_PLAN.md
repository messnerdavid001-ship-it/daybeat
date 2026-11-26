# QA TEST PLAN (owner: builder-qa)

Checked against the user's original request (brief section 1) and hard constraints (brief section 2), not only the developers' plans.

> "An app that tracks my Garmin calendar, alarms and messages. Fun, so a 23-year-old comes back to it. Different pages that track different things. Use it as an app on computer and phone. A website I can bookmark to my Apple phone's home screen. Host on GitHub; public only if it works without private info in public."

Severity scale: **BLOCKER** (stops the user / breaks a hard constraint), **MAJOR** (annoying, clearly wrong, or a missed requirement), **MINOR** (rough edge), **COSMETIC**.
Status column legend: `todo`, `PASS`, `FAIL (id)`, `n/a`, `cannot-test` (needs real hardware).

Test environment rules: temporary port, temporary data only, never the user's real browser profile or data, clean up every process and temp folder. Tools in `qa/tools/`:

| Tool | What it does |
|---|---|
| `qa/tools/pages-sim.mjs` | Serves the project folder under a sub-path (default `/qa-sub/`) like GitHub Pages does (case-sensitive, 404 outside the sub-path, `404.html` for misses, `Cache-Control: max-age=600`, no `no-cache`). Used to prove "no absolute URLs" and "SW scope under a sub-path". |
| `qa/tools/check-static.mjs` | Static checks: manifest valid, icon files exist and have the declared PNG dimensions, apple-touch-icon is 180x180, meta tags, absolute URL scan, external request scan, trademark scan, script/inline-handler scan, SW precache list vs files on disk. |
| `qa/tools/check-privacy.mjs` | Independent privacy scan (own rules, in addition to backend's `scripts/privacy-scan.mjs`): emails, phones, GPS coordinates, home paths, API keys, tokens, real-looking names in fixtures, git author/email, `.git` config, EXIF in images. |
| `qa/tools/fixtures/` | Hostile-input files (malformed ICS, huge ICS, script-tag titles, emoji, bad JSON, wrong schema version, zip bomb stand-in). All fake. |

---

## A. Installability checklist (PWA / iPhone Home Screen / desktop)

| # | Check | How | Expect | Status |
|---|---|---|---|---|
| A1 | `manifest.webmanifest` is valid JSON, linked from `index.html` with a relative href | `check-static.mjs`; browser DevTools Application tab equivalent via `fetch` | name, short_name (<= 12 chars), display `standalone`, start_url and scope relative (`./`), background/theme colour, no leading `/` | todo |
| A2 | Manifest icons: 192 and 512 PNG present, correct pixel size, one `maskable` | `check-static.mjs` reads PNG IHDR | declared `sizes` equals real size; maskable has safe-zone padding (visual check) | todo |
| A3 | `apple-touch-icon` is 180x180 PNG, opaque (iOS fills transparency black), relative href | `check-static.mjs` | file exists, 180x180, no alpha or alpha fully opaque | todo |
| A4 | iOS meta tags | grep | `apple-mobile-web-app-capable=yes`, `apple-mobile-web-app-title`, `apple-mobile-web-app-status-bar-style`, `viewport` with `viewport-fit=cover`, `theme-color` (light and dark variants) | todo |
| A5 | Viewport does not disable zoom (`user-scalable=no`, `maximum-scale=1`) | grep | not disabled (accessibility); inputs use >= 16px font so iOS does not auto-zoom on focus | todo |
| A6 | Service worker registers with a relative URL and relative scope under `/qa-sub/` | pages-sim + browser: `navigator.serviceWorker.getRegistration()` | scope ends with `/qa-sub/`, state `activated` | todo |
| A7 | Offline works under the sub-path | pages-sim, load once, stop network (kill server), hard reload | app shell, all pages, CSS, JS modules, icons, fonts load from cache; no console errors | todo |
| A8 | SW update flow | change a file, bump cache version, reload twice | new version takes over without stale mix of old HTML and new JS; user is told or it updates safely | todo |
| A9 | Precache list matches reality | `check-static.mjs` compares SW asset list to files and to every `import`/`src`/`href` | no 404 during precache (a single 404 breaks `cache.addAll`), no file missing from list | todo |
| A10 | No absolute URLs anywhere | `check-static.mjs` regex for `href="/`, `src="/`, `url(/`, `fetch('/`, `import '/`, `new URL('/`, `location.href = '/`, `start_url`, `scope`, `sw.js` registration | none. Also run the site under two different sub-paths | todo |
| A11 | 404 page works under sub-path and links back relatively | open `/qa-sub/does-not-exist` | friendly page, link home works | todo |
| A12 | Hash / deep-link routing survives reload and offline | open `/qa-sub/#/alarms`, reload, go offline, reload | same page; back button works | todo |
| A13 | Standalone mode behaviour | `display-mode: standalone` media query emulation | status bar spacing right; no browser-only UI shown (e.g. "install" banner hidden when already installed) | todo / cannot-test on real iPhone |
| A14 | Install help in Settings is accurate for iOS Safari ("Share, Add to Home Screen") and desktop Chrome/Edge | read | steps correct, no claim that push or true alarms work | todo |
| A15 | `.nojekyll` present, nothing starts with `_` that Pages would drop, filenames case-consistent | ls / check-static | present; links match exact case (Pages is case-sensitive, macOS is not) | todo |

## B. Layout and responsive

| # | Check | Expect | Status |
|---|---|---|---|
| B1 | 375x812 (iPhone-size) every page | bottom tab bar, no horizontal scroll, content not hidden behind tab bar, tap targets >= 44px | todo |
| B2 | 320x568 (small) every page | no horizontal scroll, no clipped buttons or text, tab bar still usable (labels fit or icons labelled) | todo |
| B3 | 768, 1024, 1440 desktop widths | sidebar nav at desktop, content max-width sensible, no stretched cards | todo |
| B4 | Landscape phone 812x375 | nothing unusable, tab bar does not eat the screen | todo |
| B5 | Safe-area insets | `env(safe-area-inset-*)` used on tab bar, header and bottom; simulated by CSS variable override | todo / cannot-test on real notch |
| B6 | Text zoom 200% / browser zoom 200% | still readable, no overlap | todo |
| B7 | Overscroll / pull-to-refresh / rubber-banding | `overscroll-behavior` set sensibly, no accidental refresh while scrolling a list or dragging | todo / cannot-test on iOS |
| B8 | Long content | very long title (500 chars, no spaces) wraps or truncates without breaking layout, in every list and card | todo |
| B9 | 100 / 1000 / 5000 items | lists stay responsive, no layout jank, scrolling smooth | todo |

## C. Accessibility

| # | Check | Expect | Status |
|---|---|---|---|
| C1 | Keyboard only: Tab through every page | visible focus ring on every control, logical order, no traps (modals trap focus then restore it; Escape closes) | todo |
| C2 | Every icon-only button has an accessible name | `aria-label` or visible text | todo |
| C3 | Landmarks and headings | one `h1` per view, `nav`, `main`; the page title (`document.title`) changes per page | todo |
| C4 | Contrast, light and dark, including accent themes | text >= 4.5:1, large text/UI >= 3:1, measured by script | todo |
| C5 | `prefers-reduced-motion: reduce` | confetti, bounces, auto-animations off or minimal; nothing important lost | todo |
| C6 | `prefers-color-scheme` follows OS by default; manual override persists; no flash of wrong theme on load | todo |
| C7 | Colour is not the only signal (streak states, badges, errors, calendar categories) | todo |
| C8 | Screen reader basics: live region for toasts / XP gains, no `aria-hidden` on focusable things, forms have labels | todo |
| C9 | Touch: no hover-only functionality; long-press or swipe actions have a visible alternative | todo |

## D. Data states

| # | Check | Expect | Status |
|---|---|---|---|
| D1 | Clean first run (empty storage) | demo mode is on and obviously labelled as sample data; every page looks alive; the user is told how to add their own | todo |
| D2 | Leave demo, then empty state | each page has a friendly empty state with a clear first action (not a blank screen) | todo |
| D3 | Demo data to real data | importing or adding the first real item does not leave demo items mixed with real ones; or the mix is explicit and demo items can be cleared in one tap | todo |
| D4 | Imported state | ICS import shows counts (added / skipped / errors), duplicates not doubled on a second import of the same file | todo |
| D5 | Backup export, wipe, import round trip | export JSON -> "Delete everything" (with confirmation) -> storage empty -> import same JSON -> every entity, XP, streaks, badges, settings, theme identical (deep-compare before and after via script) | todo |
| D6 | Wipe confirmation | cannot be triggered by a single accidental tap or Enter; cancel leaves data intact; after wipe also clears SW caches of user data (there should be none) and localStorage keys | todo |
| D7 | Import of a backup from an older/newer schema version | clear message, no corruption, no partial import that leaves half the data | todo |
| D8 | Storage unavailable (private mode / quota full / IndexedDB blocked) | app still opens, tells the user plainly that data cannot be saved, does not silently lose data | todo |
| D9 | Two tabs open | edit in tab A shows in tab B (or at least no data loss / clobbering on write) | todo |
| D10 | Storage persistence request | `navigator.storage.persist()` is attempted or the Settings page explains eviction risk on iOS (7-day rule for non-installed sites) and nudges backup | todo |
| D11 | Backup reminder | the app nudges the user to export sometimes (data lives only in one browser) | todo |

## E. Hostile and odd input

| # | Check | Expect | Status |
|---|---|---|---|
| E1 | Script and HTML in every text field: `<script>alert(1)</script>`, `<img src=x onerror=alert(1)>`, `"><svg onload=...>`, `javascript:` links, in titles, notes, messages, alarm labels, ICS SUMMARY/DESCRIPTION/LOCATION, backup JSON, URL fragment from Shortcuts | rendered as inert text everywhere (no `innerHTML` with user data; check `grep innerHTML`); no alert, no console error | todo |
| E2 | Emoji, ZWJ sequences, RTL text, combining marks, 4-byte characters, null bytes, in all fields and in export/import round trip | preserved exactly, no mojibake, no split surrogate pairs in truncation | todo |
| E3 | Very long text (100k chars) in a field | accepted with limit and message, or truncated visibly; no freeze | todo |
| E4 | Huge ICS (50 MB, 100k events) | UI stays responsive (or shows progress / refuses with a clear size message), no crash, no storage blow-up | todo |
| E5 | Malformed ICS: missing END:VEVENT, bad dates, `DTSTART` without value, folded lines, CRLF vs LF, BOM, unknown TZID, RRULE with `COUNT=999999` or no end (infinite expansion), `EXDATE`, all-day events (`VALUE=DATE`), `DTEND` before `DTSTART` | no hang, no crash; bad events reported in `errors[]`, good ones imported; recurrence expansion is bounded | todo |
| E6 | Wrong file type chosen (PNG, PDF, zip renamed .ics, empty file, folder) | clear error, nothing imported | todo |
| E7 | Malformed JSON backup: truncated, wrong types (`"xp": "lots"`), negative XP, `__proto__` / `constructor` keys (prototype pollution), duplicate ids, missing required fields, extra unknown fields, 100 MB | rejected or sanitised, validation errors listed, existing data untouched on failure | todo |
| E8 | Garmin "Export Your Data" zip parse (if built): wrong zip, nested zip bomb, 2 GB file, missing expected files | parsed locally in browser (network log shows no upload), memory stays bounded, clear message | todo |
| E9 | Messages via URL fragment (iOS Shortcuts) with huge, malformed, or percent-encoded text | no execution, bounded size, fragment cleared from URL after capture so it does not stay in history | todo |
| E10 | Numbers: XP overflow (2^53), negative, NaN, level calc at boundaries | UI sane, no `NaN` or `Infinity` visible anywhere | todo |
| E11 | Dates: year 0001 / 9999, 29 Feb, events spanning midnight, year change | sane rendering, no `Invalid Date` visible | todo |

## F. Time zones, DST, and the calendar/alarm maths

Run with the browser time zone emulated (and `TZ=` for node tests): `America/New_York`, `Europe/London`, `Australia/Lord_Howe` (30 min DST), `Pacific/Auckland`, `Asia/Kolkata` (+5:30), `Pacific/Kiritimati` (+14), `America/Sao_Paulo`, UTC.

| # | Check | Expect | Status |
|---|---|---|---|
| F1 | Spring-forward day (e.g. 2027-03-14 NY): alarm at 02:30 (nonexistent time) | defined behaviour (next valid minute, or flagged), not a crash and not a skipped day | todo |
| F2 | Fall-back day (2026-11-01 NY): alarm at 01:30 (happens twice) | fires/counts once, "next alarm in X" is right | todo |
| F3 | "Next alarm in 7h 30m" across DST change | countdown uses real elapsed time, not wall-clock difference | todo |
| F4 | ICS event with `TZID=America/New_York` imported while browser is in Europe/London | shows at the correct local time; `DTSTART:...Z` (UTC) correct; floating times stay floating | todo |
| F5 | All-day event does not shift a day for users west or east of UTC | todo |
| F6 | Recurring weekly event across a DST change | stays at same wall-clock time | todo |
| F7 | User travels (browser TZ changes between sessions) | no corruption; streak day boundaries remain defined (see G) | todo |
| F8 | Day boundary: streak "today" at 23:59 -> 00:00; device clock set back/forward a day; month-end; 29 Feb; week start (Mon vs Sun) | streak rules deterministic, no double-credit, no accidental reset, week recap uses a consistent week start and the user's local calendar | todo |
| F9 | Tab left open overnight | Today page updates at midnight (timer or on `visibilitychange`), no stale "today" | todo |
| F10 | Browser clock wrong / set to the future (cheating XP) | no crash; acceptable if a manual-entry app is cheatable but streaks should not produce negative or absurd values | todo |

## G. Gamification correctness (streaks, XP, quests, badges)

| # | Check | Expect | Status |
|---|---|---|---|
| G1 | Every XP source is listed once and the numbers in UI equal the rules engine's numbers | rules documented in contract; unit tests exist | todo |
| G2 | Double-tap / rapid repeated taps on "check in", "complete quest", "claim" | XP awarded once (idempotent per day / per quest) | todo |
| G3 | Reload mid-action, close tab mid-write | no half-applied XP (xp changed but quest not marked done) | todo |
| G4 | Level-up crosses boundary exactly once, toast shown once, not again after reload | todo |
| G5 | Badge unlock conditions can really be reached and can't be unlocked by trivial exploits (edit-and-delete loop to farm XP) | todo |
| G6 | Streak freeze / grace rules (if any) are explained in the UI in plain words | todo |
| G7 | Deleting an item that awarded XP: defined behaviour (XP stays or goes; consistent) | todo |
| G8 | Daily quests regenerate per local day, are the same on reload the same day (seeded), differ across days | todo |
| G9 | Nothing guilt-tripping or dark-pattern: no "you lost your streak!" shame screens, streak loss handled kindly (research: check against retention findings) | todo |

## H. Honesty audit (brief constraint 4)

| # | Check | Expect | Status |
|---|---|---|---|
| H1 | App name, title, manifest, icons, header do not contain "Garmin", the delta logo, Garmin's blue/green palette copy, "Connect" branding | grep `-i garmin` across whole repo; every hit reviewed. Mentions only as factual descriptions ("works with calendar files from Garmin Connect") and in the "unofficial, not affiliated" notice | todo |
| H2 | About page says "unofficial, not affiliated with Garmin" and "Garmin" is a trademark of Garmin Ltd. | todo |
| H3 | Nothing implies live sync: no "Last synced", "Connected", "Syncing...", no spinners that fake sync, no demo data that looks like it came from a watch without a Demo label, no "Garmin Connected" badge | todo |
| H4 | Each feature matches builder-research's verdict (H1-H7 in brief section 4): features marked infeasible by research are not faked; features marked "manual" are labelled manual | todo |
| H5 | Alarms: UI never promises the web app will ring/vibrate the watch or wake the user; wording says "mirror of your watch alarms" or "reminder" accurately; if browser notifications are used, they say what really works on iOS | todo |
| H6 | Messages page: states that messages are captured by the user (paste, share, shortcut), not read from the watch | todo |
| H7 | Insights: clear which numbers come from user-imported files vs manual entries vs demo | todo |
| H8 | Third-party names (Strava, Duolingo, etc.) not used as branding; no copied text/art from other apps | todo |

## I. Privacy audit (brief constraint 3)

| # | Check | How | Expect | Status |
|---|---|---|---|---|
| I1 | No personal data in any tracked file | `check-privacy.mjs` and `scripts/privacy-scan.mjs` | no emails except the GitHub noreply, no phone numbers, no absolute home-folder paths of any OS, no real coordinates, no names | todo |
| I2 | Fixtures and demo data obviously fake | read them | names like "Sample Alex", dates clearly demo, example.com domains, 555 numbers, coordinates not a real home | todo |
| I3 | Git history and author clean | read-only `git log --format=...`, `git config user.email` | noreply email only, no commits containing a real name or `.env`; no deleted-then-committed secrets in history | todo |
| I4 | Network log: zero third-party requests | browser network log over a full tour of every page, fresh load and offline | only same-origin requests. No Google Fonts, CDN scripts, analytics, favicons from other hosts, no `navigator.sendBeacon` | todo |
| I5 | No analytics or tracking code | grep `gtag`, `analytics`, `pixel`, `sentry`, `fbq`, `plausible`, `umami`, `beacon` | none | todo |
| I6 | Storage inventory | list IndexedDB and localStorage keys after a session | only app data; nothing leaves the device | todo |
| I7 | Wipe really wipes | after "delete everything": IndexedDB empty, localStorage empty, caches contain only app shell (no user data) | todo |
| I8 | Export file contains only user data and does not include device identifiers | read an export | todo |
| I9 | `.gitignore` guards `*.ics`, exports, `.env`, `garmin-export*/`; repo tree contains no `.ics` except fake fixtures, no `.fit`, no zip | todo |
| I10 | Images: no EXIF/GPS or author metadata in icons/screenshots | `check-privacy.mjs` scans PNG chunks (`eXIf`, `tEXt`, `iTXt`) | todo |
| I11 | Referrer policy: leaving the site via links does not leak the sub-path or fragment | `<meta name="referrer" content="no-referrer">` or `rel="noopener noreferrer"` on external links | todo |
| I12 | Content-Security-Policy meta (defence in depth): `default-src 'self'`, `connect-src 'self'` | recommended | todo |
| I13 | Does the README / docs contain anything private (the user's real name, GitHub handle is public anyway, paths)? | grep | todo |
| I14 | The repo is safe to make public: simulate a stranger visit: clone to temp folder, run it, nothing shows personal data | todo |

## J. Fun check (would a 23-year-old come back tomorrow?)

Scored against `docs/research/` retention findings once those exist. Questions:

1. Within 10 seconds of first open, is there something delightful (not a form)?
2. Is there a reason to come back tomorrow that is not guilt (daily quest, new "on this day", streak with kind grace, wrap-up)?
3. Is the copy human and playful without being cringe ("fellow kids")? Is the humour optional and does it stay out of the way when the user is in a hurry?
4. Are the numbers (XP, levels) meaningful, or just decoration? Does the level curve make day 1, day 7, day 30 feel different?
5. Is the weekly recap shareable (local image only) and good-looking enough to post?
6. Are the themes and accent colours good-looking (design taste), including dark mode first?
7. Are animations quick (< 300 ms), skippable, and reduced-motion-safe?
8. What is missing compared with research's top recommendations? What is cringe?

## K. Out-of-order and abuse scenarios

- Open a deep link to a page before demo data is loaded.
- Import a backup while in demo mode; import an ICS before ever opening Settings.
- Leave demo mode, then reload; click "Load demo" again, does it duplicate or warn?
- Delete the event that a quest refers to.
- Edit an event while the same event is open in another tab.
- Wipe, then press the browser back button into a page that expects data.
- Double-submit every form (tap Save twice quickly; press Enter twice).
- Rapid tab switching (tab bar spam) during page transitions.
- Open app offline for the first time ever (never loaded): expected browser offline error, nothing to fix; but loaded once and then offline: must work.
- Go offline mid-import; kill the tab mid-import.
- Update the service worker while a tab is open and an old tab is still around.
- Open `index.html` directly via `file://` (not supported, but should it fail gracefully with a readable message instead of a white page?).
- Visit `/qa-sub/index.html`, `/qa-sub` (no trailing slash; GitHub Pages redirects), `/qa-sub/?utm=x#/today`.
- Back/forward after navigating 20 pages; history growth.
- Browser print (Ctrl+P) of the recap or calendar: not required.

## L. Console and network

Every page, fresh load and reload and offline: **zero console errors and zero warnings** (except documented). Network: zero failed requests (no 404 for favicon, icons, source maps, fonts). No request to any host except the test host.

## M. Cross-browser / device matrix

| Target | How | Status |
|---|---|---|
| Chromium (Browser pane) at phone and desktop sizes | direct | todo |
| Safari / iOS Safari "Add to Home Screen" | **cannot-test** here (no iPhone). Mitigation: static checks against Apple's documented requirements, `safe-area` simulation | cannot-test |
| Firefox | **cannot-test** unless installed; list as risk | cannot-test |
| iOS Simulator (if a Simulator + Safari is available through the iOS Simulator tool) | try `open_url` against the temp server on the Mac's LAN IP or `localhost` | try |

## O. Added by lead (2026-11-25, after research finished): decisions to audit against

Decisions log: app name Daybeat; Messages page = "Pings"; install first, then add data; no Shortcut-by-URL capture; no live sync or push claims; tolerant export-zip parser; share-sheet + clipboard backups; forgiving streak, daily quest, weekly recap are retention must-haves.

| # | Check | Expect | Status |
|---|---|---|---|
| O1 | Honesty audit against every decision above, page by page: read every visible string (qa/tools/copy-dump via DOM text per route) | no "sync/connected/live/ring/wake/push" claims; "Pings" naming used consistently; Shortcut route not promoted | todo |
| O2 | Streak maths at midnight: now = 23:59:59.999 vs 00:00:00.000, device clock moved back one day, forward 3 days, month end, 29 Feb | one credit per local day, no negative or NaN, rest-day/freeze rules match the copy | todo |
| O3 | Streak across DST changes and a time-zone change (travel): TZ switch between sessions (e.g. New_York -> Auckland, +18h) | no double-credit, no accidental reset beyond the documented grace, day keys stable | todo |
| O4 | Backup via the share-sheet fallback path: with navigator.share/canShare missing (desktop) the UI offers Copy backup text / Show text / download; copy text, wipe, paste-import restores losslessly | round trip equal (roundtrip.js) | todo |
| O5 | navigator.share({files}) path is feature-detected (canShare) and falls back on AbortError / NotAllowedError / TypeError without losing the export | todo |
| O6 | No third-party requests of any kind (fonts, icons, CDNs): browser network log for a full tour of every page + settings + install sheet, fresh and offline; CSP meta blocks them; sub-path server log shows only same-origin | todo |
| O7 | Retention must-haves present and kind: forgiving streak (rest day / freeze, kind break copy), 3-task daily quest, weekly recap card (local share image), accent themes; cringe list in docs/research/04-retention-mechanics.md absent | todo |

## N. Gate before the lead publishes

All of: A1-A10 PASS, D5 PASS, E1 PASS, H1-H6 PASS, I1-I5 and I14 PASS, L PASS, no open BLOCKER or MAJOR. QA writes the final verdict in the summary to the lead.

---

## Findings tracker (status of items sent to developers; details are in the messages and the final report)

| ID | Owner | Sev | One line | Status |
|---|---|---|---|---|
| F-001 | lead | MAJOR | absolute home path and OS user name in docs/TEAM_BRIEF.md | fixed by lead, re-scan clean |
| F-002 | frontend | MAJOR | light-theme --good/--warn/--bad and dark --text-3 on --surface-3 below 4.5:1 (computed from tokens) | sent, verify in rendered pages |
| F-003 | frontend+backend | MAJOR | iOS Safari-tab storage is separate from the installed app; Shortcut URL capture would write to the wrong store | sent; install-first notice present on Today (verified); fragment handling pending |
| F-004 | frontend | MAJOR | "Skip to content" (href=#view) hits the hash router and bounces the user to Today | sent |
| F-005 | frontend | MINOR | h() accepts string on* props and tab/newline-split javascript: hrefs (CSP blocks them today) | sent |
| F-006 | frontend | MINOR | tap targets below 44px (How button 36, brand link 32), 11px tab labels, "Messa..." truncated at 320 px, Messages vs "Pings" naming | sent |

Platform facts the tests rely on (research, 2026-11-25): installed iOS web apps have separate storage from Safari; Shortcuts Open URL opens Safari; blob downloads unreliable in standalone; no local scheduled notifications; no Web Share Target on iOS.
