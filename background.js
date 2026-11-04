const DEBUG = true;

function debugLog(label, details) {
  if (!DEBUG) return;
  const payload = details === undefined ? {} : details;
  console.debug(`[sp-qbt-bg] ${label}`, payload);
}

function storageGet(keys) {
  debugLog("storageGet", { keys });
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
  debugLog("getSettings:start");
  const { settings } = await storageGet("settings");
  if (!settings?.url || !settings.username || !settings.password) {
    debugLog("getSettings:missing-settings", { settings: sanitizeSettings(settings) });
    throw new Error(
      "Configure the qBittorrent URL, username, and password in the extension popup.",
    );
  }
  debugLog("getSettings:loaded", { settings: sanitizeSettings(settings) });
  return settings;
}

function apiUrl(base, path) {
  const url = `${base.replace(/\/+$/, "")}${path}`;
  debugLog("apiUrl", { base, path, url });
  return url;
}

async function apiRequest(settings, path, options = {}) {
  debugLog("apiRequest:start", { url: settings?.url, path, method: options.method || "GET" });
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
      debugLog("apiRequest:response-not-ok", { path, status: response.status, detail });
      throw new Error(
        `qBittorrent returned HTTP ${response.status} for ${path} (${settings.url}): ${detail}`,
      );
    }
    debugLog("apiRequest:success", { path, status: response.status });
    return response;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    debugLog("apiRequest:error", { path, detail });
    throw new Error(
      `qBittorrent request failed for ${path} (${settings.url}): ${detail}`,
    );
  }
}

function candidateSettings(settings) {
  return [{ ...settings, url: settings.url }];
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
  debugLog("waitForApiAvailability:start", { url: settings.url });
  const statusUrl = apiUrl(settings.url, "/api/v2/app/version");

  while (!loginAttemptState.attempted) {
    try {
      const response = await fetch(statusUrl, {
        method: "GET",
        credentials: "include",
      });
      if (response && response.status >= 100 && response.status < 600) {
        debugLog("waitForApiAvailability:reachable", { status: response.status });
        return true;
      }
    } catch (error) {
      debugLog("waitForApiAvailability:retrying", {
        error: error instanceof Error ? error.message : String(error),
      });
      // qBittorrent is not reachable yet; keep polling until the API responds.
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  debugLog("waitForApiAvailability:aborted", { attempted: loginAttemptState.attempted });
  return false;
}

async function login(settings) {
  debugLog("login:start", { url: settings.url, username: settings.username ? "[redacted]" : null });
  if (!settings.username && !settings.password) return;

  const loginKey = await makeLoginKey(settings);
  if (inFlightLogins.has(loginKey)) {
    debugLog("login:in-flight", { loginKey });
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

      debugLog("login:response", { status: response.status, text: text.trim() });

      if (!successfulLogin) {
        throw new Error(
          text.trim() ||
            `qBittorrent login failed (HTTP ${response.status}). Check credentials and Web UI settings.`,
        );
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      debugLog("login:error", { detail });
      throw new Error(
        `qBittorrent login failed for ${settings.url}: ${detail}`,
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
  debugLog("authenticated:start", { path, candidates: candidateSettings(settings).length });
  let lastError;
  for (const candidate of candidateSettings(settings)) {
    try {
      const response = await apiRequest(candidate, path, options);
      debugLog("authenticated:success", { path, url: candidate.url });
      return response;
    } catch (error) {
      lastError = error;
      debugLog("authenticated:retry", { path, url: candidate.url, error: error.message });
    }
  }
  debugLog("authenticated:failed", { path, error: lastError?.message || "Unable to reach qBittorrent." });
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
  debugLog("backgroundLoginOnce:start", { attempted: loginAttemptState.attempted, pollActive: loginAttemptState.pollActive });
  if (loginAttemptState.attempted || loginAttemptState.pollActive) {
    debugLog("backgroundLoginOnce:already-processed", { success: loginAttemptState.success });
    return loginAttemptState.success;
  }

  const { settings } = await storageGet("settings");
  if (!settings?.url || !settings.username || !settings.password) {
    debugLog("backgroundLoginOnce:missing-settings");
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
    debugLog("backgroundLoginOnce:success");
    return true;
  } catch (error) {
    debugLog("backgroundLoginOnce:failure", { error: error instanceof Error ? error.message : String(error) });
    loginAttemptState.attempted = true;
    loginAttemptState.success = false;
    loginAttemptState.pollActive = false;
    return false;
  }
}

async function getRules(settings) {
  debugLog("getRules:start", { url: settings.url });
  const response = await authenticated(settings, "/api/v2/rss/rules");
  const rules = await response.json();
  debugLog("getRules:loaded", { ruleCount: Object.keys(rules || {}).length });
  return rules;
}

async function getRuleNames(settings) {
  debugLog("getRuleNames:start", { url: settings.url });
  const rules = await getRules(settings);
  const names = Object.keys(rules || {});
  debugLog("getRuleNames:loaded", { count: names.length });
  return names;
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
  debugLog("getFeeds:start", { url: settings.url });
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
debugLog("handleMessage:start", { type: message?.type });
const settings = message.settings || (await getSettings());
if (message.type === "START_QBITTORRENT_PROBE") {
  const started = await backgroundLoginOnce();
  debugLog("handleMessage:START_QBITTORRENT_PROBE", { started });
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
  debugLog("handleMessage:TEST_CONNECTION", { version, pageRefreshed });
  return { ok: true, version, pageRefreshed };
}
if (message.type === "GET_FEEDS") {
  const feeds = await getFeeds(settings);
  const names = feeds.map(
    (feed) => feed.display || feed.label || feed.value || feed,
  );
  debugLog("handleMessage:GET_FEEDS", { feedCount: feeds.length });
  return {
    ok: true,
    feeds,
    names,
  };
}
if (message.type === "GET_RULES") {
  const rules = await getRules(settings);
  const names = Object.keys(rules || {});
  debugLog("handleMessage:GET_RULES", { ruleCount: names.length });
  return {
    ok: true,
    rules,
    names,
  };
}
if (message.type === "ADD_RULE") {
  const result = await addRule(settings, message.title);
  debugLog("handleMessage:ADD_RULE", { title: message.title, result });
  return { ok: true, ...result };
}
if (message.type === "REMOVE_RULE") {
  const result = await removeRule(settings, message.title);
  debugLog("handleMessage:REMOVE_RULE", { title: message.title, result });
  return { ok: true, ...result };
}
debugLog("handleMessage:unknown", { type: message?.type });
throw new Error("Unknown extension message.");
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
debugLog("runtime.onMessage", { type: message?.type });
handleMessage(message)
  .then(sendResponse)
  .catch((error) => {
    debugLog("runtime.onMessage:error", { error: error.message || String(error) });
    sendResponse({ ok: false, error: error.message || String(error) });
  });
return true;
});

