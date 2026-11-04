const STATUS_STORAGE_KEY = "connectionStatus";
const STATUS_DETAILS = {
  connected: {
    color: "#28a745",
    title: "SubsPlease RSS Manager — qBittorrent connected",
  },
  disconnected: {
    color: "#d9534f",
    title: "SubsPlease RSS Manager — qBittorrent unavailable",
  },
  unknown: {
    color: "#6c757d",
    title: "SubsPlease RSS Manager — connection not tested",
  },
};

function createIcon(size, color) {
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext("2d");
  const center = size / 2;

  context.clearRect(0, 0, size, size);
  context.fillStyle = color;
  context.beginPath();
  context.arc(center, center, size * 0.44, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "#ffffff";
  context.font = `700 ${Math.round(size * 0.8)}px sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("S", center, center + size * 0.03);

  return context.getImageData(0, 0, size, size);
}

async function applyActionStatus(status) {
  const details = STATUS_DETAILS[status] || STATUS_DETAILS.unknown;
  await chrome.action.setIcon({
    imageData: {
      16: createIcon(16, details.color),
      32: createIcon(32, details.color),
    },
  });
  await chrome.action.setTitle({ title: details.title });
}

export async function setConnectionStatus(status) {
  const resolvedStatus = STATUS_DETAILS[status] ? status : "unknown";
  try {
    await applyActionStatus(resolvedStatus);
  } catch (error) {
    console.warn("Could not update the extension action icon.", error);
  }

  try {
    await chrome.storage.session.set({ [STATUS_STORAGE_KEY]: resolvedStatus });
  } catch (error) {
    console.warn("Could not persist the extension connection status.", error);
  }
}

export async function restoreConnectionStatus() {
  try {
    const { [STATUS_STORAGE_KEY]: status = "unknown" } =
      await chrome.storage.session.get(STATUS_STORAGE_KEY);
    await applyActionStatus(status);
  } catch (error) {
    console.warn("Could not restore the extension action icon.", error);
  }
}
