import {
  getLocalStorage,
  requestOriginPermission,
  sendRuntimeMessage,
  setLocalStorage,
} from "./shared/chrome-api.js";
import {
  hostPermissionPattern,
  normalizeUrl,
  validateWebUiUrl,
} from "./shared/settings.js";
import {
  applyTheme,
  getPopupElements,
  renderFeedOptions,
  showStatus,
} from "./popup/ui.js";

const elements = getPopupElements(document);

function settingsFromForm() {
  return {
    url: normalizeUrl(elements.url.value),
    username: elements.username.value,
    password: elements.password.value,
    theme: elements.themeToggle.checked ? "dark" : "light",
    defaultFeed: elements.feedSelect.value || "",
  };
}

async function saveSettings(changes) {
  const { settings = {} } = await getLocalStorage("settings");
  await setLocalStorage({ settings: { ...settings, ...changes } });
}

async function finishConnectionTest(settings, permission, initialSave = Promise.resolve()) {
  try {
    if (!(await permission)) {
      throw new Error("Chrome permission to access this qBittorrent host was not granted.");
    }
    await initialSave;

    showStatus(elements, "Testing connection…");
    const connection = await sendRuntimeMessage({
      type: "TEST_CONNECTION",
      settings,
    });
    if (!connection.ok) throw new Error(connection.error || "Connection failed.");

    const feeds = await sendRuntimeMessage({ type: "GET_FEEDS", settings });
    const { settings: storedSettings = {} } = await getLocalStorage("settings");
    const feedOptions = feeds.ok ? feeds.feeds || feeds.names || [] : [];
    const selectedFeed =
      storedSettings.defaultFeed || feedOptions[0]?.value || feedOptions[0] || "";
    const selectedFeedLabel =
      feedOptions.find((option) => option.value === selectedFeed)?.label ||
      feedOptions[0]?.label || "";
    renderFeedOptions(elements.feedSelect, feedOptions, selectedFeed);
    await setLocalStorage({
      settings: {
        ...storedSettings,
        ...settings,
        defaultFeed: elements.feedSelect.value || selectedFeed,
        defaultFeedLabel: selectedFeedLabel,
      },
    });

    showStatus(
      elements,
      `Connected to qBittorrent${connection.version ? ` (${connection.version})` : ""}.`,
      "ok",
    );
  } catch (error) {
    showStatus(elements, error?.message || "Connection failed.", "bad");
  } finally {
    elements.testButton.disabled = false;
  }
}

function testConnection() {
  elements.testButton.disabled = true;
  try {
    const settings = settingsFromForm();
    settings.url = validateWebUiUrl(settings.url);
    elements.url.value = settings.url;
    showStatus(elements, "Checking site permission…");
    void finishConnectionTest(
      settings,
      requestOriginPermission(hostPermissionPattern(settings.url)),
    );
  } catch (error) {
    elements.testButton.disabled = false;
    showStatus(elements, error?.message || "Enter a valid Web UI URL.", "bad");
  }
}

async function loadSettings() {
  const { settings } = await getLocalStorage("settings");
  applyTheme(elements, settings?.theme || "dark");
  if (!settings) return;

  elements.url.value = settings.url || "http://localhost:8039";
  elements.username.value = settings.username || "";
  elements.password.value = settings.password || "";
  if (settings.defaultFeed) {
    const storedLabel = settings.defaultFeedLabel || settings.defaultFeed;
    renderFeedOptions(
      elements.feedSelect,
      [{ label: storedLabel, value: settings.defaultFeed }],
      settings.defaultFeed,
    );
  }
  showStatus(elements, "Settings loaded. Test the connection to refresh feeds.");
}

elements.testButton.addEventListener("click", testConnection);

elements.feedSelect.addEventListener("change", () =>
  saveSettings({ defaultFeed: elements.feedSelect.value || "" }),
);

elements.themeToggle.addEventListener("change", () => {
  const theme = elements.themeToggle.checked ? "dark" : "light";
  applyTheme(elements, theme);
  return saveSettings({ theme });
});

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const settings = settingsFromForm();
    settings.url = validateWebUiUrl(settings.url);
    elements.url.value = settings.url;
    const permission = requestOriginPermission(hostPermissionPattern(settings.url));
    const initialSave = saveSettings(settings);
    elements.testButton.disabled = true;
    showStatus(elements, "Settings saved. Testing connection…");
    void finishConnectionTest(settings, permission, initialSave);
  } catch (error) {
    showStatus(elements, error?.message || "Enter a valid Web UI URL.", "bad");
  }
});

void loadSettings();