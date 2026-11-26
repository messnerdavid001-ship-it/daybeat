// App-wide notices shown under the top bar on every page:
//  - storage problems (data will not survive / app is read-only)
//  - "Sample data" banner while demo mode is on
//  - iPhone browser-tab hint: install first, because the Safari tab and the Home Screen app keep separate data
import { h, qs } from './dom.js';
import { icon } from './icons.js';
import { toast } from './toast.js';
import { detect, openInstallGuide, onInstallStateChange } from './install.js';
import { go } from './router.js';

// Slim one- or two-line strip: icon, short text, small actions. Detail lives behind the action, not in the strip.
function banner({ tone = '', iconName, title, text, actions = [] }) {
  return h('div', { class: 'banner banner--slim ' + tone, role: 'group', 'aria-label': title },
    h('span', { class: 'banner__glyph' }, icon(iconName)),
    h('p', { class: 'banner__body' }, h('strong', null, title), text ? ' ' + text : null),
    h('div', { class: 'banner__actions' }, ...actions),
  );
}

const btn = (label, onclick, cls = 'btn btn--tonal btn--sm') => h('button', { type: 'button', class: cls, onclick }, label);

export function mountNotices({ data, storeInfo }) {
  const host = qs('#notices');
  if (!host) return;

  function render() {
    const items = [];

    if (storeInfo && storeInfo.readOnly) {
      items.push(banner({
        tone: 'banner--warn', iconName: 'info', title: 'Update needed.',
        text: 'Your data was saved by a newer version, so this copy is read-only.',
        actions: [btn('Reload', () => location.reload())],
      }));
    }

    if (storeInfo && storeInfo.degraded) {
      items.push(banner({
        tone: 'banner--warn', iconName: 'info', title: 'Changes will not be kept.',
        text: (storeInfo.warnings && storeInfo.warnings[0]) || 'This browser is not letting the app save data. What you add will be lost when you close it.',
        actions: [btn('Back up now', () => go('settings'))],
      }));
    }

    if (data && data.demo && data.demo.isActive()) {
      items.push(banner({
        iconName: 'sparkle', title: 'Sample data.',
        text: 'All made up.',
        actions: [btn('Clear', async () => {
          try { await data.demo.clear(); toast('Sample data cleared. Your own entries stay.'); }
          catch (e) { toast(e.message || 'Could not clear sample data.'); }
        })],
      }));
    }

    const d = detect();
    const dismissed = data ? data.store.settings.get('installHintDismissed', false) : false;
    if (d.os === 'ios' && !d.standalone && !dismissed) {
      items.push(banner({
        iconName: 'phone', title: 'Install first, then add your data.',
        text: '',
        actions: [
          btn('How', () => openInstallGuide()),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Dismiss this hint', onclick: async () => {
            try { if (data) await data.store.settings.set('installHintDismissed', true); } catch (e) { /* ignore */ }
            render();
          } }, icon('x')),
        ],
      }));
    }

    host.replaceChildren(...items);
  }

  render();
  if (data) data.store.onChange(render);
  onInstallStateChange(render);
}
