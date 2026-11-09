import config from './config.js';

/* ==========================================================================
   Storage — one store for everything, with a one-time migration off
   localStorage so saved addresses survive and the service worker can
   read the same values the popup writes.
   ========================================================================== */

const store = {
  get(defaults) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(defaults, (v) => resolve(v || defaults));
      } catch { resolve(defaults); }
    });
  },
  set(obj) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set(obj, () => resolve());
      } catch { resolve(); }
    });
  },
  remove(keys) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.remove(keys, () => resolve());
      } catch { resolve(); }
    });
  }
};

async function migrateLegacyStorage() {
  const { migratedV2 } = await store.get({ migratedV2: false });
  if (migratedV2) return;

  const patch = {};
  try {
    const h = localStorage.getItem('homeAddress');
    const d = localStorage.getItem('destinationAddress');
    if (h) patch.savedStart = h;
    if (d) patch.savedDest = d;
  } catch { /* storage may be unavailable */ }

  patch.migratedV2 = true;
  await store.set(patch);

  try {
    localStorage.removeItem('homeAddress');
    localStorage.removeItem('destinationAddress');
  } catch { /* ignore */ }
}

/* ==========================================================================
   Messaging — never leave the UI stuck if the service worker is torn down.
   ========================================================================== */

function sendMessage(msg, timeoutMs = config.requestTimeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } };
    const timer = setTimeout(() => finish({ ok: false, code: 'TIMEOUT' }), timeoutMs);

    try {
      chrome.runtime.sendMessage(msg, (resp) => {
        if (chrome.runtime.lastError) {
          finish({ ok: false, code: 'DISCONNECTED', error: chrome.runtime.lastError.message });
          return;
        }
        finish(resp || { ok: false, code: 'NO_RESPONSE' });
      });
    } catch (e) {
      finish({ ok: false, code: 'SEND_FAILED', error: String(e) });
    }
  });
}

const ERROR_TEXT = {
  NOT_FOUND: 'Couldn’t find one of those addresses. Try adding a city or ZIP.',
  ZERO_RESULTS: 'No route exists between those places for this travel mode.',
  ROUTE_TOO_LONG: 'That route is too long for Google to calculate in one go.',
  RATE_LIMITED: 'Too many requests right now. Give it a few seconds and try again.',
  DENIED: 'The maps service refused the request. If this keeps happening, please report it.',
  INVALID_REQUEST: 'Something about that route didn’t make sense. Check the addresses and try again.',
  TOO_MANY_STOPS: 'That’s too many stops — keep it to 10 between start and destination.',
  TIMEOUT: 'That took too long to come back. Try again.',
  DISCONNECTED: 'QuickMaps lost its background connection. Try again.',
  NO_RESPONSE: 'No response came back. Try again.',
  SEND_FAILED: 'QuickMaps couldn’t reach its background service. Try reopening the popup.',
  NETWORK: 'Couldn’t reach the maps service. Check your connection.',
  UPSTREAM_ERROR: 'The maps service had a problem. Try again shortly.',
  INTERNAL: 'Something went wrong inside QuickMaps.',
  UNKNOWN_TYPE: 'Something went wrong inside QuickMaps.'
};

function describeError(resp) {
  if (!navigator.onLine) return 'You’re offline. Reconnect and try again.';
  const code = resp && resp.code;
  if (code && ERROR_TEXT[code]) return ERROR_TEXT[code];
  if (resp && resp.error) return String(resp.error);
  return 'Couldn’t work out the distance. Try again.';
}

/* ==========================================================================
   DOM
   ========================================================================== */

const $ = (id) => document.getElementById(id);

const form = $('form');
const homeInput = $('qm-from');
const homeSave = $('qm-from-save');
const destInput = $('qm-to');
const destSave = $('qm-to-save');
const submitBtn = $('submit-button');
const clearBtn = $('clear-button');
const clearStartBtn = $('clearStart');
const clearDestBtn = $('clearDest');
const swapBtn = $('swap-btn');
const addStopBtn = $('add-stop');
const stopsWrap = $('stops');
const saveTripBtn = $('saveTrip');

const resultsBox = $('results');
const travelEl = $('travel-time');
const milesEl = $('mile-count');
const resultNote = $('result-note');
const linkEl = $('directions-link');
const errorBox = $('error-box');

const sidebarToggle = $('sidebarToggle');
const sidebar = $('sidebar');
const tabTrips = $('tabTrips');
const tabHistory = $('tabHistory');
const panelTrips = $('panelTrips');
const panelHistory = $('panelHistory');
const tripList = $('tripList');
const tripSort = $('tripSort');
const tripsEmpty = $('tripsEmpty');
const historyList = $('historyList');
const historyEmpty = $('historyEmpty');
const mileageTotal = $('mileageTotal');
const exportCsvBtn = $('exportCsv');
const clearHistoryBtn = $('clearHistory');

const optionsToggle = $('optionsToggle');
const optionsPanel = $('optionsPanel');
const helpToggle = $('helpToggle');
const helpPanel = $('helpPanel');
const optimizeStops = $('optimizeStops');

const dockToggle = $('dockToggle');
const uiModeNote = $('uiModeNote');

const themeRadios = [$('themeAuto'), $('themeLight'), $('themeDark')].filter(Boolean);
const unitRadios = [$('chipUnitsMi'), $('chipUnitsKm')].filter(Boolean);
const modeRadios = [$('modeDrive'), $('modeWalk'), $('modeBike'), $('modeTransit')].filter(Boolean);
const uiModeRadios = [$('uiPopup'), $('uiPanel')].filter(Boolean);

/* ==========================================================================
   Where are we running?

   A Chrome action popup is closed by the browser the moment it loses
   focus, and no extension can opt out of that. The side panel is the
   supported way to stay open while the user clicks around a page, so
   the same document runs in both and adapts.
   ========================================================================== */

