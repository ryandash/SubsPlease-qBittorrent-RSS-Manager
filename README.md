# SubsPlease qBittorrent RSS Manager

Chrome Manifest V3 extension that adds buttons to the SubsPlease schedule page and manages qBittorrent RSS download rules.

## Behavior

- Green `✓ Add RSS` button: creates a rule named `<exact schedule title>`.
- Red `✕ Delete RSS` button: removes only the matching rule with that exact title.
- Default RSS feed: choose the feed to apply in the extension popup. The rule's `affectedFeeds` field is set to that feed.
- Rule criteria: the exact schedule title is stored in qBittorrent's `mustContain` field. Add any release-quality filtering you want in qBittorrent itself.
- Download location: qBittorrent's default download location.
- The extension does not create, modify, or delete RSS feed sources.

## Install Plugin

1. Download or clone this repository from GitHub.
2. Open qBittorrent and enable the Web UI in **Tools → Options → Web UI**.
3. Make sure the qBittorrent Web UI is reachable from your browser, usually at a URL such as `http://localhost:8080`.
4. Create or confirm the qBittorrent user account you want to use under **Authentication → Users**.
5. In Chrome, open `chrome://extensions`.
6. Turn on **Developer mode**.
7. Click **Load unpacked**.
8. Select the repository folder that contains `manifest.json` and the extension files.
9. The extension icon should appear in Chrome.
10. Click the extension icon and enter your qBittorrent Web UI URL, username, and password.
11. Click **Test connection** to verify it works.
12. Click **Save settings**.
13. Open or reload `https://subsplease.org/schedule` and the add (+)/remove(x) RSS buttons should appear.

When testing a connection, Chrome asks for access to the configured qBittorrent host. Allow the prompt for your local or trusted-network Web UI.

## qBittorrent compatibility

This extension uses these Web API endpoints:

- `POST /api/v2/auth/login`
- `GET /api/v2/app/version`
- `GET /api/v2/rss/rules`
- `POST /api/v2/rss/setRule`
- `POST /api/v2/rss/removeRule`

qBittorrent's RSS rule JSON schema has changed across releases. This project uses the documented fields `enabled`, `mustContain`, `mustNotContain`, `useRegex`, `episodeFilter`, `smartFilter`, `previouslyMatchedEpisodes`, `affectedFeeds`, and `ignoreDays`. In qBittorrent, `mustContain` is a single string, not an array. Verify the rule creation payload against the API documentation for your installed qBittorrent version if `setRule` returns an error.

## Extension architecture

- `background.js` is a Manifest V3 module service worker that routes messages.
- `background/qbittorrent-client.js` owns qBittorrent authentication and API requests.
- `shared/` contains the popup/service-worker browser and settings utilities.
- `popup/ui.js` contains popup rendering; `content-utils.js` and `content-artwork.js` are classic content-script helpers loaded before `content.js`.

The toolbar icon is an `S`: green after the last successful qBittorrent request, red after a failed request, and gray until the connection is tested. Loading the SubsPlease schedule also makes one login attempt. These are event-driven checks; the extension does not poll qBittorrent in the background.

## Important limitations / security

- The SubsPlease page markup may change. If buttons do not appear, inspect the schedule page's current DOM and update `SCHEDULE_LINK_SELECTOR` / `getScheduleEntries()` in `content.js`.
- Exact matching means the schedule title is included as a literal required term, not a regex.
- Credentials are stored in `chrome.storage.local`. This is local extension storage, not a dedicated secrets vault. Use a strong qBittorrent password and keep the Web UI bound to localhost or a trusted network.
- The extension requests optional HTTP/HTTPS host access only when you test a configured Web UI. Chrome may ask for permission when connecting.
- If qBittorrent is configured with CSRF protection or reverse-proxy restrictions, configure its Web UI accordingly for local API access.
- Do not expose the qBittorrent Web UI directly to the public internet unless you are aware of the risks involved
