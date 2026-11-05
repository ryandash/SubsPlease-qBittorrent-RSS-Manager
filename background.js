import { getLocalStorage } from "./shared/chrome-api.js";
import {
  restoreConnectionStatus,
  setConnectionStatus,
} from "./background/action-status.js";
import { QbittorrentClient } from "./background/qbittorrent-client.js";
import { refreshScheduleTabs } from "./background/schedule-tabs.js";

void restoreConnectionStatus();

async function handleMessage(message) {
  const settings =
    message?.settings ?? (await getLocalStorage("settings")).settings;
  const client = new QbittorrentClient(settings);
  await client.login();

  switch (message?.type) {
    case "CHECK_CONNECTION":
      return { ok: true };
    case "TEST_CONNECTION": {
      const version = await client.getVersion();
      return {
        ok: true,
        version,
        pageRefreshed: await refreshScheduleTabs(),
      };
    }
    case "GET_FEEDS": {
      const feeds = await client.getFeeds();
      return {
        ok: true,
        feeds,
        names: feeds.map((feed) => feed.display),
      };
    }
    case "GET_RULES": {
      const [rules, feeds] = await Promise.all([
        client.getRules(),
        client.getFeeds(),
      ]);

      return {
        ok: true,
        rules,
        names: Object.keys(rules),
        feeds,
      };
    }
    case "ADD_RULE":
      return {
        ok: true,
        ...(await client.addRule(message.title, message.rule)),
      };
    case "REMOVE_RULE":
      return { ok: true, ...(await client.removeRule(message.title)) };
    default:
      throw new Error("Unknown extension message.");
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(async (response) => {
      await setConnectionStatus("connected");
      sendResponse(response);
    })
    .catch(async (error) => {
      const status = error?.message?.startsWith("Configure the qBittorrent")
        ? "unknown"
        : "disconnected";
      await setConnectionStatus(status);
      sendResponse({ ok: false, error: error?.message || String(error) });
    });
  return true;
});
