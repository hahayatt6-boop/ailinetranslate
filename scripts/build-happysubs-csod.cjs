// Make an isolated compatibility copy; never edit Chrome's installed extension.
const fs=require('node:fs');
const path=require('node:path');
const source=path.resolve(process.argv[2] || path.join(process.env.LOCALAPPDATA,'Google/Chrome/User Data/Profile 12/Extensions/malocefbdblplamcmmmpilepcgllfmnf/2.2.2_0'));
const output=path.resolve(__dirname,'../artifacts/happysubs-csod');
const manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'),'utf8'));
if(manifest.version!=='2.2.2')throw new Error('This patch targets HappySubs 2.2.2 only.');
let popup=fs.readFileSync(path.join(source,'popup.js'),'utf8').replaceAll('\r\n','\n');
function replaceOnce(before,after){
  if(!popup.includes(before))throw new Error('HappySubs source does not match the expected version: '+before.slice(0,70));
  popup=popup.replace(before,after);
}
replaceOnce('let activeTabId = null;', 'let activeTabId = null;\nlet activeFrameId = null;');
replaceOnce('  currentTabId = tab.id;', `  currentTabId = tab.id;
  activeFrameId = null;
  // CSOD puts the course video in a same-origin iframe. Discover that frame
  // before messaging, so helper frames cannot win the response race.
  if (activeTabUrl.startsWith("https://ready.csod.com/")) {
    if (!(await injectGeneric(tab))) return null;
    probedInfo = await askContent(tab.id);
    return probedInfo && probedInfo.videoId ? tab : null;
  }`);
replaceOnce('    const [probe] = await chrome.scripting.executeScript({\n      target: { tabId: tab.id },', `    const isCsod = url.startsWith("https://ready.csod.com/");
    const probes = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: isCsod },`);
replaceOnce('          hasVideo: has,', `          hasVideo: has,
          score: Math.max(0, ...Array.from(document.querySelectorAll("video"), video => {
            const rect = video.getBoundingClientRect();
            return rect.width > 80 && rect.height > 60
              ? (video.paused ? 0 : 1e9) + rect.width * rect.height : 0;
          })),`);
replaceOnce('    const found = (probe && probe.result) || {};', `    const videoProbe = probes.filter(probe => probe.result && probe.result.hasVideo)
      .sort((a, b) => (b.result.score || 0) - (a.result.score || 0))[0];
    const found = (videoProbe && videoProbe.result) || {};`);
replaceOnce('    if (!found.hasVideo) return false;', `    if (!found.hasVideo) return false;
    if (isCsod) activeFrameId = videoProbe.frameId;
    const injectionTarget = isCsod ? { tabId: tab.id, frameIds: [activeFrameId] } : { tabId: tab.id };`);
replaceOnce('await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files:', 'await chrome.scripting.insertCSS({ target: injectionTarget, files:');
replaceOnce('      target: { tabId: tab.id },\n      files: ["i18n.js", "platform.js", "live.js", "content.js"]', '      target: injectionTarget,\n      files: ["i18n.js", "platform.js", "live.js", "content.js"]');
replaceOnce('chrome.tabs.sendMessage(tabId, { type: "YDS_GET_INFO" }, (resp) => {', 'chrome.tabs.sendMessage(tabId, { type: "YDS_GET_INFO" }, activeFrameId !== null && currentTabId === tabId ? { frameId: activeFrameId } : {}, (resp) => {');
replaceOnce('chrome.tabs.sendMessage(tabId, msg, (resp) => {', 'chrome.tabs.sendMessage(tabId, msg, activeFrameId !== null && currentTabId === tabId ? { frameId: activeFrameId } : {}, (resp) => {');
replaceOnce('        const has = !!document.querySelector("video");', `        const isNarratedCourse = location.hostname === "ready.csod.com"
          && !!document.querySelector("#frame #slide") && !!document.querySelector("#play-pause");
        const has = !!document.querySelector("video") || isNarratedCourse;`);
