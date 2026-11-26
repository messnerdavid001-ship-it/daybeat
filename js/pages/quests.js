// Quests: level, streak (with rest day), daily quest + weekly challenge, badge shelf, recent XP.
import { h } from '../ui/dom.js';
import { icon, iconOr } from '../ui/icons.js';
import { ring } from '../ui/ring.js';
import { openSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { showAward, originOf } from '../ui/rewards.js';
import { fmtDate, fmtTime, plural, dateOfKey, WEEKDAYS_LETTER } from '../ui/format.js';
import { pageHead, dataMissingCard, keepFocus } from '../ui/parts.js';
import { questsCard } from '../ui/questcards.js';

const MILESTONES = [3, 7, 14, 30, 50, 100, 365];

const TYPE_LABEL = {
  visit: 'Opened the app', checkin: 'Checked in', message: 'Saved a ping', event: 'Added an event',
  alarm: 'Changed an alarm', import: 'Imported a file', recap: 'Looked at your recap',
};

export function mount(root, ctx) {
  if (!ctx.data) { root.replaceChildren(dataMissingCard()); return; }
  const { store, game, dates } = ctx.data;
  let first = true;

  async function markTask(quest, button) {
    try { showAward(await game.award('task', { ref: quest.id }), button ? originOf(button) : undefined); }
    catch (e) { toast(e.message || 'Could not mark that done.'); }
  }

  function badgeSheet(b) {
    const sheet = openSheet({
      title: b.title,
      content: h('div', { class: 'reward' },
        h('div', { class: 'reward__art' + (b.earned ? '' : ' is-locked') }, b.earned ? iconOr(b.icon) : icon('lock')),
        h('p', { class: 'muted' }, b.desc),
        h('p', { class: 'chip ' + (b.earned ? 'chip--good' : '') }, b.earned
          ? `Earned${b.earnedAt ? ' ' + fmtDate(new Date(b.earnedAt), { month: 'short', day: 'numeric', year: 'numeric' }) : ''}`
          : 'Not yet. Keep going.')),
      footer: [h('button', { type: 'button', class: 'btn btn--primary', onclick: () => sheet.close('ok') }, 'Close')],
    });
  }

  function levelCard(snap) {
    return h('section', { class: 'card level-card span-2', 'aria-label': 'Level' },
      ring({ value: snap.levelProgress, size: 124, stroke: 12, animate: first, center: h('div', { class: 'level__num' }, h('small', null, 'LEVEL'), h('span', { class: 'num level__big' }, String(snap.level))) }),
      h('div', { class: 'level-card__body' },
        h('h2', { class: 'card__title' }, `${snap.xp} XP total`),
        h('p', { class: 'card__sub' }, `${snap.xpIntoLevel} of ${snap.xpForNext} to level ${snap.level + 1}.`),
        h('p', { class: 'faint' }, 'XP is just a score for showing up. It unlocks nothing and costs nothing.'),
      ),
    );
  }

  function streakCard(snap, todayKey) {
    const st = snap.streak;
    const from = dates.addDays(todayKey, -34);
    const active = new Set(store.list('action', { from, to: dates.addDays(todayKey, 1) }).filter((a) => game.TYPES.includes(a.type)).map((a) => a.day));
    // 5 rows x 7 columns, columns follow the weekday of the first shown day
    const cells = Array.from({ length: 35 }, (_, i) => {
      const key = dates.addDays(from, i);
      return { key, on: active.has(key), today: key === todayKey, letter: WEEKDAYS_LETTER[dateOfKey(key).getDay()], d: dateOfKey(key) };
    });
    const nextMs = st.nextMilestone || MILESTONES.find((m) => m > st.current);
    return h('section', { class: 'card streak-card span-2', 'aria-label': 'Streak' },
      h('div', { class: 'streak-card__top' },
        h('span', { class: 'streak__flame' + (st.current > 0 ? ' is-lit' : '') }, icon('flame')),
        h('div', null,
          h('p', { class: 'streak-card__num num' }, String(st.current), h('small', null, st.current === 1 ? ' day' : ' days')),
          h('p', { class: 'card__sub' }, st.best > 0 ? `Best: ${plural(st.best, 'day')}` : 'Your streak starts with one tap.')),
        h('div', { class: 'cluster streak-card__chips' },
          h('span', { class: 'chip ' + (st.restDaysLeft ? 'chip--good' : '') }, icon(st.restDaysLeft ? 'check' : 'clock'), st.restDaysLeft ? 'Rest day ready' : 'Rest day used'),
          h('span', { class: 'chip ' + (st.freezes ? 'chip--accent' : '') }, icon('snow'), `${st.freezes || 0} ${st.freezes === 1 ? 'freeze' : 'freezes'}`))),
      h('p', { class: 'muted' }, 'Miss a day and the streak survives. One rest day a week is free, and every 7 days of streak earns a freeze (up to 2).'),
      h('div', { class: 'heat', role: 'img', 'aria-label': `Last 5 weeks: ${cells.filter((c) => c.on).length} active days` },
        ...cells.map((c) => h('span', { class: 'heat__cell' + (c.on ? ' is-on' : '') + (c.today ? ' is-today' : ''), title: fmtDate(c.d) }))),
      h('div', { class: 'milestones' },
        ...MILESTONES.map((m) => h('span', { class: 'chip ' + (st.best >= m ? 'chip--accent' : '') }, st.best >= m ? icon('check') : null, `${m} days`))),
      nextMs ? h('p', { class: 'faint' }, `Next milestone: ${nextMs} days. ${plural(nextMs - st.current, 'day')} to go.`) : h('p', { class: 'faint' }, 'Every milestone reached. Legend.'),
    );
  }

  function badgeShelf(snap) {
    const earned = snap.badges.filter((b) => b.earned).length;
    return h('section', { class: 'card span-2', 'aria-label': 'Badges' },
      h('div', { class: 'section-head' }, h('h2', { class: 'card__title' }, 'Badges'), h('span', { class: 'chip chip--accent' }, `${earned} of ${snap.badges.length}`)),
      h('ul', { class: 'plain badges' },
        ...snap.badges.map((b) => h('li', null,
          h('button', { type: 'button', class: 'badge' + (b.earned ? ' is-earned' : ''), 'data-fk': 'badge-' + b.id, onclick: () => badgeSheet(b), 'aria-label': `${b.title}, ${b.earned ? 'earned' : 'locked'}. ${b.desc}` },
            h('span', { class: 'badge__art' }, b.earned ? iconOr(b.icon) : icon('lock')),
            h('span', { class: 'badge__title' }, b.title))))),
    );
  }

  function xpLog(snap) {
    const rows = store.list('action', { limit: 12 });
    const lookup = (a) => {
      if (a.type === 'quest') return 'Quest: ' + ((snap.quests.concat([snap.weekly]).find((q) => q.id === a.ref) || {}).title || 'done');
      if (a.type === 'weekly') return 'Weekly challenge done';
      if (a.type === 'badge') return 'Badge: ' + ((snap.badges.find((b) => b.id === a.ref) || {}).title || 'earned');
      return TYPE_LABEL[a.type] || 'Activity';
    };
    return h('section', { class: 'card span-2', 'aria-label': 'Recent XP' },
      h('div', { class: 'section-head' }, h('h2', { class: 'card__title' }, 'Recent XP')),
      rows.length
        ? h('ul', { class: 'plain rows' }, ...rows.map((a) => h('li', { class: 'row' },
            h('span', { class: 'row__body' }, h('span', { class: 'row__title' }, lookup(a)),
              h('span', { class: 'row__sub' }, fmtDate(new Date(a.at)) + ', ' + fmtTime(new Date(a.at), store.settings.get('timeFormat', 'auto')))),
            h('span', { class: 'chip' }, a.xp > 0 ? `+${a.xp} XP` : 'capped'))))
        : h('p', { class: 'muted' }, 'Nothing yet. Check in on Today to earn your first XP.'),
    );
  }

  function render() {
    const now = new Date();
    const todayKey = dates.todayKey(now);
    const snap = game.snapshot({ now });
    root.replaceChildren(
      pageHead({ eyebrow: 'Quests', title: 'Level up', lede: 'Small things, done often. That is the whole game.' }),
      h('div', { class: 'bento' + (first ? ' stagger' : '') },
        levelCard(snap),
        streakCard(snap, todayKey),
        questsCard(snap, { onTask: markTask }),
        badgeShelf(snap),
        xpLog(snap),
      ),
    );
    first = false;
  }

  keepFocus(root, render);
  ctx.watch('*', () => keepFocus(root, render));
}
