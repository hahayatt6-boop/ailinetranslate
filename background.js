
const freeTranslationCache = new Map();
async function translateCaption(text, target) {
  const cacheKey = target + ":" + text;
  if (freeTranslationCache.has(cacheKey)) return freeTranslationCache.get(cacheKey);
  const url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl="+encodeURIComponent(target||"zh-CN")+"&dt=t&q="+encodeURIComponent(text);
  const response = await fetch(url);
  if (!response.ok) throw new Error("Google 网页翻译暂不可用（HTTP "+response.status+"）");
  const data = await response.json();
  const translated = (data[0]||[]).map(part=>part?.[0]||"").join("").trim();
  if (!translated) throw new Error("翻译服务没有返回内容");
  freeTranslationCache.set(cacheKey,translated);
  if (freeTranslationCache.size>300) freeTranslationCache.delete(freeTranslationCache.keys().next().value);
  return translated;
}
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
    if (message.type === "TRANSLATE_CAPTION") {\n      const translated = await translateCaption(message.text, message.target);\n      sendResponse({ ok: true, translated });\n    } else if (message.type === "START_SUBTITLE_READING" || message.type === "STOP_SUBTITLE_READING") {\n      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });\n      if (!tab?.id) throw new Error("No active tab found.");\n      const result = await chrome.tabs.sendMessage(tab.id, { type: message.type }).catch(() => null);\n      if (!result?.ok) throw new Error("无法启动字幕读取，请刷新课程页面后重试。");\n      sendResponse({ ok: true });\n    } else if (message.type === "START_CAPTURE") {
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