replaceOnce('async function reloadForTabCapture(detail) {', `async function reloadForTabCapture(detail) {
  // SCORM launches depend on the LMS opener/session. Never bounce these URLs
  // through about:blank; after the first permission grant relaunch via the LMS.
  if (activeTabUrl.startsWith("https://ready.csod.com/")) return { ok: false, error: "reopen-for-tab-audio" };`);
replaceOnce('    // Chrome\'s own reason, when there is one:', `    if (res.error === "reopen-for-tab-audio") {
      setLiveStatus("音频权限已开启。请从课程列表重新打开本课件一次，再点击插件开启实时听译；以后无需重复此步骤。", false);
      return;
    }
    // Chrome's own reason, when there is one:`);
popup=popup.replaceAll('"i18n.js", "platform.js", "live.js", "content.js"','"i18n.js", "platform.js", "bailian-provider.js", "speech-connection.js", "live.js", "content.js"');
popup=popup.replace('msg = ydsT("liveIdle");','msg = window.ydsSpeechCloudEnabled ? "开启后直接连接所选云端服务，无需启动本地服务。" : ydsT("liveIdle");');
popup=popup.replace('msg = ydsT("liveListening");','msg = st.server?.provider === "bailian" ? "百炼正在识别" : st.server?.provider === "deepgram" ? "Deepgram 正在识别" : ydsT("liveListening");');
popup=popup.replace('function renderLiveStartHint(show) {','function renderLiveStartHint(show) {\n  if (window.ydsSpeechCloudEnabled) show = false;');
replaceOnce('function renderLivePanel(info) {', 'function renderLivePanel(info) {\n  window.dispatchEvent(new CustomEvent("yds-live-info", { detail: info }));');
new (require('node:vm').Script)(popup);
if(fs.existsSync(output) && JSON.parse(fs.readFileSync(path.join(output,'manifest.json'),'utf8')).name!=='HappySubs · CSOD 适配') {
  throw new Error('Refusing to overwrite an unrelated directory: '+output);
}
fs.cpSync(source,output,{recursive:true,filter:file=>path.basename(file)!=='_metadata'});
manifest.name='HappySubs · CSOD 适配';
manifest.version='2.2.5.4';
for(const entry of manifest.content_scripts || []) {
  const position=entry.js?.indexOf('live.js');
  if(position>=0)entry.js.splice(position,0,'bailian-provider.js','speech-connection.js');
}
manifest.host_permissions=[...new Set([...manifest.host_permissions,'https://api.deepgram.com/*','*://dashscope.aliyuncs.com/*'])];
manifest.permissions=[...new Set([...manifest.permissions,'declarativeNetRequestWithHostAccess'])];
delete manifest.key;
delete manifest.update_url;
fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
fs.writeFileSync(path.join(output,'popup.js'),popup);
const extension=path.resolve(__dirname,'../extension');
let platform=fs.readFileSync(path.join(output,'platform.js'),'utf8').replaceAll('\r\n','\n');
const genericOffset=platform.indexOf('  function createGeneric(ctx) {');
if(genericOffset<0)throw new Error('Missing generic platform adapter');
let generic=platform.slice(genericOffset);
generic=generic.replace('      if (!vids.length) return null;', '      if (!vids.length) return window.HappyCsodMedia?.getMedia() || null;');
generic=generic.replace('      const v = videoEl();\n      if (!v || !stage) return;', '      window.HappyCsodMedia?.poll();\n      const v = videoEl();\n      if (!v || !stage) return;');
generic=generic.replace('looksLikeVideoPage: () => !!document.querySelector("video"),','looksLikeVideoPage: () => !!videoEl(),');
generic=generic.replace('getVideoEl: () => current || videoEl(),','getVideoEl: () => videoEl() || current,');
platform=fs.readFileSync(path.join(extension,'csod-media.js'),'utf8')+'\n'+platform.slice(0,genericOffset)+generic;
fs.writeFileSync(path.join(output,'platform.js'),platform);
for(const file of ['bailian-provider.js','speech-connection.js','speech-settings.js','key-diagnostics.js','speech-config-bridge.js'])fs.copyFileSync(path.join(extension,file),path.join(output,file));
let html=fs.readFileSync(path.join(output,'popup.html'),'utf8');
html=html.replace('<button type="button" id="liveToggle"',fs.readFileSync(path.join(extension,'speech-settings.html'),'utf8')+'\n    <button type="button" id="liveToggle"');
html=html.replace('<script src="popup.js"></script>','<script src="popup.js"></script>\n  <script src="speech-settings.js"></script>');
fs.writeFileSync(path.join(output,'popup.html'),html);

