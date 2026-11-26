// Turns the result of game.award() into feedback: a toast, confetti, and a sheet for level-ups and new badges.
// Text comes from the rules engine (plain text) and is rendered as text nodes.
import { h } from './dom.js';
import { iconOr } from './icons.js';
import { toast } from './toast.js';
import { celebrate } from './celebrate.js';
import { openSheet } from './sheet.js';

function rewardSheet({ iconName, title, text, kicker }) {
  const sheet = openSheet({
    title,
    content: h('div', { class: 'reward' },
      h('div', { class: 'reward__art' }, iconOr(iconName, 'sparkle')),
      kicker ? h('p', { class: 'eyebrow' }, kicker) : null,
      text ? h('p', { class: 'muted' }, text) : null,
    ),
    footer: [h('button', { type: 'button', class: 'btn btn--primary', onclick: () => sheet.close('ok') }, 'Nice')],
    initialFocus: (dlg) => dlg.querySelector('.sheet__foot .btn'),
  });
  celebrate({ y: 0.3, count: 120 });
  return sheet;
}

/** result = value returned by game.award(). origin = optional {x,y} 0..1 for the confetti burst. */
export function showAward(result, origin) {
  if (!result) return;
  const lines = [];
  if (result.xpGained > 0) lines.push(`+${result.xpGained} XP`);
  for (const q of result.questsCompleted || []) lines.push(`Quest done: ${q.title}`);
  if (result.weeklyCompleted) lines.push('Weekly challenge done');
  if (lines.length) toast(lines.join('  ·  '));

  if (result.milestoneReached) {
    rewardSheet({ iconName: 'flame', kicker: 'Streak milestone', title: `${result.milestoneReached} days`, text: 'Day after day. That is how it is done.' });
  } else if (result.leveledUp) {
    rewardSheet({ iconName: 'bolt', kicker: 'Level up', title: `Level ${result.level}`, text: 'You are on a roll. Keep the beat going.' });
  } else if ((result.badgesEarned || []).length) {
    const b = result.badgesEarned[0];
    rewardSheet({ iconName: b.icon, kicker: 'New badge', title: b.title, text: b.desc });
  } else if ((result.questsCompleted || []).length || result.weeklyCompleted) {
    celebrate({ x: origin ? origin.x : 0.5, y: origin ? origin.y : 0.5, count: 50, duration: 1100 });
  }
}

/** Center of an element as viewport fractions, for confetti origins. */
export function originOf(el) {
  const r = el.getBoundingClientRect();
  return { x: (r.left + r.width / 2) / window.innerWidth, y: (r.top + r.height / 2) / window.innerHeight };
}
