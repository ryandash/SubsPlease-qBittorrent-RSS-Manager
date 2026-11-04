(() => {
  const app = globalThis.SubsPleaseQbit;
  if (!app) return;

  const BUTTON_CLASS = "sp-qbt-rule-button";
  const WIDGET_ID = "sp-qbt-missing-rules-widget";
  const SCHEDULE_LINK_SELECTOR = "#full-schedule-table td.all-schedule-show a";
  const RULE_CACHE_MS = 15_000;
  const state = {
    initialized: false,
    knownRuleNames: new Set(),
    ruleCache: new Map(),
    ruleRequests: new Map(),
  };

  function getScheduleEntries() {
    return [...document.querySelectorAll(SCHEDULE_LINK_SELECTOR)]
      .map((link) => ({
        link,
        container: link.closest("td.all-schedule-show") || link.parentElement,
        title: app.normalizeTitle(link.textContent),
      }))
      .filter(
        (entry) =>
          entry.container &&
          entry.title.length >= 2 &&
          entry.title.length <= 100,
      );
  }

  function setButtonState(button, title) {
    const exists = state.knownRuleNames.has(app.normalizeRuleName(title));
    button.dataset.exists = String(exists);
    button.textContent = "✕";
    button.classList.toggle("is-added", exists);
    button.classList.toggle("is-missing", !exists);
    button.setAttribute(
      "aria-label",
      exists ? `Delete RSS rule for ${title}` : `Add RSS rule for ${title}`,
    );
    button.title = exists
      ? "Remove this SubsPlease RSS download rule"
      : "Create an RSS download rule";
  }

  function disableRuleButtons(label, title) {
    const hideLabel = label === "qBittorrent unavailable";
    document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((button) => {
      button.disabled = true;
      button.textContent = hideLabel ? "" : label;
      button.title = title;
    });
  }

  function injectButtons() {
    for (const { container, link, title } of getScheduleEntries()) {
      if (container.querySelector(`.${BUTTON_CLASS}`)) continue;

      const button = document.createElement("button");
      button.type = "button";
      button.className = BUTTON_CLASS;
      button.dataset.animeTitle = title;
      button.addEventListener("click", onRuleButtonClick);
      setButtonState(button, title);
      container.insertBefore(button, link);
    }
  }

  function getMissingRuleNames(rules, settings, scheduleTitles) {
    const missing = new Set();
    const defaultFeed = String(settings.defaultFeed || "")
      .trim()
      .toLowerCase();

    for (const [ruleName, rawRule] of Object.entries(rules || {})) {
      const title = String(ruleName || "").trim();
      if (!title || scheduleTitles.has(app.normalizeRuleName(title))) continue;

      let rule = rawRule;
      if (typeof rule === "string") {
        try {
          rule = JSON.parse(rule);
        } catch {
          rule = {};
        }
      }

      const affectedFeeds = Array.isArray(rule?.affectedFeeds)
        ? rule.affectedFeeds
        : [rule?.affectedFeeds].filter(Boolean);
      const appliesToSelectedFeed = affectedFeeds.some((feed) => {
        const value = String(feed || "")
          .trim()
          .toLowerCase();
        return (
          value.includes("subsplease") ||
          (defaultFeed &&
            (value === defaultFeed ||
              value.includes(defaultFeed) ||
              defaultFeed.includes(value)))
        );
      });
      if (appliesToSelectedFeed) missing.add(title);
    }

    return [...missing].sort((a, b) => a.localeCompare(b));
  }

  function getWidgetContainer() {
    let container = document.getElementById(WIDGET_ID);
    if (container) return container;

    container = document.createElement("div");
    container.id = WIDGET_ID;
    container.className =
      "sidebar widget-area sidebar-widget-area homepage-widget";
    const secondary = document.getElementById("secondary");
    const secondaryBackground = secondary
      ? window.getComputedStyle(secondary).backgroundColor
      : "";
    if (secondaryBackground && secondaryBackground !== "rgba(0, 0, 0, 0)") {
      container.style.backgroundColor = secondaryBackground;
    }
    container.addEventListener("click", onMissingRuleClick);
    const target =
      document.getElementById("secondary") ||
      document.querySelector(".secondary, .sidebar, #content");
    const anchor = target?.closest(".table-responsive") || target;
    if (anchor?.parentNode) {
      anchor.insertAdjacentElement("afterend", container);
    } else {
      document.body.append(container);
    }
    return container;
  }

  function renderMissingRuleWidget(rules, settings) {
    const entries = getScheduleEntries();
    if (!entries.length) return;

    const scheduleTitles = new Set(
      entries.map(({ title }) => app.normalizeRuleName(title)),
    );
    const missingRules = getMissingRuleNames(rules, settings, scheduleTitles);
    const container = getWidgetContainer();
    const heading =
      container.querySelector("h2") || document.createElement("h2");
    if (!heading.parentNode) container.append(heading);
    heading.textContent = "Remaining RSS Anime";

    const table = document.createElement("table");
    table.cellPadding = 0;
    table.cellSpacing = 0;
    table.border = 0;
    const fragment = document.createDocumentFragment();

    if (!missingRules.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 2;
      cell.textContent =
        "No RSS rules for this feed are missing from the current schedule.";
      row.append(cell);
      fragment.append(row);
    } else {
      for (const title of missingRules) {
        const row = document.createElement("tr");
        row.className = "schedule-widget-item";
        const cell = document.createElement("td");
        cell.className = "schedule-widget-show";

        const button = document.createElement("button");
        button.type = "button";
        button.className = "sp-qbt-missing-rule-button";
        button.dataset.animeTitle = title;
        button.textContent = "✕";
        button.setAttribute("aria-label", `Delete RSS rule for ${title}`);
        button.title = "Delete this rule";

        const link = document.createElement("a");
        link.textContent = title;
        link.title = "Go to show";
        link.href = "#";
        const resolveArtwork = async () => {
          if (link.dataset.artworkResolved === "true") return;
          link.dataset.artworkResolved = "true";
          const artwork = await app.resolveArtworkForTitle(title);
          if (artwork.href !== "#") link.href = artwork.href;
          if (artwork.imageUrl) link.dataset.previewImage = artwork.imageUrl;
        };
        link.addEventListener("mouseenter", resolveArtwork, { once: true });
        link.addEventListener("focus", resolveArtwork, { once: true });

        cell.append(button, link);
        row.append(cell);
        fragment.append(row);
      }
    }

    table.append(fragment);
    const previousTable = container.querySelector("table");
    if (previousTable) previousTable.replaceWith(table);
    else container.append(table);
  }

  async function getRules(settings) {
    const key = `${settings.url}\u0000${settings.username}\u0000${settings.password}`;
    const cached = state.ruleCache.get(key);
    if (cached?.expiresAt > Date.now()) return cached.result;
    if (state.ruleRequests.has(key)) return state.ruleRequests.get(key);

    const request = app.sendRuntimeMessage({ type: "GET_RULES", settings });
    state.ruleRequests.set(key, request);
    try {
      const result = await request;
      if (result?.ok && result.rules && typeof result.rules === "object") {
        state.ruleCache.set(key, {
          result,
          expiresAt: Date.now() + RULE_CACHE_MS,
        });
      }
      return result;
    } finally {
      state.ruleRequests.delete(key);
    }
  }

  async function refreshRulesAndMissingList() {
    const settings = await app.getSettings();
    const buttons = document.querySelectorAll(`.${BUTTON_CLASS}`);
    if (!settings.url || !settings.username || !settings.password) {
      disableRuleButtons(
        "Configure qBittorrent",
        "Set up the qBittorrent connection in the extension popup.",
      );
      return;
    }
    if (!getScheduleEntries().length) return;

    const result = await getRules(settings);
    if (!result?.ok || !result.rules) {
      disableRuleButtons(
        "qBittorrent unavailable",
        result?.error || "Configure qBittorrent in the extension popup.",
      );
      return;
    }

    state.knownRuleNames = new Set(
      (result.names || Object.keys(result.rules)).map(app.normalizeRuleName),
    );
    buttons.forEach((button) => {
      button.disabled = false;
      setButtonState(button, button.dataset.animeTitle || "");
    });
    renderMissingRuleWidget(result.rules, settings);
  }

  async function onRuleButtonClick(event) {
    const button = event.currentTarget;
    const title = button.dataset.animeTitle;
    const exists = button.dataset.exists === "true";
    button.disabled = true;
    try {
      const result = await app.sendRuntimeMessage({
        type: exists ? "REMOVE_RULE" : "ADD_RULE",
        title,
        settings: await app.getSettings(),
      });
      if (!result?.ok) throw new Error(result?.error || "Operation failed.");

      const normalizedTitle = app.normalizeRuleName(title);
      if (exists) state.knownRuleNames.delete(normalizedTitle);
      else state.knownRuleNames.add(normalizedTitle);
      state.ruleCache.clear();
      setButtonState(button, title);
    } catch (error) {
      button.title = error?.message || "Operation failed.";
      window.alert(`SubsPlease RSS Manager: ${button.title}`);
    } finally {
      button.disabled = false;
    }
  }

  async function onMissingRuleClick(event) {
    const button = event.target.closest(".sp-qbt-missing-rule-button");
    if (!button) return;

    button.disabled = true;
    try {
      const result = await app.sendRuntimeMessage({
        type: "REMOVE_RULE",
        title: button.dataset.animeTitle,
        settings: await app.getSettings(),
      });
      if (!result?.ok)
        throw new Error(result?.error || "Could not delete the RSS rule.");

      state.knownRuleNames.delete(
        app.normalizeRuleName(button.dataset.animeTitle),
      );
      state.ruleCache.clear();
      await refreshRulesAndMissingList();
    } catch (error) {
      button.disabled = false;
      window.alert(
        `SubsPlease RSS Manager: ${error?.message || "Could not delete the RSS rule."}`,
      );
    }
  }

  function initialize() {
    if (state.initialized) return;
    state.initialized = true;
    injectButtons();
    void refreshRulesAndMissingList().catch((error) =>
      console.warn("Could not refresh qBittorrent RSS rules.", error),
    );
  }

  function start() {
    void app.sendRuntimeMessage({ type: "CHECK_CONNECTION" });
    if (getScheduleEntries().length) {
      initialize();
      return;
    }

    const observer = new MutationObserver(() => {
      if (!getScheduleEntries().length) return;
      clearTimeout(timeout);
      observer.disconnect();
      initialize();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    const timeout = setTimeout(() => {
      observer.disconnect();
      initialize();
    }, 7_500);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "REFRESH_RULES") return;
    injectButtons();
    void refreshRulesAndMissingList().catch((error) =>
      console.warn("Could not refresh qBittorrent RSS rules.", error),
    );
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
