# Changelog

## 1.7.1 — November 2026

### Fixed

- **Suggestion ranking matched substrings, not places.** The region hint was
  tested with `includes()`, so a two-letter state code could match inside an
  unrelated word — "IL" sits inside "M**il**waukee" — which was enough to
  float a result from the wrong state above the one being typed toward.
  Ranking now compares whole comma-separated segments. Caught while recording
  the store demo, where the wrong city got picked on screen.

---

## 1.7.0 —  November 2026

### New

- **Theme control: Auto, Light or Dark**, in Options. Auto follows your
  operating system, as every version has; the other two override it, so a
  light QuickMaps on a dark desktop is now a choice rather than a
  contradiction. The setting is stored per browser profile.
- **Native controls match the theme.** `color-scheme` was never declared, so
  checkboxes, scrollbars and number spinners rendered in light chrome even in
  dark mode. They now follow the active theme, including a forced one.

### Implementation notes

- The chosen theme is applied by `theme-init.js`, a small synchronous script
  in `<head>`. `chrome.storage` is async and `popup.js` is a module, so
  without it every popup would open on a frame of the wrong theme. It reads a
  `localStorage` mirror of the setting; `chrome.storage` stays the source of
  truth and rewrites the mirror. It is a separate file because the MV3
  content security policy forbids inline scripts.
- `auto` removes the `data-theme` attribute so the stylesheet's
  `prefers-color-scheme` rule takes over. Forced dark needs no rules of its
  own — it is excluded from the light media query, so the `:root` defaults
  apply.

### Testing

- The theme audit now runs four combinations — system light, system dark,
  forced light on a dark desktop, forced dark on a light one — for 968
  text/background pairs. It drives the real control and reloads, so it also
  proves the choice survives reopening and is applied before first paint.

---

## 1.6.1 —  October 2026

### Fixed

- **Error banner contrast.** Red text on a red-tinted panel measured 4.01:1 in
  light and 4.32:1 in dark, both just short of WCAG AA. The banner now uses a
  separate `--danger-text` tone per theme while borders keep `--danger`.

### Testing

- Added a theme audit that walks every visible label in six UI states across
  both colour schemes — 476 text/background pairs — resolving each element's
  real backdrop through stacked translucent layers and checking WCAG AA. This
  is the check that would have caught the light-mode dropdown bug in v1.1.

---

## 1.6.0 — October 2026

### Suggestions now favour nearby places

Places Autocomplete ranks globally, so typing "341" could return a street in
Santiago above one two miles away. Two layers fix that, and neither filters
anything out — distant places are still reachable, they just stop crowding out
the near ones.

- **Region bias in the proxy.** The Worker now biases autocomplete toward the
  requester's approximate area, taken from Cloudflare's IP geolocation, which
  the request already carries. No device location, no permission. The
  coordinates are rounded to one decimal place (~11 km) before use, which is
  far finer than the 50 km bias needs, keeps what reaches Google coarse, and
  lets everyone in a region share one cache entry. `location` and `radius` are
  no longer accepted from the client, so a caller cannot aim the bias. Set
  `LOCATION_BIAS = "off"` in `wrangler.toml` to turn it off.
  **Requires redeploying the Worker.**
- **Re-ranking in the popup**, which works immediately with no redeploy.
  Suggestions are scored against the addresses already in the form — same
  country, same region, same city — and stable-sorted, so Google's relevance
  order survives within each tier. With nothing else filled in, the order is
  left exactly as Google returned it.

### Fixed

- **Chrome's address autofill no longer covers our suggestions.** Chrome
  offers no supported way to switch it off, and its heuristics key off the
  field's `id`, `name`, `placeholder` and `<label for>` — all four of ours
  said "address". The inputs are now `qm-from` / `qm-to` with neutral random
  `name`s, `autocomplete="off"`, placeholders "Where from?" / "Where to?",
  and labels wired by `aria-labelledby` rather than `for`, so the accessible
  name survives but Chrome's parser no longer sees an address form.
  `autocomplete="new-password"` is also gone — it was inviting the password
  manager.

### Testing

- Added a ranking test built from the reported "341" case, asserting
  local results rise, foreign ones are reordered rather than dropped, the sort
  stays stable within a tier, and the inputs carry no address-like attributes.

---

