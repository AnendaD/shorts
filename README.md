# Shorts Limiter

A Chrome extension that helps you take control of your time on YouTube Shorts by setting a daily watch limit and automatically redirecting you to a video of your choice when the limit is reached.

---

## Features

- **Daily time limit** — Set a custom daily limit (1–60 minutes) for YouTube Shorts
- **Auto-redirect** — When your limit is reached, you're automatically sent to a YouTube video you choose (great for redirecting to something productive or educational)
- **Live tracking** — Time is tracked only while a Short is actually playing
- **Weekly chart** — Visual bar chart of your Shorts usage over the past 7 days
- **Statistics** — View today's usage, 7-day total, 30-day total, and daily average
- **Account sync** — Optional login to sync your settings and stats across devices

---

## Installation

Since this extension is not on the Chrome Web Store, you'll need to load it manually:

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked**
5. Select the folder containing the extension files
6. The Shorts Limiter icon will appear in your toolbar

---

## Usage

### Setting your limit

1. Click the Shorts Limiter icon in the toolbar
2. If prompted, you can sign in to sync settings or continue without an account
3. Click **Settings** to open the options page
4. Use the slider to set your daily limit in minutes
5. Paste a YouTube video URL into the redirect field
6. Click **Save settings**

### When the limit is reached

As soon as your daily watch time hits the limit, you'll be redirected away from Shorts to your chosen video automatically. 

### Resetting stats

- To reset today's counter, click **Reset today** in the popup
- To wipe all historical data, go to **Settings → Reset all statistics**

---

## Account & Sync

Creating an account is optional. Without one, all data is stored locally in your browser.

With an account, your settings and statistics are synced to the cloud via the SSO service, so your limits carry over if you reinstall the extension or use multiple devices.

To sign in, click the **Sign in** button in the popup. To sign out, click **Logout** next to your email.

---

## Project Structure

```
├── manifest.json       # Extension configuration (Manifest V3)
├── background.js       # Service worker: handles timers, storage, messaging
├── content.js          # Injected into YouTube: tracks playback and triggers redirects
├── popup.html/css/js   # Toolbar popup UI
├── options.html/css/js # Settings page
├── auth.html/css/js    # Login & registration page
├── auth-ui.js          # Auth UI logic
├── init.js             # Initializes content scripts on existing YouTube tabs
```

---

## Permissions

| Permission | Why it's needed |
|---|---|
| `storage` | Save settings and statistics locally |
| `tabs` | Detect YouTube tabs and inject content scripts |
| `scripting` | Inject the tracker into YouTube pages |
| `alarms` | Schedule daily stat resets |
| `notifications` | Notify when the daily limit is approaching |
| `windows` | Open the auth page in a new window |

---

## Privacy

- All tracking happens locally in your browser
- No browsing data is ever sent to any server
- If you create an account, only your settings and usage statistics are synced (no video history or personal data)

---

## Requirements

- Google Chrome (or any Chromium-based browser supporting Manifest V3)
- Active internet connection required only for account sync
