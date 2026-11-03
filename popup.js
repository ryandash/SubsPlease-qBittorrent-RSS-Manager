const form = document.getElementById("settings-form");
const urlInput = document.getElementById("url");
const userInput = document.getElementById("username");
const passInput = document.getElementById("password");
const testButton = document.getElementById("test");
const statusText = document.getElementById("status");
const statusDot = document.getElementById("status-dot");
const feedSelect = document.getElementById("feed-select");
const themeToggle = document.getElementById("theme-toggle");

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

function storageSet(values) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.set(values, () => {
        const error = chrome.runtime.lastError;
        if (error) return reject(new Error(error.message));
        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

function sanitizeSettings(settings) {
  if (!settings) return null;
  return {
    url: settings.url || null,
    username: settings.username ? "[redacted]" : null,
    password: settings.password ? "[redacted]" : null,
    defaultFeed: settings.defaultFeed || null,
  };
}

function sendRuntimeMessage(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          resolve({ ok: false, error: error.message });
          return;
        }
        resolve(response ?? { ok: false, error: "No response from extension background script." });
      });
    } catch (error) {
      resolve({ ok: false, error: error.message || String(error) });
    }
  });
}

function permissionContains(details) {
  return new Promise((resolve, reject) => {
    try {
      chrome.permissions.contains(details, (result) => {
        const error = chrome.runtime.lastError;
        if (error) return reject(new Error(error.message));
        resolve(result);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function permissionRequest(details) {
  return new Promise((resolve, reject) => {
    try {
      chrome.permissions.request(details, (granted) => {
        const error = chrome.runtime.lastError;
        if (error) return reject(new Error(error.message));
        resolve(granted);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function normalizeFeedOption(feed) {
  if (typeof feed === "string") {
    return { label: feed, value: feed };
  }
  if (feed && typeof feed === "object") {
    return {
      label: feed.display || feed.label || feed.name || feed.value || "",
      value: feed.value || feed.url || feed.label || feed.name || "",
    };
  }
  return { label: "", value: "" };
}

function renderFeedOptions(feeds, selected) {
  const options = (feeds || [])
    .map(normalizeFeedOption)
    .filter((feed) => feed.label && feed.value);
  const uniqueFeeds = [];
  const seen = new Set();
  for (const feed of options) {
    const key = `${feed.value}|${feed.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueFeeds.push(feed);
  }
  feedSelect.innerHTML = "";

  if (!uniqueFeeds.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No RSS feeds available";
    feedSelect.appendChild(option);
    feedSelect.disabled = true;
    return;
  }

  const selectedValue = uniqueFeeds.some((feed) => feed.value === selected)
    ? selected
    : uniqueFeeds[0].value;

  for (const feed of uniqueFeeds) {
    const option = document.createElement("option");
    option.value = feed.value;
    option.textContent = feed.label;
    if (feed.value === selectedValue) option.selected = true;
    feedSelect.appendChild(option);
  }
  feedSelect.disabled = false;
  feedSelect.value = selectedValue;
}

function showStatus(message, kind = "") {
  statusText.textContent = message;
  statusDot.className = `dot ${kind}`;
}

function currentTheme() {
  return themeToggle?.checked ? "dark" : "light";
}

function applyTheme(theme) {
  const resolvedTheme = theme === "light" ? "light" : "dark";
  document.body.dataset.theme = resolvedTheme;
  if (themeToggle) {
    themeToggle.checked = resolvedTheme === "dark";
  }
}

function normalizedUrl(value) {
  return value.trim().replace(/\/+$/, "");
}

async function loadFeeds() {
  const settings = {
    url: normalizedUrl(urlInput.value),
    username: userInput.value,
    password: passInput.value,
    theme: currentTheme(),
  };

  if (!settings.url || !settings.username || !settings.password) {
    renderFeedOptions([], "");
    return;
  }

  try {
    const result = await sendRuntimeMessage({
      type: "GET_FEEDS",
      settings,
    });
    if (!result?.ok) {
      renderFeedOptions([], "");
      return;
    }

    const storedSettings = (await storageGet("settings")).settings || {};
    const selectedFeed = storedSettings.defaultFeed || result.feeds?.[0]?.value || result.names?.[0] || "";
    renderFeedOptions(result.feeds || result.names || [], selectedFeed);
    if (feedSelect.value) {
      const nextSettings = {
        ...storedSettings,
        url: settings.url,
        username: settings.username,
        password: settings.password,
        theme: currentTheme(),
        defaultFeed: feedSelect.value,
      };
      await storageSet({ settings: nextSettings });
    }
  } catch {
    renderFeedOptions([], "");
  }
}

async function loadSettings() {
  const { settings } = await storageGet("settings");
  const theme = settings?.theme || "dark";
  applyTheme(theme);
  if (!settings) return;
  urlInput.value = settings.url || "http://localhost:8039";
  userInput.value = settings.username || "";
  passInput.value = settings.password || "";
  if (settings.defaultFeed) {
    renderFeedOptions([settings.defaultFeed], settings.defaultFeed);
  }
  if (settings.url && settings.username && settings.password) {
    showStatus("Settings loaded; attempting login…");
    await testConnection();
  }
}

async function refreshFeedsAfterConnection() {
  const settings = {
    url: normalizedUrl(urlInput.value),
    username: userInput.value,
    password: passInput.value,
    theme: currentTheme(),
  };

  if (!settings.url || !settings.username || !settings.password) return;

  const result = await sendRuntimeMessage({
    type: "GET_FEEDS",
    settings,
  });

  if (!result?.ok || !(result.feeds || result.names)) {
    renderFeedOptions([], "");
    return;
  }

  const feedOptions = result.feeds || result.names || [];
  const selectedDefault = (await storageGet("settings")).settings?.defaultFeed || feedOptions[0]?.value || feedOptions[0] || "";
  renderFeedOptions(feedOptions, selectedDefault);

  const currentSettings = (await storageGet("settings")).settings || {};
  await storageSet({
    settings: {
      ...currentSettings,
      url: settings.url,
      username: settings.username,
      password: settings.password,
      theme: currentTheme(),
      defaultFeed: feedSelect.value || selectedDefault || "",
    },
  });
}

async function requestHostPermission() {
  const parsed = new URL(normalizedUrl(urlInput.value));
  const pattern = `${parsed.protocol}//${parsed.host}/*`;
  const allowedRemotePatterns = [
    "http://localhost/*",
    "http://127.0.0.1/*",
    "https://subsplease.org/*",
  ];

  if (allowedRemotePatterns.includes(pattern)) {
    return true;
  }

  const alreadyGranted = await permissionContains({
    origins: [pattern],
  });
  if (alreadyGranted) return true;

  try {
    return await permissionRequest({ origins: [pattern] });
  } catch {
    return false;
  }
}

async function testConnection() {
  testButton.disabled = true;
  const settings = {
    url: normalizedUrl(urlInput.value),
    username: userInput.value,
    password: passInput.value,
    theme: currentTheme(),
  };
  showStatus("Checking site permission…");
  try {
    const permitted = await requestHostPermission();
    if (!permitted)
      throw new Error(
        "Chrome permission to access this qBittorrent host was not granted.",
      );
    showStatus("Testing connection…");
    const result = await sendRuntimeMessage({
      type: "TEST_CONNECTION",
      settings,
    });
    if (!result?.ok) throw new Error(result?.error || "Connection failed.");

    const feedResult = await sendRuntimeMessage({
      type: "GET_FEEDS",
      settings,
    });
    if (!feedResult?.ok || !(feedResult.feeds || feedResult.names)) {
      renderFeedOptions([], "");
      showStatus(
        `Connected to qBittorrent${result.version ? ` (${result.version})` : ""}.`,
        "ok",
      );
      return;
    }

    const feedOptions = feedResult.feeds || feedResult.names || [];
    const storedSettings = (await storageGet("settings")).settings || {};
    const selectedDefault =
      storedSettings.defaultFeed ||
      feedOptions[0]?.value ||
      feedOptions[0] ||
      "";
    renderFeedOptions(feedOptions, selectedDefault);
    await storageSet({
      settings: {
        ...storedSettings,
        url: settings.url,
        username: settings.username,
        password: settings.password,
        theme: currentTheme(),
        defaultFeed: feedSelect.value || selectedDefault || "",
      },
    });

    showStatus(
      `Connected to qBittorrent${result.version ? ` (${result.version})` : ""}.`,
      "ok",
    );
  } catch (error) {
    showStatus(error.message || "Connection failed.", "bad");
  } finally {
    testButton.disabled = false;
  }
}

testButton.addEventListener("click", testConnection);

feedSelect.addEventListener("change", async () => {
  const { settings } = await storageGet("settings");
  const nextSettings = {
    ...(settings || {}),
    url: settings?.url || normalizedUrl(urlInput.value),
    username: settings?.username || userInput.value,
    password: settings?.password || passInput.value,
    theme: currentTheme(),
    defaultFeed: feedSelect.value || "",
  };
  await storageSet({ settings: nextSettings });
});

themeToggle.addEventListener("change", async () => {
  const theme = currentTheme();
  applyTheme(theme);
  const { settings } = await storageGet("settings");
  await storageSet({
    settings: {
      ...(settings || {}),
      theme,
    },
  });
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const settings = {
    url: normalizedUrl(urlInput.value),
    username: userInput.value,
    password: passInput.value,
    theme: currentTheme(),
    defaultFeed: feedSelect.value || "",
  };
  try {
    new URL(settings.url);
  } catch {
    showStatus("Enter a valid Web UI URL.", "bad");
    return;
  }
  await storageSet({ settings });
  showStatus("Settings saved. Testing connection…");
  await testConnection();
});

loadSettings();
