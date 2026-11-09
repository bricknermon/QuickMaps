import config from './config.js';

/* ------------------------------------------------------------------ *
 * QuickMaps service worker
 *
 * One request for the whole trip, traffic-aware
 * ETAs, travel modes and optional stop reordering. If the Worker has
 * not been updated yet, we fall back to the legacy Distance Matrix
 * leg-by-leg loop so existing installs keep working.
 * ------------------------------------------------------------------ */

const MODE_TO_MAPS_LINK = {
  DRIVE: 'driving',
  WALK: 'walking',
  BICYCLE: 'bicycling',
  TRANSIT: 'transit'
};

const VALID_MODES = Object.keys(MODE_TO_MAPS_LINK);

// 'unknown' | 'yes' | 'no' — cached across service-worker restarts.
let routesSupport = 'unknown';

chrome.storage.local.get({ routesSupport: 'unknown' }, (s) => {
  routesSupport = s.routesSupport || 'unknown';
});

function setRoutesSupport(v) {
  if (routesSupport === v) return;
  routesSupport = v;
  try { chrome.storage.local.set({ routesSupport: v }); } catch { /* ignore */ }
}

/* ---------------------------- utilities ---------------------------- */

function fetchWithTimeout(url, opts = {}, ms = config.requestTimeoutMs) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  return fetch(url, { ...opts, signal: ctl.signal }).finally(() => clearTimeout(t));
}

function fail(code, detail) {
  return { ok: false, code, error: detail || code };
}

function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const hours = Math.floor(s / 3600);
  const mins = Math.round((s % 3600) / 60);
  if (hours && mins) return `${hours} hr ${mins} min`;
  if (hours) return `${hours} hr`;
  return `${mins} min`;
}

function formatDistance(meters, units) {
  const m = Number(meters) || 0;
  return units === 'metric'
    ? (m / 1000).toFixed(1) + ' km'
    : (m / 1609.344).toFixed(1) + ' mi';
}

function buildDirectionsLink(stops, mode) {
  const link = new URL('https://www.google.com/maps/dir/');
  link.searchParams.set('api', '1');
  link.searchParams.set('origin', stops[0]);
  link.searchParams.set('destination', stops[stops.length - 1]);
  const waypoints = stops.slice(1, -1);
  if (waypoints.length) link.searchParams.set('waypoints', waypoints.join('|'));
  const travelmode = MODE_TO_MAPS_LINK[mode] || 'driving';
  link.searchParams.set('travelmode', travelmode);
  return link.toString();
}

/**
 * Map an upstream status or HTTP failure onto a stable code the popup
 * can turn into a readable sentence.
 */
function classifyUpstream(status, httpStatus) {
  const s = String(status || '').toUpperCase();
  if (s === 'ZERO_RESULTS' || s === 'ZERO_RESULT') return 'ZERO_RESULTS';
  if (s === 'NOT_FOUND') return 'NOT_FOUND';
  if (s === 'OVER_QUERY_LIMIT' || s === 'RESOURCE_EXHAUSTED' || httpStatus === 429) return 'RATE_LIMITED';
  if (s === 'REQUEST_DENIED' || s === 'PERMISSION_DENIED' || httpStatus === 403) return 'DENIED';
  if (s === 'INVALID_REQUEST' || s === 'INVALID_ARGUMENT' || httpStatus === 400) return 'INVALID_REQUEST';
  if (s === 'MAX_ROUTE_LENGTH_EXCEEDED') return 'ROUTE_TOO_LONG';
  if (httpStatus && httpStatus >= 500) return 'UPSTREAM_ERROR';
  return 'UPSTREAM_ERROR';
}