const IS_PANEL = new URLSearchParams(location.search).get('ctx') === 'panel';
const PANEL_SUPPORTED = typeof chrome !== 'undefined' && !!chrome.sidePanel;

// Both elements, because <html> carries the fixed popup width too.
document.documentElement.classList.toggle('ctx-panel', IS_PANEL);
document.body.classList.toggle('ctx-panel', IS_PANEL);

async function setUiMode(mode) {
  const resp = await sendMessage({ type: 'SET_UI_MODE', mode }, 6000);
  return resp && resp.ok;
}

if (dockToggle) {
  if (!PANEL_SUPPORTED) {
    dockToggle.hidden = true;
  } else if (IS_PANEL) {
    dockToggle.textContent = '⇲';
    dockToggle.title = 'Go back to the popup';
    dockToggle.setAttribute('aria-label', 'Go back to the popup');
    dockToggle.addEventListener('click', async () => {
      clearTimeout(draftTimer);
      await saveDraft();
      await setUiMode('popup');
      uiModeRadios.forEach((r) => { r.checked = r.value === 'popup'; });
      await closePanel();
    });
  } else {
    dockToggle.addEventListener('click', async () => {
      await saveDraft();
      try {
        const win = await chrome.windows.getCurrent();
        await setUiMode('panel');
        // Must run inside the click, so the gesture still counts.
        await chrome.sidePanel.open({ windowId: win.id });
        window.close();
      } catch {
        showError('Couldn’t open the side panel. Your Chrome may be too old for it.');
      }
    });
  }
}

/**
 * Close the side panel.
 *
 * Chrome has no sidePanel.close(). window.close() works from inside the
 * panel on current builds; the service worker's disable/re-enable of the
 * panel for this tab is the fallback when it doesn't. Leaving the panel
 * up after switching back to popup mode is what produced two QuickMaps
 * on screen at once.
 */
async function closePanel() {
  await sendMessage({ type: 'CLOSE_PANEL' }, 6000);
  if (IS_PANEL) {
    try { window.close(); } catch { /* the service worker handled it */ }
  }
}

/** Save what's typed, then close whichever surface we're running in. */
async function closeQuickMaps() {
  clearTimeout(draftTimer);
  await saveDraft();
  if (IS_PANEL) await closePanel();
  else { try { window.close(); } catch { /* nothing to do */ } }
}

/* --------------------------------------------------------------------
   The toolbar shortcut opens QuickMaps, but Chrome does not deliver the
   command while the extension's own popup has focus — so pressing it
   again cannot close it from the browser's side. The popup therefore
   watches for that same key itself. We read the real binding from
   chrome.commands rather than hard-coding Alt+Q, so this keeps working
   if the shortcut is reassigned.
   -------------------------------------------------------------------- */

let actionShortcut = null;

function parseShortcut(str) {
  if (!str) return null;
  const out = { alt: false, ctrl: false, shift: false, meta: false, key: '' };
  for (const raw of String(str).split('+')) {
    const part = raw.trim().toLowerCase();
    if (part === 'alt') out.alt = true;
    else if (part === 'ctrl' || part === 'control' || part === 'macctrl') out.ctrl = true;
    else if (part === 'shift') out.shift = true;
    else if (part === 'command' || part === 'cmd' || part === 'meta') out.meta = true;
    else if (part) out.key = part;
  }
  return out.key ? out : null;
}

function matchesShortcut(e, sc) {
  if (!sc) return false;
  if (!!sc.alt !== e.altKey || !!sc.ctrl !== e.ctrlKey) return false;
  if (!!sc.shift !== e.shiftKey || !!sc.meta !== e.metaKey) return false;
  // e.code, because Alt+<letter> can report an alternate character in
  // e.key on some keyboard layouts.
  if (/^[a-z]$/.test(sc.key)) return e.code === 'Key' + sc.key.toUpperCase();
  if (/^[0-9]$/.test(sc.key)) return e.code === 'Digit' + sc.key;
  return (e.key || '').toLowerCase() === sc.key;
}

function loadActionShortcut() {
  try {
    chrome.commands.getAll((cmds) => {
      const cmd = (cmds || []).find((c) => c.name === '_execute_action');
      actionShortcut = parseShortcut(cmd && cmd.shortcut);
      const hint = $('shortcutKeys');
      if (hint && cmd && cmd.shortcut) hint.textContent = cmd.shortcut;
    });
  } catch { /* commands unavailable; Esc still closes */ }
}

uiModeRadios.forEach((r) => r.addEventListener('change', async () => {
  if (!r.checked) return;
  await setUiMode(r.value);
  if (uiModeNote) {
    uiModeNote.textContent = r.value === 'panel'
      ? 'The toolbar button now opens the side panel, which stays open while you browse.'
      : 'The side panel stays open while you click around a page, so you can copy an address without losing what you’ve typed.';
  }
  // Switching to popup while the panel is up would leave both open.
  if (r.value === 'popup') await closePanel();
}));

/* ==========================================================================
   Settings
   ========================================================================== */

const settings = {
  theme: 'auto',
  units: 'imperial',
  mode: 'DRIVE',
  optimize: false
};

async function loadSettings() {
  const s = await store.get({
    theme: 'auto',
    units: 'imperial',
    mode: 'DRIVE',
    optimize: false,
    uiMode: 'popup'
  });
  Object.assign(settings, s);

  applyTheme(settings.theme, false);
  themeRadios.forEach((r) => { r.checked = r.value === settings.theme; });
  unitRadios.forEach((r) => { r.checked = r.value === settings.units; });
  modeRadios.forEach((r) => { r.checked = r.value === settings.mode; });
  uiModeRadios.forEach((r) => { r.checked = r.value === (s.uiMode || 'popup'); });
  if (!PANEL_SUPPORTED) {
    uiModeRadios.forEach((r) => { r.disabled = true; });
    if (uiModeNote) uiModeNote.textContent = 'The side panel needs a newer version of Chrome.';
  }
  if (optimizeStops) optimizeStops.checked = !!settings.optimize;
}