let live=fs.readFileSync(path.join(output,'live.js'),'utf8').replaceAll('\r\n','\n');
live='// Video audio capture with user-configured Deepgram keys and optional local fallback.\n'+live.slice(live.indexOf('(() => {'));
live=live.replace('(() => {','(() => {\n  if (window.__happySpeechLiveLoaded) return;\n  window.__happySpeechLiveLoaded = true;');
live=live.replace('if (ev.kind === "status") emitStatus(ev.status);','if (ev.kind === "status") emitStatus(ev.status, ev.detail);');
live=live.replace('    ws: null,','    connection: null,');
live=live.replace('    tabMode: false,','    tabMode: false,\n    captureSessionId: null,');
live=live.replace('    captureSessionId: null,','    captureSessionId: null,\n    tabStartPending: false,\n    pendingTabEvents: [],');
live=live.replace('  chrome.runtime.onMessage.addListener((msg) => {','  function handleTabEvent(msg) {\n    if (msg?.type === "YDS_TABCAP_EVENT" && state.tabStartPending) { state.pendingTabEvents.push(msg); return; }');
live=live.replace('  });\n\n  function emitStatus', '  }\n  chrome.runtime.onMessage.addListener(handleTabEvent);\n\n  function emitStatus');
live=live.replace('    const ev = msg.event || {};','    if (msg.sessionId && state.captureSessionId && msg.sessionId !== state.captureSessionId) return;\n    const ev = msg.event || {};\n    if (ev.kind === "status" && ev.status === "stopped") { state.running = false; state.tabMode = false; state.captureSessionId = null; }');
live=live.replace('      if (opts && opts.tabAudio) {','      if (opts && opts.tabAudio) {\n        state.tabStartPending = true; state.pendingTabEvents = [];');
live=live.replace('        if (!res || !res.ok) {','        state.tabStartPending = false;\n        if (!res || !res.ok) {\n          state.pendingTabEvents = [];');
live=live.replace('        emitStatus("connecting");\n        return { ok: true };',`        state.captureSessionId = res.sessionId || null;
        if (res.state?.hello) state.handlers.onHello?.(res.state.hello);
        emitStatus(res.state?.status || "connecting", res.state?.detail);
        const pending = state.pendingTabEvents; state.pendingTabEvents = [];
        for (const event of pending) handleTabEvent(event);
        return { ok: true };`);
live=live.replace(`      if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(floatTo16(e.inputBuffer.getChannelData(0)).buffer);
      }`,`      state.connection?.sendAudio(floatTo16(e.inputBuffer.getChannelData(0)).buffer);`);
const connectStart=live.indexOf('  function connect() {');
const connectEnd=live.indexOf('  window.YDS_LIVE',connectStart);
if(connectStart<0 || connectEnd<0)throw new Error('Unexpected live.js structure');
live=live.slice(0,connectStart)+`  function connect() {
    state.connection = new HappySpeechConnection({
      onText: (text, final) => state.handlers.onText?.(text, final),
      onStatus: emitStatus,
      onHello: hello => state.handlers.onHello?.(hello)
    });
    state.connection.start().catch(() => emitStatus("unavailable", "语音识别启动失败，请刷新课件页面再试"));
  }

`+live.slice(connectEnd);
live=live.replace(`      if (state.ws) {
        try { state.ws.close(); } catch {}
        state.ws = null;
      }`,'      state.connection?.stop(); state.connection = null;');