async function computeViaRoutesApi({ stops, units, mode, optimize }) {
  const intermediates = stops.slice(1, -1);

  const body = {
    origin: { address: stops[0] },
    destination: { address: stops[stops.length - 1] },
    travelMode: mode,
    units: units === 'metric' ? 'METRIC' : 'IMPERIAL',
    languageCode: 'en-US'
  };

  if (intermediates.length) {
    body.intermediates = intermediates.map((a) => ({ address: a, via: false }));
  }

  // routingPreference and waypoint optimization are only valid for
  // vehicle modes; sending them for WALK/TRANSIT is an INVALID_ARGUMENT.
  if (mode === 'DRIVE') {
    body.routingPreference = 'TRAFFIC_AWARE';
    if (optimize && intermediates.length > 1) body.optimizeWaypointOrder = true;
  }

  const fields = ['routes.duration', 'routes.staticDuration', 'routes.distanceMeters'];
  if (body.optimizeWaypointOrder) fields.push('routes.optimizedIntermediateWaypointIndex');

  const res = await fetchWithTimeout(`${config.proxyBase}${config.routesPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-FieldMask': fields.join(',')
    },
    body: JSON.stringify(body)
  });

  if (res.status === 404 || res.status === 501) {
    const e = new Error('ROUTES_UNSUPPORTED');
    e.unsupported = true;
    throw e;
  }

  let data = null;
  try { data = await res.json(); } catch { data = null; }

  if (!res.ok) {
    const upstream = data?.error?.status || data?.error?.message;
    const e = new Error(String(upstream || 'HTTP ' + res.status));
    e.code = classifyUpstream(upstream, res.status);
    throw e;
  }

  const route = data?.routes?.[0];
  if (!route) {
    const e = new Error('No route returned');
    e.code = 'ZERO_RESULTS';
    throw e;
  }

  const seconds = parseFloat(String(route.duration ?? route.staticDuration ?? '0')) || 0;
  const meters = Number(route.distanceMeters) || 0;

  // If Google reordered the stops, hand the new order back so the popup
  // can show the trip the way it will actually be driven.
  let orderedStops = stops;
  const order = route.optimizedIntermediateWaypointIndex;
  if (Array.isArray(order) && order.length === intermediates.length) {
    orderedStops = [stops[0], ...order.map((i) => intermediates[i]), stops[stops.length - 1]];
  }

  return {
    ok: true,
    engine: 'routes',
    travelTime: formatDuration(seconds),
    mileCount: formatDistance(meters, units),
    durationSeconds: Math.round(seconds),
    distanceMeters: Math.round(meters),
    trafficAware: mode === 'DRIVE',
    optimized: orderedStops !== stops,
    stops: orderedStops,
    directionsLink: buildDirectionsLink(orderedStops, mode)
  };
}

/* ------------------ Distance Matrix (legacy fallback) ------------------ */

async function computeViaDistanceMatrix({ stops, units, mode }) {
  let totalSeconds = 0;
  let totalMeters = 0;

  for (let i = 0; i < stops.length - 1; i++) {
    const url = new URL(`${config.proxyBase}${config.legacyMatrixPath}`);
    url.searchParams.set('units', units);
    url.searchParams.set('origins', stops[i]);
    url.searchParams.set('destinations', stops[i + 1]);
    url.searchParams.set('mode', (MODE_TO_MAPS_LINK[mode] || 'driving'));

    const res = await fetchWithTimeout(url.toString());
    let data = null;
    try { data = await res.json(); } catch { data = null; }

    if (!res.ok) {
      const e = new Error('HTTP ' + res.status);
      e.code = classifyUpstream(data?.status, res.status);
      throw e;
    }

    const el = data?.rows?.[0]?.elements?.[0];
    if (data?.status !== 'OK' || el?.status !== 'OK') {
      const upstream = el?.status || data?.status;
      const e = new Error(String(upstream || 'Distance Matrix error'));
      e.code = classifyUpstream(upstream, res.status);
      throw e;
    }

    totalSeconds += Number(el.duration?.value || 0);
    totalMeters += Number(el.distance?.value || 0);
  }

  return {
    ok: true,
    engine: 'legacy',
    travelTime: formatDuration(totalSeconds),
    mileCount: formatDistance(totalMeters, units),
    durationSeconds: Math.round(totalSeconds),
    distanceMeters: Math.round(totalMeters),
    trafficAware: false,
    optimized: false,
    stops,
    directionsLink: buildDirectionsLink(stops, mode)
  };
}

async function routeDistance(req) {
  const stops = (Array.isArray(req.stops) ? req.stops : [])
    .map((s) => String(s || '').trim())
    .filter(Boolean);

  if (stops.length < 2) return fail('INVALID_REQUEST', 'Need a start and a destination');
  if (stops.length > 12) return fail('TOO_MANY_STOPS', 'Up to 10 stops between start and destination');

  const units = req.units === 'metric' ? 'metric' : 'imperial';
  const mode = VALID_MODES.includes(req.mode) ? req.mode : 'DRIVE';
  const optimize = !!req.optimize;

  if (routesSupport !== 'no') {
    try {
      const out = await computeViaRoutesApi({ stops, units, mode, optimize });
      setRoutesSupport('yes');
      return out;
    } catch (e) {
      if (e && e.unsupported) {
        // Worker is on the old build; remember and fall through.
        setRoutesSupport('no');
      } else if (e && e.code) {
        return fail(e.code, e.message);
      } else if (e && e.name === 'AbortError') {
        return fail('TIMEOUT', 'The request took too long');
      } else {
        // Network-level failure — try the legacy path before giving up.
        // Intentionally does not mark the Worker as unsupported.
      }
    }
  }

  try {
    return await computeViaDistanceMatrix({ stops, units, mode });
  } catch (e) {
    if (e && e.name === 'AbortError') return fail('TIMEOUT', 'The request took too long');
    if (e && e.code) return fail(e.code, e.message);
    return fail('NETWORK', String(e && e.message ? e.message : e));
  }
}

/* --------------------------- Autocomplete --------------------------- */

// Small LRU so repeated prefixes within a session cost nothing.
const acCache = new Map();

function acCacheGet(key) {
  if (!acCache.has(key)) return null;
  const v = acCache.get(key);
  acCache.delete(key);
  acCache.set(key, v);
  return v;
}

function acCacheSet(key, value) {
  acCache.set(key, value);
  while (acCache.size > config.autocompleteCacheMax) {
    acCache.delete(acCache.keys().next().value);
  }
}

async function autocomplete(req) {
  const input = String(req.input || '').trim();
  if (input.length < config.autocompleteMinChars) return { ok: true, predictions: [] };

  const country = req.country ? String(req.country) : '';
  const token = req.sessiontoken ? String(req.sessiontoken) : '';
  const cacheKey = `${country}|${input.toLowerCase()}`;

  const hit = acCacheGet(cacheKey);
  if (hit) return { ok: true, predictions: hit, cached: true };

  // A single 'geocode' request covers street addresses, cities and
  // regions, which is what the old 'address' + '(cities)' pair was
  // approximating at twice the cost.
  const url = new URL(`${config.proxyBase}${config.autocompletePath}`);
  url.searchParams.set('input', input);
  url.searchParams.set('types', 'geocode');
  if (country) url.searchParams.set('components', 'country:' + country);
  if (token) url.searchParams.set('sessiontoken', token);

  try {
    const res = await fetchWithTimeout(url.toString(), {}, 8000);
    const data = await res.json();

    if (data?.status && data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      return fail(classifyUpstream(data.status, res.status), data.status);
    }

    const seen = new Set();
    const merged = [];
    for (const p of (data?.predictions || [])) {
      const desc = p && p.description;
      if (!desc) continue;
      const k = desc.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push(desc);
      if (merged.length >= 8) break;
    }

    acCacheSet(cacheKey, merged);
    return { ok: true, predictions: merged };
  } catch (e) {
    if (e && e.name === 'AbortError') return fail('TIMEOUT', 'Autocomplete timed out');
    return fail('NETWORK', String(e && e.message ? e.message : e));
  }
}

/* --------------------------- UI mode ---------------------------- *
 * A Chrome action popup always closes when it loses focus — there is
 * no way to prevent that. The side panel is the supported way to stay
 * open while you click around a page, so the user picks which one the
 * toolbar button opens.
 *
 * Neither setPanelBehavior() nor setPopup('') survives the service
 * worker being torn down, and MV3 recycles it after about 30 seconds
 * idle. So applyUiMode() runs at the top level of this module, which
 * re-asserts the choice every time the worker wakes. Calling it only
 * from onInstalled/onStartup is why the setting appeared to forget
 * itself between uses.
 * ---------------------------------------------------------------- */

const PANEL_PATH = 'popup.html?ctx=panel';

async function getUiMode() {
  return new Promise((r) =>
    chrome.storage.local.get({ uiMode: 'popup' }, (s) => r(s.uiMode || 'popup')));
}

async function applyUiMode(mode) {
  const uiMode = mode || await getUiMode();
  const panel = uiMode === 'panel';

  try {
    await chrome.action.setPopup({ popup: panel ? '' : 'popup.html' });
  } catch { /* ignore */ }

  if (!chrome.sidePanel) return uiMode;

  try {
    await chrome.sidePanel.setOptions({ path: PANEL_PATH, enabled: true });
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: panel });
  } catch { /* side panel unavailable on this Chrome build */ }

  return uiMode;
}

// Runs on every service-worker wake, which is what makes the choice stick.
applyUiMode();

chrome.runtime.onInstalled.addListener(() => { applyUiMode(); });
chrome.runtime.onStartup.addListener(() => { applyUiMode(); });

// Only fires in panel mode (popup mode has a popup registered). Backs up
// openPanelOnActionClick in case that setting was lost.
chrome.action.onClicked.addListener(async (tab) => {
  if (!chrome.sidePanel || !tab) return;
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch { /* nothing more we can do from here */ }
});

/* ------------------------- Context menus ------------------------- */

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'sendToStart',
      title: 'Send to QuickMaps start address',
      contexts: ['selection']
    });
    chrome.contextMenus.create({
      id: 'sendToDestination',
      title: 'Send to QuickMaps destination',
      contexts: ['selection']
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const selectedText = (info.selectionText || '').trim().replace(/\s+/g, ' ').slice(0, 250);
  if (!selectedText) return;

  const key = info.menuItemId === 'sendToStart' ? 'pendingStartAddress'
    : info.menuItemId === 'sendToDestination' ? 'pendingDestAddress'
      : null;
  if (!key) return;

  chrome.storage.local.set({ [key]: selectedText }, async () => {
    const { uiMode } = await new Promise((r) =>
      chrome.storage.local.get({ uiMode: 'popup' }, r));

    if (uiMode === 'panel' && chrome.sidePanel && tab) {
      try {
        await chrome.sidePanel.open({ windowId: tab.windowId });
        return;
      } catch { /* fall through to the popup */ }
    }

    if (chrome.action.openPopup) {
      chrome.action.openPopup().catch(() => { /* user can click the icon */ });
    }
  });
});

/* --------------------------- Message router --------------------------- */

const HANDLERS = {
  ROUTE_DISTANCE: routeDistance,
  AUTOCOMPLETE: autocomplete,
  /* Chrome exposes no sidePanel.close(). Disabling the panel for the
     active tab closes it; we re-enable a moment later so the toolbar
     button can open it again. */
  CLOSE_PANEL: async () => {
    if (!chrome.sidePanel) return { ok: true, closed: false };
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return { ok: true, closed: false };

      await chrome.sidePanel.setOptions({ tabId: tab.id, enabled: false });
      setTimeout(() => {
        chrome.sidePanel
          .setOptions({ tabId: tab.id, path: PANEL_PATH, enabled: true })
          .catch(() => { /* tab may be gone */ });
      }, 500);

      return { ok: true, closed: true };
    } catch (e) {
      return { ok: true, closed: false, error: String(e) };
    }
  },

  SET_UI_MODE: async (req) => {
    const mode = req.mode === 'panel' ? 'panel' : 'popup';
    await new Promise((r) => chrome.storage.local.set({ uiMode: mode }, r));
    await applyUiMode(mode);
    return { ok: true, mode };
  },
  // Kept so older popups still work if one is open across an update.
  DISTANCE: (req) => routeDistance({
    stops: [req.homeAddress, req.destinationAddress],
    units: req.units,
    mode: 'DRIVE'
  })
};

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  const handler = req && req.type && HANDLERS[req.type];
  if (!handler) {
    sendResponse(fail('UNKNOWN_TYPE', 'Unknown request type'));
    return false;
  }

  Promise.resolve()
    .then(() => handler(req))
    .then((out) => sendResponse(out))
    .catch((e) => sendResponse(fail('INTERNAL', String(e && e.message ? e.message : e))));

  return true; // async response
});
