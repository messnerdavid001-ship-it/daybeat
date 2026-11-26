# 04 Retention mechanics, ranked by payoff vs effort (static PWA, no push, no accounts)

Checked 2026-11-25. Evidence labels as in 01. "Design suggestion" = my proposal, not a research finding.

## What this means for us
1. **Must be in v1 (top 3):** (a) a **forgiving daily streak** where one tiny action counts and rest days are built in; (b) a **daily quest of 3 tiny tasks** tied to the real watch day; (c) a **weekly recap card** (free, shareable as a local image). Cheap fourth: **themes/accent colours** for ownership.
2. We **cannot push**, so every hook must be a reason to *pull* (open the app): "what's next" on Today, a streak you can see, a quest that resets daily, a recap that lands on a fixed day, a level-up that is one tap away.
3. **Be kind about missing days.** Evidence says a broken streak lowers later activity, and highlighting the break lowers it more; offering repair softens it. So: grace/rest days, "welcome back" copy, no red alarm, no shame.
4. **Skip:** leaderboards, friends, widgets, real alarms, push (all impossible or need a server). Do not fake social proof.

## Evidence in one place
- Duolingo separated the streak from the daily goal (one lesson extends the streak) and saw **+3.3% day-14 retention**, +1% daily active learners, +10.5% daily learners on a streak (relative, 2020 experiment). A year on, over 40% more learners had a 7+ day streak. https://blog.duolingo.com/improving-the-streak (2020-11-19, confirmed). Lesson: **make the streak bar tiny**.
- Duolingo reports learners with a 7-day streak are 2.4 times as likely to return the next day, and allows up to two streak freezes at once: https://blog.duolingo.com/how-duolingo-streak-builds-habit (via search summary of the official post; likely, re-read the post before quoting numbers).
- Streak research (INSEAD, Silverman and Barasch 2023, Journal of Consumer Research): people with a **broken** streak were less likely to do another exercise (57.9% vs 66.2% with an intact streak); the effect shrank when repair was offered, and was worse when the break was highlighted. https://knowledge.insead.edu/marketing/consumer-streaks-are-motivating-the-key-is-keeping-them-alive (likely, summary page).
- Habit-formation research (Lally, UCL) found missing one day had almost no effect; streak designs assume the opposite: https://mobbin.com/blog/streaks-are-about-losing-a-study-of-859-streak-designs (likely, secondary).
- Practical guidance for streak systems (freezes, grace periods, milestone days 7/30/50/100/365, small actions, supportive break copy, no UTC-midnight reset, remind don't nag): https://smashingmagazine.com/2026/02/designing-streak-system-ux-psychology/ (2026-02-18, likely).
- Apple lets users **pause rings** so rest days do not break a streak (watchOS 11 / iOS 18) and gives retroactive All Rings Closed awards at 100/365/500/1,000: https://www.macrumors.com/2024/11/20/apple-watch-all-rings-closed-awards/ (likely).
- Strava Year in Sport has shareable images; making it subscriber-only in 2025 drew complaints: https://support.strava.com/hc/en-us/articles/22067973274509-Your-Year-in-Sport and https://road.cc/content/news/strava-year-sport-now-only-subscribers-317425 (likely).
- Notification overload is a top Gen Z complaint (38% overwhelmed in an April 2025 NZ survey): https://www.scoop.co.nz/stories/BU2504/S00379.htm (likely, one country).

## Ranked ideas

Scale: payoff = expected effect on coming back and enjoying it; effort = build cost for the static PWA (S under half a day, M about a day, L multiple days). Order is the recommended build order.

| # | Idea | Payoff | Effort | Notes and how to build it here |
|---|---|---|---|---|
| 1 | **Forgiving day streak** | High | S | One tiny action counts for the day (a check-in, logging one ping, confirming an alarm, opening Quests and tapping "I'm here"). Local-time day boundary (not UTC). **One free rest day per week** that auto-protects, plus up to **2 freezes** earned with XP, shown as small snowflake chips. Break copy is supportive ("Streak paused at 12. Welcome back, day 1 of the next one"), never red. Milestones at 3, 7, 14, 30, 50, 100, 365 with a short celebration. Keep a "best streak" so a restart never feels like zero. Design suggestion on rules; evidence above. |
| 2 | **Daily quest: 3 tiny tasks tied to the real day** | High | S-M | Examples that need no integration: "Look at today's first event", "Check your wake alarm still matches your watch", "Capture one ping", "Rate your sleep 1-5", "Stretch for 60 seconds, tap done". Rotate from a pool of 30+, deterministic by date so it works offline. Finishing all 3 = bonus XP and a gold state on Today (a nod to Streaks' gold theme when everything is done: https://apps.apple.com/us/app/streaks/id963034692). Keep each task under a minute (Smashing: keep actions small). |
| 3 | **Weekly recap card ("Week Wrapped")** | High | M | Appears every Sunday evening (or on first open after), 5 to 6 swipeable cards: days checked in, best day, quests done, XP and level, a Garmin-export stat if imported (steps, sleep average), a playful "title" for the week ("Early Bird", "Night Owl", "Steady Eddie"). **Free, always**. A "share" button renders a PNG on a `<canvas>` locally and calls `navigator.share({files})` (works on iOS 15+, test; fallback "save image" long-press). No upload. Because we cannot push, the fixed weekly date is a natural pull. |
| 4 | **Themes and accent colours** | Medium | S | 6 to 8 accent palettes, light/dark/auto, unlockable by level (cosmetic only). Streaks sells on 30+ themes. Ownership and identity beat features for this age group (hypothesis; no direct source). |
| 5 | **XP, levels, badges** | Medium | M | XP per action (check-in 10, quest 15, recap viewed 5, import 50 once, first alarm 20). Gentle curve: level 2 at 50 XP, level 5 at about 400, level 10 at about 1,500, then +300 per level (design suggestion; tune with playtest). 20 to 30 badges tied to real behaviour: First Day, 7-Day Streak, Early Bird (check-in before 08:00 seven times), Night Owl, Calendar Cleaner (imported .ics), Data Nerd (imported export), Backup Hero (made a backup), Quiet Week (zero pings), Comeback Kid (returned after 3+ days). Show 3 locked badges with hints so there is always a next goal. Avoid XP inflation and meaningless modals. |
| 6 | **"On this day" memories** | Medium (after weeks) | S | Needs history; shows a past event or ping from 1 week / 1 month / 1 year ago. Costs almost nothing once data exists; hides itself when empty. |
| 7 | **Surprise reward (cosmetic)** | Medium | S | A "mystery sticker" on streak milestones (7, 30, 100): cosmetic stickers for the badge shelf. No gambling feel, no real-money hooks. |
| 8 | **Widget-like cards inside the app** | Medium | S | Home-screen widgets are **not possible** for web apps (no route found, see 02). Make the top of Today behave like a widget: next event with a live countdown, streak flame/number, quest ring. |
| 9 | **Calendar-based reminder trick** | Medium | S-M | Since we cannot push or schedule locally, offer "Add a weekly reminder to your calendar": generate a tiny `.ics` with a recurring event (Sunday 18:00, title "Open Daybeat for your week", URL to the app) and hand it to the share sheet. The OS calendar then does the notifying with no server. **Unverified on iOS**: whether the share sheet accepts a `.ics` file and offers Calendar; test on a device before promising. |
| 10 | **Sound, haptics** | Low | S | `navigator.vibrate` is not available in iOS Safari (my knowledge, unverified here); skip haptics. Short optional sounds need a user gesture; off by default. |
| 11 | **Social: friends, leaderboards, challenges** | High elsewhere | L, needs server | **Not feasible** with no server and no accounts. Do not build. A manual "share your recap image" covers the social need. |
| 12 | **Push reminders** | High elsewhere | n/a | **Impossible** without a push server (see 01). Replace with #9 and with strong "what's next" on open. |

## The first 60 seconds (design suggestion based on the evidence above)
- Duolingo found retention is most fragile in the first week; their fix was to lower the bar (see above). So: **open straight into a populated demo** (no sign-up, no permission prompt, no paywall; Finch's launch-time paywall is a top complaint).
- Second 0 to 10: Today page with a friendly line, a streak chip at "Day 0", a 3-task quest.
- Second 10 to 30: one tap on the first quest task gives instant feedback (small animation, +XP, streak becomes Day 1).
- Second 30 to 60: a gentle "make it yours" card: name your app greeting, pick an accent colour, optionally "Add your own data" (calendar file / alarms / export) or "Keep exploring the demo".
- Never ask for notification permission (it would be pointless and a cringe signal).

## Cringe and annoyance list (QA can check the built app against this)
- Guilt copy ("Your streak is crying"), red countdown timers, fake urgency, loss-framed messages (Smashing, Mobbin research above).
- Hard reset to zero after one missed day.
- Streak or recap behind a paywall (Strava recap backlash), or any paywall, ad or sign-up wall at first launch (Finch).
- Overloaded RPG screens with many currencies (Habitica complaints).
- Infantilising mascot and non-stop emoji; confetti on every tap (keep big celebrations rare, so they mean something).
- Claiming live Garmin sync, "connected", or notifications the app cannot send.
- Motion that ignores `prefers-reduced-motion`; contrast failures on the accent colours; icon-only buttons without labels.
- Dark patterns like pre-ticked "send me reminders".

## Microcopy tone (design suggestion)
Warm, dry, short, a little self-aware, never preachy; second person; lowercase-friendly headings are fine; one joke per screen at most. Examples:
- Empty calendar: "Nothing on. Suspicious. Add something or enjoy it."
- Streak saved by rest day: "Rest day used. Streak safe, legs happy."
- Streak restart: "Fresh start. Day 1 looks good on you."
- No-alarm honesty: "This app can't buzz your wrist. Your watch does that. We just keep the score."
- Backup nudge: "Your data lives only on this phone. Make a backup so a lost phone is not a lost streak."
- Privacy: "No account. No ads. Nothing leaves this device."

## Open questions for the team
- Is a 1 rest day per week + 2 freezes too forgiving? Easy to tune; QA can test the date logic around midnight, time zones, DST, travelling.
- Share-image generation on iOS standalone (canvas + share files) must be tested on a device.
