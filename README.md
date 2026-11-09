# QuickMaps

QuickMaps is a Chrome extension that gives you travel time, distance and
directions from a fast popup - or from a docked side panel that stays open
while you browse. Multi-stop trips, saved routes, history, and a mileage log
you can export to CSV.

[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/quickmaps/jemlgpgigchogddmjciecgibcilfgcme)

<img width="720" height="450" alt="demo" src="https://github.com/user-attachments/assets/2e316ac6-ddc7-4706-88d8-db2901c74c73" />" 

---

## Features

- **Dock it as a side panel** - a popup closes the moment you click the page;
  the panel doesn't, so you can copy an address without losing what you typed
- **One-call routing** across every stop, with ETAs that account for traffic
- **Multi-stop trips** with reorder, plus optional *optimize stop order*
- **Travel modes**: driving, walking, cycling and transit
- **Mileage log** - every route records its distance and duration, exportable
  to CSV for expenses or tax time
- **Saved trips** and **history** (50 most recent), stored locally
- **Right-click any address** on a page and send it straight to QuickMaps
- **Draft autosave** so a half-filled route survives the popup closing
- **Light, dark or automatic**, following your system by default

---

## Shortcuts

| Keys | Action |
|---|---|
| <kbd>Alt</kbd>+<kbd>Q</kbd> | Open / close QuickMaps |
| <kbd>Esc</kbd> | Close |
| <kbd>Enter</kbd> | Accept the highlighted suggestion (press again to calculate) |
| <kbd>Ctrl</kbd>+<kbd>Enter</kbd> | Calculate |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd> | Swap start and destination |
| <kbd>Ctrl</kbd>+<kbd>B</kbd> | Toggle trips & history |
| <kbd>Ctrl</kbd>+<kbd>K</kbd> | Clear the form |
| <kbd>Alt</kbd>+<kbd>H</kbd> / <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>H</kbd> | Store / recall home |
| <kbd>Alt</kbd>+<kbd>W</kbd> / <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>W</kbd> | Store / recall work |

Press <kbd>?</kbd> in the popup header for this list in-app, and reassign the
open shortcut at `chrome://extensions/shortcuts`.

---

##  Privacy

- **Your data stays on your device.** Saved addresses, trips, history, drafts
  and settings live in your browser's local extension storage and are never
  uploaded to us.
- Addresses you enter are sent to our proxy, and on to Google Maps, purely to
  calculate the route you asked for.
- **No location permission.** QuickMaps never requests your device location.
- No accounts, no analytics, no advertising, no cross-site tracking. There are
  no content scripts, so QuickMaps cannot read the pages you browse - text
  reaches it only when you select it and choose QuickMaps from the right-click
  menu.

Full policy: [PRIVACY_POLICY.md](PRIVACY_POLICY.md)

---

## Repository layout

| Path | What it is |
|---|---|
| `manifest.json` | MV3 manifest |
| `popup.html` / `popup.css` / `popup.js` | The UI, in both popup and side-panel modes |
| `theme-init.js` | Applies the saved theme before first paint |
| `background.js` | Service worker: routing, autocomplete, UI mode |
| `config.js` | Proxy hostname and client-side tuning |
| `icons/` | Toolbar icons, with editable SVG source in `icons/source/` |
| `CHANGELOG.md` | Version history |
---

## Development

```bash
git clone https://github.com/bricknermon/quickmaps.git
cd quickmaps
# chrome://extensions → Developer mode → Load unpacked → select this folder
```

Plain ES modules, no build step. `config.js` holds the proxy hostname; if you
change it, change `host_permissions` in `manifest.json` too.

---
