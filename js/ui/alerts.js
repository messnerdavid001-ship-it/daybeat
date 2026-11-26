// In-app heads-up for alarms and timed tasks. This ONLY works while Daybeat is open on screen: a web page cannot ring,
// vibrate or notify once it is closed. The wording says so, and points to "Add to my Calendar" for real alerts.
import { h } from './dom.js';
import { icon } from './icons.js';
import { toast } from './toast.js';
import { openSheet } from './sheet.js';
import { clockParts, fmtClock } from './format.js';
import { checkInNow } from './checkin.js';
import { finishTask } from './taskactions.js';

const WINDOW_MS = 10 * 60 * 1000;   // how late we still tell you about something you just missed (tab was asleep)
const KEY = 'daybeat.alerted';

function loadFired() {
  try { return new Set(JSON.parse(sessionStorage.getItem(KEY) || '[]')); } catch { return new Set(); }
}
function saveFired(set) {
  try { sessionStorage.setItem(KEY, JSON.stringify([...set].slice(-200))); } catch { /* storage blocked: alerts may repeat after a reload, nothing worse */ }
}

export function startAlerts(data) {
  const { store, dates } = data;
  const fired = loadFired();
  let timer = null;

  const dialogOpen = () => !!document.querySelector('dialog[open]');

  function alarmSheet(a, when, now) {
    const pref = store.settings.get('timeFormat', 'auto');
    const c = clockParts(a.time, pref);
    const late = Math.round((now - when) / 60000);
    const sheet = openSheet({
      title: 'Alarm',
      content: h('div', { class: 'stack', style: { textAlign: 'center' } },
        h('p', { class: 'alert-sheet__time num' }, c.main, c.suffix ? h('small', null, ' ' + c.suffix) : null),
        h('p', { class: 'alert-sheet__who user-text' }, a.label || 'Alarm'),
        late >= 2 ? h('p', { class: 'muted' }, `${late} minutes ago`) : null,
        h('p', { class: 'faint' }, 'You are seeing this because Daybeat is open. A closed web app cannot ring. For real alerts, use Add to my Calendar, and keep the alarm on your watch or phone clock too.')),
      footer: [
        h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => sheet.close('dismiss') }, 'Dismiss'),
        h('button', { type: 'button', class: 'btn btn--primary', onclick: async (e) => { await checkInNow(data, 0, e.currentTarget); sheet.close('up'); } }, icon('sunrise'), 'I’m up'),
      ],
    });
  }

  function check() {
    if (document.hidden) return;
    let info;
    try { info = store.info(); } catch { return; }
    if (!info || info.readOnly) return;
    const now = new Date();
    const lookBack = new Date(now.getTime() - WINDOW_MS);

    for (const a of store.list('alarm')) {
      if (!a.enabled) continue;
      const when = dates.nextAlarm(a, lookBack);
      if (!when || when > now) continue;
      const key = `alarm:${a.id}:${when.toISOString()}`;
      if (fired.has(key) || dialogOpen()) continue;
      fired.add(key);
      saveFired(fired);
      alarmSheet(a, when, now);
    }

    const today = dates.todayKey(now);
    const pref = store.settings.get('timeFormat', 'auto');
    for (const t of store.list('task')) {
      if (t.done || !t.due || !t.time || t.due !== today) continue;
      const due = new Date(`${t.due}T${t.time}:00`);
      const at = new Date(due.getTime() - (t.remindMin || 0) * 60000);
      if (!(at <= now && at > lookBack)) continue;
      const key = `task:${t.id}:${t.due}:${t.time}`;
      if (fired.has(key)) continue;
      fired.add(key);
      saveFired(fired);
      toast(`${t.remindMin ? 'Coming up' : 'Due now'}: ${t.title} (${fmtClock(t.time, pref)})`, { duration: 20000, action: { label: 'Done', onClick: () => finishTask(data, t, null) } });
    }
  }

  const onVisible = () => { if (!document.hidden) check(); };
  document.addEventListener('visibilitychange', onVisible);
  timer = setInterval(check, 20000);
  setTimeout(check, 2500);
  return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
}
