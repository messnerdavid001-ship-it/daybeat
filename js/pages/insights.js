// Insights: "Week Wrapped" story cards (with a local share image) and trends from daily numbers you enter.
// Honest about data: nothing here comes from a watch unless the user adds it or imports a file.
import { h, s } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { openSheet } from '../ui/sheet.js';
import { showAward } from '../ui/rewards.js';
import { segmented } from '../ui/pickers.js';
import { fmtDate, fmtNumber, minutesToHM, plural, dateOfKey, WEEKDAYS_LONG, WEEKDAYS_LETTER } from '../ui/format.js';
import { pageHead, emptyState, dataMissingCard, keepFocus } from '../ui/parts.js';

export function mount(root, ctx) {
  if (!ctx.data) { root.replaceChildren(dataMissingCard()); return; }
  const { store, game, dates } = ctx.data;
  let which = 'this';          // 'this' | 'last'
  let first = true;
  let awarded = false;

  // ------------------------------------------------------------ numbers for one week
  function weekStats(startKey) {
    const endKey = dates.addDays(startKey, 7);
    const keys = Array.from({ length: 7 }, (_, i) => dates.addDays(startKey, i));
    const actions = store.list('action', { from: startKey, to: endKey });
    const base = actions.filter((a) => game.TYPES.includes(a.type));
    const perDay = Object.fromEntries(keys.map((k) => [k, 0]));
    for (const a of base) if (a.day in perDay) perDay[a.day]++;
    const activeDays = keys.filter((k) => perDay[k] > 0).length;
    const xp = actions.reduce((n, a) => n + (a.xp || 0), 0);
    const checkins = store.list('checkin').filter((c) => keys.includes(c.day));
    const early = checkins.filter((c) => new Date(c.at).getHours() < 8).length;
    const late = checkins.filter((c) => new Date(c.at).getHours() >= 22).length;
    const tasksDone = actions.filter((a) => a.type === 'todo').length;
    const events = store.list('event', { from: startKey, to: endKey }).length;
    const quests = actions.filter((a) => a.type === 'quest').length;
    let best = null;
    for (const k of keys) if (perDay[k] > 0 && (!best || perDay[k] > perDay[best])) best = k;
    const daily = keys.map((k) => store.get('daily', k)).filter(Boolean);
    const avg = (f) => { const v = daily.map(f).filter((n) => Number.isFinite(n)); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
    let title = 'Fresh page';
    if (early >= 3) title = 'Early bird';
    else if (late >= 2) title = 'Night owl';
    else if (activeDays >= 6) title = 'Steady Eddie';
    else if (activeDays >= 4) title = 'Regular';
    else if (activeDays >= 1) title = 'Warming up';
    return { startKey, keys, activeDays, xp, checkins: checkins.length, early, tasksDone, events, quests, best, bestCount: best ? perDay[best] : 0, title,
      steps: avg((d) => d.steps), sleep: avg((d) => d.sleepMinutes), hr: avg((d) => d.restingHr), daysWithNumbers: daily.length };
  }

  function wrappedCards(w, snap) {
    const cards = [
      { icon: 'flame', kicker: 'Your week', big: `${w.activeDays}/7`, label: 'days you showed up', foot: w.activeDays >= 5 ? 'That is a proper rhythm.' : w.activeDays > 0 ? 'Every day counts for the streak.' : 'A fresh page. Your move.' },
      { icon: 'bolt', kicker: 'Score', big: `${w.xp}`, label: 'XP this week', foot: `Level ${snap.level}, ${snap.xpIntoLevel} of ${snap.xpForNext} to the next.` },
      { icon: 'sunrise', kicker: 'Check-ins', big: `${w.checkins}`, label: plural(w.checkins, 'wake-up check-in').replace(/^\d+ /, ''), foot: w.early ? `${plural(w.early, 'was', 'were')} before 8.` : 'Early mornings are optional.' },
      { icon: 'check', kicker: 'Tasks', big: `${w.tasksDone}`, label: 'tasks finished', foot: `${plural(w.quests, 'quest')} done, ${plural(w.events, 'event')} added.` },
      { icon: 'star', kicker: 'Best day', big: w.best ? WEEKDAYS_LONG[dateOfKey(w.best).getDay()] : 'None yet', label: w.best ? `${plural(w.bestCount, 'thing')} done` : 'No activity this week', foot: w.best ? fmtDate(dateOfKey(w.best), { month: 'long', day: 'numeric' }) : 'Check in to start one.', small: true },
    ];
    if (w.daysWithNumbers) {
      cards.push({ icon: 'steps', kicker: 'Your numbers', big: w.steps !== null ? fmtNumber(w.steps) : (w.sleep !== null ? minutesToHM(w.sleep) : `${w.hr}`), label: w.steps !== null ? 'steps a day, on average' : (w.sleep !== null ? 'sleep a night, on average' : 'resting heart rate, on average'),
        foot: [w.sleep !== null && w.steps !== null ? `Sleep ${minutesToHM(w.sleep)}` : '', w.hr !== null && (w.steps !== null || w.sleep !== null) ? `Resting HR ${w.hr}` : ''].filter(Boolean).join(' · ') || 'From numbers you entered.' });
    }
    cards.push({ icon: 'crown', kicker: 'This week you were', big: w.title, label: '', foot: 'Your title for the week.', small: true });
    return cards;
  }

  // ------------------------------------------------------------ share image (drawn locally on a canvas)
  function cssVar(name, fallback) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback; }

  async function shareImage(w, snap, label) {
    const W = 1080, H = 1350;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const accent = cssVar('--accent', '#c6f432'), accent2 = cssVar('--accent-2', '#9be84a'), ink = cssVar('--on-accent', '#0f1115');
    const grad = g.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, accent); grad.addColorStop(1, accent2);
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    g.fillStyle = ink;
    const font = (px, wt = 800) => { g.font = `${wt} ${px}px ui-rounded, system-ui, -apple-system, "Segoe UI", sans-serif`; };
    g.textBaseline = 'alphabetic';
    font(46, 800); g.fillText('Daybeat', 80, 120);
    font(40, 650); g.globalAlpha = 0.75; g.fillText(label, 80, 180); g.globalAlpha = 1;
    font(60, 700); g.fillText('This week I was', 80, 420);
    font(w.title.length > 10 ? 150 : 190, 850); g.fillText(w.title, 80, 600);
    const rows = [[`${w.activeDays}/7`, 'days showed up'], [`${w.xp}`, 'XP earned'], [`${w.quests}`, 'quests done']];
    rows.forEach(([big, small], i) => {
      const x = 80 + i * 320;
      font(120, 850); g.fillText(big, x, 900);
      font(36, 650); g.globalAlpha = 0.8; g.fillText(small, x, 960); g.globalAlpha = 1;
    });
    font(36, 650); g.globalAlpha = 0.75; g.fillText(`Level ${snap.level}`, 80, 1240); g.fillText('Made on my own device. No account.', 80, 1290); g.globalAlpha = 1;

    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    if (!blob) { toast('Could not make the image.'); return; }
    const file = new File([blob], 'daybeat-week.png', { type: 'image/png' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'My week on Daybeat' }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    const url = URL.createObjectURL(blob);
    const sheet = openSheet({
      title: 'Your week, as an image',
      content: h('div', { class: 'stack' },
        h('img', { class: 'share-preview', src: url, alt: `Week summary: ${w.title}, ${w.activeDays} of 7 days, ${w.xp} XP`, width: 270, height: 338 }),
        h('p', { class: 'muted' }, 'Press and hold the image to save it, or use the button.'),
        h('a', { class: 'btn btn--primary btn--block', href: url, download: 'daybeat-week.png' }, icon('download'), 'Download image')),
      footer: [h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => sheet.close('ok') }, 'Close')],
      onClose: () => URL.revokeObjectURL(url),
    });
  }

  // ------------------------------------------------------------ page
  function render() {
    const now = new Date();
    const todayKey = dates.todayKey(now);
    const ws = store.settings.get('weekStart', 1);
    const thisStart = dates.weekStart(todayKey, ws);
    const startKey = which === 'this' ? thisStart : dates.addDays(thisStart, -7);
    const snap = game.snapshot({ now });
    const w = weekStats(startKey);
    const label = which === 'this' ? 'This week' : 'Last week';
    const cards = wrappedCards(w, snap);

    root.replaceChildren(
      pageHead({ eyebrow: 'Recap', title: 'Your week', lede: 'A look back at what you got done.' }),
      h('div', { class: 'stack-lg' + (first ? ' stagger' : '') },
        h('section', { class: 'wrapped', 'aria-label': 'Week wrapped' },
          h('div', { class: 'section-head' },
            h('h2', null, 'Week wrapped'),
            segmented({ label: 'Which week', value: which, options: [{ value: 'this', label: 'This week' }, { value: 'last', label: 'Last week' }], onChange: (v) => { which = v; keepFocus(root, render); } })),
          h('ul', { class: 'plain story', tabindex: '0', 'aria-label': `${label}: swipe through ${cards.length} cards` },
            ...cards.map((c, i) => h('li', { class: 'story__card' + (c.small ? ' is-small' : ''), 'aria-label': `${c.kicker}: ${c.big} ${c.label}` },
              h('span', { class: 'story__icon' }, icon(c.icon)),
              h('p', { class: 'story__kicker' }, c.kicker),
              h('p', { class: 'story__big num' }, c.big),
              c.label ? h('p', { class: 'story__label' }, c.label) : null,
              h('p', { class: 'story__foot' }, c.foot),
              h('span', { class: 'story__count num' }, `${i + 1}/${cards.length}`)))),
          h('div', { class: 'cluster' },
            h('button', { type: 'button', class: 'btn btn--primary', onclick: () => shareImage(w, snap, label) }, icon('share'), 'Share as image'),
            h('span', { class: 'faint' }, 'Made on this device. Nothing is uploaded.'))),
        h('a', { class: 'card tile-link', href: '#/garmin', 'aria-label': 'Open your Garmin numbers' },
          h('span', { class: 'row__icon' }, icon('watch')),
          h('span', { class: 'row__body' }, h('span', { class: 'row__title' }, 'Steps, sleep and heart rate'), h('span', { class: 'row__sub' }, 'Charts, goals and personal bests live on the Garmin page.')),
          h('span', { class: 'row__trail' }, icon('chevron-right'))),
      ),
    );
    first = false;

    // opening the recap counts as the "look back" action (once per week, handled by the rules engine)
    if (!awarded && which === 'this') {
      awarded = true;
      game.award('recap').then((r) => { if (r && !r.duplicate) showAward(r); }).catch(() => {});
    }
  }

  keepFocus(root, render);
  ctx.watch(['daily', 'checkin', 'message', 'event', 'demo', 'import', 'wipe', 'bulk', 'action'], () => keepFocus(root, render));
}
