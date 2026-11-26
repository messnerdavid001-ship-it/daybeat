// Settings & Data: profile, look and feel, install, your data (backup, restore, sample data, delete), about.
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { openSheet } from '../ui/sheet.js';
import { themePicker, accentPicker, segmented } from '../ui/pickers.js';
import { openInstallGuide, runningChip, detect } from '../ui/install.js';
import { APP_NAME, DISCLAIMER } from '../ui/brand.js';
import { showAward } from '../ui/rewards.js';
import { fmtDate, plural, untilText } from '../ui/format.js';
import { keepFocus } from '../ui/parts.js';

const KIND_LABEL = { task: 'tasks', event: 'events', alarm: 'alarms', message: 'pings', checkin: 'check-ins', daily: 'daily numbers', action: 'XP history' };

function card(title, ...children) {
  return h('section', { class: 'card stack', 'aria-label': title }, h('h2', { class: 'card__title' }, title), ...children);
}

const bytesText = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export function mount(root, ctx) {
  const data = ctx.data;
  let first = true;

  // ------------------------------------------------------------ profile + preferences
  function profileCard() {
    if (!data) return null;
    const { store } = data;
    const name = h('input', { class: 'input', type: 'text', id: 'set-name', maxlength: 40, autocomplete: 'nickname', placeholder: 'Your name or nickname', value: store.settings.get('name', ''),
      onchange: async (e) => { try { await store.settings.set('name', e.target.value.trim()); toast('Saved.'); } catch (err) { toast(err.message); } } });
    const set = (key) => async (v) => { try { await store.settings.set(key, v); } catch (err) { toast(err.message); } };
    return card('You',
      h('div', null, h('label', { class: 'field-label', for: 'set-name' }, 'Name'), name, h('p', { class: 'field-hint' }, 'Used for the greeting on Today. Stays on this device.')),
      h('div', null, h('p', { class: 'field-label' }, 'Week starts on'),
        segmented({ label: 'Week starts on', value: store.settings.get('weekStart', 1), onChange: set('weekStart'), options: [{ value: 1, label: 'Mon' }, { value: 0, label: 'Sun' }, { value: 6, label: 'Sat' }] })),
      h('div', null, h('p', { class: 'field-label' }, 'Clock'),
        segmented({ label: 'Clock', value: store.settings.get('timeFormat', 'auto'), onChange: set('timeFormat'), options: [{ value: 'auto', label: 'Auto' }, { value: '12h', label: '12-hour' }, { value: '24h', label: '24-hour' }] })),
    );
  }

  function lookCard() {
    return card('Look and feel',
      h('div', null, h('p', { class: 'field-label' }, 'Theme'), themePicker(), h('p', { class: 'field-hint' }, 'Auto follows your phone or computer.')),
      h('div', null, h('p', { class: 'field-label' }, 'Accent colour'), accentPicker()),
    );
  }

  function installCard() {
    const d = detect();
    return card('Install the app',
      h('div', { class: 'cluster' }, runningChip()),
      h('p', { class: 'muted' }, d.standalone
        ? 'You are using the installed app. It opens full screen and works offline.'
        : 'Install first, then add your data. The browser and the installed app keep separate copies.'),
      d.standalone ? null : h('div', { class: 'cluster' },
        h('button', { type: 'button', class: 'btn btn--primary', onclick: () => openInstallGuide() }, icon('plus-square'), 'How to install')),
    );
  }

  // ------------------------------------------------------------ export
  const refreshSoon = () => setTimeout(() => { if (root.isConnected) keepFocus(root, render); }, 400);
  async function exportBackup() {
    const { backup, game } = data;
    let f;
    try { f = await backup.exportFile(); } catch (e) { toast(e.message || 'Could not make a backup.'); return; }
    const file = new File([f.blob], f.filename, { type: 'application/json' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Daybeat backup' });
        toast('Backup shared. Keep it somewhere safe.');
        await award();
        refreshSoon();
        return;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return;   // the user closed the share sheet
      // anything else: fall through to the manual options
    }
    exportFallback(f);
    refreshSoon();
    async function award() { try { showAward(await game.award('backup', { ref: 'backup' })); } catch (e) { /* not important */ } }
  }

  function exportFallback(f) {
    const { game } = data;
    const url = URL.createObjectURL(f.blob);
    const area = h('textarea', { class: 'input textarea mono', readonly: true, rows: 5, 'aria-label': 'Backup text', onfocus: (e) => e.target.select() });
    area.value = f.text;
    const done = async () => { try { showAward(await game.award('backup', { ref: 'backup' })); } catch (e) { /* ignore */ } };
    const sheet = openSheet({
      title: 'Save your backup',
      content: h('div', { class: 'stack' },
        h('p', { class: 'muted' }, `${f.filename} (${bytesText(f.bytes)}). Pick whichever works on this device.`),
        h('a', { class: 'btn btn--primary btn--block', href: url, download: f.filename, onclick: () => { setTimeout(done, 300); } }, icon('download'), 'Download the file'),
        h('button', { type: 'button', class: 'btn btn--tonal btn--block', onclick: async () => {
          try { await navigator.clipboard.writeText(f.text); toast('Backup text copied. Paste it into a note or a file.'); done(); } catch (e) { area.focus(); toast('Could not copy. Select the text below and copy it by hand.'); }
        } }, icon('copy'), 'Copy backup text'),
        h('div', null, h('p', { class: 'field-label' }, 'Or select it by hand'), area),
      ),
      footer: [h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => sheet.close('ok') }, 'Close')],
      onClose: () => URL.revokeObjectURL(url),
    });
  }

  // ------------------------------------------------------------ import
  const picker = h('input', { type: 'file', accept: '.json,application/json,text/plain', hidden: true, 'aria-hidden': 'true', tabindex: '-1', onchange: async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try { previewImport(file, await data.backup.importAll(file, { mode: 'merge', dryRun: true })); }
    catch (err) { toast(err.message || 'That does not look like a Daybeat backup.'); }
  } });

  function previewImport(file, dry) {
    let mode = 'merge';
    const lines = Object.entries(dry.counts || {}).filter(([, c]) => c.added || c.updated).map(([k, c]) => `${(c.added || 0) + (c.updated || 0)} ${KIND_LABEL[k] || k}`);
    const summary = h('p', { class: 'muted' });
    const refresh = (d) => { summary.textContent = d.added || d.updated ? `${d.added} new, ${d.updated} updated${d.skipped ? `, ${d.skipped} skipped` : ''}.` : 'Nothing new in that file.'; };
    refresh(dry);
    const sheet = openSheet({
      title: 'Restore a backup?',
      content: h('div', { class: 'stack' },
        h('p', { class: 'muted' }, `${file.name.slice(0, 60)}${dry.exportedAt ? ', made ' + fmtDate(new Date(dry.exportedAt), { month: 'short', day: 'numeric', year: 'numeric' }) : ''}`),
        lines.length ? h('p', { class: 'chips-line' }, ...lines.map((l) => h('span', { class: 'chip' }, l))) : null,
        summary,
        segmented({ label: 'How to restore', value: 'merge', options: [{ value: 'merge', label: 'Merge' }, { value: 'replace', label: 'Replace all' }],
          onChange: async (v) => { mode = v; try { refresh(await data.backup.importAll(file, { mode: v, dryRun: true })); } catch (e) { toast(e.message); } } }),
        h('p', { class: 'faint' }, 'Merge keeps what is here and adds what is new. Replace swaps everything here for what is in the file. A safety copy is kept so you can undo.'),
      ),
      footer: [
        h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => sheet.close('cancel') }, 'Cancel'),
        h('button', { type: 'button', class: 'btn btn--primary', onclick: async () => {
          try {
            const rep = await data.backup.importAll(file, { mode });
            sheet.close('ok');
            toast(`Restored: ${rep.added} new, ${rep.updated} updated.`, { action: { label: 'Undo', onClick: async () => { try { await data.backup.undoLastImport(); toast('Import undone.'); } catch (e) { toast(e.message); } } } });
          } catch (e) { toast(e.message || 'Could not restore that file.'); }
        } }, 'Restore'),
      ],
    });
  }

  // ------------------------------------------------------------ delete everything
  function deleteSheet() {
    const input = h('input', { class: 'input', type: 'text', id: 'del-confirm', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'DELETE' });
    const go = h('button', { type: 'button', class: 'btn btn--danger-solid', disabled: true, onclick: async () => {
      try {
        await data.store.wipeAll({ confirmed: true });
        sheet.close('done');
        toast('Everything is deleted from this device.');
      } catch (e) { toast(e.message || 'Could not delete.'); }
    } }, icon('trash'), 'Delete everything');
    input.addEventListener('input', () => { go.disabled = input.value.trim().toUpperCase() !== 'DELETE'; });
    const sheet = openSheet({
      title: 'Delete everything?',
      content: h('div', { class: 'stack' },
        h('p', null, 'This removes all tasks, events, alarms, pings, check-ins, Garmin numbers, your streak, XP and badges, and your settings from this device. It cannot be undone.'),
        h('button', { type: 'button', class: 'btn btn--tonal', onclick: exportBackup }, icon('download'), 'Download a backup first'),
        h('div', null, h('label', { class: 'field-label', for: 'del-confirm' }, 'Type DELETE to confirm'), input),
      ),
      footer: [h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => sheet.close('cancel') }, 'Keep my data'), go],
      initialFocus: () => null,
    });
  }

  // ------------------------------------------------------------ data card
  function dataCard() {
    if (!data) return card('Your data', h('p', { class: 'muted' }, 'Storage is not available in this browser, so nothing can be saved or backed up.'));
    const { store, backup, demo } = data;
    const counts = store.counts();
    const last = store.settings.get('lastBackupAt', '');
    const hasUser = store.hasUserData();
    const lastText = last ? `Last backup ${untilText(new Date(last).getTime() - Date.now())}` : 'No backup yet';
    const old = last ? Date.now() - new Date(last).getTime() > 14 * 86400000 : true;
    const undo = backup.canUndo();
    const persistChip = h('span', { class: 'chip' }, 'Checking...');
    const persistBtn = h('button', { type: 'button', class: 'btn btn--ghost btn--sm', hidden: true, onclick: async () => {
      const ok = await store.requestPersistence();
      toast(ok ? 'Protected. The browser will not clear this data to free space.' : 'The browser said no. A backup is the safe way to keep it.');
      checkPersist();
    } }, 'Ask the browser to protect it');
    const usage = h('span', { class: 'faint' });
    async function checkPersist() {
      let p = false;
      try { p = !!(navigator.storage && navigator.storage.persisted && await navigator.storage.persisted()); } catch (e) { /* ignore */ }
      persistChip.textContent = p ? 'Protected from clean-up' : 'Not protected from clean-up';
      persistChip.className = 'chip ' + (p ? 'chip--good' : '');
      persistBtn.hidden = p;
      try { const est = await store.estimate(); if (est) usage.textContent = `Using ${bytesText(est.usage)}.`; } catch (e) { /* ignore */ }
    }
    checkPersist();

    return card('Your data',
      h('p', { class: 'muted' }, 'It all lives on this device, in this browser or app. Nothing is uploaded. If you lose the phone, a backup is how you keep your streak.'),
      h('div', { class: 'chips-line' },
        ...Object.entries(counts).filter(([k, n]) => n > 0 && k !== 'action').map(([k, n]) => h('span', { class: 'chip' }, `${n} ${KIND_LABEL[k] || k}`))),
      h('div', { class: 'cluster' }, persistChip, persistBtn, usage),

      h('div', { class: 'divider' }),
      h('div', { class: 'stack' },
        h('div', { class: 'cluster' }, h('h3', { class: 'card__title' }, 'Backup'), h('span', { class: 'chip ' + (old && hasUser ? 'chip--warn' : '') }, lastText)),
        old && hasUser ? h('p', { class: 'muted' }, 'Your data lives only on this phone. Make a backup so a lost phone is not a lost streak.') : null,
        h('div', { class: 'cluster' },
          h('button', { type: 'button', class: 'btn btn--primary', 'data-fk': 'export', onclick: exportBackup }, icon('share'), 'Back up now'),
          h('button', { type: 'button', class: 'btn btn--ghost', 'data-fk': 'import', onclick: () => picker.click() }, icon('upload'), 'Restore from a file')),
        undo ? h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: async () => { try { await backup.undoLastImport(); toast('Import undone.'); } catch (e) { toast(e.message); } } }, 'Undo the last restore') : null,
      ),

      h('div', { class: 'divider' }),
      h('div', { class: 'stack' },
        h('h3', { class: 'card__title' }, 'Sample data'),
        demo.isActive()
          ? h('div', { class: 'cluster' }, h('p', { class: 'muted' }, 'Made-up tasks, events, alarms and Garmin numbers are mixed in so you can look around.'), h('button', { type: 'button', class: 'btn btn--tonal', onclick: async () => { try { await demo.clear(); toast('Sample data cleared. Your own entries stay.'); } catch (e) { toast(e.message); } } }, 'Clear sample data'))
          : h('div', { class: 'cluster' }, h('p', { class: 'muted' }, 'Want to look around again? Add the made-up sample data back.'), h('button', { type: 'button', class: 'btn btn--ghost', onclick: async () => { try { await demo.load(); toast('Sample data added.'); } catch (e) { toast(e.message); } } }, 'Load sample data')),
      ),
    );
  }

  function dangerCard() {
    if (!data) return null;
    return h('section', { class: 'card stack danger', 'aria-label': 'Delete everything' },
      h('h2', { class: 'card__title' }, 'Delete everything'),
      h('p', { class: 'muted' }, 'Wipes all data and settings from this device. Back up first if there is anything you want to keep.'),
      h('div', null, h('button', { type: 'button', class: 'btn btn--danger', 'data-fk': 'wipe', onclick: deleteSheet }, icon('trash'), 'Delete everything…')),
    );
  }

  function aboutCard() {
    const ver = h('span', { class: 'faint' }, '');
    if (data && data.sw && data.sw.version) data.sw.version().then((v) => { if (v) ver.textContent = `Build ${String(v).slice(0, 12)}`; }).catch(() => {});
    return card(`About ${APP_NAME}`,
      h('p', null, 'No account. No ads. No tracking. Nothing leaves this device, and nothing is ever sent to us.'),
      h('p', { class: 'muted' }, 'Daybeat plans your day: tasks, calendar and alarms, plus your Garmin numbers. A web app cannot ring when it is closed, send you notifications or sync with your watch, so for real alerts use Add to my Calendar and keep important alarms on your watch or phone clock. Calendar events come from a file you import, Garmin numbers from the export zip you pick, and everything else is entered by you.'),
      h('p', null, h('a', { class: 'btn btn--ghost btn--sm', href: '#/messages' }, icon('message'), 'Pings (saved messages)')),
      h('p', { class: 'faint' }, DISCLAIMER),
      ver,
    );
  }

  function render() {
    root.replaceChildren(
      h('header', { class: 'page-head' }, h('p', { class: 'eyebrow' }, 'Settings and data'), h('h1', null, 'Make it yours')),
      h('div', { class: 'stack' + (first ? ' stagger' : '') },
        profileCard(), lookCard(), dataCard(), installCard(), dangerCard(), aboutCard(), picker),
    );
    first = false;
  }

  render();
  // 'settings' changes come from this page itself (theme, name...): re-rendering would drop keyboard focus
  if (data) ctx.watch(['demo', 'import', 'wipe', 'bulk', 'message', 'event', 'alarm', 'checkin', 'task', 'daily'], () => keepFocus(root, render));
}
