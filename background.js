const freeTranslationCache = new Map();

async function translateCaption(text, target) {
  const cacheKey = (target || "zh-CN") + ":" + text;
  if (freeTranslationCache.has(cacheKey)) return freeTranslationCache.get(cacheKey);
  const url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=" +
    encodeURIComponent(target || "zh-CN") + "&dt=t&q=" + encodeURIComponent(text);
  const response = await fetch(url);
  if (!response.ok) throw new Error("Google 网页翻译暂不可用（HTTP " + response.status + "）");
  const data = await response.json();
  const translated = (data[0] || []).map(part => part?.[0] || "").join("").trim();
  if (!translated) throw new Error("翻译服务没有返回内容");
  freeTranslationCache.set(cacheKey, translated);
  if (freeTranslationCache.size > 300) freeTranslationCache.delete(freeTranslationCache.keys().next().value);
  return translated;
}

async function sendToFrames(tabId, type) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  if (!frames?.length) throw new Error("没有找到可注入的页面 frame");
  const results = await Promise.all(frames.map(async frame => {
    try {
      return await chrome.tabs.sendMessage(tabId, { type }, { frameId: frame.frameId });
    } catch (_) {
      return null;
    }
  }));
  return results.filter(result => result?.ok).length;
}

const OFFSCREEN_URL = "offscreen.html";
async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
  });
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
    if (message.type === "TRANSLATE_CAPTION") {
      const translated = await translateCaption(message.text, message.target);
      sendResponse({ ok: true, translated });
    } else if (message.type === "START_SUBTITLE_READING" || message.type === "STOP_SUBTITLE_READING") {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab?.id) throw new Error("No active tab found.");
      const count = await sendToFrames(tab.id, message.type);
      if (!count && message.type === "START_SUBTITLE_READING") {
        throw new Error("没有在当前页面找到可运行的字幕监听脚本。请刷新课程页面，并确认扩展已启用。");
      }
      sendResponse({ ok: true, frames: count });
    } else if (message.type === "START_CAPTURE") {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab?.id) throw new Error("No active tab found.");
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
      await ensureOffscreen();
      const result = await chrome.runtime.sendMessage({
        target: "offscreen", type: "BEGIN_RECORDING", streamId, tabId: tab.id
      });
      if (!result?.ok) throw new Error(result?.error || "Could not start audio capture.");
      sendResponse({ ok: true, tabId: tab.id });
    } else if (message.type === "STOP_CAPTURE") {
      await chrome.runtime.sendMessage({ target: "offscreen", type: "END_RECORDING" });
      sendResponse({ ok: true });
    } else if (message.type === "SUBTITLE" || message.type === "CAPTURE_ERROR") {
      const tabId = message.tabId || sender.tab?.id;
      if (tabId) {
        const frames = await chrome.webNavigation.getAllFrames({ tabId }).catch(() => []);
        await Promise.all((frames || []).map(frame =>
          chrome.tabs.sendMessage(tabId, {
            type: message.type,
            original: message.original,
            translated: message.translated,
            error: message.error
          }, { frameId: frame.frameId }).catch(() => null)
        ));
      }
      sendResponse({ ok: true });
    }
  })().catch(error => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});
