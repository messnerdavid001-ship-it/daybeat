// Wake-up / daily check-in: one record per day (id ci-YYYY-MM-DD), then XP via the rules engine.
import { toast } from './toast.js';
import { showAward, originOf } from './rewards.js';

export const MOODS = ['', 'Rough', 'Meh', 'Okay', 'Good', 'Great'];
let busy = false;

/** mood 0 = no mood. `button` (optional) is where the confetti starts. Returns the saved record or null. */
export async function checkInNow(data, mood, button) {
  if (busy) return null;
  busy = true;
  try {
    const { store, game, dates } = data;
    const day = dates.todayKey();
    const rec = await store.put('checkin', { id: 'ci-' + day, day, at: new Date().toISOString(), alarmId: '', mood, note: '' });
    const result = await game.award('checkin', { ref: rec.id });
    showAward(result, button ? originOf(button) : undefined);
    return rec;
  } catch (e) {
    toast((e && e.message) || 'Could not save that check-in.');
    return null;
  } finally { busy = false; }
}
