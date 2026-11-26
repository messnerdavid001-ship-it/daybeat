// Quick capture: turn pasted text (or a hostile URL query) into message DRAFTS. Never writes to the store.
// The UI shows the drafts, lets the user edit them, and only then calls store.putMany('message', drafts).

import { cleanText, truncate, toInstant, LIMITS } from './schema.js';

const MAX_PASTE_CHARS = 200000;
const FROM_RE = /^([\p{L}\p{N} .'_-]{1,40}):\s+([\s\S]+)$/u;

function makeDraft(text, from, atIso, via) {
  const clean = truncate(cleanText(text, { multiline: true }), 4000);
  if (!clean) return null;
  return { text: clean, from: truncate(cleanText(from ?? ''), 80), at: atIso, via };
}

/** Pasted text -> drafts. Blocks are separated by blank lines; a leading "Name: " becomes the sender. */
export function fromText(text, { at, now } = {}) {
  if (typeof text !== 'string') return { drafts: [], truncated: false };
  let truncated = false;
  let s = text;
  if (s.length > MAX_PASTE_CHARS) {
    s = s.slice(0, MAX_PASTE_CHARS);
    truncated = true;
  }
  const atIso = toInstant(at) ?? toInstant(now ?? new Date()) ?? new Date().toISOString();
  const drafts = [];
  for (const block of s.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n+/)) {
    const b = block.trim();
    if (!b) continue;
    let from = '';
    let body = b;
    const m = FROM_RE.exec(b);
    if (m && !/^(https?|ftp|mailto|tel)$/i.test(m[1].trim())) {
      from = m[1];
      body = m[2];
    }
    const d = makeDraft(body, from, atIso, 'paste');
    if (d) drafts.push(d);
    if (drafts.length >= LIMITS.pasteDrafts) {
      truncated = true;
      break;
    }
  }
  return { drafts, truncated };
}

/**
 * Parse the query part of a route such as "text=Hello&from=Sam&at=2026-11-25T10:00:00Z" (a leading "?" or "#" is ok).
 * Never throws. A URL is hostile input: the UI must show the draft and ask before saving.
 */
export function fromQuery(search, { now } = {}) {
  const empty = { drafts: [], truncated: false };
  if (typeof search !== 'string' || search.length > 200000) return { ...empty, truncated: typeof search === 'string' };
  let params;
  try {
    params = new URLSearchParams(search.replace(/^[?#]/, '').replace(/^.*\?/, ''));
  } catch {
    return empty;
  }
  let text = params.get('text') ?? params.get('add');
  if (!text) return empty;
  let truncated = false;
  if (text.length > LIMITS.queryTextChars) {
    text = text.slice(0, LIMITS.queryTextChars);
    truncated = true;
  }
  const atRaw = params.get('at');
  let atIso = null;
  if (atRaw && /^\d{9,11}$/.test(atRaw)) atIso = toInstant(Number(atRaw) * 1000);
  else if (atRaw) atIso = toInstant(atRaw);
  const d = makeDraft(text, params.get('from') ?? '', atIso ?? toInstant(now ?? new Date()), 'shortcut');
  return { drafts: d ? [d] : [], truncated };
}

export const capture = { fromText, fromQuery };