/* --------------------------------------------------------------------
   Theme.

   'auto' removes the attribute so the stylesheet's prefers-color-scheme
   rule takes over; 'light' and 'dark' force it. The choice lives in
   chrome.storage, and is mirrored into localStorage purely so
   theme-init.js can read it synchronously before the first paint.
   -------------------------------------------------------------------- */

function applyTheme(theme, persist = true) {
  const value = (theme === 'light' || theme === 'dark') ? theme : 'auto';
  settings.theme = value;

  if (value === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', value);

  try {
    if (value === 'auto') localStorage.removeItem('qm-theme');
    else localStorage.setItem('qm-theme', value);
  } catch { /* blocked storage: the popup still themes correctly this session */ }

  if (persist) store.set({ theme: value });
}

themeRadios.forEach((r) => r.addEventListener('change', () => {
  if (r.checked) applyTheme(r.value);
}));

unitRadios.forEach((r) => r.addEventListener('change', () => {
  if (!r.checked) return;
  settings.units = r.value === 'metric' ? 'metric' : 'imperial';
  store.set({ units: settings.units });
  hideResults();
}));

modeRadios.forEach((r) => r.addEventListener('change', () => {
  if (!r.checked) return;
  settings.mode = r.value;
  store.set({ mode: settings.mode });
  hideResults();
}));

if (optimizeStops) optimizeStops.addEventListener('change', () => {
  settings.optimize = optimizeStops.checked;
  store.set({ optimize: settings.optimize });
});

function wireDisclosure(button, panel) {
  if (!button || !panel) return;
  button.addEventListener('click', () => {
    const open = panel.hasAttribute('hidden');
    panel.toggleAttribute('hidden', !open);
    button.setAttribute('aria-expanded', String(open));
  });
}
wireDisclosure(optionsToggle, optionsPanel);
wireDisclosure(helpToggle, helpPanel);

/* ==========================================================================
   Results & errors
   ========================================================================== */

function hideResults() {
  resultsBox.hidden = true;
  linkEl.hidden = true;
  linkEl.removeAttribute('href');
  resultNote.hidden = true;
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove('notice');
  errorBox.hidden = false;
}

function showNotice(message) {
  errorBox.textContent = message;
  errorBox.classList.add('notice');
  errorBox.hidden = false;
  setTimeout(() => { if (errorBox.classList.contains('notice')) clearError(); }, 6000);
}

function clearError() {
  errorBox.hidden = true;
  errorBox.classList.remove('notice');
  errorBox.textContent = '';
}

/* ==========================================================================
   Draft — what you've typed survives the popup closing, whichever way
   it closed: clicking away, Esc, or switching windows.
   ========================================================================== */

const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
let draftTimer = null;

function saveDraft() {
  const draft = {
    home: homeInput.value.trim(),
    destination: destInput.value.trim(),
    stops: stopValues(),
    ts: Date.now()
  };
  if (!draft.home && !draft.destination && !draft.stops.length) return store.remove('draft');
  return store.set({ draft });
}

function scheduleDraftSave() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraft, 350);
}

async function restoreDraft() {
  const { draft } = await store.get({ draft: null });
  if (!draft || (Date.now() - (draft.ts || 0)) > DRAFT_MAX_AGE_MS) return false;
  if (!draft.home && !draft.destination && !(draft.stops || []).length) return false;

  if (draft.home) homeInput.value = draft.home;
  if (draft.destination) destInput.value = draft.destination;
  if ((draft.stops || []).length) setStops(draft.stops);
  return true;
}

// The popup can be closed at any moment; flush synchronously-ish on the
// way out so the last keystroke isn't the one that gets lost.
window.addEventListener('pagehide', () => { clearTimeout(draftTimer); saveDraft(); });
window.addEventListener('blur', () => { clearTimeout(draftTimer); saveDraft(); });

/* ==========================================================================
   Autocomplete
   ========================================================================== */

let acSessionToken = newSessionToken();

function newSessionToken() {
  return (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random();
}

/* --------------------------------------------------------------------
   Nearer results first.

   Places Autocomplete ranks globally, so "341" can come back as a street
   in Santiago ahead of one two miles away. Two things pull local results
   up. The Worker biases the query by the request's approximate region
   (see worker/worker.js), and this re-ranks what comes back against the
   addresses already in the form.

   It is a stable sort on a small score, so Google's relevance order is
   preserved within each tier and distant places are never hidden — they
   just stop crowding out the near ones.
   -------------------------------------------------------------------- */

/** Trailing comma-segments of an address: "…, Springfield, IL, USA". */
function regionTokens(address) {
  const parts = String(address || '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length < 2) return null;
  return {
    country: parts[parts.length - 1],
    region: parts[parts.length - 2],
    locality: parts.length >= 3 ? parts[parts.length - 3] : null
  };
}

/** The other addresses already filled in, as ranking context. */
function formRegionHint(exceptEl) {
  const filled = [homeInput, ...Array.from(stopsWrap.querySelectorAll('input[type="text"]')), destInput]
    .filter((el) => el && el !== exceptEl)
    .map((el) => el.value.trim())
    .filter(Boolean);
  for (const addr of filled) {
    const t = regionTokens(addr);
    if (t) return t;
  }
  return null;
}

function rankByRegion(predictions, inputEl) {
  const hint = formRegionHint(inputEl);
  if (!hint || predictions.length < 2) return predictions;

  // Compare whole comma-segments, never substrings. A state abbreviation
  // is short enough to appear inside unrelated words — "IL" sits inside
  // "Milwaukee" — which was enough to float a result from the wrong state
  // above the one the user was actually typing toward.
  const score = (text) => {
    const t = regionTokens(text);
    if (!t) return 0;
    let n = 0;
    if (hint.country && t.country === hint.country) n += 4;
    if (hint.region && t.region === hint.region) n += 2;
    if (hint.locality && t.locality && t.locality === hint.locality) n += 1;
    return n;
  };

  return predictions
    .map((text, i) => ({ text, i, s: score(text) }))
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))
    .map((x) => x.text);
}

