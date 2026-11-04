export function getPopupElements(root) {
  return {
    form: root.getElementById("settings-form"),
    url: root.getElementById("url"),
    username: root.getElementById("username"),
    password: root.getElementById("password"),
    testButton: root.getElementById("test"),
    statusText: root.getElementById("status"),
    statusDot: root.getElementById("status-dot"),
    feedSelect: root.getElementById("feed-select"),
    themeToggle: root.getElementById("theme-toggle"),
  };
}

export function renderFeedOptions(select, feeds, selected) {
  const uniqueFeeds = new Map();
  for (const feed of feeds || []) {
    const option =
      typeof feed === "string"
        ? {
            label: feed,
            value: feed,
            // Include display property for compatibility with the composite key format
            display: feed,
          }
        : {
            label:
              feed?.display || feed?.label || feed?.name || feed?.value || "",
            value: feed?.value || feed?.url || feed?.label || feed?.name || "",
          };
    if (option.label && option.value) {
      uniqueFeeds.set(`${option.value}\u0000${option.label}`, option);
    }
  }

  select.replaceChildren();
  if (!uniqueFeeds.size) {
    select.append(new Option("No RSS feeds available", ""));
    select.disabled = true;
    return;
  }

  const options = [...uniqueFeeds.values()];

  // Determine which feed is selected - check both the simple value and the composite Map key
  const selectedValue =
    options.find((option) => option.value === selected)?.value ||
    options.find(
      (option) => `${option.value}\u0000${option.label}` === selected,
    )?.value ||
    options[0].value;

  const fragment = document.createDocumentFragment();
  for (const option of options) {
    fragment.append(
      new Option(
        option.label,
        option.value,
        false,
        option.value === selectedValue,
      ),
    );
  }
  select.append(fragment);
  select.disabled = false;
  select.value = selectedValue;
}

export function showStatus(elements, message, kind = "") {
  elements.statusText.textContent = message;
  elements.statusDot.className = `dot ${kind}`;
}

export function applyTheme(elements, theme) {
  const resolvedTheme = theme === "light" ? "light" : "dark";
  document.body.dataset.theme = resolvedTheme;
  elements.themeToggle.checked = resolvedTheme === "dark";
}
