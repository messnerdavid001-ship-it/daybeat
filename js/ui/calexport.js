// "Add to my Calendar": builds the .ics (tasks + alarms with alerts) on this device and hands it to the phone.
// Shared by Tasks, Calendar and Alarms. Nothing is uploaded.
import { h } from './dom.js';
import { icon } from './icons.js';
import { toast } from './toast.js';
import { openSheet } from './sheet.js';
import { plural } from './format.js';

export function openCalendarExport(data) {
  const { store, calendarExport } = data;
  const open = store.list('task').filter((t) => !t.done && t.due);
  const alarms = store.list('alarm').filter((a) => a.enabled);
  let lead = 10;
  const sel = h('select', { class: 'input', id: 'ex-lead', onchange: (e) => { lead = Number(e.target.value); } },
    ...calendarExport.REMIND_CHOICES.map((c) => h('option', { value: String(c.value), selected: c.value === lead }, c.label)));
  const sheet = openSheet({
    title: 'Add to my Calendar',
    content: h('div', { class: 'stack' },
      h('p', { class: 'muted' }, 'Daybeat cannot ring when it is closed. Your phone\u2019s Calendar can. This makes a small calendar file with alerts built in. The file is made on this device and goes nowhere else.'),
      h('p', { class: 'muted' }, `${plural(open.length, 'task')} with a date and ${plural(alarms.length, 'alarm')} will go in the file.`),
      h('div', null, h('label', { class: 'field-label', for: 'ex-lead' }, 'Alert for tasks'), sel),
      h('ol', { class: 'steps' },
        h('li', null, 'Tap Share file, then choose Calendar. If your browser downloads it instead, open the downloaded file.'),
        h('li', null, 'Tap Add All. Your tasks and alarms appear in Calendar with alerts.'),
        h('li', null, 'Change things later? Delete the old Daybeat calendar entries first, then add the new file, so nothing doubles up.')),
      h('p', { class: 'faint' }, 'Garmin watches can show phone calendar events and notifications you allow in the Garmin Connect app. Whether an alert buzzes your watch depends on your watch and phone settings, so try it once with a test task.')),
    footer: [
      h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => sheet.close('cancel') }, 'Cancel'),
      h('button', { type: 'button', class: 'btn btn--primary', onclick: () => deliver() }, icon('share'), 'Share file'),
    ],
  });

  async function deliver() {
    const built = calendarExport.build({ tasks: store.list('task'), alarms: store.list('alarm') }, { remindMin: lead });
    if (!built.counts.tasks && !built.counts.alarms) { toast('Nothing to send yet. Give a task a date or switch on an alarm.'); return; }
    const file = new File([built.text], built.filename, { type: 'text/calendar' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Daybeat reminders' }); sheet.close('shared'); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    const url = URL.createObjectURL(new Blob([built.text], { type: 'text/calendar' }));
    const a = h('a', { href: url, download: built.filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('File saved. Open it to add the reminders.');
    sheet.close('downloaded');
  }
}
