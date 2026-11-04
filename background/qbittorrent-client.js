import { hasConnectionSettings, normalizeUrl } from "../shared/settings.js";

const loggedInSettings = new Set();
const pendingLogins = new Map();
const REQUEST_TIMEOUT_MS = 10_000;
const FORM_HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded",
};

function normalizeRuleName(value) {
  return String(value || "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function feedEntries(payload) {
  const feeds = new Map();
  const nodes = [payload];

  while (nodes.length) {
    const node = nodes.pop();
    if (!node || typeof node !== "object") continue;

    for (const [label, value] of Object.entries(node)) {
      if (!value || typeof value !== "object") continue;

      const hasUrl = value.hasUrl === true || typeof value.url === "string";
      if (hasUrl && label) {
        const display = String(label).trim();
        const url = String(value.url || value.uid || label).trim();
        if (display && url) {
          feeds.set(`${display}\u0000${url}`, { label: display, value: url, display });
        }
      } else {
        nodes.push(value);
      }
    }
  }

  return [...feeds.values()];
}

export class QbittorrentClient {
  constructor(settings) {
    if (!hasConnectionSettings(settings)) {
      throw new Error(
        "Configure the qBittorrent URL, username, and password in the extension popup.",
      );
    }

    this.settings = { ...settings, url: normalizeUrl(settings.url) };
    this.key = `${this.settings.url}\u0000${this.settings.username}\u0000${this.settings.password}`;
  }

  get url() {
    return this.settings.url;
  }

  async fetch(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(`${this.url}${path}`, {
        method: options.method || "GET",
        credentials: "include",
        headers: options.body ? FORM_HEADERS : undefined,
        body: options.body,
        signal: controller.signal,
      });
    } catch (error) {
      throw new Error(
        `qBittorrent request failed for ${path} (${this.url}): ${
          error?.message || String(error)
        }`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async login() {
    if (loggedInSettings.has(this.key)) return;
    if (pendingLogins.has(this.key)) return pendingLogins.get(this.key);

    const request = (async () => {
      const response = await this.fetch("/api/v2/auth/login", {
        method: "POST",
        body: new URLSearchParams({
          username: this.settings.username,
          password: this.settings.password,
        }),
      });
      const text = await response.text();
      const succeeded =
        response.status === 204 || (response.status === 200 && text.trim() === "Ok.");

      if (!succeeded) {
        throw new Error(
          text.trim() ||
            `qBittorrent login failed (HTTP ${response.status}). Check credentials and Web UI settings.`,
        );
      }
      loggedInSettings.add(this.key);
    })();

    pendingLogins.set(this.key, request);
    try {
      await request;
    } catch (error) {
      throw new Error(
        `qBittorrent login failed for ${this.url}: ${error?.message || String(error)}`,
      );
    } finally {
      pendingLogins.delete(this.key);
    }
  }

  async request(path, options = {}) {
    let response = await this.fetch(path, options);
    if (response.status === 403) {
      loggedInSettings.delete(this.key);
      await this.login();
      response = await this.fetch(path, options);
    }
    if (response.ok) return response;

    const detail = (await response.text()).trim() || `HTTP ${response.status}`;
    throw new Error(
      `qBittorrent returned HTTP ${response.status} for ${path} (${this.url}): ${detail}`,
    );
  }

  async getVersion() {
    return (await (await this.request("/api/v2/app/version")).text()).trim();
  }

  async getRules() {
    const rules = await (await this.request("/api/v2/rss/rules")).json();
    return rules && typeof rules === "object" ? rules : {};
  }

  async getRuleNames() {
    return Object.keys(await this.getRules());
  }

  async getFeeds() {
    for (const path of [
      "/api/v2/rss/items",
      "/api/v2/rss/folders",
      "/api/v2/rss/feeds",
    ]) {
      try {
        const feeds = feedEntries(await (await this.request(path)).json());
        if (feeds.length) return feeds;
      } catch {
        // Older qBittorrent versions do not expose every RSS endpoint.
      }
    }
    return [];
  }

  async addRule(title) {
    const ruleName = String(title || "").trim();
    if (!ruleName) throw new Error("A schedule title is required to create an RSS rule.");

    const normalizedTitle = normalizeRuleName(ruleName);
    if ((await this.getRuleNames()).some((name) => normalizeRuleName(name) === normalizedTitle)) {
      return { ruleName, alreadyExists: true };
    }

    const affectedFeeds = [this.settings.defaultFeed]
      .flat()
      .map((feed) => String(feed || "").trim())
      .filter(Boolean);
    if (!affectedFeeds.length) {
      throw new Error("Choose a default RSS feed in the extension popup before creating a rule.");
    }

    const rule = {
      enabled: true,
      mustContain: ruleName,
      mustNotContain: "",
      useRegex: false,
      episodeFilter: "",
      smartFilter: false,
      previouslyMatchedEpisodes: [],
      affectedFeeds,
      ignoreDays: 0,
    };
    const response = await this.request("/api/v2/rss/setRule", {
      method: "POST",
      body: new URLSearchParams({ ruleName, ruleDef: JSON.stringify(rule) }),
    });
    const text = (await response.text()).trim();
    if (text && text !== "Ok.") throw new Error(`Could not create RSS rule: ${text}`);
    return { ruleName, alreadyExists: false };
  }

  async removeRule(title) {
    const ruleName = String(title || "").trim();
    if (!ruleName) throw new Error("A schedule title is required to remove an RSS rule.");

    const normalizedTitle = normalizeRuleName(ruleName);
    if (!(await this.getRuleNames()).some((name) => normalizeRuleName(name) === normalizedTitle)) {
      return { ruleName, notFound: true };
    }

    const response = await this.request("/api/v2/rss/removeRule", {
      method: "POST",
      body: new URLSearchParams({ ruleName }),
    });
    const text = (await response.text()).trim();
    if (text && text !== "Ok.") throw new Error(`Could not remove RSS rule: ${text}`);
    return { ruleName, notFound: false };
  }
}
