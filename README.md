# Daybeat

A tasks, alarms and calendar planner with a place for your Garmin numbers, built as an installable web app (PWA). It works on a phone and on a computer, keeps everything on your own device, and is made to be fun enough that you open it every day.

> Daybeat is an independent, unofficial project. It is not made by, affiliated with or endorsed by Garmin. "Garmin" is a trademark of its owner.

## What it does

| Page | What it is for |
|---|---|
| **Today** | What is next: due tasks you can tick off, your next event and alarm, today's quests, your streak. |
| **Tasks** | Quick add in plain words (`call mum tomorrow 5pm !high #home`), repeats, steps, priorities, lists, smart views (Today, Upcoming, Someday, Done). |
| **Calendar** | Month and day view showing events, tasks and alarms together. Import a calendar file (`.ics`). |
| **Alarms** | Your alarms in one place, a wake-up check-in, and "Add to my Calendar" for real alerts. |
| **Garmin** | Steps, sleep, resting heart rate and active minutes: import your Garmin "Export Your Data" zip (read on your device) or type numbers in. Goals, trends, personal bests. |
| **Quests / Recap** | Streaks (with a rest day and freezes, no guilt), XP, levels, badges, daily quests and a shareable weekly recap. |

## Honest limits

- **No live Garmin sync.** Garmin offers no way for a website like this to read your calendar, alarms or messages. Daybeat never asks for your Garmin login. Numbers come from the data export you request from Garmin and pick on your own device, or from typing.
- **A web app cannot ring when it is closed.** Daybeat shows a heads-up only while it is open. For real alerts use **Add to my Calendar**: it makes a calendar file with alerts that your phone's own Calendar app fires. Keep important wake-up alarms on your watch or phone clock as well.
- **No notifications, no accounts, no sync between devices.**

## Privacy

Everything you enter stays in your browser's storage on your device. There is no server, no account, no analytics, no tracking and no third-party request. The site's content-security policy makes the browser enforce that. Use **Settings > Back up** to save a copy, and **Settings > Delete everything** to wipe it. The first time you open the app it shows made-up sample data so you can look around; clear it in Settings.

## Put it on an iPhone

1. Open the site's address in Safari.
2. Tap Share, then **Add to Home Screen**.
3. Open Daybeat from the home screen and **add your data there**. The home-screen app keeps its own storage, separate from the Safari tab.

On a computer, use the install icon in Chrome or Edge, or just keep it as a tab.

## Run it locally

No build step and no dependencies. Needs Node 20 or newer.

```bash
node scripts/dev-server.mjs --port 4781
node --test tests/*.test.mjs
```

Open `http://127.0.0.1:4781/`. The service worker only runs on `localhost` or HTTPS.

## Publishing (GitHub Pages)

The site is plain static files served from the root of the `main` branch. Before every publish run `node scripts/build-sw-manifest.mjs` (it refreshes the offline file list and cache version) and the tests. All paths are relative, so it works under `https://<user>.github.io/<repo>/`.

## Layout

- `index.html`, `css/`, `js/ui/`, `js/pages/`: the interface (no framework).
- `js/data/`: storage (IndexedDB), tasks and repeat rules, the streak/XP engine, `.ics` import and export, Garmin export reader, backups.
- `sw.js`, `sw-manifest.js`: offline support.
- `tests/`: unit tests. `qa/`: browser and privacy check scripts. `docs/`: research notes and working notes.