function wireAutocomplete(inputEl, boxEl) {
  if (!inputEl || !boxEl) return;

  let timer = null;
  let items = [];
  let index = -1;
  let suppressUntil = 0;
  let seq = 0;              // guards against out-of-order responses
  let showingRecent = false;

  // Chrome offers no supported way to switch its address autofill off, so
  // this removes every signal its heuristics look at: a neutral name, no
  // "address" in the id, placeholder or label, and autocomplete off.
  inputEl.setAttribute('autocomplete', 'off');
  inputEl.setAttribute('name', 'qm-' + Math.random().toString(36).slice(2, 9));
  inputEl.setAttribute('data-lpignore', 'true');
  inputEl.setAttribute('data-1p-ignore', '');
  inputEl.setAttribute('data-form-type', 'other');

  function open() {
    boxEl.classList.add('show');
    inputEl.setAttribute('aria-expanded', 'true');
  }

  function close() {
    boxEl.classList.remove('show');
    inputEl.setAttribute('aria-expanded', 'false');
    index = -1;
  }

  function render(list, heading) {
    boxEl.innerHTML = '';
    items = (list || []).slice(0, 8);
    if (!items.length) { close(); return; }

    if (heading) {
      const h = document.createElement('div');
      h.className = 'item-head';
      h.textContent = heading;
      boxEl.appendChild(h);
    }

    items.forEach((text, i) => {
      const row = document.createElement('div');
      row.className = 'item';
      row.setAttribute('role', 'option');
      row.id = `${boxEl.id}-opt-${i}`;
      row.textContent = text;
      row.addEventListener('mousedown', (e) => { e.preventDefault(); apply(text); });
      boxEl.appendChild(row);
    });

    index = -1;
    open();
  }

  function highlight() {
    const rows = [...boxEl.querySelectorAll('.item')];
    rows.forEach((el, i) => el.classList.toggle('active', i === index));
    if (index >= 0 && rows[index]) {
      rows[index].scrollIntoView({ block: 'nearest' });
      inputEl.setAttribute('aria-activedescendant', rows[index].id);
    } else {
      inputEl.removeAttribute('aria-activedescendant');
    }
  }

  function apply(text) {
    inputEl.value = text;
    items = [];
    close();
    boxEl.innerHTML = '';
    suppressUntil = Date.now() + 600;
    // A selection ends the Places billing session.
    acSessionToken = newSessionToken();
    hideResults();
  }

  async function showRecent() {
    const { history } = await store.get({ history: [] });
    const recent = [];
    const seen = new Set();
    for (const h of history) {
      for (const addr of [h.home, h.destination]) {
        if (!addr) continue;
        const k = addr.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        recent.push(addr);
      }
      if (recent.length >= 5) break;
    }
    if (recent.length && !inputEl.value.trim()) {
      showingRecent = true;
      render(recent.slice(0, 5), 'Recent');
    }
  }

  async function fetchPredictions(q) {
    const mine = ++seq;
    const resp = await sendMessage({
      type: 'AUTOCOMPLETE',
      input: q,
      sessiontoken: acSessionToken,
      country: ''
    }, 9000);

    if (mine !== seq) return;                 // a newer keystroke won
    if (inputEl.value.trim() !== q) return;   // the field moved on
    if (!resp || !resp.ok) return;            // stay quiet; typing still works

    showingRecent = false;
    render(rankByRegion(resp.predictions || [], inputEl));
  }

  inputEl.addEventListener('focus', () => {
    if (Date.now() < suppressUntil) return;
    if (!inputEl.value.trim()) showRecent();
  });

  inputEl.addEventListener('input', () => {
    hideResults();
    if (Date.now() < suppressUntil) return;
    clearTimeout(timer);

    const q = inputEl.value.trim();
    if (!q) { close(); boxEl.innerHTML = ''; return; }
    if (q.length < config.autocompleteMinChars) { close(); return; }

    timer = setTimeout(() => fetchPredictions(q), config.autocompleteDebounceMs);
  });

  inputEl.addEventListener('keydown', (e) => {
    if (!boxEl.classList.contains('show')) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      index = Math.min(index + 1, items.length - 1);
      highlight();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      index = Math.max(index - 1, -1);
      highlight();
    } else if (e.key === 'Enter') {
      // Enter accepts the suggestion and stops there. A second Enter
      // submits, so nobody calculates a route they didn't mean to pick.
      e.preventDefault();
      e.stopPropagation();
      if (index >= 0) apply(items[index]);
      else if (items.length && !showingRecent) apply(items[0]);
      else close();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      close();
    }
  });

  inputEl.addEventListener('blur', () => setTimeout(close, 150));
}

/* ==========================================================================
   Stops
   ========================================================================== */

let stopCounter = 0;

function renumberStops() {
  Array.from(stopsWrap.children).forEach((row, i) => {
    const label = row.querySelector('.stop-label');
    if (label) label.textContent = 'Stop ' + (i + 1);
    const input = row.querySelector('input[type="text"]');
    if (input && label) label.setAttribute('for', input.id);
  });
}

