const ids = ["apiKey","asrBaseUrl","asrModel","translationBaseUrl","translationModel","targetLanguage","subtitleMode","azureTranslatorKey","azureTranslatorRegion","googleTranslateKey"];
const visible = document.getElementById("subtitleVisible");
chrome.storage.local.get(["subtitleVisible"]).then(v => { visible.checked = v.subtitleVisible !== false; });
visible.addEventListener("change", () => chrome.storage.local.set({subtitleVisible:visible.checked}));
document.getElementById("subtitleMode").addEventListener("change", e => chrome.storage.local.set({subtitleMode:e.target.value}));
const status = document.getElementById("status");
chrome.storage.local.get(ids).then(cfg => ids.forEach(id => { if (cfg[id]) document.getElementById(id).value = cfg[id]; }));
document.getElementById("save").addEventListener("click", async () => {
  const cfg = Object.fromEntries(ids.map(id => [id, document.getElementById(id).value.trim()]));
  await chrome.storage.local.set(cfg);
  status.textContent = "设置已保存在本机。";
});
document.getElementById("start").addEventListener("click", async () => {
  const cfg = await chrome.storage.local.get(["apiKey"]);
  if (!cfg.apiKey) { status.textContent = "请先展开 Provider 设置并填写 API Key。"; return; }
  const result = await chrome.runtime.sendMessage({ type: "START_CAPTURE" });
  status.textContent = result?.ok ? "正在捕获当前标签页音频。" : "启动失败：" + (result?.error || "未知错误");
});
document.getElementById("stop").addEventListener("click", async () => {
  const result = await chrome.runtime.sendMessage({ type: "STOP_CAPTURE" });
  status.textContent = result?.ok ? "已暂停捕获。" : "暂停失败。";
});

document.getElementById("startReader").addEventListener("click", async () => {
  status.textContent = "正在检查网页字幕…";
  try {
    const result = await chrome.runtime.sendMessage({type:"START_SUBTITLE_READING"});
    if (!result?.ok) throw new Error(result?.error || "未知错误");
    status.textContent = result.hasCaption
      ? "已读取到网页字幕，正在翻译。"
      : "已在 " + result.frames + " 个页面框架启动监听，尚未发现可读取的字幕。" +
        (result.videos ? "已检测到视频：请开启播放器字幕；画面内嵌的字幕需要 OCR 或音频识别。" : "请播放课程并开启字幕。");
  } catch (error) {
    status.textContent = "启动失败：" + error.message;
  }
});
document.getElementById("stopReader").addEventListener("click", async () => {
  const result = await chrome.runtime.sendMessage({type:"STOP_SUBTITLE_READING"});
  status.textContent = result?.ok ? "已停止网页字幕读取。" : "停止失败：" + (result?.error || "未知错误");
});
