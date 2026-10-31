const OFFSCREEN_URL = "offscreen.html";

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)] });
  if (!contexts.length) {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ["USER_MEDIA", "AUDIO_PLAYBACK"],
      justification: "Capture active-tab audio, process short audio chunks, and keep captured audio audible."
    });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === "START_CAPTURE") {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab?.id) throw new Error("No active tab found.");
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
      await ensureOffscreen();
      const result = await chrome.runtime.sendMessage({ target: "offscreen", type: "BEGIN_RECORDING", streamId, tabId: tab.id });
      if (!result?.ok) throw new Error(result?.error || "Could not start audio capture.");
      sendResponse({ ok: true, tabId: tab.id });
    } else if (message.type === "STOP_CAPTURE") {
      await chrome.runtime.sendMessage({ target: "offscreen", type: "END_RECORDING" });
      sendResponse({ ok: true });
    } else if (message.type === "SUBTITLE") {
      if (message.tabId) chrome.tabs.sendMessage(message.tabId, { type: "SUBTITLE", original: message.original, translated: message.translated }).catch(() => {});
      sendResponse({ ok: true });
    } else if (message.type === "CAPTURE_ERROR") {
      if (message.tabId) chrome.tabs.sendMessage(message.tabId, { type: "CAPTURE_ERROR", error: message.error }).catch(() => {});
      sendResponse({ ok: true });
    }
  })().catch(error => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});
