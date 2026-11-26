// The page table. One source for the sidebar, the phone tab bar and the router.
// `tab: true` = shown in the 5-slot phone tab bar. The rest sit in the top bar on phones. `hidden: true` = routable but not in any menu.
// Every page module exports:  mount(root, ctx) -> optional cleanup function (sync or async)

export const ROUTES = [
  { id: 'today',    label: 'Today',    icon: 'today',    tab: true,  load: () => import('../pages/today.js') },
  { id: 'tasks',    label: 'Tasks',    icon: 'tasks',    tab: true,  load: () => import('../pages/tasks.js') },
  { id: 'calendar', label: 'Calendar', icon: 'calendar', tab: true,  load: () => import('../pages/calendar.js') },
  { id: 'alarms',   label: 'Alarms',   icon: 'alarm',    tab: true,  load: () => import('../pages/alarms.js') },
  { id: 'garmin',   label: 'Garmin',   icon: 'watch',    tab: true,  load: () => import('../pages/garmin.js') },
  { id: 'quests',   label: 'Quests',   icon: 'quests',   tab: false, load: () => import('../pages/quests.js') },
  { id: 'insights', label: 'Recap',    icon: 'insights', tab: false, load: () => import('../pages/insights.js') },
  { id: 'settings', label: 'Settings', icon: 'settings', tab: false, load: () => import('../pages/settings.js') },
  // Pings (saved messages) is no longer in the main navigation; it is reached from Settings. The route still works.
  { id: 'messages', label: 'Pings',    icon: 'message',  tab: false, hidden: true, load: () => import('../pages/messages.js') },
];

export const DEFAULT_ROUTE = 'today';
export const routeById = (id) => ROUTES.find((r) => r.id === id);
