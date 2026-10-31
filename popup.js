const ids = ["apiKey","asrBaseUrl","asrModel","translationBaseUrl","translationModel","targetLanguage","subtitleMode"];
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
