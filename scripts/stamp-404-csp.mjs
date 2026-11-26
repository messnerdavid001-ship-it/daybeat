#!/usr/bin/env node
// Recomputes the CSP hashes of the single inline <style> and <script> in 404.html and writes them into
// its <meta http-equiv="Content-Security-Policy">. Run after editing 404.html. `--check` only verifies.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function computeHashes(html) {
  const style = /<style>([\s\S]*?)<\/style>/.exec(html);
  const script = /<script>([\s\S]*?)<\/script>/.exec(html);
  if (!style || !script) throw new Error('404.html must contain exactly one inline <style> and one inline <script>');
  const h = (s) => 'sha256-' + crypto.createHash('sha256').update(s, 'utf8').digest('base64');
  return { style: h(style[1]), script: h(script[1]) };
}

export function stamp(html) {
  const { style, script } = computeHashes(html);
  return html
    .replace(/style-src '[^']*'/, `style-src '${style}'`)
    .replace(/script-src '[^']*'/, `script-src '${script}'`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = path.join(ROOT, '404.html');
  const html = fs.readFileSync(file, 'utf8');
  const next = stamp(html);
  if (process.argv.includes('--check')) {
    if (next !== html) {
      console.error('404.html CSP hashes are stale. Run: node scripts/stamp-404-csp.mjs');
      process.exit(1);
    }
    console.log('404.html CSP hashes are current.');
  } else {
    fs.writeFileSync(file, next);
    console.log('404.html CSP hashes updated.');
  }
}
