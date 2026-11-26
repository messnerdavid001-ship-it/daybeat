// Finishing a task from any page: tick animation, XP feedback and an Undo toast. One place so every page behaves the same.
import { toast } from './toast.js';
import { showAward, originOf } from './rewards.js';
import { fmtDate, dateOfKey } from './format.js';

export async function finishTask(data, task, btn) {
  const { tasks, dates } = data;
  if (btn) { btn.disabled = true; btn.classList.add('is-popping'); }
  try {
    const res = await tasks.complete(task.id);
    const a = res.award;
    const big = a && (a.milestoneReached || a.leveledUp || (a.badgesEarned || []).length || (a.questsCompleted || []).length || a.weeklyCompleted);
    if (big) showAward(a, btn ? originOf(btn) : undefined);
    const xp = !big && a && a.xpGained ? `  ·  +${a.xpGained} XP` : '';   // a big award already toasted its XP
    let msg = `Done${xp}`;
    if (res.nextDue) {
      const today = dates.todayKey();
      msg = `Done. Next one: ${tasks.dueWords(res.nextDue, today) || fmtDate(dateOfKey(res.nextDue))}${xp}`;
    }
    toast(msg, { action: { label: 'Undo', onClick: async () => { try { await tasks.restore(res.previous); } catch (e) { toast(e.message); } } } });
    return res;
  } catch (e) {
    if (btn) { btn.disabled = false; btn.classList.remove('is-popping'); }
    toast(e.message || 'Could not finish that task.');
    return null;
  }
}