function makeStopRow(value = '') {
  const id = 'qm-stop-' + (++stopCounter);

  const row = document.createElement('div');
  row.className = 'stop-row';

  const head = document.createElement('div');
  head.className = 'stop-head';

  const label = document.createElement('label');
  label.className = 'stop-label';
  label.textContent = 'Stop';
  label.setAttribute('for', id);

  const actions = document.createElement('div');
  actions.className = 'actions';

  const up = mkBtn('↑', 'Move up');
  const down = mkBtn('↓', 'Move down');
  const del = mkBtn('🗑', 'Remove stop');
  actions.append(up, down, del);
  head.append(label, actions);

  const wrap = document.createElement('div');
  wrap.className = 'ac-wrap';

  const input = document.createElement('input');
  input.type = 'text';
  input.id = id;
  input.placeholder = 'Add a stop…';
  input.value = value;
  input.autocomplete = 'off';
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('autocapitalize', 'off');
  input.spellcheck = false;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', id + '-suggest');

  const box = document.createElement('div');
  box.id = id + '-suggest';
  box.className = 'suggest';
  box.setAttribute('role', 'listbox');
  box.setAttribute('aria-label', 'Stop suggestions');

  wrap.append(input, box);
  row.append(head, wrap);

  up.addEventListener('click', () => {
    const prev = row.previousElementSibling;
    if (prev) { stopsWrap.insertBefore(row, prev); renumberStops(); hideResults(); }
  });
  down.addEventListener('click', () => {
    const next = row.nextElementSibling;
    if (next) { stopsWrap.insertBefore(next, row); renumberStops(); hideResults(); }
  });
  del.addEventListener('click', (e) => {
    e.preventDefault();
    row.remove();
    renumberStops();
    hideResults();
  });

  wireAutocomplete(input, box);
  return row;
}

function mkBtn(text, title) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn small';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.textContent = text;
  return b;
}

addStopBtn.addEventListener('click', () => {
  const row = makeStopRow();
  stopsWrap.appendChild(row);
  renumberStops();
  hideResults();
  row.querySelector('input').focus();
});

function stopValues() {
  return Array.from(stopsWrap.querySelectorAll('input[type="text"]'))
    .map((x) => x.value.trim())
    .filter(Boolean);
}

function setStops(list) {
  stopsWrap.innerHTML = '';
  (list || []).forEach((v) => stopsWrap.appendChild(makeStopRow(v)));
  renumberStops();
}

/* ==========================================================================
   Saved addresses
   ========================================================================== */

async function loadSavedAddresses() {
  const s = await store.get({ savedStart: '', savedDest: '' });
  if (s.savedStart) { homeInput.value = s.savedStart; homeSave.checked = true; }
  if (s.savedDest) { destInput.value = s.savedDest; destSave.checked = true; }
}

async function persistSaved(which) {
  if (which === 'start') {
    const v = homeInput.value.trim();
    if (homeSave.checked && v) await store.set({ savedStart: v });
    else if (!homeSave.checked) await store.remove('savedStart');
  } else {
    const v = destInput.value.trim();
    if (destSave.checked && v) await store.set({ savedDest: v });
    else if (!destSave.checked) await store.remove('savedDest');
  }
}

homeSave.addEventListener('change', () => persistSaved('start'));
destSave.addEventListener('change', () => persistSaved('dest'));
homeInput.addEventListener('blur', () => { if (homeSave.checked) persistSaved('start'); });
destInput.addEventListener('blur', () => { if (destSave.checked) persistSaved('dest'); });

/* Clearing the form clears the form. It does not throw away the
   addresses someone deliberately asked us to remember. */
function clearForm() {
  homeInput.value = '';
  destInput.value = '';
  stopsWrap.innerHTML = '';
  clearTimeout(draftTimer);
  store.remove('draft');
  hideResults();
  clearError();
  setTimeout(() => homeInput.focus(), 40);
}

clearBtn.addEventListener('click', (e) => { e.preventDefault(); clearForm(); });
clearStartBtn.addEventListener('click', (e) => { e.preventDefault(); homeInput.value = ''; hideResults(); homeInput.focus(); });
clearDestBtn.addEventListener('click', (e) => { e.preventDefault(); destInput.value = ''; hideResults(); destInput.focus(); });

swapBtn.addEventListener('click', () => {
  const tmp = homeInput.value;
  homeInput.value = destInput.value;
  destInput.value = tmp;
  hideResults();
});

homeInput.addEventListener('input', () => { hideResults(); scheduleDraftSave(); });
destInput.addEventListener('input', () => { hideResults(); scheduleDraftSave(); });
stopsWrap.addEventListener('input', scheduleDraftSave);

/* ==========================================================================
   Trips
   ========================================================================== */

function currentTrip() {
  return {
    name: '',
    created: Date.now(),
    home: homeInput.value.trim(),
    destination: destInput.value.trim(),
    stops: stopValues()
  };
}

function mapsLinkFor(trip, mode) {
  const stops = [trip.home, ...(trip.stops || []), trip.destination].filter(Boolean);
  if (stops.length < 2) return null;
  const link = new URL('https://www.google.com/maps/dir/');
  link.searchParams.set('api', '1');
  link.searchParams.set('origin', stops[0]);
  link.searchParams.set('destination', stops[stops.length - 1]);
  if (stops.length > 2) link.searchParams.set('waypoints', stops.slice(1, -1).join('|'));
  const modes = { DRIVE: 'driving', WALK: 'walking', BICYCLE: 'bicycling', TRANSIT: 'transit' };
  link.searchParams.set('travelmode', modes[mode || trip.mode] || 'driving');
  return link.toString();
}

function loadTrip(t) {
  homeInput.value = t.home || '';
  destInput.value = t.destination || '';
  setStops(t.stops || []);
  hideResults();
  clearError();
  setTimeout(() => homeInput.focus(), 80);
}

