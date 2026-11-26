/* Classic (non-module) script, loaded blocking in <head> so the right theme is on the page
   before first paint (no flash of the wrong theme). No inline script: the CSP forbids it.
   Keep in sync with js/ui/theme.js (same keys, same colours). */
(function () {
  var root = document.documentElement;
  var theme = 'system';
  var accent = 'volt';
  try {
    theme = localStorage.getItem('app.theme') || 'system';
    accent = localStorage.getItem('app.accent') || 'volt';
  } catch (e) { /* storage blocked: fall back to system + violet */ }

  var prefersLight = false;
  try { prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches; } catch (e) {}
  var resolved = theme === 'light' || theme === 'dark' ? theme : (prefersLight ? 'light' : 'dark');

  root.setAttribute('data-theme', resolved);
  root.setAttribute('data-theme-pref', theme);
  root.setAttribute('data-accent', accent);
  root.classList.add('js');

  var color = resolved === 'light' ? '#f6f2ea' : '#0f1115';
  var metas = document.querySelectorAll('meta[name="theme-color"]');
  for (var i = 0; i < metas.length; i++) {
    metas[i].setAttribute('content', color);
    metas[i].removeAttribute('media');
  }
})();
