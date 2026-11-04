(() => {
  const normalize = (value) =>
    String(value || "")
      .replace(/\u00A0/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  globalThis.SubsPleaseQbit = {
    normalizeTitle: normalize,
    normalizeRuleName: (value) => normalize(value).toLowerCase(),
    async getSettings() {
      try {
        return (await chrome.storage.local.get("settings")).settings || {};
      } catch {
        return {};
      }
    },
    async sendRuntimeMessage(message) {
      try {
        return (
          (await chrome.runtime.sendMessage(message)) ?? {
            ok: false,
            error: "No response from the extension service worker.",
          }
        );
      } catch (error) {
        return { ok: false, error: error?.message || String(error) };
      }
    },
  };
})();