async function refreshTrips() {
  const { trips } = await store.get({ trips: [] });
  const v = tripSort ? tripSort.value : 'newest';
  const sorted = [...trips];
  if (v === 'newest') sorted.sort((a, b) => b.created - a.created);
  if (v === 'oldest') sorted.sort((a, b) => a.created - b.created);
  if (v === 'az') sorted.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  if (v === 'za') sorted.sort((a, b) => (b.name || '').localeCompare(a.name || ''));

  tripList.innerHTML = '';
  tripsEmpty.hidden = sorted.length > 0;

  sorted.forEach((t) => {
    const li = document.createElement('li');
    const summary = `${t.home} → ${t.destination}`;

    const nameBtn = document.createElement('button');
    nameBtn.type = 'button';
    nameBtn.className = 'name btn small';
    nameBtn.textContent = t.name || summary;
    nameBtn.title = 'Load this trip • ' + summary;
    nameBtn.addEventListener('click', () => loadTrip(t));

    const actions = document.createElement('div');
    actions.className = 'actions';

    const maps = mkBtn('🗺', 'Open in Google Maps');
    maps.addEventListener('click', () => {
      const url = mapsLinkFor(t, settings.mode);
      if (url) window.open(url, '_blank', 'noopener');
    });

    const rename = mkBtn('✎', 'Rename trip');
    rename.addEventListener('click', () => startRename(li, nameBtn, t));

    const del = mkBtn('🗑', 'Delete trip');
    del.addEventListener('click', () => confirmInline(li, async () => {
      const { trips: arr } = await store.get({ trips: [] });
      const i = arr.findIndex((x) => x.created === t.created && x.name === t.name);
      if (i >= 0) { arr.splice(i, 1); await store.set({ trips: arr }); }
      refreshTrips();
    }, refreshTrips));

    actions.append(maps, rename, del);
    li.append(nameBtn, actions);
    tripList.appendChild(li);
  });
}

/* Inline rename and confirm, rather than prompt()/confirm(), which can
   take the whole popup down with them on some Chrome builds. */
function startRename(li, nameBtn, trip) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'name-input';
  input.value = trip.name || `${(trip.home || '').split(',')[0]} → ${(trip.destination || '').split(',')[0]}`;
  li.replaceChild(input, nameBtn);
  input.focus();
  input.select();

  let done = false;
  const commit = async (save) => {
    if (done) return;
    done = true;
    if (save) {
      const next = input.value.trim();
      const { trips: arr } = await store.get({ trips: [] });
      const i = arr.findIndex((x) => x.created === trip.created && x.name === trip.name);
      if (i >= 0) { arr[i].name = next; await store.set({ trips: arr }); }
    }
    refreshTrips();
  };

  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); commit(true); }
    if (e.key === 'Escape') { e.preventDefault(); commit(false); }
  });
  input.addEventListener('blur', () => commit(true));
}

function confirmInline(li, onYes, onNo) {
  const original = Array.from(li.children);
  li.innerHTML = '';

  const label = document.createElement('span');
  label.className = 'name';
  label.textContent = 'Delete?';

  const row = document.createElement('div');
  row.className = 'confirm-row';

  const yes = mkBtn('Delete', 'Confirm delete');
  yes.classList.add('danger');
  const no = mkBtn('Cancel', 'Cancel');

  yes.addEventListener('click', onYes);
  no.addEventListener('click', () => {
    if (onNo) onNo();
    else { li.innerHTML = ''; original.forEach((n) => li.appendChild(n)); }
  });

  row.append(yes, no);
  li.append(label, row);
  yes.focus();
}

if (tripSort) tripSort.addEventListener('change', refreshTrips);

saveTripBtn.addEventListener('click', async () => {
  const trip = currentTrip();
  if (!trip.home || !trip.destination) {
    showError('Add a start and a destination before saving.');
    return;
  }
  clearError();

  trip.name = `${trip.home.split(',')[0]} → ${trip.destination.split(',')[0]}`;
  trip.mode = settings.mode;

  const { trips } = await store.get({ trips: [] });
  trips.unshift(trip);
  await store.set({ trips });

  saveTripBtn.textContent = '✓';
  setTimeout(() => { saveTripBtn.textContent = '💾'; }, 1400);

  openSidebar(true);
  tabTrips.click();
  await refreshTrips();

  // Drop straight into renaming the trip we just added.
  const first = tripList.querySelector('li');
  if (first) {
    const btn = first.querySelector('.name');
    if (btn) startRename(first, btn, trip);
  }
});

/* ==========================================================================
   History
   ========================================================================== */

function routeKey(entry) {
  return [entry.mode, entry.units, entry.home, ...(entry.stops || []), entry.destination]
    .join('||').toLowerCase();
}

async function addHistoryEntry(entry) {
  const { history } = await store.get({ history: [] });
  const key = routeKey(entry);

  // Collapse an immediate repeat of the same route, so a double-click
  // doesn't leave two identical rows in a mileage log.
  if (history[0] && routeKey(history[0]) === key && (entry.created - history[0].created) < 60000) {
    history[0] = entry;
  } else {
    history.unshift(entry);
  }

  await store.set({ history: history.slice(0, config.historyCap) });
  refreshHistory();
}

