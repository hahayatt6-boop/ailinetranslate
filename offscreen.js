let stream;
let recorder;
let audioContext;
let source;
let activeTabId;
let capturing = false;
let busy = false;
let queue = [];

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== "offscreen") return;
  if (message.type === "BEGIN_RECORDING") {
    begin(message.streamId, message.tabId).then(() => sendResponse({ ok: true })).catch(e => sendResponse({ ok: false, error: e.message }));
  } else if (message.type === "END_RECORDING") {
    end();
    sendResponse({ ok: true });
  }
  return true;
});

async function begin(streamId, tabId) {
  end();
  activeTabId = tabId;
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
    video: false
  });
  audioContext = new AudioContext();
  source = audioContext.createMediaStreamSource(stream);
  // tabCapture mutes the original tab unless the captured stream is routed back to speakers.
  source.connect(audioContext.destination);
  capturing = true;
  startSegment();
}

function startSegment() {
  if (!capturing || !stream) return;
  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
  recorder = new MediaRecorder(stream, { mimeType });
  const chunks = [];
  recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
  recorder.onerror = event => reportError(event.error?.message || "Audio recording failed.");
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: mimeType });
    if (blob.size) {
      queue.push(blob);
      processQueue();
    }
    recorder = null;
    if (capturing) startSegment();
  };
  recorder.start();
  setTimeout(() => {
    if (capturing && recorder?.state === "recording") recorder.stop();
  }, 5000);
}

function end() {
  capturing = false;
  if (recorder && recorder.state !== "inactive") recorder.stop();
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  source?.disconnect();
  source = null;
  audioContext?.close().catch(() => {});
  audioContext = null;
  queue = [];
}

async function processQueue() {
  if (busy || !queue.length) return;
  busy = true;
  const blob = queue.shift();
  try {
    const cfg = await chrome.storage.local.get(["apiKey", "asrBaseUrl", "asrModel", "translationBaseUrl", "translationModel", "targetLanguage", "azureTranslatorKey", "azureTranslatorRegion", "googleTranslateKey"]);
    if (!cfg.apiKey) throw new Error("Add an API key in Provider settings first.");
    const asrBase = (cfg.asrBaseUrl || "https://api.openai.com/v1").replace(/\\/$/, "");
    const form = new FormData();
    form.append("file", new File([blob], "audio.webm", { type: blob.type || "audio/webm" }));
    form.append("model", cfg.asrModel || "whisper-1");
    form.append("response_format", "text");
    const asrResponse = await fetch(asrBase + "/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: "Bearer " + cfg.apiKey },
      body: form
    });
    if (!asrResponse.ok) throw new Error("ASR error " + asrResponse.status + ": " + (await asrResponse.text()).slice(0, 300));
    const original = (await asrResponse.text()).trim();
    if (original) {
      const translated = await translateText(original, cfg, asrBase);
      if (translated) await chrome.runtime.sendMessage({ type: "SUBTITLE", tabId: activeTabId, original, translated });
    }
  } catch (error) {
    reportError(error.message || String(error));
  } finally {
    busy = false;
    if (queue.length) processQueue();
  }
}

function reportError(error) {
  chrome.runtime.sendMessage({ type: "CAPTURE_ERROR", tabId: activeTabId, error }).catch(() => {});
}

async function translateText(original, cfg, asrBase) {
  const target = ({Chinese:"zh-Hans",English:"en",Japanese:"ja",Korean:"ko",French:"fr",Spanish:"es"})[cfg.targetLanguage || "Chinese"] || "zh-Hans";
  const errors = [];
  if (cfg.azureTranslatorKey) {
    try {
      const headers = {"Ocp-Apim-Subscription-Key":cfg.azureTranslatorKey,"Content-Type":"application/json"};
      if (cfg.azureTranslatorRegion) headers["Ocp-Apim-Subscription-Region"] = cfg.azureTranslatorRegion;
      const r = await fetch("https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to="+encodeURIComponent(target), {method:"POST",headers,body:JSON.stringify([{Text:original}])});
      if (!r.ok) throw new Error("Azure "+r.status);
      const data = await r.json();
      const value = data[0]?.translations?.[0]?.text;
      if (value) return value;
      throw new Error("Empty Azure translation");
    } catch(e) { errors.push(e.message); }
  }
  if (cfg.googleTranslateKey) {
    try {
      const r = await fetch("https://translation.googleapis.com/language/translate/v2?key="+encodeURIComponent(cfg.googleTranslateKey), {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({q:original,target:target==="zh-Hans"?"zh-CN":target,format:"text"})});
      if (!r.ok) throw new Error("Google "+r.status);
      const data = await r.json();
      const value = data.data?.translations?.[0]?.translatedText;
      if (value) return value;
      throw new Error("Empty Google translation");
    } catch(e) { errors.push(e.message); }
  }
  if (cfg.apiKey) {
    const trBase = (cfg.translationBaseUrl || asrBase).replace(/\\/$/, "");
    const r = await fetch(trBase+"/chat/completions",{method:"POST",headers:{Authorization:"Bearer "+cfg.apiKey,"Content-Type":"application/json"},body:JSON.stringify({model:cfg.translationModel||"gpt-4o-mini",temperature:0.2,messages:[{role:"system",content:"Translate to "+(cfg.targetLanguage||"Chinese")+". Return only translation."},{role:"user",content:original}]})});
    if (!r.ok) throw new Error("Translation "+r.status);
    return (await r.json()).choices?.[0]?.message?.content?.trim();
  }
  throw new Error("No translation provider configured: "+errors.join("; "));
}
