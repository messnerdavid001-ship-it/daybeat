// The ONLY module the UI imports from the data layer.
//   import { store, game, demo, backup, ics, capture, dates, sw, DataError } from '../data/index.js';
// See docs/TEAM_BRIEF.md section 6 for the contract.

import { createStore } from './store.js';
import { createGame } from './game.js';
import { createDemo } from './demo.js';
import { createBackup } from './backup.js';
import { createIcs } from './ics.js';
import { createGarminExport } from './garmin-export.js';
import { createTasks } from './tasks.js';
import { buildCalendar, REMIND_CHOICES } from './cal-export.js';

export const store = createStore();
export const game = createGame(store);
export const demo = createDemo(store);
export const backup = createBackup(store);
export const ics = createIcs(store);
export const garminExport = createGarminExport(store);
export const tasks = createTasks(store, game);
export const calendarExport = { build: buildCalendar, REMIND_CHOICES };

export { capture } from './capture.js';
export { sw } from './sw-client.js';
export * as dates from './dates.js';
export { DataError, KINDS, LIMITS, SCHEMA_VERSION, BACKUP_FORMAT } from './schema.js';
