# QuickMaps

QuickMaps is a Chrome extension that lets you check travel time, distance, and get directions 
using Google Maps data — all from a fast and simple browser popup.  
It also saves your recent searches and trips for quick access.

<img width="358" height="439" alt="Quick-Maps-Demo-Photo-1" src="https://github.com/user-attachments/assets/dcd4ffed-d5bd-4f5d-bc00-a0d0884f7c12" />

---

## ✨ Features
- **Instant results** for travel time, distance, and directions
- **Saved trips**: Keep your most-used routes handy
- **Search history**: Up to 50 recent queries stored locally
- **Google Maps accuracy**: Powered by Distance Matrix, Directions, and Places APIs
- **Privacy-first**: No cross-site tracking or persistent personal data storage

---

## 🔒 Privacy
- We do not sell or share your data
- Minimal, temporary logs stored server-side only for abuse prevention and reliability
- All logs are purged automatically on a rolling basis
- You can request deletion of logs related to your IP at any time

Full policy: [Privacy Policy](https://github.com/bricknermon/QuickMaps/blob/main/PRIVACY_POLICY.md)

---

## ⚙️ How It Works
QuickMaps uses a Cloudflare Worker proxy to securely send your requests to Google Maps APIs.  
This keeps your API key private and prevents it from being exposed in the extension source code.

---

## 📦 Installation
1. Install from the Chrome Web Store (link coming soon)
2. Click the QuickMaps icon in your browser toolbar
3. Enter start and destination addresses
4. Get instant travel time, distance, and directions!

---

## 🛠 Development
Clone the repo and load it unpacked in Chrome for local testing:
```bash
git clone https://github.com/bricknermon/quickmaps.git
