let stream;
let recorder;
let audioContext;
let source;
let activeTabId;
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
  source.connect(audioContext.destination);
  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
  recorder = new MediaRecorder(stream, { mimeType });
  recorder.ondataavailable = event => {
    if (event.data?.size) {
      queue.push(event.data);
      processQueue();
    }
  };
  recorder.onerror = event => reportError(event.error?.message || "Audio recording failed.");
  recorder.start(5000);
}

function end() {
  if (recorder && recorder.state !== "inactive") recorder.stop();
  recorder = null;
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  source?.disconnect();
  source = null;
  audioContext?.close().catch(() => {});
  audioContext = null;
  queue = [];
  busy = false;
}

async function processQueue() {
  if (busy || !queue.length) return;
  busy = true;
  const blob = queue.shift();
  try {
    const cfg = await chrome.storage.local.get(["apiKey", "asrBaseUrl", "asrModel", "translationBaseUrl", "translationModel", "targetLanguage"]);
    if (!cfg.apiKey) throw new Error("Add an API key in Provider settings first.");
    const asrBase = (cfg.asrBaseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
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
      const trBase = (cfg.translationBaseUrl || asrBase).replace(/\/$/, "");
      const trResponse = await fetch(trBase + "/chat/completions", {
        method: "POST",
        headers: { Authorization: "Bearer " + cfg.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: cfg.translationModel || "gpt-4o-mini",
          temperature: 0.2,
          messages: [
            { role: "system", content: "Translate the user's speech into " + (cfg.targetLanguage || "Chinese") + ". Return only the translation. Preserve meaning and names." },
            { role: "user", content: original }
          ]
        })
      });
      if (!trResponse.ok) throw new Error("Translation error " + trResponse.status + ": " + (await trResponse.text()).slice(0, 300));
      const data = await trResponse.json();
      const translated = data.choices?.[0]?.message?.content?.trim();
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
