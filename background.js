function storageGet(keys) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.get(keys, (result) => {
        const error = chrome.runtime.lastError;
        if (error) return reject(new Error(error.message));
        resolve(result);
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function getSettings() {
  const { settings } = await storageGet("settings");
  if (!settings?.url || !settings.username || !settings.password) {
    throw new Error(
      "Configure the qBittorrent URL, username, and password in the extension popup.",
    );
  }
  return settings;
}

function apiUrl(base, path) {
  return `${base.replace(/\/+$/, "")}${path}`;
}

async function apiRequest(settings, path, options = {}) {
  try {
    const response = await fetch(apiUrl(settings.url, path), {
      method: options.method || "GET",
      credentials: "include",
      headers: options.body
        ? { "Content-Type": "application/x-www-form-urlencoded" }
        : undefined,
      body: options.body,
    });
    if (!response.ok) {
      const errorText = await response.text();
      const detail = errorText.trim() || `HTTP ${response.status}`;
      throw new Error(
        `qBittorrent returned HTTP ${response.status} for ${path} (${settings.url}): ${detail}`,
      );
    }
    return response;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `qBittorrent request failed for ${path} (${settings.url}): ${detail}`,
    );
  }
}

function candidateSettings(settings) {
  const urls = new Set([settings.url]);
  if (settings.url !== "http://localhost:8039")
    urls.add("http://localhost:8039");
  if (settings.url !== "http://localhost:8080")
    urls.add("http://localhost:8080");
  if (settings.url !== "http://127.0.0.1:8039")
    urls.add("http://127.0.0.1:8039");
  return [...urls].map((url) => ({ ...settings, url }));
}

const loginAttemptState = {
  attempted: false,
  success: false,
  pollActive: false,
};
const inFlightLogins = new Map();

function sanitizeSettings(settings) {
  if (!settings) return null;
  return {
    url: settings.url || null,
    username: settings.username ? "[redacted]" : null,
    password: settings.password ? "[redacted]" : null,
  };
}

async function makeLoginKey(settings) {
  const raw = `${settings.url}|${settings.username}|${settings.password}`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(raw),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function waitForApiAvailability(settings) {
  const statusUrl = apiUrl(settings.url, "/api/v2/app/version");

  while (!loginAttemptState.attempted) {
    try {
      const response = await fetch(statusUrl, {
        method: "GET",
        credentials: "include",
      });
      if (response && response.status >= 100 && response.status < 600) {
        return true;
      }
    } catch {
      // qBittorrent is not reachable yet; keep polling until the API responds.
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  return false;
}

async function login(settings) {
  if (!settings.username && !settings.password) return;

  const loginKey = await makeLoginKey(settings);
  if (inFlightLogins.has(loginKey)) {
    return inFlightLogins.get(loginKey);
  }

  const loginPromise = (async () => {
    try {
      const body = new URLSearchParams({
        username: settings.username,
        password: settings.password,
      });

      const response = await fetch(apiUrl(settings.url, "/api/v2/auth/login"), {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });

      const text = await response.text();

      const successfulLogin =
        response.status === 204 ||
        (response.status === 200 && text.trim() === "Ok.");

      if (!successfulLogin) {
        throw new Error(
          text.trim() ||
            `qBittorrent login failed (HTTP ${response.status}). Check credentials and Web UI settings.`,
        );
      }
    } catch (error) {
      throw new Error(
        `qBittorrent login failed for ${settings.url}: ${error.message || String(error)}`,
      );
    }
  })();

  inFlightLogins.set(loginKey, loginPromise);
  try {
    await loginPromise;
  } finally {
    inFlightLogins.delete(loginKey);
  }
}

async function authenticated(settings, path, options = {}) {
  let lastError;
  for (const candidate of candidateSettings(settings)) {
    try {
      return await apiRequest(candidate, path, options);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Unable to reach qBittorrent.");
}

async function refreshRulesOnPage() {
  return new Promise((resolve) => {
    try {
      chrome.tabs.query({}, (tabs) => {
        const match = (tabs || []).find((tab) => {
          const url = tab?.url || "";
          return /^https?:\/\/subsplease\.org\/schedule/i.test(url);
        });

        if (!match?.id) {
          resolve(false);
          return;
        }

        chrome.tabs.sendMessage(match.id, { type: "REFRESH_RULES" }, () => {
          const error = chrome.runtime.lastError;
          if (error) {
            resolve(false);
            return;
          }
          resolve(true);
        });
      });
    } catch {
      resolve(false);
    }
  });
}

async function backgroundLoginOnce() {
  if (loginAttemptState.attempted || loginAttemptState.pollActive) {
    return loginAttemptState.success;
  }

  const { settings } = await storageGet("settings");
  if (!settings?.url || !settings.username || !settings.password) {
    loginAttemptState.attempted = true;
    loginAttemptState.success = false;
    return false;
  }

  loginAttemptState.pollActive = true;

  try {
    await waitForApiAvailability(settings);
    await login(settings);
    loginAttemptState.attempted = true;
    loginAttemptState.success = true;
    loginAttemptState.pollActive = false;
    await refreshRulesOnPage();
    return true;
  } catch {
    loginAttemptState.attempted = true;
    loginAttemptState.success = false;
    loginAttemptState.pollActive = false;
    return false;
  }
}

async function logout(settings) {
  if (!settings.username && !settings.password) return;
  try {
    await fetch(apiUrl(settings.url, "/api/v2/auth/logout"), {
      method: "POST",
      credentials: "include",
    });
  } catch {
    // Ignore logout failures; the session is already being used for this check.
  }
}

async function getRules(settings) {
  const response = await authenticated(settings, "/api/v2/rss/rules");
  const rules = await response.json();
  return rules;
}

async function getRuleNames(settings) {
  const rules = await getRules(settings);
  return Object.keys(rules || {});
}

function encodeForm(values) {
  return new URLSearchParams(values);
}

function normalizeRuleName(value) {
  return String(value || "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeFeedEntries(payload) {
  const entries = new Map();

  function addFeed(label, rawValue) {
    const displayName = String(label || "").trim();
    if (!displayName) return;
    const value = String(rawValue || "").trim();
    const finalValue = value || displayName;
    entries.set(displayName, {
      label: displayName,
      value: finalValue,
      display: displayName,
    });
  }

  function walk(node) {
    if (!node || typeof node !== "object") return;

    for (const [key, value] of Object.entries(node)) {
      if (!value || typeof value !== "object") continue;

      const hasUrl = value.hasUrl === true || typeof value.url === "string";
      if (hasUrl && key) {
        const url = typeof value.url === "string" ? value.url.trim() : "";
        addFeed(key, url || value.uid || key);
        continue;
      }

      if (key && typeof value === "object" && Object.keys(value).length) {
        walk(value);
      }
    }
  }

  walk(payload);
  return [...entries.values()];
}

async function getFeeds(settings) {
  const attempts = [
    "/api/v2/rss/items",
    "/api/v2/rss/folders",
    "/api/v2/rss/feeds",
  ];

  for (const candidate of candidateSettings(settings)) {
    for (const path of attempts) {
      try {
        const response = await authenticated(candidate, path);
        const data = await response.json();
        const feeds = normalizeFeedEntries(data);
        if (feeds.length) {
          return feeds;
        }
      } catch (error) {
        // Ignore failed feed endpoints and keep trying the next fallback.
      }
    }
  }

  return [];
}

async function addRule(settings, title) {
  const ruleName = title;
  const normalizedTarget = normalizeRuleName(ruleName);
  const existing = await getRuleNames(settings);
  const alreadyExists = existing.some(
    (name) => normalizeRuleName(name) === normalizedTarget,
  );
  if (alreadyExists) {
    return { ruleName, alreadyExists: true };
  }

  const rawFeed = settings.defaultFeed;
  const selectedFeeds = Array.isArray(rawFeed)
    ? rawFeed.map((feed) => String(feed).trim()).filter(Boolean)
    : [String(rawFeed || "").trim()].filter(Boolean);

  if (!selectedFeeds.length) {
    throw new Error(
      "Choose a default RSS feed in the extension popup before creating a rule.",
    );
  }

  // The popup stores the actual feed URL returned by /api/v2/rss/items, while the
  // dropdown displays the human-readable object name.
  const rule = {
    enabled: true,
    mustContain: title,
    mustNotContain: "",
    useRegex: false,
    episodeFilter: "",
    smartFilter: false,
    previouslyMatchedEpisodes: [],
    affectedFeeds: selectedFeeds,
    ignoreDays: 0,
  };
  const requestBody = encodeForm({
    ruleName,
    ruleDef: JSON.stringify(rule),
  });
  const response = await authenticated(settings, "/api/v2/rss/setRule", {
    method: "POST",
    body: requestBody,
  });
  const text = await response.text();
  if (text.trim() && text.trim() !== "Ok.") {
    throw new Error(`Could not create RSS rule: ${text}`);
  }
  return { ruleName, alreadyExists: false };
}

async function removeRule(settings, title) {
  const ruleName = title;
  const names = await getRuleNames(settings);
  const normalizedTarget = normalizeRuleName(ruleName);
  const matched = names.some(
    (name) => normalizeRuleName(name) === normalizedTarget,
  );
  if (!matched) {
    return { ruleName, notFound: true };
  }
  const body = encodeForm({ ruleName });
  const response = await authenticated(settings, "/api/v2/rss/removeRule", {
    method: "POST",
    body,
  });
  const text = await response.text();
  if (text.trim() && text.trim() !== "Ok.") {
    throw new Error(`Could not remove RSS rule: ${text}`);
  }
  return { ruleName, notFound: false };
}

async function handleMessage(message) {
  const settings = message.settings || (await getSettings());
  if (message.type === "START_QBITTORRENT_PROBE") {
    const started = await backgroundLoginOnce();
    return { ok: true, started };
  }
  if (message.type === "TEST_CONNECTION") {
    await waitForApiAvailability(settings);
    await login(settings);
    loginAttemptState.attempted = true;
    loginAttemptState.success = true;
    const response = await apiRequest(settings, "/api/v2/app/version");
    const version = (await response.text()).trim();
    const pageRefreshed = await refreshRulesOnPage();
    return { ok: true, version, pageRefreshed };
  }
  if (message.type === "GET_FEEDS") {
    const feeds = await getFeeds(settings);
    const names = feeds.map(
      (feed) => feed.display || feed.label || feed.value || feed,
    );
    return {
      ok: true,
      feeds,
      names,
    };
  }
  if (message.type === "GET_RULES") {
    const rules = await getRules(settings);
    const names = Object.keys(rules || {});
    return {
      ok: true,
      rules,
      names,
    };
  }
  if (message.type === "ADD_RULE") {
    const result = await addRule(settings, message.title);
    return { ok: true, ...result };
  }
  if (message.type === "REMOVE_RULE") {
    const result = await removeRule(settings, message.title);
    return { ok: true, ...result };
  }
  throw new Error("Unknown extension message.");
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((error) =>
      sendResponse({ ok: false, error: error.message || String(error) }),
    );
  return true;
});

