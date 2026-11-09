/**
 * Applies the saved theme before first paint.
 *
 * chrome.storage is async and popup.js is a module (so it runs after the
 * document parses), which together would show a frame of the wrong theme
 * every time the popup opens. This reads a localStorage mirror of the
 * setting synchronously instead; popup.js keeps chrome.storage as the real
 * source of truth and rewrites the mirror whenever it changes.
 *
 * Loaded as a separate file rather than inline because the MV3 content
 * security policy forbids inline scripts in extension pages.
 */
(function () {
  try {
    var theme = localStorage.getItem('qm-theme');
    if (theme === 'light' || theme === 'dark') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  } catch (e) {
    // Private mode or blocked storage: fall back to following the OS.
  }
})();