async function refreshHistory() {
  const { history } = await store.get({ history: [] });
  historyList.innerHTML = '';
  historyEmpty.hidden = history.length > 0;

  let totalMeters = 0;
  let counted = 0;

  history.forEach((t, idx) => {
    if (t.distanceMeters) {
      totalMeters += t.distanceMeters;
      counted++;
    }

    const li = document.createElement('li');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'name btn small';
    const main = document.createElement('span');
    main.textContent = `${t.home} → ${t.destination}`;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = [
      new Date(t.created).toLocaleDateString(),
      t.mileCount || '',
      t.travelTime || ''
    ].filter(Boolean).join(' • ');
    btn.append(main, meta);
    btn.title = new Date(t.created).toLocaleString();
    btn.addEventListener('click', () => loadTrip(t));

    const actions = document.createElement('div');
    actions.className = 'actions';

    const maps = mkBtn('🗺', 'Open in Google Maps');
    maps.addEventListener('click', () => {
      const url = mapsLinkFor(t, t.mode);
      if (url) window.open(url, '_blank', 'noopener');
    });

    const del = mkBtn('🗑', 'Delete entry');
    del.addEventListener('click', async () => {
      const { history: list } = await store.get({ history: [] });
      list.splice(idx, 1);
      await store.set({ history: list });
      refreshHistory();
    });

    actions.append(maps, del);
    li.append(btn, actions);
    historyList.appendChild(li);
  });

  if (counted) {
    const unitLabel = settings.units === 'metric' ? 'km' : 'mi';
    const qty = settings.units === 'metric' ? totalMeters / 1000 : totalMeters / 1609.344;
    mileageTotal.hidden = false;
    mileageTotal.innerHTML = '';
    const line = document.createElement('span');
    line.textContent = `${counted} trip${counted === 1 ? '' : 's'} • `;
    const strong = document.createElement('strong');
    strong.textContent = `${qty.toFixed(1)} ${unitLabel}`;
    line.appendChild(strong);
    mileageTotal.appendChild(line);
  } else {
    mileageTotal.hidden = true;
  }
}

if (clearHistoryBtn) clearHistoryBtn.addEventListener('click', async () => {
  const original = clearHistoryBtn.textContent;
  if (clearHistoryBtn.dataset.confirming === '1') {
    delete clearHistoryBtn.dataset.confirming;
    clearHistoryBtn.textContent = original;
    await store.set({ history: [] });
    refreshHistory();
    return;
  }
  clearHistoryBtn.dataset.confirming = '1';
  clearHistoryBtn.textContent = 'Sure?';
  setTimeout(() => {
    if (clearHistoryBtn.dataset.confirming === '1') {
      delete clearHistoryBtn.dataset.confirming;
      clearHistoryBtn.textContent = 'Clear';
    }
  }, 3000);
});

/* -------------------------- CSV export ---------------------------------- */

