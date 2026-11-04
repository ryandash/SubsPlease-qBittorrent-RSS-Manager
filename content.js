(() => {
  const BUTTON_CLASS = "sp-qbt-rule-button";
  const THEME_STYLE_ID = "sp-qbt-page-theme-styles";
  const DEBUG = true;
  let knownRuleNames = new Set();
  const artworkCache = new Map();
  const artworkRequests = new Map();
  const ruleResultCache = new Map();
  let ruleRequestInFlight = null;
  let startHandled = false;
  let missingRuleRenderGeneration = 0;

  function debugLog(label, details) {
    if (!DEBUG) return;
    const payload = details === undefined ? {} : details;
    console.debug(`[sp-qbt] ${label}`, payload);
  }

  function injectThemeStyles() {
    debugLog("injectThemeStyles", { themeStyleId: THEME_STYLE_ID });
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
    debugLog("findScheduleEntries", {
      hasTable: !!document.querySelector("#full-schedule-table"),
    });
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
    debugLog("resolveArtworkForTitle:start", { title: query, cacheKey });
    if (!query) {
      debugLog("resolveArtworkForTitle:empty", { title: query });
      return { href: "#", imageUrl: "" };
    }
    if (artworkCache.has(cacheKey)) {
      const cached = artworkCache.get(cacheKey);
      debugLog("resolveArtworkForTitle:cache-hit", {
        title: query,
        href: cached?.href || "#",
      });
      return cached;
    }
    if (artworkRequests.has(cacheKey)) {
      const pending = artworkRequests.get(cacheKey);
      debugLog("resolveArtworkForTitle:request-pending", { title: query });
      return pending;
    }

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
      const result = await request;
      debugLog("resolveArtworkForTitle:resolved", {
        title: query,
        href: result?.href || "#",
        imageUrl: result?.imageUrl || "",
      });
      return result;
    } finally {
      artworkRequests.delete(cacheKey);
    }
  }

  async function hydrateArtworkLink(title, link) {
    const cacheKey = normalizeRuleLookupValue(title);
    if (link.dataset.artworkResolved === "true") return;

    const cachedArtwork = artworkCache.get(cacheKey);
    if (cachedArtwork) {
      link.href = cachedArtwork.href || "#";
      if (cachedArtwork.imageUrl) {
        link.setAttribute("data-preview-image", cachedArtwork.imageUrl);
      }
      link.dataset.artworkResolved = "true";
      return;
    }

    const artwork = await resolveArtworkForTitle(title);
    if (artwork.href && artwork.href !== "#") link.href = artwork.href;
    if (artwork.imageUrl)
      link.setAttribute("data-preview-image", artwork.imageUrl);
    link.dataset.artworkResolved = "true";
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

  function hasScheduleLinks() {
    return !!(
      document.querySelector("#full-schedule-table tr td.all-schedule-show a") ||
      document.querySelector("#full-schedule-table td.all-schedule-show a")
    );
  }

  function getCurrentScheduleTitles() {
    const titles = new Set();
    const nodes = document.querySelectorAll(
      "#full-schedule-table td.all-schedule-show a, #schedule-table .schedule-widget-show a, .schedule-widget-show a",
    );
    nodes.forEach((link) => {
      if (link.closest("#sp-qbt-missing-rules-widget")) return;
      const title = normalizeTitle(link.textContent || "");
      if (title) titles.add(normalizeRuleLookupValue(title));
    });
    return titles;
  }

  function getSettingsKey(settings) {
    return `${settings?.url || ""}|${settings?.username || ""}|${settings?.password || ""}`;
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

  function getMissingRuleNames(rules, settings, scheduleTitles = getCurrentScheduleTitles()) {
    const missing = new Set();

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
      missing.add(candidateName);
    }

    return [...missing].sort((a, b) => a.localeCompare(b));
  }

  async function buildRuleWidget(rules, settings) {
    const generation = ++missingRuleRenderGeneration;
    debugLog("buildRuleWidget:start", {
      ruleCount: Object.keys(rules || {}).length,
      generation,
    });

    if (!hasScheduleLinks()) {
      debugLog("buildRuleWidget:waiting-for-schedule", { generation });
      return;
    }

    const scheduleTitles = getCurrentScheduleTitles();
    const missing = getMissingRuleNames(rules, settings, scheduleTitles);
    const preloadTitles = missing.slice(0, 8);
    if (preloadTitles.length) {
      void Promise.allSettled(
        preloadTitles.map((title) => resolveArtworkForTitle(title)),
      );
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

    const existingTable = container.querySelector("table");
    const nextTable = document.createElement("table");
    nextTable.cellPadding = 0;
    nextTable.cellSpacing = 0;
    nextTable.border = 0;

    debugLog("buildRuleWidget:result", {
      missingCount: missing.length,
      scheduleCount: scheduleTitles.size,
    });

    if (!missing.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 2;
      cell.textContent =
        "No RSS rules for this feed are missing from the current schedule.";
      row.appendChild(cell);
      nextTable.appendChild(row);
    } else {
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
        link.addEventListener("mouseenter", hydrateOnInteraction, {
          once: true,
        });
        link.addEventListener("focus", hydrateOnInteraction, { once: true });
        link.addEventListener("pointerover", hydrateOnInteraction, {
          once: true,
        });

        showCell.appendChild(button);
        showCell.appendChild(link);
        row.appendChild(showCell);

        void hydrateArtworkLink(title, link);
        nextTable.appendChild(row);
      }
    }

    if (generation !== missingRuleRenderGeneration) {
      debugLog("buildRuleWidget:skipped-stale-render", { generation });
      return;
    }

    if (existingTable) {
      existingTable.replaceWith(nextTable);
    } else {
      container.appendChild(nextTable);
    }
  }

  async function fetchRulesFromQbittorrent(settings, retries = 3) {
    const cacheKey = getSettingsKey(settings);
    const cachedResult = ruleResultCache.get(cacheKey);
    if (cachedResult) {
      debugLog("fetchRulesFromQbittorrent:cache-hit", { cacheKey });
      return cachedResult;
    }
    if (ruleRequestInFlight && ruleRequestInFlight.key === cacheKey) {
      debugLog("fetchRulesFromQbittorrent:in-flight", { cacheKey });
      return ruleRequestInFlight.promise;
    }

    debugLog("fetchRulesFromQbittorrent:start", { retries, cacheKey });
    const request = (async () => {
      let lastResult = null;
      for (let attempt = 0; attempt < retries; attempt += 1) {
        const result = await sendRuntimeMessage({ type: "GET_RULES", settings });
        lastResult = result;
        debugLog("fetchRulesFromQbittorrent:attempt", {
          attempt: attempt + 1,
          ok: !!result?.ok,
          ruleCount: Object.keys(result?.rules || {}).length,
        });
        if (result?.ok && result.rules) {
          ruleResultCache.set(cacheKey, result);
          return result;
        }
        if (attempt < retries - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
      debugLog("fetchRulesFromQbittorrent:failed", {
        error: lastResult?.error || "Could not fetch RSS rules.",
      });
      return lastResult || { ok: false, error: "Could not fetch RSS rules." };
    })();

    ruleRequestInFlight = { key: cacheKey, promise: request };
    try {
      return await request;
    } finally {
      if (ruleRequestInFlight?.key === cacheKey) {
        ruleRequestInFlight = null;
      }
    }
  }

  async function refreshRulesAndMissingList(existingResult) {
    debugLog("refreshRulesAndMissingList:start", {
      hasExistingResult: !!existingResult,
    });
    const settingsResult = await storageGet("settings");
    const settings = settingsResult?.settings;

    if (!settings?.url || !settings.username || !settings.password) {
      debugLog("refreshRulesAndMissingList:missing-settings");
      document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((button) => {
        button.disabled = true;
        button.textContent = "Configure qBittorrent";
        button.title =
          "Set up the qBittorrent connection in the extension popup.";
      });
      return;
    }

    if (!hasScheduleLinks()) {
      debugLog("refreshRulesAndMissingList:waiting-for-schedule");
      return;
    }

    const result = existingResult || (await fetchRulesFromQbittorrent(settings));

    if (!result?.ok || !result.rules) {
      debugLog("refreshRulesAndMissingList:unavailable", { error: result?.error });
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
    debugLog("refreshRulesAndMissingList:known-rules", {
      count: knownRuleNames.size,
    });
    document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((button) => {
      button.disabled = false;
      setButtonState(button, button.dataset.animeTitle || "");
    });

    debugLog("refreshRulesAndMissingList:rules-fetched", {
      ruleCount: Object.keys(result.rules || {}).length,
    });
    await buildRuleWidget(result.rules, settings);
    return result;
  }

  function storageGet(keys) {
    debugLog("storageGet", { keys });
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
    debugLog("sendRuntimeMessage", { type: message?.type });
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

  async function onRuleButtonClick(event) {
    const button = event.currentTarget;
    const title = button.dataset.animeTitle;
    const exists = button.dataset.exists === "true";
    debugLog("onRuleButtonClick", {
      title,
      exists,
      action: exists ? "remove" : "add",
    });
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
    const entries = findScheduleEntries();
    debugLog("injectButtons:start", {
      entryCount: entries.length,
    });
    for (const entry of entries) {
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
    debugLog("runtime-message", { type: message?.type });
    if (message?.type === "REFRESH_RULES") {
      void refreshRulesAndMissingList().catch((error) =>
        debugLog("REFRESH_RULES:error", {
          error: error?.message || String(error),
        }),
      );
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
      attempts += 1;
      debugLog("waitForScheduleTable:check", {
        attempt: attempts,
        found: !!hasScheduleRows,
      });
      if (hasScheduleRows) {
        callback();
        return;
      }

      if (attempts < maxAttempts) {
        setTimeout(check, 250);
      } else {
        debugLog("waitForScheduleTable:timeout", { attempts });
        callback();
      }
    }

    check();
  }

  async function start() {
    debugLog("start", { startHandled, readyState: document.readyState });
    if (startHandled) return;
    startHandled = true;

    injectThemeStyles();
    chrome.runtime.sendMessage({ type: "START_QBITTORRENT_PROBE" });

    waitForScheduleTable(async () => {
      debugLog("start:table-ready");
      injectButtons();
      await refreshRulesAndMissingList();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