live=live.replace(`      if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({ type: "reset" }));
      }`,'      state.connection?.reset();');
fs.writeFileSync(path.join(output,'live.js'),live);

const offscreen=fs.readFileSync(path.join(extension,'offscreen-capture.js'),'utf8');
fs.writeFileSync(path.join(output,'offscreen.js'),offscreen);
const offHtml=fs.readFileSync(path.join(output,'offscreen.html'),'utf8').replace('<script src="offscreen.js">','<script src="bailian-provider.js"></script>\n<script src="speech-connection.js"></script>\n<script src="offscreen.js">');
fs.writeFileSync(path.join(output,'offscreen.html'),offHtml);
let background=fs.readFileSync(path.join(output,'background.js'),'utf8');
const captureStart=background.indexOf('// ---------- tab-audio capture'),captureEnd=background.indexOf('// ---------- sites the viewer');
if(captureStart<0 || captureEnd<captureStart)throw new Error('Unexpected capture controller structure');
background=background.slice(0,captureStart)+fs.readFileSync(path.join(extension,'tab-capture-controller.js'),'utf8')+'\n\n'+background.slice(captureEnd);
background=background.replaceAll('"i18n.js", "platform.js", "live.js", "content.js"','"i18n.js", "platform.js", "bailian-provider.js", "speech-connection.js", "live.js", "content.js"');
background+=`\n// Upgrade already-registered optional-site scripts to include the speech connector.
chrome.scripting.getRegisteredContentScripts().then(rules => {
  const updates = rules.filter(rule => rule.js?.includes("live.js") && !rule.js.includes("bailian-provider.js"))
    .map(rule => ({ id: rule.id, js: rule.js.filter(file => file !== "speech-connection.js")
      .flatMap(file => file === "live.js" ? ["bailian-provider.js", "speech-connection.js", file] : [file]) }));
  if (updates.length) return chrome.scripting.updateContentScripts(updates);
}).catch(() => {});\n`;
background+=`\nimportScripts("bailian-provider.js", "key-diagnostics.js", "speech-config-bridge.js");
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "YDS_BAILIAN_PREPARE") {
    HappyBailian.authorize(message.key).then(sendResponse).catch(() => sendResponse({error:"authorization_setup_failed"}));return true;
  }
  if (message?.type === "YDS_BAILIAN_RELEASE") {
    if (!Number.isInteger(message.ruleId) || message.ruleId < 810001) {sendResponse({ok:false});return;}
    chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[message.ruleId]})
      .then(() => sendResponse({ok:true})).catch(() => sendResponse({ok:false}));return true;
  }
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "YDS_SPEECH_CHECK_KEY") return;
  if (typeof message.key !== "string" || !message.key.trim()) { sendResponse({status:"invalid"}); return; }
  const check = message.provider === "bailian" ? HappyBailian.checkKey : HappyKeyDiagnostics.checkKey;
  check(message.key.trim()).then(sendResponse).catch(() => sendResponse({status:"unknown"}));
  return true;
});\n`;
fs.writeFileSync(path.join(output,'background.js'),background);
let content=fs.readFileSync(path.join(output,'content.js'),'utf8').replaceAll('\r\n','\n');
// Paused live captions must have no expiry, including late translations.
content=content.replace(`      clearTimeout(live.hideTimer);
      live.hideTimer = setTimeout(() => {
        if (overlayEl) overlayEl.classList.remove("yds-live-visible");`, `      clearTimeout(live.hideTimer);
      if (P?.getVideoEl()?.paused) return;
      live.hideTimer = setTimeout(() => {
        if (!P?.getVideoEl()?.paused && overlayEl) overlayEl.classList.remove("yds-live-visible");`);