function csvCell(value) {
  const s = String(value == null ? '' : value);
  // Guard against a leading =, +, - or @ being read as a formula.
  const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  return '"' + safe.replace(/"/g, '""') + '"';
}

function buildCsv(history) {
  const header = [
    'Date', 'Time', 'Start', 'Stops', 'Destination',
    'Distance', 'Unit', 'Duration', 'Travel mode'
  ];
  const rows = [header.map(csvCell).join(',')];

  history.forEach((t) => {
    const d = new Date(t.created);
    const units = t.units || 'imperial';
    const unitLabel = units === 'metric' ? 'km' : 'mi';
    const qty = t.distanceMeters
      ? (units === 'metric' ? t.distanceMeters / 1000 : t.distanceMeters / 1609.344)
      : null;

    rows.push([
      d.toLocaleDateString(),
      d.toLocaleTimeString(),
      t.home || '',
      (t.stops || []).join(' | '),
      t.destination || '',
      qty != null ? qty.toFixed(2) : '',
      unitLabel,
      t.travelTime || '',
      t.mode || 'DRIVE'
    ].map(csvCell).join(','));
  });

  // BOM so Excel opens non-ASCII addresses correctly.
  return '﻿' + rows.join('\r\n') + '\r\n';
}

if (exportCsvBtn) exportCsvBtn.addEventListener('click', async () => {
  const { history } = await store.get({ history: [] });
  if (!history.length) {
    showError('There’s no history to export yet.');
    return;
  }
  clearError();

  const blob = new Blob([buildCsv(history)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `quickmaps-mileage-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  exportCsvBtn.textContent = '✓ CSV';
  setTimeout(() => { exportCsvBtn.textContent = '⬇ CSV'; }, 1500);
});

/* ==========================================================================
   Sidebar
   ========================================================================== */

function openSidebar(open) {
  sidebar.classList.toggle('open', open);
  document.body.classList.toggle('sidebar-open', open);
  sidebarToggle.setAttribute('aria-expanded', String(open));
  sidebarToggle.setAttribute('aria-label', open ? 'Close trips and history' : 'Open trips and history');
}

sidebarToggle.addEventListener('click', () => openSidebar(!sidebar.classList.contains('open')));

function selectTab(which) {
  const trips = which === 'trips';
  tabTrips.classList.toggle('active', trips);
  tabHistory.classList.toggle('active', !trips);
  tabTrips.setAttribute('aria-selected', String(trips));
  tabHistory.setAttribute('aria-selected', String(!trips));
  panelTrips.classList.toggle('hidden', !trips);
  panelHistory.classList.toggle('hidden', trips);
}
tabTrips.addEventListener('click', () => selectTab('trips'));
tabHistory.addEventListener('click', () => selectTab('history'));

/* ==========================================================================
   Calculate
   ========================================================================== */

let calculating = false;

async function calculate() {
  if (calculating) return;

  const home = homeInput.value.trim();
  const dest = destInput.value.trim();

  if (!home) { showError('Add a start address.'); homeInput.focus(); return; }
  if (!dest) { showError('Add a destination.'); destInput.focus(); return; }

  clearError();
  calculating = true;
  const original = submitBtn.textContent;
  submitBtn.textContent = 'Calculating…';
  submitBtn.disabled = true;

  const stops = [home, ...stopValues(), dest];

  const resp = await sendMessage({
    type: 'ROUTE_DISTANCE',
    stops,
    units: settings.units,
    mode: settings.mode,
    optimize: settings.optimize
  });

  submitBtn.textContent = original;
  submitBtn.disabled = false;
  calculating = false;

  if (!resp || !resp.ok) {
    hideResults();
    showError(describeError(resp));
    return;
  }

  // If Google reordered the stops, show the order it actually used.
  if (resp.optimized && Array.isArray(resp.stops) && resp.stops.length === stops.length) {
    setStops(resp.stops.slice(1, -1));
  }

  resultsBox.hidden = false;
  travelEl.textContent = '≈ ' + resp.travelTime;
  milesEl.textContent = resp.mileCount;
  linkEl.href = resp.directionsLink || '#';
  linkEl.hidden = false;

  const notes = [];
  if (resp.trafficAware) notes.push('Includes current traffic');
  if (resp.optimized) notes.push('Stops reordered for the shortest trip');
  if (notes.length) {
    resultNote.hidden = false;
    resultNote.textContent = notes.join(' • ');
  } else {
    resultNote.hidden = true;
  }

  await addHistoryEntry({
    created: Date.now(),
    name: '',
    home: resp.stops ? resp.stops[0] : home,
    destination: resp.stops ? resp.stops[resp.stops.length - 1] : dest,
    stops: resp.stops ? resp.stops.slice(1, -1) : stopValues(),
    distanceMeters: resp.distanceMeters,
    durationSeconds: resp.durationSeconds,
    mileCount: resp.mileCount,
    travelTime: resp.travelTime,
    units: settings.units,
    mode: settings.mode
  });
}

submitBtn.addEventListener('click', calculate);

form.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); calculate(); }
});

form.addEventListener('submit', (e) => { e.preventDefault(); calculate(); });

/* ==========================================================================
   Copy to clipboard
   ========================================================================== */

async function copyMetric(el) {
  const text = (el.textContent || '').replace('≈ ', '').trim();
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    const original = el.textContent;
    el.textContent = '✓ Copied';
    el.classList.add('copied');
    setTimeout(() => {
      el.textContent = original;
      el.classList.remove('copied');
    }, 1200);
  } catch {
    showError('Couldn’t copy to the clipboard.');
  }
}

travelEl.addEventListener('click', () => copyMetric(travelEl));
milesEl.addEventListener('click', () => copyMetric(milesEl));

/* ==========================================================================
   Keyboard shortcuts
   ========================================================================== */

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;

  // Esc closes. Autocomplete dropdowns and the inline rename both stop
  // propagation on Esc, so this only fires when nothing is open.
  if (e.key === 'Escape') {
    e.preventDefault();
    closeQuickMaps();
    return;
  }

  // Pressing the toolbar shortcut again closes QuickMaps.
  if (matchesShortcut(e, actionShortcut)) {
    e.preventDefault();
    closeQuickMaps();
    return;
  }

  if (mod && !e.shiftKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); clearForm(); return; }
  if (mod && e.key === 'Enter') { e.preventDefault(); calculate(); return; }
  if (mod && !e.shiftKey && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); sidebarToggle.click(); return; }
  if (mod && e.shiftKey && (e.key === 'x' || e.key === 'X')) { e.preventDefault(); swapBtn.click(); return; }

  if (e.altKey) {
    const k = (e.key || '').toLowerCase();
    if (k === 'h' && !e.shiftKey) { store.set({ savedHome: homeInput.value.trim() }); flash(homeInput); }
    if (k === 'h' && e.shiftKey) {
      store.get({ savedHome: '' }).then((s) => { if (s.savedHome) { homeInput.value = s.savedHome; flash(homeInput); hideResults(); } });
    }
    if (k === 'w' && !e.shiftKey) { store.set({ savedWork: destInput.value.trim() }); flash(destInput); }
    if (k === 'w' && e.shiftKey) {
      store.get({ savedWork: '' }).then((s) => { if (s.savedWork) { destInput.value = s.savedWork; flash(destInput); hideResults(); } });
    }
  }
});

function flash(el) {
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1000);
}

/* Chrome owns the shortcut list, so the most we can do is take the user
   to the page where they rebind it. */
const editShortcut = $('editShortcut');
if (editShortcut) editShortcut.addEventListener('click', () => {
  try {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    window.close();
  } catch {
    const note = $('shortcutFallback');
    if (note) note.hidden = false;
  }
});

/* ==========================================================================
   Init
   ========================================================================== */

async function consumePending(allowFocus) {
  const pending = await store.get({ pendingStartAddress: '', pendingDestAddress: '' });

  if (pending.pendingStartAddress) {
    homeInput.value = pending.pendingStartAddress;
    await store.remove('pendingStartAddress');
    flash(homeInput);
    if (allowFocus) homeInput.focus();
    hideResults();
  }
  if (pending.pendingDestAddress) {
    destInput.value = pending.pendingDestAddress;
    await store.remove('pendingDestAddress');
    flash(destInput);
    if (allowFocus && !pending.pendingStartAddress) destInput.focus();
    hideResults();
  }
  if (pending.pendingStartAddress || pending.pendingDestAddress) saveDraft();
}

async function init() {
  hideResults();
  clearError();

  await migrateLegacyStorage();
  await loadSettings();
  await loadSavedAddresses();
  loadActionShortcut();

  // Re-assert the popup/panel choice. The service worker already does
  // this when it wakes, but a popup open is the cheapest moment to heal
  // a setting that Chrome dropped when the worker was recycled.
  sendMessage({ type: 'SET_UI_MODE', mode: settings.uiMode || 'popup' }, 6000);

  wireAutocomplete(homeInput, $('qm-from-suggest'));
  wireAutocomplete(destInput, $('qm-to-suggest'));

  // An unfinished route beats a remembered address — it's the more
  // recent intent, and losing it is the whole thing we're fixing.
  await restoreDraft();

  // Anything handed over by the right-click menu.
  await consumePending(true);

  // In the side panel we stay open, so a right-click send while the
  // panel is up should land in the field straight away.
  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.pendingStartAddress || changes.pendingDestAddress) consumePending(false);
    });
  }

  await refreshTrips();
  await refreshHistory();
}

init();
