// Icon set: simple 24x24 stroke icons drawn for this app. Static constants only.
import { svgFromConstant } from './dom.js';

const PATHS = {
  tasks:     '<rect x="4" y="4" width="16" height="16" rx="4.5"/><path d="M8.5 12.2l2.5 2.5 4.5-5"/>',
  watch:     '<rect x="7" y="6.5" width="10" height="11" rx="3"/><path d="M9.5 6.5l.7-3h3.6l.7 3M9.5 17.5l.7 3h3.6l.7-3M12 10v2.2l1.4.9"/>',
  repeat:    '<path d="M4 11V9a3 3 0 0 1 3-3h11l-2.5-2.5M20 13v2a3 3 0 0 1-3 3H6l2.5 2.5"/>',
  flag:      '<path d="M6 21V4M6 5h11l-2 4 2 4H6"/>',
  inbox:     '<path d="M4 13l2.2-7A2 2 0 0 1 8.1 4.6h7.8a2 2 0 0 1 1.9 1.4L20 13v4.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V13zM4 13h4.5l1 2h5l1-2H20"/>',
  today:     '<circle cx="12" cy="12" r="4"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7"/>',
  calendar:  '<rect x="3.5" y="5" width="17" height="15.5" rx="3.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  alarm:     '<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4.2l2.6 1.6M4 5.4l3-2.2M20 5.4l-3-2.2"/>',
  message:   '<path d="M6 4.5h12A3.5 3.5 0 0 1 21.5 8v7a3.5 3.5 0 0 1-3.5 3.5h-6.2L7 21.5v-3H6A3.5 3.5 0 0 1 2.5 15V8A3.5 3.5 0 0 1 6 4.5z"/>',
  quests:    '<path d="M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M7 6H4v1.5A3.5 3.5 0 0 0 7.5 11M17 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5M12 14v4M8.5 20.5h7"/>',
  insights:  '<path d="M5 20v-8M12 20V5M19 20v-5"/>',
  settings:  '<path d="M4 7h8M18 7h2M4 17h2M12 17h8"/><circle cx="15" cy="7" r="2.6"/><circle cx="9" cy="17" r="2.6"/>',
  flame:     '<path d="M12 3c.7 3.4 5 5.3 5 10a5 5 0 0 1-10 0c0-1.9.9-3.1 1.9-4.1.3 1.3.9 2 1.7 2.3C10.3 8.3 10.9 5.6 12 3z"/>',
  bolt:      '<path d="M13 2.8 5.5 13.2H11l-1 8 7.5-10.4H12l1-8z"/>',
  check:     '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  plus:      '<path d="M12 5v14M5 12h14"/>',
  x:         '<path d="M6 6l12 12M18 6L6 18"/>',
  'chevron-right': '<path d="M9 5l7 7-7 7"/>',
  'chevron-left':  '<path d="M15 5l-7 7 7 7"/>',
  'chevron-down':  '<path d="M5 9l7 7 7-7"/>',
  share:     '<path d="M12 15V3.8M8 7.3l4-4 4 4M8 10H6.5A2.5 2.5 0 0 0 4 12.5v6A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5v-6a2.5 2.5 0 0 0-2.5-2.5H16"/>',
  'plus-square': '<rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><path d="M12 8v8M8 12h8"/>',
  download:  '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
  upload:    '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 19.5h14"/>',
  moon:      '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>',
  sun:       '<circle cx="12" cy="12" r="4"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7"/>',
  auto:      '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/>',
  lock:      '<rect x="5" y="10.5" width="14" height="10" rx="3"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  info:      '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.8v.01"/>',
  sparkle:   '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z"/>',
  phone:     '<rect x="7" y="2.5" width="10" height="19" rx="3"/><path d="M10.5 18.5h3"/>',
  desktop:   '<rect x="3.5" y="4.5" width="17" height="11.5" rx="2.5"/><path d="M8.5 20h7M12 16v4"/>',
  trash:     '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 12a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9l.8-12"/>',
  heart:     '<path d="M12 20.5s-8-4.8-8-10.6A4.4 4.4 0 0 1 12 7.4a4.4 4.4 0 0 1 8 2.5c0 5.8-8 10.6-8 10.6z"/>',
  moonstar:  '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>',
  star:      '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9 6.8 19.7l1-5.9L3.5 9.7l5.9-.8L12 3.5z"/>',
  target:    '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  rocket:    '<path d="M12 3c3 2 5 5.5 5 9.5l-2 3h-6l-2-3C7 8.5 9 5 12 3z"/><circle cx="12" cy="10" r="1.6"/><path d="M9 15.5L6.5 19M15 15.5l2.5 3.5M12 18v3"/>',
  crown:     '<path d="M3.5 8l4.5 4 4-6.5 4 6.5 4.5-4-1.5 10h-14L3.5 8z"/>',
  sunrise:   '<path d="M3 18h18M7.5 14.5a4.5 4.5 0 0 1 9 0M12 5.5V8M5.2 9.7l1.7 1.5M18.8 9.7l-1.7 1.5M3 14.5h2M19 14.5h2"/>',
  pencil:    '<path d="M4.5 19.5l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8.5 18.5l-4 1z"/><path d="M14.5 6.5l3 3"/>',
  pin:       '<path d="M9 4h6l-1 5 3 3H7l3-3-1-5zM12 12v8"/>',
  search:    '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  copy:      '<rect x="8.5" y="8.5" width="12" height="12" rx="3"/><path d="M15.5 8.5V6.5a3 3 0 0 0-3-3h-6a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h2"/>',
  clipboard: '<rect x="5" y="4.5" width="14" height="16.5" rx="3"/><path d="M9 4.5h6V7H9z"/>',
  medal:     '<circle cx="12" cy="14.5" r="5.5"/><path d="M8.5 9.5L6.5 3.5h4l1.5 3 1.5-3h4l-2 6"/>',
  'calendar-check': '<rect x="3.5" y="5" width="17" height="15.5" rx="3.5"/><path d="M3.5 10h17M8 3v4M16 3v4M9 15l2 2 4-4"/>',
  clock:     '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  steps:     '<path d="M8 4.5c1.7 0 2.5 1.4 2.5 3.2 0 2-1 3.3-2.5 3.3S5.5 9.700 5.500 7.700C5.500 5.900 6.300 4.500 8 4.500zM8 13.500c1.200 0 2 .6 2 1.600v1.400a1.700 1.700 0 0 1-3.400 0v-1.400c0-1 .2-1.600 1.400-1.600zM16 9c1.700 0 2.500 1.400 2.500 3.200 0 2-1 3.300-2.500 3.300s-2.500-1.300-2.500-3.300C13.500 10.400 14.300 9 16 9z"/>',
  moon2:     '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>',
  heartbeat: '<path d="M3 12h4l2-4 3 8 2-4h7"/>',
  'mood-1':  '<circle cx="12" cy="12" r="9"/><circle cx="8.8" cy="10" r="1" fill="currentColor"/><circle cx="15.2" cy="10" r="1" fill="currentColor"/><path d="M8.5 16c1-1.300 2.200-1.900 3.500-1.900s2.500.6 3.500 1.900"/>',
  'mood-2':  '<circle cx="12" cy="12" r="9"/><circle cx="8.8" cy="10" r="1" fill="currentColor"/><circle cx="15.2" cy="10" r="1" fill="currentColor"/><path d="M9 15.500h6"/>',
  'mood-3':  '<circle cx="12" cy="12" r="9"/><circle cx="8.8" cy="10" r="1" fill="currentColor"/><circle cx="15.2" cy="10" r="1" fill="currentColor"/><path d="M9 14.500c1 .8 2 1.200 3 1.200s2-.4 3-1.200"/>',
  'mood-4':  '<circle cx="12" cy="12" r="9"/><circle cx="8.8" cy="10" r="1" fill="currentColor"/><circle cx="15.2" cy="10" r="1" fill="currentColor"/><path d="M8.500 14c1 1.800 2.200 2.600 3.500 2.600s2.500-.8 3.500-2.600"/>',
  'mood-5':  '<circle cx="12" cy="12" r="9"/><circle cx="8.8" cy="9.500" r="1" fill="currentColor"/><circle cx="15.2" cy="9.500" r="1" fill="currentColor"/><path d="M8 13.500h8c0 2.500-1.800 4.200-4 4.200s-4-1.700-4-4.200z"/>',
  snow:      '<path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9M9.5 4.8L12 7.3l2.5-2.5M9.5 19.2L12 16.7l2.5 2.5"/>',
  more:      '<circle cx="5.5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18.5" cy="12" r="1.2" fill="currentColor"/>',
};

export function icon(name, { size, label } = {}) {
  const body = PATHS[name];
  if (!body) throw new Error('Unknown icon: ' + name);
  const svg = svgFromConstant(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false">${body}</svg>`
  );
  if (size) { svg.setAttribute('width', size); svg.setAttribute('height', size); }
  if (label) { svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label); }
  else svg.setAttribute('aria-hidden', 'true');
  return svg;
}

export const ICON_NAMES = Object.keys(PATHS);
export const hasIcon = (name) => Object.prototype.hasOwnProperty.call(PATHS, name);
/** Icon for a name that came from data (e.g. a quest or badge). Unknown names fall back to a sparkle. */
export const iconOr = (name, fallback = 'sparkle', opts) => icon(hasIcon(name) ? name : fallback, opts);
