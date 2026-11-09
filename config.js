/**
 * QuickMaps configuration.
 *
 * proxyBase must match the host_permissions entry in manifest.json.
 * If you change the Worker hostname, change it in BOTH places.
 */
const config = {
  proxyBase: 'https://ancient-wave-07fb.quickmaps.workers.dev',

  // Routes path on the Worker. .
  routesPath: '/routes/v2:computeRoutes',

  // Legacy Distance Matrix path, used only as a fallback the Worker
  legacyMatrixPath: '/maps/distancematrix/json',

  // Places Autocomplete path on the Worker.
  autocompletePath: '/maps/place/autocomplete/json',

  // Client-side tuning.
  autocompleteDebounceMs: 260,
  autocompleteMinChars: 3,
  autocompleteCacheMax: 120,
  requestTimeoutMs: 20000,
  historyCap: 50
};

export default config;
