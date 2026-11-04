export async function getLocalStorage(keys) {
  return chrome.storage.local.get(keys);
}

export async function setLocalStorage(values) {
  await chrome.storage.local.set(values);
}

export async function sendRuntimeMessage(message) {
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
}

export async function requestOriginPermission(origin) {
  return chrome.permissions.request({ origins: [origin] });
}
