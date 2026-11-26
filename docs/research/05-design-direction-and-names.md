# 05 Visual direction, page ideas, app names

Checked 2026-11-25. Everything here is a **design suggestion** informed by the sources named; where I verified something (name clashes, contrast ratios) it says so. Patterns and ideas only, nothing copied from another app.

## What this means for us
1. **Name:** keep **Daybeat** (frontend's working name). In App Store web search on 2026-11-25 I found **no app with that exact name**; nearest neighbours are *DailyBeat HRV* (iOS, a heart-rate-variability app) and *DailyBeat* (an Android journal on F-Droid), both different products. **Tempo and Orbit are crowded names** (several fitness and habit apps use each) and I would not use them. Trademark and domain were not checked (needs USPTO/EUIPO and a registrar search if it ever goes beyond a personal project).
2. **Look:** a warm, bold "pocket scoreboard": big rounded numerals, chunky outlined bento cards with hard offset shadows, one saturated accent that the user can change, calm dark mode by default. It fits 2026 trend roundups (bento grids, high-contrast tactile styling, saturated "dopamine" colour) without copying any app.
3. **Accessibility is easy if tokens are chosen once.** I computed WCAG contrast for the palette below (table in this file): all body text and ink-on-accent pairs pass AA, and light-theme accent text needs the darker variants given.
4. **No third-party requests:** use system fonts (`ui-rounded`, `system-ui`), inline SVG icons, no Google Fonts or CDNs, so the "nothing leaves your device" claim stays true.

## Names

| Candidate | Check done (2026-11-25, one web search each, not a legal clearance) | Verdict |
|---|---|---|
| **Daybeat** | No exact match in App Store results. Near: DailyBeat HRV https://apps.apple.com/us/app/dailybeat-hrv/id1094029001 ; DailyBeat (F-Droid) https://f-droid.org/packages/com.dailybeat.app/ | **Recommended.** Short, rhythm and day, nothing to do with Garmin. Pronounced the same as the HRV app's name, so keep the logo and domain distinct. |
| **Dayhop** | No results at all in one search | Good backup; playful (hopping from day to day, streak jumps). Unverified beyond the one search. |
| **Wristly** | No exact result in one search | Friendly and on-theme (wrist), but "wrist" ties it to wearables only. Unverified. |
| Tempo | Many apps share it: Tempo Health, Tempo: Run, Recover, Repeat, Tempo: Home Workout, Tempo Cycle, Tempo Studio https://apps.apple.com/app/id1106746589 | Avoid, crowded and fitness-adjacent. |
| Orbit | Orbit Rings: Daily Routine (habit tracker, ring-style), Orbit Steps, Intermittent Fasting: Orbit https://apps.apple.com/app/id6755077967 | Avoid, same category as ours. |
| Cadence | At least two habit-tracker apps use it https://apps.apple.com/app/id6761003558 | Avoid. |

Rule from the brief: no "Garmin" in the name, logo or branding; About page says "Unofficial, not affiliated with Garmin." Avoid Garmin's colours (their blue/black) and shapes.

## Visual direction: "pocket scoreboard"
- **Mood:** friendly, a little cheeky, sporty without being gym-bro. The app is a scoreboard for your day.
- **Layout:** bento grid of cards with meaningful sizes (a big "Next up" card, medium streak and quest cards, small stat tiles). Source for the trend and the warning that uniform blocks lose hierarchy: https://www.moburst.com/blog/top-mobile-web-design-trends/ and https://fireart.studio/blog/the-best-web-design-trends/ (likely, general roundups).
- **Shape:** 20 px radius cards, 2 px ink outline, hard offset shadow (4 px, no blur) in light theme; softer elevated surfaces in dark theme. Pill buttons, 44 px minimum touch targets.
- **Type:** system stack only: `ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` for headings and numerals (heavy weight, tabular numbers for clocks and streaks), body in `system-ui`. 16 px minimum for inputs. Test that `ui-rounded` falls back cleanly on non-Apple browsers.
- **Colour tokens** (contrast computed by me with the WCAG 2 formula on 2026-11-25):

| Token | Dark theme | Light theme |
|---|---|---|
| bg | `#0F1115` | `#F6F2EA` |
| surface | `#181B22` | `#FFFFFF` |
| text | `#F4F1EA` (16.8:1 on bg) | `#14161B` (16.2:1 on bg) |
| muted text | `#A8AEBB` (8.5:1 on bg, 7.7:1 on surface) | `#5B6070` (5.6:1 on bg, 6.3:1 on white) |
| border / ink | `#F4F1EA` at 20% | `#14161B` |

Accent palettes (user-selectable; text **on** the accent is always ink `#0F1115`; contrast of ink on accent shown; "as text on light" gives the darker variant to use for accent-coloured text and icons on the light theme, all >= 5.2:1):

| Name | Accent (fill) | Ink on accent | Accent as text on dark bg | Accent text on light bg |
|---|---|---|---|---|
| Volt (default) | `#C6F432` | 14.8:1 | 14.8:1 | `#4B6300` 6.1:1 |
| Bubblegum | `#FF5CA8` | 6.6:1 | 6.6:1 | `#B3125F` 5.9:1 |
| Sky | `#5CC8FF` | 10.0:1 | 10.0:1 | `#0B5F8A` 6.2:1 |
| Sunset | `#FF8A3D` | 8.1:1 | 8.1:1 | `#A8480A` 5.2:1 |
| Grape | `#9B7BFF` | 6.0:1 | 6.0:1 | `#5B3FCC` 6.2:1 |
| Mint | `#3DDBA4` | 10.7:1 | 10.7:1 | `#0A7355` 5.2:1 |

Never put the raw Volt accent as text on the light theme (1.15:1, fails). Also do not rely on colour alone for streak/quest state (add icon and text).
- **Motion:** springy but short (150 to 300 ms); streak number rolls, quest tick pops, level-up gets a one-off burst; all disabled or reduced to a fade under `prefers-reduced-motion`. Celebrations are rare so they mean something.
- **Iconography:** one inline SVG set, 2 px strokes, rounded caps; every icon-only button has an `aria-label`.
- **Imagery:** simple vector badges and "stickers" (original art), no stock photos, no mascot that guilt-trips.
- **App icon:** opaque square 180x180 (no transparency; see 02). Working idea from frontend (a ring with a dot riding in the gap) is good: it reads as "day on a dial" and echoes ring-style trackers without copying Apple's three rings. Make the dot the accent colour on an ink background.

## Page ideas (one thing each; designed around what is real)

| Page | Purpose | Fun layer | Data source |
|---|---|---|---|
| **Today** | What's next, streak, quest, one-line "day vibe" | Big next-event countdown card; streak chip; 3-task quest; gold state when all done; "on this day" when history exists | Calendar + alarms + quests (demo first) |
| **Calendar** | Month and agenda from imported `.ics` + manual events | Day dots coloured by type; "free evening" highlight; import drop zone with a friendly empty state | `.ics` file, manual |
| **Alarms** | Mirror of the watch's alarms; wake check-in | Morning "I'm up" button that feeds the streak; presets (weekday 06:30, weekend 08:30); honest banner "this app cannot ring, your watch does" | manual |
| **Pings** (rename of Messages) | Capture and sort things the watch pinged you about | Quick add, paste-from-clipboard, pin/archive, "inbox zero" confetti (small) | manual, paste |
| **Quests** | Streak, XP, level, badges, daily quest, rest-day and freezes | Badge shelf with locked hints; level ring; stickers from milestones | local rules engine |
| **Insights** | Weekly recap, trends | Week Wrapped cards; sleep, steps, HRV charts only if the user imported an export; otherwise charts from in-app activity (check-ins, quests); shareable PNG | export zip + app data |
| **Settings & Data** | Import/export, backup, theme, privacy, install help, about | Theme picker preview; "last backup" chip; "Wipe everything" with typed confirmation; install steps with screenshots drawn in SVG | local |

Navigation: bottom tab bar on phone with at most 5 items (Today, Calendar, Alarms, Pings, You), and **You** holding Quests, Insights and Settings as sections; left sidebar with all seven on desktop. This is a suggestion; the 5-item cap is a common iOS pattern but I did not verify Apple's current guideline text here.

## Honest-labelling rules for the UI (from 01)
- Never "synced", "connected" or "live". Use "imported on 12 Nov", "entered by you", "demo data".
- Show a small banner "Demo data" until the user adds or imports their own.
- About page: unofficial, not affiliated with Garmin; Garmin and product names belong to their owners; no Garmin logos.
