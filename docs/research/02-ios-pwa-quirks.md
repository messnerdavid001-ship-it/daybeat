# 02 iPhone home-screen web app: quirks to design around and test

Checked 2026-11-25. Labels: confirmed (primary source) / likely (several secondary agree) / unverified (my knowledge or one weak source; test on a real iPhone).

## What this means for us
1. The biggest traps are **data, not looks**: the installed app and the Safari tab have **separate storage**, and file **export from an installed app is fragile**. Design the install flow and backup flow around these two facts before polishing visuals.
2. Layout traps are small and well known: inputs under 16 px zoom the page, `viewport-fit=cover` needs safe-area padding, transparent icons turn black, `100vh`/`dvh` behave differently with the keyboard.
3. Almost every behaviour below can only be proven on a **real iPhone** (or at least the iOS Simulator). Desktop device emulation will not show them. QA should say "untested on device" in the report when that is the case.
4. iOS 26 changed install: every site added to the Home Screen opens as a web app by default; the manifest is no longer required but is still used for icons.

## Install flow (iOS 26 and earlier)
- iOS 26 steps: open in **Safari**, tap Share (via the three-dot menu by the address bar), **Add to Home Screen**, keep **Open as Web App** on, optionally rename, **Add**. https://www.macrumors.com/how-to/save-safari-bookmark-web-app-iphone-home-screen/ and https://heise.de/-10749652 (2025-10-10). Likely. The toggle can be switched off, which makes a plain bookmark that opens in Safari: **tell users to leave it on**.
- Before iOS 26 the app only opened standalone if a manifest `display` (or the `apple-mobile-web-app-capable` meta) said so: https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/ (confirmed). Keep both for older iPhones.
- There is **no install prompt** (`beforeinstallprompt` does not exist) so the app must show its own help card. https://firt.dev/notes/pwa-ios/ (likely, page updated 2026-10-13).
- Only Safari can install web apps on iPhone in most regions; other browsers on iOS may offer it too from iOS 16.4 (unverified). Show install help only when not standalone: `navigator.standalone === true` or `matchMedia('(display-mode: standalone)')`.
- **Install first, then add data.** Storage is separate (next section). Test: add data in Safari tab, install, open app, expect empty.

## Storage and data safety
- Separate stores for Safari tab and installed app: Apple WWDC23 session 10120 "separate cookies and storage from the browser": https://developer.apple.com/videos/play/wwdc2023/10120/ (confirmed). Same in https://firt.dev/notes/pwa-ios/ (likely).
- 7-day cap on script-writable storage (IndexedDB, localStorage, service worker registrations and caches) after 7 days of **Safari use** without interaction on the site; home-screen apps count their own days of use and WebKit considers deletion of their first-party data a bug: https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/ (confirmed).
- Quotas (iOS 17+): origin quota about 15% of disk for non-browser apps (60% for browsers); overall 20%; eviction under pressure is per origin, least-recently-used, unless persisted: https://webkit.org/blog/14403/updates-to-storage-policy/ (confirmed). `navigator.storage.persist()` is granted by heuristics (e.g. installed web app). Call it once after the first meaningful save and show the result in Settings ("Protected / Not protected").
- Deleting the home-screen app deletes its data (standard iOS behaviour, unverified in a source here). Settings must say so and offer a backup.
- All pages under the same `https://<user>.github.io` origin share IndexedDB/localStorage/CacheStorage (confirmed by browser same-origin rules, a point raised by backend): use unique DB/cache names and a key prefix, and never trust that other keys are absent.