## 1.5.1 —  October 2026

### Fixed

- **"Open in → Side panel" did nothing.** The entire UI-mode block —
  `applyUiMode()`, the panel path constant, the startup hooks and the action
  click fallback — was deleted by accident in 1.4.0, when the edit that
  stripped the geolocation code cut from the geocoding header to the next
  header and took everything between them. `SET_UI_MODE` had been calling a
  function that no longer existed ever since, so the toolbar button always
  fell back to the popup.
- **The mode would not have stuck even once restored.** Neither
  `setPanelBehavior()` nor `setPopup('')` survives the service worker being
  recycled, which MV3 does after roughly 30 seconds idle. `applyUiMode()` now
  runs at the top level of the service worker, so it is re-asserted every time
  the worker wakes, and the popup re-asserts it on open as a second line of
  defence.
- **The shortcut could not close QuickMaps.** Chrome does not deliver the
  action command while the extension's own popup has focus, so pressing it a
  second time could never close it from the browser's side. QuickMaps now
  watches for that key itself, reading the live binding from `chrome.commands`
  rather than assuming Alt+Q, so it still works if you reassign the shortcut.
  The help panel shows your actual binding.

### Testing

- Added a service-worker test that imports `background.js` for real against a
  shimmed `chrome` and drives its message handlers. The browser tests mock
  `sendMessage`, so nothing had ever executed that file — which is exactly how
  a call to a deleted function shipped twice. Verified by reintroducing the
  bug and confirming the suite fails.

---

## 1.5.0 —  October 2026

### Fixed

- **Two QuickMaps could be open at once.** Switching from side panel back to
  popup set the mode correctly but left the panel standing, so the next
  `Alt+Q` opened a popup in front of it. Going back to popup mode — by the
  **⇲** button or the *Open in* radio — now actually closes the panel. Chrome
  exposes no `sidePanel.close()`, so this calls `window.close()` from inside
  the panel and falls back to the service worker disabling and re-enabling the
  panel for the active tab.
- **The travel-mode icons had no names.** Hovering 🚗 🚶 🚲 🚆 explained
  nothing, and a screen reader announced nothing at all, since the only label
  was an emoji. Each now has a tooltip and an `aria-label` — Driving, Walking,
  Cycling, Transit — with the emoji marked decorative. The **mi** and **km**
  chips got the same treatment.

### Removed

- **Mileage reimbursement is gone**: the rate field in Options, the currency
  line in the results, the money total in History, and the Rate and
  Reimbursement columns in the CSV export. The mileage log itself stays — each
  trip still records distance, duration and travel mode, History still totals
  the distance, and CSV export is unchanged apart from those two columns.

---

## 1.4.0 — October 2026

### Removed

- **"Use my location" is gone**, along with the optional `geolocation`
  permission, the reverse-geocoding proxy endpoint and every supporting line of
  code. QuickMaps now holds no location permission of any kind, optional or
  otherwise, and the listing and privacy policy say so plainly. One fewer thing
  to justify at review, and one fewer thing to explain to users.

### New

- **Esc closes QuickMaps**, in both popup and side panel, saving your draft on
  the way out. Autocomplete dropdowns and the inline rename swallow Esc first,
  so it only closes when nothing else is open.
- **Alt+Q now toggles** rather than only opening, and the manifest and help
  panel say so.
- **A "Change the open shortcut" button** in the help panel opens
  `chrome://extensions/shortcuts`, with the address shown as copyable text if
  Chrome blocks the navigation.

### Changed

- **New icon.** The old mark was a white rounded rectangle, which reads as a
  placeholder at 16px and shared nothing with the different abstract mark used
  in the popup header. Both are now the same route-and-pin design: a start
  node, a bend, and a destination pin, which stays legible at toolbar size.
  Editable source is in `icons/source/icon.svg`; the pin-and-speed alternate
  is in `icons/alternates/` if you prefer it.

---

## 1.3.0 —  August 2026

### Keeping your work when the popup closes

A Chrome action popup is destroyed by the browser the moment it loses focus,
and no extension can opt out of that. So this release attacks the problem from
both ends.

- **Side panel mode.** QuickMaps can now open as a docked side panel, which
  stays open while you click around a page, select text and copy it. Switch in
  Options → *Open in*, or press **⇱** in the header to dock it immediately.
  Press **⇲** in the panel to go back to the popup. The panel fills whatever
  width you drag it to, and the trips drawer overlays rather than widening it.
