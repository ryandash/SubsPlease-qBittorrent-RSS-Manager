(() => {
  const BUTTON_CLASS = "sp-qbt-rule-button";
  const THEME_STYLE_ID = "sp-qbt-page-theme-styles";
  let knownRuleNames = new Set();
  const artworkCache = new Map();
  const artworkRequests = new Map();
  let startHandled = false;

  function injectThemeStyles() {
    if (document.getElementById(THEME_STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = THEME_STYLE_ID;
    style.textContent = `
      .${BUTTON_CLASS} {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        margin-right: 8px;
        margin-left: 0;
        min-width: 28px;
        height: 28px;
        padding: 0 10px;
        border: 0;
        border-radius: 6px;
        background: #4caf50;
        color: #ffffff;
        font: inherit;
        font-size: 12px;
        font-weight: 700;
        line-height: 1;
        line-height: 0;
        cursor: pointer;
        vertical-align: middle;
        box-shadow: inset 0 0 0 1px rgba(255,255,255,0.12);
        transition: transform 0.15s ease, filter 0.15s ease, opacity 0.15s ease;
      }

      .${BUTTON_CLASS}:hover,
      .${BUTTON_CLASS}:focus-visible {
        filter: brightness(1.04);
        transform: translateY(-1px);
      }

      .${BUTTON_CLASS}:disabled {
        opacity: 0.7;
        cursor: wait;
      }

      .${BUTTON_CLASS}.is-added {
        background: #d9534f;
      }

      .${BUTTON_CLASS}.is-missing {
        background: #4caf50;
      }

      .${BUTTON_CLASS}.is-added span,
      .${BUTTON_CLASS}.is-missing span {
        font-size: 12px;
      }

      .${BUTTON_CLASS}.is-missing span {
        display: inline-block;
        transform: rotate(45deg);
      }

      #sp-qbt-missing-rules-widget {
        margin-top: 20px;
        padding: 12px 14px;
        border: 0;
        border-radius: 0;
        background: transparent;
        color: var(--main-color);
        box-sizing: border-box;
        box-shadow: none;
      }

      #sp-qbt-missing-rules-widget h2 {
        margin: 0 0 10px;
        font-size: 1.75rem;
        line-height: 1.2;
        font-weight: 400;
        color: var(--heading-color);
      }

      #sp-qbt-missing-rules-widget table {
        width: 100%;
        border-collapse: collapse;
        border-spacing: 0;
        border: 0;
      }

      #sp-qbt-missing-rules-widget tr.schedule-widget-item {
        border-bottom: 1px solid var(--main-border-color);
      }

      #sp-qbt-missing-rules-widget tr.schedule-widget-item:last-child {
        border-bottom: 0;
      }

      #sp-qbt-missing-rules-widget td.schedule-widget-show {
        padding: 6px 0;
        color: var(--main-color);
        text-align: left;
      }

      #sp-qbt-missing-rules-widget td.schedule-widget-show a {
        color: var(--main-color);
        text-decoration: none;
      }

      #sp-qbt-missing-rules-widget td.schedule-widget-show a:hover,
      #sp-qbt-missing-rules-widget td.schedule-widget-show a:focus {
        color: var(--a-color);
      }

      #sp-qbt-missing-rules-widget .sp-qbt-missing-rule-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        padding: 0;
        margin-right: 8px;
        border: 0;
        border-radius: 6px;
        background: #d9534f;
        color: #ffffff;
        font: inherit;
        font-size: 12px;
        font-weight: 700;
        line-height: 1;
        line-height: 0;
        cursor: pointer;
        vertical-align: middle;
        box-shadow: inset 0 0 0 1px rgba(255,255,255,0.12);
      }

      #sp-qbt-missing-rules-widget .sp-qbt-missing-rule-button.is-added {
        background: #4caf50;
      }

      #sp-qbt-missing-rules-widget .sp-qbt-missing-rule-button.is-added span,
      #sp-qbt-missing-rules-widget .sp-qbt-missing-rule-button:not(.is-added) span {
        font-size: 12px;
      }

      #sp-qbt-missing-rules-widget .sp-qbt-missing-rule-button.is-added span {
        display: inline-block;
        transform: rotate(45deg);
      }

      #sp-qbt-missing-rules-widget .sp-qbt-missing-rule-button:hover,
      #sp-qbt-missing-rules-widget .sp-qbt-missing-rule-button:focus-visible {
        filter: brightness(1.04);
      }
    `;
    document.head.appendChild(style);
  }

  function normalizeTitle(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  function findScheduleEntries() {
    const table = document.querySelector("#full-schedule-table");
    if (!table) {
      const selectors = [
        ".schedule-item",
        ".anime-item",
        ".schedule-entry",
        "article",
        ".entry",
      ];
      const found = new Set();
      for (const selector of selectors) {
        document.querySelectorAll(selector).forEach((node) => {
          const titleNode = node.querySelector(
            "h1,h2,h3,h4,.title,.anime-title,a",
          );
          if (!titleNode) return;
          const title = normalizeTitle(titleNode.textContent || "");
          if (title.length < 2 || title.length > 100) return;
          if (
            node.querySelectorAll("h1,h2,h3,h4,.title,.anime-title").length > 2
          )
            return;
          found.add(node);
        });
      }

      if (!found.size) {
        document
          .querySelectorAll(
            "main h2, main h3, #content h2, #content h3, h2, h3",
          )
          .forEach((heading) => {
            const parent =
              heading.closest("article,li,.row,.col,.card,div") ||
              heading.parentElement;
            if (parent && parent.getBoundingClientRect().height < 700)
              found.add(parent);
          });
      }
      return [...found];
    }

    const entries = [];
    table.querySelectorAll("tr").forEach((row) => {
      const cell = row.querySelector("td.all-schedule-show");
      if (!cell) return;
      const link = cell.querySelector("a");
      if (!link) return;
      const title = normalizeTitle(link.textContent || "");
      if (title.length < 2 || title.length > 100) return;
      entries.push({ element: cell, title });
    });
    return entries;
  }

  function extractTitle(entry) {
    if (entry && typeof entry === "object" && entry.title) {
      return entry.title;
    }
    const candidates = entry.querySelectorAll(
      "h1,h2,h3,h4,.title,.anime-title,a",
    );
    for (const node of candidates) {
      const title = normalizeTitle(node.textContent || "");
      if (title.length >= 2 && title.length <= 100) return title;
    }
    return "";
  }

  function normalizeRuleLookupValue(value) {
    return String(value || "")
      .replace(/\u00A0/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  async function resolveArtworkForTitle(title) {
    const query = String(title || "").trim();
    const cacheKey = normalizeRuleLookupValue(query);
    if (!query) return { href: "#", imageUrl: "" };
    if (artworkCache.has(cacheKey)) return artworkCache.get(cacheKey);
    if (artworkRequests.has(cacheKey)) return artworkRequests.get(cacheKey);

    const request = (async () => {
      try {
        const response = await fetch(
          `https://subsplease.org/api/?f=search&tz=America/Toronto&s=${encodeURIComponent(query)}`,
        );
        if (!response.ok) return { href: "#", imageUrl: "" };

        const payload = await response.json();
        const firstResult = Array.isArray(payload)
          ? payload[0]
          : Array.isArray(payload?.results)
            ? payload.results[0]
            : payload && typeof payload === "object"
              ? Object.values(payload)[0]
              : null;

        if (!firstResult) return { href: "#", imageUrl: "" };

        const page = firstResult.page ? `/shows/${firstResult.page}` : "#";
        const imageUrl = firstResult.image_url
          ? `https://subsplease.org${firstResult.image_url}`
          : "";

        const result = { href: page, imageUrl };
        artworkCache.set(cacheKey, result);
        return result;
      } catch (error) {
        return { href: "#", imageUrl: "" };
      }
    })();

    artworkRequests.set(cacheKey, request);
    try {
      return await request;
    } finally {
      artworkRequests.delete(cacheKey);
    }
  }

  async function hydrateArtworkLink(title, link) {
    const cacheKey = normalizeRuleLookupValue(title);
    const cachedArtwork = artworkCache.get(cacheKey);
    if (cachedArtwork) {
      link.href = cachedArtwork.href || "#";
      if (cachedArtwork.imageUrl) link.setAttribute("data-preview-image", cachedArtwork.imageUrl);
      return;
    }

    const artwork = await resolveArtworkForTitle(title);
    if (artwork.href && artwork.href !== "#") link.href = artwork.href;
    if (artwork.imageUrl) link.setAttribute("data-preview-image", artwork.imageUrl);
  }

  function setButtonState(button, title) {
    const normalizedTitle = normalizeRuleLookupValue(title);
    const expectedNames = new Set([normalizedTitle]);
    const exists = [...knownRuleNames].some((name) => expectedNames.has(name));
    button.dataset.exists = String(exists);
    const existingSymbol = button.querySelector("span");
    const symbol = existingSymbol || document.createElement("span");
    symbol.textContent = "✕";
    symbol.style.display = "inline-block";
    if (!existingSymbol) button.appendChild(symbol);
    button.textContent = "";
    button.appendChild(symbol);
    button.classList.toggle("is-added", exists);
    button.classList.toggle("is-missing", !exists);
    button.setAttribute(
      "aria-label",
      exists ? `Delete RSS rule for ${title}` : `Add RSS rule for ${title}`,
    );
    button.title = exists
      ? "Remove this SubsPlease RSS download rule"
      : "Create a 1080p RSS download rule";
  }

  function getCurrentScheduleTitles() {
    const titles = new Set();
    const nodes = document.querySelectorAll(
      "#full-schedule-table td.all-schedule-show a, #schedule-table .schedule-widget-show a, .schedule-widget-show a",
    );
    nodes.forEach((link) => {
      const title = normalizeTitle(link.textContent || "");
      if (title) titles.add(normalizeRuleLookupValue(title));
    });
    return titles;
  }

  function normalizeFeedValue(value) {
    return String(value || "")
      .trim()
      .toLowerCase();
  }

  function feedMatchesSubsPlease(feedValue, settings) {
    const normalizedValue = normalizeFeedValue(feedValue);
    if (!normalizedValue) return false;
    if (normalizedValue.includes("subsplease")) return true;
    if (settings?.defaultFeed) {
      const normalizedDefault = normalizeFeedValue(settings.defaultFeed);
      return (
        normalizedValue === normalizedDefault ||
        normalizedDefault.includes(normalizedValue) ||
        normalizedValue.includes(normalizedDefault)
      );
    }
    return false;
  }

  async function buildMissingRuleWidget(rules, settings) {
    const scheduleTitles = getCurrentScheduleTitles();
    const missing = [];

    for (const [ruleName, ruleDef] of Object.entries(rules || {})) {
      const candidateName = String(ruleName || "").trim();
      if (!candidateName) continue;

      let parsedRule = ruleDef;
      if (typeof parsedRule === "string") {
        try {
          parsedRule = JSON.parse(parsedRule);
        } catch {
          parsedRule = {};
        }
      }

      const affectedFeeds = Array.isArray(parsedRule?.affectedFeeds)
        ? parsedRule.affectedFeeds
        : parsedRule && parsedRule.affectedFeeds
          ? [parsedRule.affectedFeeds]
          : [];

      const matchesFeed = affectedFeeds.some((feed) =>
        feedMatchesSubsPlease(feed, settings),
      );
      if (!matchesFeed) continue;

      const normalizedRuleName = normalizeRuleLookupValue(candidateName);
      if (scheduleTitles.has(normalizedRuleName)) continue;
      missing.push(candidateName);
    }

    const widgetId = "sp-qbt-missing-rules-widget";
    let container = document.getElementById(widgetId);
    if (!container) {
      container = document.createElement("div");
      container.id = widgetId;
      container.className =
        "sidebar widget-area sidebar-widget-area homepage-widget";
      container.classList.remove("table-responsive");
      const target =
        document.getElementById("secondary") ||
        document.querySelector(".secondary") ||
        document.querySelector(".sidebar") ||
        document.querySelector("#content");
      if (target && target.parentNode) {
        const insertionAnchor = target.closest(".table-responsive") || target;
        if (insertionAnchor.parentNode) {
          insertionAnchor.insertAdjacentElement("afterend", container);
        } else {
          document.body.appendChild(container);
        }
      } else {
        document.body.appendChild(container);
      }
    }

    container.classList.remove("table-responsive");

    const secondary = document.getElementById("secondary");
    if (secondary) {
      const secondaryBg = window.getComputedStyle(secondary).backgroundColor;
      if (secondaryBg && secondaryBg !== "rgba(0, 0, 0, 0)") {
        container.style.backgroundColor = secondaryBg;
      }
    }
    container.style.border = "0";
    container.style.borderRadius = "0";

    const heading =
      container.querySelector("h2") || document.createElement("h2");
    if (!heading.parentNode) {
      container.appendChild(heading);
    }
    heading.textContent = "Remaining RSS Anime";

    let table = container.querySelector("table");
    if (!table) {
      table = document.createElement("table");
      table.cellPadding = 0;
      table.cellSpacing = 0;
      table.border = 0;
      container.appendChild(table);
    }

    table.innerHTML = "";

    if (!missing.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 2;
      cell.textContent =
        "No RSS rules for this feed are missing from the current schedule.";
      row.appendChild(cell);
      table.appendChild(row);
    } else {
      missing.sort((a, b) => a.localeCompare(b));
      for (const title of missing) {
        const row = document.createElement("tr");
        row.className = "schedule-widget-item";

        const showCell = document.createElement("td");
        showCell.className = "schedule-widget-show";

        const button = document.createElement("button");
        button.type = "button";
        button.className = "sp-qbt-missing-rule-button";
        button.dataset.ruleAction = "delete";
        const symbol = document.createElement("span");
        symbol.textContent = "✕";
        symbol.style.display = "inline-block";
        button.appendChild(symbol);
        button.setAttribute("aria-label", `Delete RSS rule for ${title}`);
        button.title = "Delete this rule";
        button.onclick = async () => {
          const action = button.dataset.ruleAction === "add" ? "add" : "delete";
          button.disabled = true;
          const settingsResult = await storageGet("settings");
          const stored = settingsResult?.settings || {};
          const result = await sendRuntimeMessage({
            type: action === "delete" ? "REMOVE_RULE" : "ADD_RULE",
            title,
            settings: stored,
          });

          if (result?.ok) {
            const nextAction = action === "delete" ? "add" : "delete";
            button.dataset.ruleAction = nextAction;
            const currentSymbol = button.querySelector("span");
            if (currentSymbol) {
              currentSymbol.textContent = "✕";
            }
            button.classList.toggle("is-added", nextAction === "add");
            button.setAttribute(
              "aria-label",
              nextAction === "delete"
                ? `Delete RSS rule for ${title}`
                : `Add RSS rule for ${title}`,
            );
            button.title =
              nextAction === "delete"
                ? "Delete this rule"
                : "Undo the delete and add this rule";
          }

          button.disabled = false;
        };

        const link = document.createElement("a");
        link.textContent = title;
        link.title = "Go to show";
        link.href = "#";
        const hydrateOnInteraction = () => {
          if (link.dataset.artworkLoaded === "true") return;
          link.dataset.artworkLoaded = "true";
          hydrateArtworkLink(title, link);
        };
        link.addEventListener("mouseenter", hydrateOnInteraction, { once: true });
        link.addEventListener("focus", hydrateOnInteraction, { once: true });
        link.addEventListener("pointerover", hydrateOnInteraction, { once: true });

        showCell.appendChild(button);
        showCell.appendChild(link);
        row.appendChild(showCell);

        table.appendChild(row);
      }
    }
  }

  async function refreshMissingRuleList(existingResult) {
    const settingsResult = await storageGet("settings");
    const settings = settingsResult?.settings;
    if (!settings?.url || !settings.username || !settings.password) return;

    const result =
      existingResult ||
      (await sendRuntimeMessage({ type: "GET_RULES", settings }));
    if (!result?.ok || !result.rules) return;
    await buildMissingRuleWidget(result.rules, settings);
  }

  function storageGet(keys) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(keys, (result) => {
          const error = chrome.runtime.lastError;
          if (error) {
            resolve({});
            return;
          }
          resolve(result || {});
        });
      } catch (error) {
        resolve({});
      }
    });
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
          resolve(
            response ?? {
              ok: false,
              error: "No response from extension background script.",
            },
          );
        });
      } catch (error) {
        resolve({ ok: false, error: error.message || String(error) });
      }
    });
  }

  async function refreshRules() {
    const settingsResult = await storageGet("settings");
    const settings = settingsResult?.settings;

    if (!settings?.url || !settings.username || !settings.password) {
      document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((button) => {
        button.disabled = true;
        button.textContent = "Configure qBittorrent";
        button.title =
          "Set up the qBittorrent connection in the extension popup.";
      });
      return;
    }

    const result = await sendRuntimeMessage({ type: "GET_RULES", settings });

    if (!result?.ok) {
      document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((button) => {
        button.disabled = true;
        button.textContent = "qBittorrent unavailable";
        button.title =
          result?.error || "Configure qBittorrent in the extension popup.";
      });
      return;
    }

    knownRuleNames = new Set(
      (result.names || []).map((name) => normalizeRuleLookupValue(name)),
    );
    document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((button) => {
      button.disabled = false;
      setButtonState(button, button.dataset.animeTitle || "");
    });

    return result;
  }

  async function onRuleButtonClick(event) {
    const button = event.currentTarget;
    const title = button.dataset.animeTitle;
    const exists = button.dataset.exists === "true";
    const settingsResult = await storageGet("settings");
    const settings = settingsResult?.settings || {};
    button.disabled = true;
    try {
      const result = await sendRuntimeMessage({
        type: exists ? "REMOVE_RULE" : "ADD_RULE",
        title,
        settings,
      });
      if (!result?.ok) throw new Error(result?.error || "Operation failed.");

      const normalizedTitle = normalizeRuleLookupValue(title);
      if (exists) {
        knownRuleNames.delete(normalizedTitle);
      } else {
        knownRuleNames.add(normalizedTitle);
      }
      button.dataset.exists = String(!exists);
      setButtonState(button, title);
    } catch (error) {
      button.disabled = false;
      setButtonState(button, title);
      button.title = error.message;
      window.alert(`SubsPlease RSS Manager: ${error.message}`);
    }
    button.disabled = false;
  }

  function injectButtons() {
    for (const entry of findScheduleEntries()) {
      const container = entry.element || entry;
      if (container.querySelector(`.${BUTTON_CLASS}`)) continue;
      const title = extractTitle(entry);
      if (!title) continue;

      const button = document.createElement("button");
      button.type = "button";
      button.className = BUTTON_CLASS;
      button.dataset.animeTitle = title;
      button.dataset.exists = "false";
      button.addEventListener("click", onRuleButtonClick);
      setButtonState(button, title);

      const anchor = container.querySelector("a");
      if (anchor && anchor.parentElement) {
        anchor.parentElement.insertBefore(button, anchor);
      } else {
        const titleNode = container.querySelector(
          "h1,h2,h3,h4,.title,.anime-title",
        );
        const insertionTarget = titleNode?.parentElement || container;
        insertionTarget.insertBefore(
          button,
          titleNode || insertionTarget.firstChild,
        );
      }
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "REFRESH_RULES") {
      refreshRules()
        .then((rulesResult) => refreshMissingRuleList(rulesResult))
        .catch(() => undefined);
    }
  });

  function waitForScheduleTable(callback) {
    const maxAttempts = 30;
    let attempts = 0;

    function check() {
      const hasScheduleRows =
        document.querySelector(
          "#full-schedule-table tr td.all-schedule-show a",
        ) ||
        document.querySelector("#full-schedule-table td.all-schedule-show a");
      if (hasScheduleRows) {
        callback();
        return;
      }

      attempts += 1;
      if (attempts < maxAttempts) {
        setTimeout(check, 250);
      } else {
        callback();
      }
    }

    check();
  }

  async function start() {
    if (startHandled) return;
    startHandled = true;

    injectThemeStyles();
    chrome.runtime.sendMessage({ type: "START_QBITTORRENT_PROBE" });

    waitForScheduleTable(async () => {
      injectButtons();
      const rulesResult = await refreshRules();
      await refreshMissingRuleList(rulesResult);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
