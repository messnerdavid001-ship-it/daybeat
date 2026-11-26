// Pings (route id "messages"): things YOU save: quick add, paste from clipboard, pin, search.
// Honest by design: the app cannot read notifications from a watch. A URL with text in it is hostile input:
// it only ever produces a draft that the user confirms (and in a plain iPhone browser tab it is NOT stored).
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { openSheet } from '../ui/sheet.js';
import { showAward } from '../ui/rewards.js';
import { fmtTime, fmtDate, plural, dateOfKey } from '../ui/format.js';
import { dayLabel } from '../ui/events.js';
import { replaceHash } from '../ui/router.js';
import { detect } from '../ui/install.js';
import { pageHead, emptyState, dataMissingCard, keepFocus } from '../ui/parts.js';

const PAGE = 100;

function mergeAwards(list) {
  const out = { xpGained: 0, leveledUp: false, level: 1, questsCompleted: [], badgesEarned: [], weeklyCompleted: false };
  for (const r of list) {
    if (!r) continue;
    out.xpGained += r.xpGained || 0;
    out.leveledUp = out.leveledUp || !!r.leveledUp;
    out.level = r.level || out.level;
    out.questsCompleted.push(...(r.questsCompleted || []));
    out.badgesEarned.push(...(r.badgesEarned || []));
    out.weeklyCompleted = out.weeklyCompleted || !!r.weeklyCompleted;
  }
  return out;
}

