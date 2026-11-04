const SCHEDULE_URL = "https://subsplease.org/schedule*";

export async function refreshScheduleTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: [SCHEDULE_URL] });
    const results = await Promise.allSettled(
      tabs
        .filter((tab) => Number.isInteger(tab.id))
        .map((tab) => chrome.tabs.sendMessage(tab.id, { type: "REFRESH_RULES" })),
    );
    return results.some((result) => result.status === "fulfilled");
  } catch {
    return false;
  }
}