- **Draft autosave.** Whatever you've typed — start, destination and every stop
  — is saved as you type and restored next time you open QuickMaps, for up to
  24 hours. This works in popup mode too, so even an accidental click away
  costs you nothing. **Clear** discards the draft; nothing else does.
- **Right-click sends land live.** With the side panel open, selecting an
  address on a page and sending it from the right-click menu drops it straight
  into the field, instead of waiting for the next time you open QuickMaps.

### Fixed

- **Hovering Calculate erased its green gradient.** The generic `.btn:hover`
  rule used the `background` shorthand, which resets `background-image`, and it
  out-specifies `.btn.primary`. Button backgrounds are now set with
  `background-color` only.

---

## 1.2.0 —  August 2026

### Routing

- **Migrated to the Google Routes API.** Distance Matrix and Directions became
  Legacy on 1 March 2025; Legacy services are feature-frozen and are not
  available on new Cloud projects. A multi-stop trip is now one request instead
  of one per leg, and the total matches the route Google Maps actually shows,
  rather than the sum of independent point-to-point hops.
- **Traffic-aware ETAs** for driving, via `TRAFFIC_AWARE` routing preference.
- **Travel modes**: driving, walking, cycling and transit.
- **Optimise stop order** — Google reorders intermediate stops for the shortest
  trip, and the popup updates to show the order it used.
- **Automatic fallback.** If the proxy Worker hasn't been upgraded yet, the
  extension detects it once, caches that fact, and uses the legacy path. No
  flag to set, no broken installs during rollout.

### New

- **CSV export** of your history — date, start, stops, destination, distance,
  duration, mode, rate and reimbursement. Formula-injection safe.
- **Mileage reimbursement** shown with each result and totalled in the History
  panel, at a rate you control in Options.
- **Use my location** to fill in the start address, behind an optional
  permission requested only on first use.
- **`Alt+Q` global shortcut** to open the popup, and an in-app shortcuts panel.
- **Inline rename and delete confirmation** for trips.

### Fixed

- **Light mode was unreadable.** The suggestions dropdown was hard-coded to a
  near-black background with `!important` while its text stayed dark navy.
- **Duplicate `id="add-stop"`** meant the second button was dead. The
  destination field had three overlapping autocomplete containers, one of them
  a `<datalist>` that was stripped at runtime.
- **Stop inputs never had their `id` assigned**, so the CSS rule targeting them
  never matched.
- **Enter did two things at once.** Accepting a suggestion also submitted the
  form, because the keydown event bubbled to the form handler. Enter now
  accepts; a second Enter calculates.
- **Stale autocomplete responses** could overwrite newer ones. Requests are now
  sequenced and late replies discarded.
- **Clear deleted your saved addresses.** `Clear` and <kbd>Ctrl</kbd>+<kbd>K</kbd>
  wiped the addresses you had ticked **Remember** on. They now clear the form
  only.
- **A dead service worker left the button stuck on "Calculating…" forever.**
  All messaging now has a timeout and restores the UI.
- **History entries recorded no distance or duration**, which made them useless
  as a mileage log. They now store the full result.
- `prompt()` and `confirm()` replaced with inline UI — modal dialogs can close
  the popup out from under themselves.
- Removed dead code: `wireCustomDest` (~60 unused lines), `getJSON`,
  `HISTORY_CAP`, `fmtTime`, and the unused `tripSort` reference that silently
  disabled trip sorting.

### Changed

- **Readable errors.** `ZERO_RESULTS`, `NOT_FOUND` and `TypeError: Failed to
  fetch` are translated into sentences, with an offline check first.
- **Accessibility.** Results announce via `aria-live`, copy targets are real
  buttons, the sidebar toggle and disclosures report `aria-expanded`, the
  combobox inputs expose `aria-activedescendant`, and focus is visible
  throughout. `prefers-reduced-motion` is respected.
- **CSS rewritten** as a single token block and one set of component rules.
  The previous file had three stacked "compact passes" each redefining `:root`,
  plus an `!important` block — which is how the light-mode bug got in.

---

## 1.1.1

Trips, history, multi-stop routing, context menu integration.