export function mount(root, ctx) {
  if (!ctx.data) { root.replaceChildren(dataMissingCard()); return; }
  const { store, game, dates, capture } = ctx.data;
  let query = '';
  let pinnedOnly = false;
  let shown = PAGE;
  let first = true;

  const pref = () => store.settings.get('timeFormat', 'auto');

  // ------------------------------------------------------------ saving
  async function saveDrafts(drafts) {
    const saved = await store.putMany('message', drafts);
    const results = [];
    for (const rec of saved.slice(0, 20)) results.push(await game.award('message', { ref: rec.id }));
    showAward(mergeAwards(results));
    return saved.length;
  }

  // ------------------------------------------------------------ composer (built once, so typing is never interrupted)
  const text = h('textarea', { class: 'input textarea', id: 'ping-text', rows: 3, maxlength: 4000, placeholder: 'Type or paste something worth keeping...' });
  const from = h('input', { class: 'input', type: 'text', id: 'ping-from', maxlength: 80, placeholder: 'From (optional)', autocomplete: 'off' });
  const feedback = h('p', { class: 'form-error', role: 'alert', hidden: true });

  async function quickAdd() {
    feedback.hidden = true;
    const t = text.value.trim();
    if (!t) { feedback.textContent = 'Write something first.'; feedback.hidden = false; text.focus(); return; }
    try {
      const rec = await store.put('message', { text: t, from: from.value.trim(), at: new Date().toISOString(), via: 'manual', pinned: false, tags: [] });
      text.value = ''; from.value = '';
      toast('Saved.');
      showAward(await game.award('message', { ref: rec.id }));
      text.focus();
    } catch (e) { feedback.textContent = e.message || 'Could not save that.'; feedback.hidden = false; }
  }

  async function pasteFromClipboard() {
    feedback.hidden = true;
    let clip = '';
    try {
      clip = await navigator.clipboard.readText();
    } catch (e) {
      feedback.textContent = 'This browser would not let us read the clipboard. Press and hold in the box above and choose Paste instead.';
      feedback.hidden = false;
      text.focus();
      return;
    }
    if (!clip || !clip.trim()) { feedback.textContent = 'The clipboard is empty.'; feedback.hidden = false; return; }
    previewDrafts(capture.fromText(clip), 'From your clipboard');
  }

  function previewDrafts(res, heading, opts = {}) {
    const drafts = res.drafts || [];
    const n = drafts.length;
    const sheet = openSheet({
      title: n === 1 ? 'Add this ping?' : `Add ${plural(n, 'ping')}?`,
      content: h('div', { class: 'stack' },
        heading ? h('p', { class: 'eyebrow' }, heading) : null,
        n ? h('ul', { class: 'plain draft-list' }, ...drafts.slice(0, 5).map((d) => h('li', { class: 'draft user-text' },
          d.from ? h('strong', null, d.from + ': ') : null, d.text.length > 400 ? d.text.slice(0, 400) + '...' : d.text))) : h('p', { class: 'muted' }, 'Nothing usable in there.'),
        n > 5 ? h('p', { class: 'faint' }, `and ${n - 5} more`) : null,
        res.truncated ? h('p', { class: 'faint' }, 'That was a lot of text, so only the first part is shown.') : null,
        opts.note || null,
      ),
      footer: [
        h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => sheet.close('cancel') }, 'Not now'),
        n ? h('button', { type: 'button', class: 'btn btn--primary', onclick: async () => {
          try { const c = await saveDrafts(drafts); sheet.close('ok'); toast(c === 1 ? 'Saved.' : `Saved ${c} pings.`); } catch (e) { toast(e.message || 'Could not save those.'); }
        } }, n === 1 ? 'Add ping' : `Add ${n}`) : null,
      ],
      onClose: opts.onClose,
    });
  }

  const composer = h('section', { class: 'card composer', 'aria-label': 'Quick add' },
    h('label', { class: 'field-label', for: 'ping-text' }, 'Quick add'),
    text,
    h('div', { class: 'composer__row' },
      h('div', { class: 'composer__from' }, h('label', { class: 'sr-only', for: 'ping-from' }, 'From'), from),
      h('button', { type: 'button', class: 'btn btn--ghost', onclick: pasteFromClipboard }, icon('clipboard'), 'Paste from clipboard'),
      h('button', { type: 'button', class: 'btn btn--primary', onclick: quickAdd }, icon('plus'), 'Add')),
    feedback,
    h('p', { class: 'faint' }, 'Pings are notes you save yourself. This app cannot read the notifications on your watch.'),
  );

  text.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); quickAdd(); } });

  // ------------------------------------------------------------ list
  const search = h('input', { class: 'input', type: 'search', id: 'ping-search', placeholder: 'Search pings', autocomplete: 'off', 'aria-label': 'Search pings',
    oninput: (e) => { query = e.target.value.trim().toLowerCase(); shown = PAGE; renderList(); } });
  const pinFilter = h('button', { type: 'button', class: 'chip chip--button', 'aria-pressed': 'false', onclick: (e) => {
    pinnedOnly = !pinnedOnly; e.currentTarget.setAttribute('aria-pressed', String(pinnedOnly)); e.currentTarget.classList.toggle('chip--accent', pinnedOnly); shown = PAGE; renderList();
  } }, icon('pin'), 'Pinned');
  const listHost = h('div', { class: 'ping-list' });

  async function togglePin(m) { try { await store.update('message', m.id, { pinned: !m.pinned }); } catch (e) { toast(e.message); } }
  async function removePing(m) {
    const copy = { ...m };
    try {
      await store.remove('message', m.id);
      toast('Ping deleted.', { action: { label: 'Undo', onClick: async () => { try { await store.put('message', copy); } catch (e) { toast(e.message); } } } });
    } catch (e) { toast(e.message); }
  }
  async function copyPing(m) {
    try { await navigator.clipboard.writeText(m.text); toast('Copied.'); } catch (e) { toast('Could not copy. Press and hold the text to select it.'); }
  }

  // long pings are cut to a few lines with a Show more toggle, so one 4000-character paste cannot bury the list
  function longText(t) {
    const p = h('p', { class: 'ping__text user-text' + (t.length > 280 ? ' is-clamped' : '') }, t);
    if (t.length <= 280) return p;
    const more = h('button', { type: 'button', class: 'linklike', 'aria-expanded': 'false', onclick: () => {
      const open = p.classList.toggle('is-clamped') === false;
      more.textContent = open ? 'Show less' : 'Show more';
      more.setAttribute('aria-expanded', String(open));
    } }, 'Show more');
    return h('div', null, p, more);
  }

  function pingCard(m) {
    return h('li', null,
      h('article', { class: 'ping' + (m.pinned ? ' is-pinned' : '') },
        h('p', { class: 'ping__meta user-text' }, m.from ? m.from + ' \u00b7 ' : '', fmtTime(new Date(m.at), pref()), m.source === 'demo' ? ' \u00b7 sample' : ''),
        longText(m.text),
        h('div', { class: 'ping__actions' },
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Copy ping', onclick: () => copyPing(m), 'data-fk': 'cp-' + m.id }, icon('copy')),
          h('button', { type: 'button', class: 'icon-btn' + (m.pinned ? ' is-on' : ''), 'aria-label': m.pinned ? 'Unpin ping' : 'Pin ping', 'aria-pressed': String(!!m.pinned), onclick: () => togglePin(m), 'data-fk': 'pin-' + m.id }, icon('pin')),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Delete ping', onclick: () => removePing(m), 'data-fk': 'rm-' + m.id }, icon('trash'))),
      ),
    );
  }

  function renderList() {
    keepFocus(listHost, () => {
      const total = store.count('message');
      let items = store.list('message'); // newest first
      if (pinnedOnly) items = items.filter((m) => m.pinned);
      if (query) items = items.filter((m) => m.text.toLowerCase().includes(query) || (m.from || '').toLowerCase().includes(query));

      if (total === 0) {
        listHost.replaceChildren(h('div', { class: 'card' }, emptyState({ iconName: 'message', title: 'Nothing saved yet',
          text: 'A reminder, a text you do not want to lose, a thought at 2 a.m. Type it in the box above and it lives here.',
          actions: [h('button', { type: 'button', class: 'btn btn--primary', onclick: () => text.focus() }, 'Write the first one')] })));
        return;
      }
      if (items.length === 0) {
        listHost.replaceChildren(h('div', { class: 'card' }, emptyState({ iconName: 'search', compact: true, title: 'No match', text: query ? 'Try a different word.' : 'Nothing is pinned yet.' })));
        return;
      }

      const today = dates.todayKey();
      const groups = [];
      for (const m of items.slice(0, shown)) {
        const key = dates.dayKey(m.at);
        const last = groups[groups.length - 1];
        if (last && last.key === key) last.items.push(m); else groups.push({ key, items: [m] });
      }
      const nodes = [];
      for (const g of groups) {
        nodes.push(h('h2', { class: 'day-head' }, dayLabel(g.key, today, dates)));
        nodes.push(h('ul', { class: 'plain stack' }, ...g.items.map(pingCard)));
      }
      if (items.length > shown) {
        nodes.push(h('button', { type: 'button', class: 'btn btn--ghost btn--block', 'data-fk': 'more', onclick: () => { shown += PAGE; renderList(); } }, `Show more (${items.length - shown} left)`));
      }
      listHost.replaceChildren(...nodes);
    });
  }

  // ------------------------------------------------------------ text arriving in the URL (hostile input)
  // Never saved from here. A link only ever fills a panel the user reads: copy it, or (outside an iPhone browser
  // tab, where the storage is the same as the installed app's) drop it into the quick-add box to review and send.
  function handleIncoming() {
    if (!ctx.query.has('text') && !ctx.query.has('add')) return;
    const qs = new URLSearchParams(ctx.query);
    if (qs.has('add') && !qs.has('text')) qs.set('text', qs.get('add'));
    const res = capture.fromQuery('?' + qs.toString());
    replaceHash('#/messages');                           // strip the text from the address bar and history
    if (!res.drafts || res.drafts.length === 0) return;
    const d = detect();
    const wrongStore = d.os === 'ios' && !d.standalone;  // Safari tab and Home Screen app do not share storage
    const joined = res.drafts.map((x) => (x.from ? x.from + ': ' : '') + x.text).join('\n\n');
    const sheet = openSheet({
      title: wrongStore ? 'You opened this in the browser' : 'Someone sent you text',
      content: h('div', { class: 'stack' },
        h('p', { class: 'muted' }, wrongStore
          ? 'The installed Daybeat app keeps its own data, separate from this browser tab, so nothing was saved here. Copy the text and paste it into the installed app (Pings, then Paste from clipboard).'
          : 'It came from a link, so nothing was saved. Copy it, or put it in the quick-add box to look it over first.'),
        h('p', { class: 'draft user-text' }, joined.length > 600 ? joined.slice(0, 600) + '...' : joined)),
      footer: [
        h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => sheet.close('close') }, 'Close'),
        wrongStore ? null : h('button', { type: 'button', class: 'btn btn--tonal', onclick: () => { text.value = joined.slice(0, 4000); sheet.close('use'); text.focus(); } }, 'Use in quick add'),
        h('button', { type: 'button', class: 'btn btn--primary', onclick: async () => {
          try { await navigator.clipboard.writeText(joined); toast('Copied.'); } catch (e) { toast('Could not copy. Select the text and copy it by hand.'); }
        } }, icon('copy'), 'Copy text'),
      ],
    });
  }

  // ------------------------------------------------------------ mount
  root.replaceChildren(
    pageHead({ eyebrow: 'Pings', title: 'Your messages', lede: 'Things you saved yourself, in one place.' }),
    h('div', { class: 'stack-lg' + (first ? ' stagger' : '') },
      composer,
      h('div', { class: 'toolbar' }, h('div', { class: 'toolbar__search' }, h('span', { class: 'toolbar__icon' }, icon('search')), search), pinFilter),
      listHost,
    ),
  );
  first = false;
  renderList();
  ctx.watch(['message', 'settings', 'demo', 'import', 'wipe', 'bulk'], renderList);
  handleIncoming();
}
