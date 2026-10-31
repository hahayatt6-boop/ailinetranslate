(() => {
  if (window.__aiLineTranslatorLoaded) return;
  window.__aiLineTranslatorLoaded = true;
  let host;
  let timer;
  let prefs = { subtitleMode: "both", subtitleVisible: true };
  chrome.storage.local.get(["subtitleMode", "subtitleVisible"]).then(v => { prefs = {...prefs,...v}; });
  chrome.storage.onChanged.addListener(changes => { for (const key of ["subtitleMode","subtitleVisible"]) if (changes[key]) prefs[key] = changes[key].newValue; if (host?.isConnected) applyPrefs(); });
  function applyPrefs() { if (!host?.isConnected) return; host.style.display = prefs.subtitleVisible === false ? "none" : "block"; const s=host.shadowRoot; s.querySelector(".original").style.display = prefs.subtitleMode === "zh" ? "none" : "block"; s.querySelector(".translated").style.display = prefs.subtitleMode === "original" ? "none" : "block"; }
  function ensureOverlay() {
    if (host?.isConnected) return;
    host = document.createElement("div");
    host.id = "ai-line-translator-host";
    host.style.cssText = "all:initial;position:fixed;z-index:2147483647;left:50%;bottom:16%;transform:translateX(-50%);width:min(78vw,680px);pointer-events:none;";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        .box{font:16px/1.45 system-ui,sans-serif;color:#fff;text-align:center;background:rgba(10,14,22,.88);border:1px solid rgba(255,255,255,.18);border-radius:12px;padding:12px 18px;box-shadow:0 8px 28px #0005;backdrop-filter:blur(8px);pointer-events:auto;cursor:move}
        .original{font-size:14px;color:#e6eaf0}.translated{font-size:20px;font-weight:650;margin-top:5px}.error{font-size:13px;color:#ffb4a9;margin-top:5px}
      </style><div class="box"><div class="original"></div><div class="translated"></div></div>`;
    document.documentElement.appendChild(host);
    applyPrefs();
    const box = shadow.querySelector(".box");
    let drag = null;
    box.addEventListener("pointerdown", e => { drag = { x:e.clientX, y:e.clientY, left:host.offsetLeft, top:host.offsetTop }; box.setPointerCapture(e.pointerId); });
    box.addEventListener("pointermove", e => { if (!drag) return; host.style.left = (drag.left + e.clientX-drag.x) + "px"; host.style.top = (drag.top + e.clientY-drag.y) + "px"; host.style.bottom = "auto"; host.style.transform = "none"; });
    box.addEventListener("pointerup", () => drag = null);
  }
  chrome.runtime.onMessage.addListener(message => {
    if (message.type === "SUBTITLE") {
      ensureOverlay();
      const s = host.shadowRoot;
      s.querySelector(".original").textContent = message.original || "";
      s.querySelector(".translated").textContent = message.translated || "";
      s.querySelector(".error")?.remove();
      applyPrefs();
      clearTimeout(timer);
      timer = setTimeout(() => { if (host?.isConnected) host.remove(); }, 12000);
    } else if (message.type === "CAPTURE_ERROR") {
      ensureOverlay();
      const s = host.shadowRoot;
      let error = s.querySelector(".error");
      if (!error) { error = document.createElement("div"); error.className = "error"; s.querySelector(".box").append(error); }
      error.textContent = message.error;
    }
  });
})();
