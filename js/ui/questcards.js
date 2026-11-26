// Daily quest card + weekly challenge, shared by Today and Quests.
import { h } from './dom.js';
import { icon, iconOr } from './icons.js';

// where each quest points the user
const QUEST_LINKS = { q_wake: '#/today', q_finish: '#/tasks', q_triple: '#/tasks', q_addtask: '#/tasks', q_plan: '#/calendar', q_tune: '#/alarms', q_look: '#/insights' };

/** onTask(quest, buttonEl) is called when the user taps Done on a self-reported quest. */
export function questsCard(snap, { onTask } = {}) {
  const { quests, weekly } = snap;
  const doneCount = quests.filter((q) => q.done).length;
  const gold = quests.length > 0 && doneCount === quests.length;
  return h('section', { class: 'card quests span-2' + (gold ? ' is-gold' : ''), 'aria-label': 'Daily quest' },
    h('div', { class: 'section-head' },
      h('h2', { class: 'card__title' }, gold ? 'Gold day' : 'Daily quest'),
      h('span', { class: 'chip ' + (gold ? 'chip--gold' : 'chip--accent') }, gold ? icon('star') : null, `${doneCount} of ${quests.length}`),
    ),
    gold ? h('p', { class: 'card__sub' }, 'All three done. That is a gold day.') : null,
    h('ul', { class: 'plain quest-list' },
      ...quests.map((q) => {
        const to = QUEST_LINKS[q.id];
        const isTask = q.metric === 'task' && !q.done;
        const body = [
          h('span', { class: 'quest__icon' }, q.done ? icon('check') : iconOr(q.icon)),
          h('span', { class: 'quest__body' },
            h('span', { class: 'quest__title' }, q.title),
            h('span', { class: 'quest__desc' }, q.desc),
            h('span', { class: 'quest__xp num' }, q.goal > 1 && !q.done ? `${q.progress}/${q.goal} \u00b7 ` : '', `+${q.xp} XP`)),
          isTask && onTask
            ? h('button', { type: 'button', class: 'btn btn--tonal btn--sm quest__action', 'data-fk': 'task-' + q.id, 'aria-label': `Mark done: ${q.title}`, onclick: (e) => onTask(q, e.currentTarget) }, 'Done')
            : (to && !q.done ? h('span', { class: 'quest__chev' }, icon('chevron-right')) : null),
        ];
        if (isTask) return h('li', null, h('div', { class: 'quest' }, ...body));
        return h('li', null, to && !q.done
          ? h('a', { class: 'quest', href: to }, ...body)
          : h('div', { class: 'quest' + (q.done ? ' is-done' : '') }, ...body));
      }),
    ),
    h('div', { class: 'weekly' + (weekly.done ? ' is-done' : '') },
      h('span', { class: 'quest__icon' }, weekly.done ? icon('check') : iconOr(weekly.icon)),
      h('div', { class: 'weekly__body' },
        h('p', { class: 'quest__title' }, `This week: ${weekly.title}`),
        h('p', { class: 'quest__desc' }, weekly.desc),
        h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': weekly.goal, 'aria-valuenow': weekly.progress, 'aria-label': weekly.title },
          h('span', { style: { width: Math.round((weekly.progress / weekly.goal) * 100) + '%' } })),
      ),
      h('span', { class: 'num weekly__count' }, `${weekly.progress}/${weekly.goal}`),
    ),
  );
}