## Files in and out
- Import: `<input type="file">` works in standalone (supported since iOS 6 per https://firt.dev/notes/pwa-ios/ , likely). `accept=".ics,.json,.zip"`: iOS may treat unknown types loosely; always validate content, not extension. The Files app can unzip a Garmin export first.
- Export: `<a download>` with a Blob **unreliable** in installed apps (WebKit bugs https://bugs.webkit.org/show_bug.cgi?id=275288 June 2024, https://bugs.webkit.org/show_bug.cgi?id=290847 April 2025 iOS 18.4: user can get stuck on a preview screen without navigation; likely). Primary path: `navigator.share({files:[new File([json],'backup.json',{type:'application/json'})]})` from a tap, guarded by `navigator.canShare({files})`. Fallbacks: "Copy backup text" (clipboard) and a read-only textarea to long-press-select. Web Share 2.0 (files) since iOS 15 per firt.dev (likely). Not provable without a device.
- Receiving files from the share sheet / "Open in": **impossible** (Web Share Target unsupported, WebKit bug https://bugs.webkit.org/show_bug.cgi?id=194593, open since 2019; confirmed).
- Public File System Access API (`showOpenFilePicker`) not supported; origin-private file system yes: firt.dev (likely).

## Notifications, badges, background
- Web Push: installed apps only, iOS 16.4+, needs a push server: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ (confirmed). Not for us.
- Local scheduled notifications: do not exist (Notification Triggers never shipped): https://developer.chrome.com/docs/web-platform/notification-triggers (confirmed for Chrome; Safari absence likely).
- Badge: `navigator.setAppBadge` only for installed apps and only if notification permission was granted: https://webkit.org/blog/14112/webkit-features-for-safari-17-0/ (confirmed). Skip in v1.
- Background Sync, Periodic Background Sync, Background Fetch: not supported: firt.dev (likely). Never promise anything that runs while the app is closed.
- Home-screen widgets and Live Activities for web apps: no route found (https://www.mobiloud.com/blog/progressive-web-apps-ios , unverified; firt.dev lists none). Do not design around widgets; use "widget-like cards" inside the app instead.
- Link capturing: a normal link never opens the installed app ("only a push message can open an installed PWA", firt.dev, likely). See 01-feasibility H4 for the `webapp://` story.

## Layout and input
- **Inputs under 16 px** trigger an auto-zoom on focus; keep inputs, selects and textareas at `font-size: 16px` or more and do not disable pinch zoom (accessibility): https://css-tricks.com/?p=339455 , https://weblog.west-wind.com/posts/2023/Apr/17/Preventing-iOS-Textbox-Auto-Zooming-and-ViewPort-Sizing (likely).
- **Viewport units:** `svh/lvh/dvh` exist since iOS 15.4 (likely), but sources disagree on whether `dvh` reacts to the on-screen keyboard; WebKit bugs show svh/dvh not always distinguished (https://bugs.webkit.org/show_bug.cgi?id=261185). Use `dvh` for the shell, `visualViewport` for keyboard-aware sheets (e.g. quick-add), and test with the keyboard open (https://dev.to/rl0425/why-css-dvh-ignores-the-mobile-keyboard-and-how-to-fix-it-31ao , unverified).
- **Safe area:** `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` makes the page draw edge to edge; then pad with `env(safe-area-inset-top|right|bottom|left)` (keep a `constant()` fallback only if old iOS 11 matters, it does not): https://webkit.org/blog/7929/designing-websites-for-iphone-x/ (confirmed). The bottom tab bar needs `padding-bottom: env(safe-area-inset-bottom)`, and landscape needs left/right insets.
- **Status bar:** `apple-mobile-web-app-status-bar-style` was deprecated in iOS 15 in favour of `<meta name="theme-color">`; `black-translucent` is still the only way to draw under the status bar (full-bleed). With `black-translucent` the status-bar text is white, so a light theme needs a dark header strip or `default` style; make theme-color change with the theme (use two `theme-color` metas with `media="(prefers-color-scheme)"` and update on manual theme switch): https://firt.dev/notes/pwa-ios/ (likely).
- **Icon:** `apple-touch-icon` 180x180 PNG, **fully opaque square, no transparency, no rounded corners** (iOS masks it; transparent pixels turn black): https://developer.apple.com/forums/thread/713895 and https://makandracards.com/makandra/26757-transparent-pngs-ios-favicons (likely; one site claims transparency works, treat as outlier). If present it overrides manifest icons (firt.dev).
- **Name:** manifest `name`/`short_name` is used for the home-screen label since iOS 11.3 and replaces `apple-mobile-web-app-title`; keep `short_name` at 12 characters or fewer so it does not truncate under the icon: firt.dev (likely; length limit is my rule of thumb, unverified). In iOS 26 the user can rename at add time.
- **Splash:** only `apple-touch-startup-image` (per-device sizes) gives a custom splash; without it iOS shows a white (or system) screen at launch, which flashes in dark theme. Set `body` and `html` background to the theme colour so the first paint matches; consider skipping startup images (many sizes): firt.dev (likely).
- **Pull-to-refresh and overscroll:** standalone iOS apps have no browser pull-to-refresh; rubber-band overscroll still shows the page background, so set `html` background and `overscroll-behavior: none` on app containers (unverified; test). Tabs/menus: use `touch-action: manipulation` and `-webkit-tap-highlight-color: transparent`; avoid `position: fixed` bottom bars that jump when the keyboard opens (test).
- **Service worker:** needed for offline, not for installability on iOS 26 (heise). GitHub Pages serves `max-age=600` (see 01), so use a version constant and an in-app "update ready" toast. After an update the new worker waits until all windows close; on iOS "closing" means swiping the app away from the app switcher: offer `skipWaiting` + a reload button (unverified on iOS; test).
- **Reduce motion and dark mode:** honour `prefers-reduced-motion` and `prefers-color-scheme`; the manual theme switch must also set `color-scheme` and `theme-color`.
- **Safari-tab vs standalone differences to display:** hide the install card and the "you are in the browser" banner when `display-mode: standalone`.

## Test checklist for QA (real device where possible)
1. Fresh install: tap-by-tap iOS 26 flow, launch, no white flash, status bar readable in light and dark.
2. Data separation: add item in Safari, install, confirm empty; export in Safari, import in app.
3. Backup via share sheet saves to Files; fallback copy text works; no navigation trap.
4. Keyboard open in Quick add: input visible, no zoom, no layout jump, tab bar not floating mid-screen.
5. Rotate to landscape on a notch phone: safe-area side padding.
6. Airplane mode after first load: all pages open; demo works; update toast appears after a version bump.
7. Kill app from switcher, reopen after a day: data still there; `storage.persisted()` reported honestly.
8. Delete app: confirm user-facing warning text says data is gone.