content=content.replace(`    const holdFor = (ms) => {
      clearTimeout(live.hideTimer);
      live.hideTimer = setTimeout(() => {
        if (overlayEl) overlayEl.classList.remove("yds-live-visible");`, `    const holdFor = (ms) => {
      clearTimeout(live.hideTimer);
      if (P?.getVideoEl()?.paused) {
        if (overlayEl && (live.textBuf || live.partial || live.transBuf)) overlayEl.classList.add("yds-live-visible");
        return;
      }
      live.hideTimer = setTimeout(() => {
        if (!P?.getVideoEl()?.paused && overlayEl) overlayEl.classList.remove("yds-live-visible");`);
content=content.replace('  let P = null;',`  function ydsSetPlaybackRate(value) {
    const rate = Number(value);
    if (!Number.isFinite(rate) || rate < 0.5 || rate > 2) return { ok: false, error: "速度范围为 0.5–2 倍" };
    const video = P?.getVideoEl();
    if (!video) return { ok: false, error: "当前页面尚未检测到视频" };
    try { video.playbackRate = rate; preferredPlaybackRate = rate; return { ok: true, rate: video.playbackRate }; }
    catch { return { ok: false, error: "播放器不支持调整速度" }; }
  }
  // Media speed preferences
  let preferredPlaybackRate = 1;
  chrome.storage.local.get("ydsPlaybackRate").then(values => {
    preferredPlaybackRate = Number(values.ydsPlaybackRate) || 1;
    if (P) ydsSetPlaybackRate(preferredPlaybackRate);
  }).catch(() => {});
  let P = null;`);
content=content.replace('    if (msg?.type === "YDS_LIVE_START") {',`    if (msg?.type === "YDS_SET_PLAYBACK_RATE") {
      sendResponse(ydsSetPlaybackRate(msg.rate)); return;
    }
    if (msg?.type === "YDS_GET_PLAYBACK_RATE") {
      sendResponse({ ok: !!P?.getVideoEl(), rate: P?.getVideoEl()?.playbackRate || 1 }); return;
    }
    if (msg?.type === "YDS_LIVE_START") {`);
content=content.replace('    document.addEventListener("play", (e) => {\n      if (live.active', '    document.addEventListener("play", (e) => {\n      if (ours(e)) ydsSetPlaybackRate(preferredPlaybackRate);\n      if (live.active');
content=content.replace('      P.start();', '      P.start();\n      ydsSetPlaybackRate(preferredPlaybackRate);');
content=content.replace('      live.partial = "";\n    } else if (isFinal) {','      if (!P?.getVideoEl()?.paused) live.partial = "";\n    } else if (isFinal) {');
// Narration-only courses deliberately trigger the existing tab-audio permission
// flow; captureStream cannot see Web Audio's separately mixed narration.
content=content.replace('    if (!video && !(opts && opts.tabAudio)) return { ok: false, error: "no-video" };',
  '    if (video?.tabAudioOnly && !opts?.tabAudio) return { ok: false, error: "capture-failed", detail: "互动课件旁白需要捕获此标签页的音频" };\n    if (!video && !(opts && opts.tabAudio)) return { ok: false, error: "no-video" };');
content=content.replace('    document.addEventListener("pause", (e) => {', `    document.addEventListener("yds-course-pause", () => { if (live.active) holdFor(LIVE_PAUSE_HOLD_MS); });
    document.addEventListener("yds-course-play", () => { if (live.active) holdFor(LIVE_HIDE_MS); });
    document.addEventListener("pause", (e) => {`);
content=content.replace('  function watchSeeks() {', `  function watchSeeks() {
    document.addEventListener("yds-course-seek", () => {
      if (!live.active) return;
      live.gen++; liveClearText(); window.YDS_LIVE.reset(); liveRender();
    });`);
content=content.replace('    live.detail = detail || "";', '    live.detail = detail || "";\n    if (status === "stopped" && live.active) { stopLive(); return; }');
fs.writeFileSync(path.join(output,'content.js'),content);
for(const name of ['platform.js','live.js','offscreen.js','background.js','content.js','bailian-provider.js','speech-connection.js','speech-settings.js','key-diagnostics.js','speech-config-bridge.js']) {
  new (require('node:vm').Script)(fs.readFileSync(path.join(output,name),'utf8'),{filename:name});
}
console.log(output);
