(() => {
  if (window.__aiLineTranslatorLoaded) return;
  window.__aiLineTranslatorLoaded = true;

  let host = null, lastText = "", translateTimer = null, observer = null;
  let prefs = { subtitleMode: "both", subtitleVisible: true, captionReaderEnabled: true };
  chrome.storage.local.get(["subtitleMode","subtitleVisible","captionReaderEnabled"]).then(v => prefs = {...prefs,...v});
  chrome.storage.onChanged.addListener(changes => {
    for (const key of ["subtitleMode","subtitleVisible","captionReaderEnabled"]) if (changes[key]) prefs[key] = changes[key].newValue;
    applyPrefs();
  });

  function applyPrefs() {
    if (!host?.isConnected) return;
    host.style.display = prefs.subtitleVisible === false ? "none" : "block";
    const root = host.shadowRoot;
    root.querySelector(".original").style.display = prefs.subtitleMode === "zh" ? "none" : "block";
    root.querySelector(".translated").style.display = prefs.subtitleMode === "original" ? "none" : "block";
  }

  function ensureOverlay() {
    if (host?.isConnected) return;
    host = document.createElement("div");
    host.id = "ai-line-translator-host";
    host.style.cssText = "all:initial;position:fixed;z-index:2147483647;left:50%;bottom:16%;transform:translateX(-50%);width:min(76vw,620px);pointer-events:none;";
    const root = host.attachShadow({mode:"open"});
    root.innerHTML = `<style>
      .box{font:14px/1.4 system-ui,sans-serif;color:#fff;text-align:center;background:rgba(10,14,22,.82);border:1px solid #ffffff30;border-radius:9px;padding:7px 12px;box-shadow:0 5px 18px #0005;backdrop-filter:blur(7px);pointer-events:auto;cursor:move}
      .original{font-size:12px;color:#e6eaf0}.translated{font-size:16px;font-weight:650;margin-top:3px}.error{font-size:12px;color:#ffb4a9;margin-top:4px}
    </style><div class="box"><div class="original"></div><div class="translated"></div><div class="error"></div></div>`;
    document.documentElement.appendChild(host);
    applyPrefs();
    const box=root.querySelector(".box"); let drag=null;
    box.addEventListener("pointerdown",e=>{drag={x:e.clientX,y:e.clientY,left:host.offsetLeft,top:host.offsetTop};box.setPointerCapture(e.pointerId);});
    box.addEventListener("pointermove",e=>{if(!drag)return;host.style.left=(drag.left+e.clientX-drag.x)+"px";host.style.top=(drag.top+e.clientY-drag.y)+"px";host.style.bottom="auto";host.style.transform="none";});
    box.addEventListener("pointerup",()=>drag=null);
  }

  function show(original, translated) {
    ensureOverlay();
    host.shadowRoot.querySelector(".original").textContent=original;
    host.shadowRoot.querySelector(".translated").textContent=translated;
    host.shadowRoot.querySelector(".error").textContent="";
    applyPrefs();
  }

  function normalize(s) { return (s||"").replace(/\s+/g," ").trim(); }
  function submitCaption(raw) {
    const text=normalize(raw);
    if (!text || text.length<2 || text===lastText || text.length>500) return;
    lastText=text;
    clearTimeout(translateTimer);
    translateTimer=setTimeout(async()=>{
      try {
        const result=await chrome.runtime.sendMessage({type:"TRANSLATE_CAPTION",text,target:"zh-CN"});
        if (!result?.ok) throw new Error(result?.error||"翻译服务暂不可用");
        show(text,result.translated);
      } catch(e) {
        ensureOverlay();
        host.shadowRoot.querySelector(".original").textContent=text;
        host.shadowRoot.querySelector(".translated").textContent="";
        host.shadowRoot.querySelector(".error").textContent=e.message;
      }
    },180);
  }

  const captionSelectors = [
    ".vjs-text-track-display .vjs-text-track-cue",
    ".vjs-text-track-display",
    ".video-js .vjs-text-track-cue",
    ".jw-text-track-cue",
    ".jw-captions",
    ".shaka-text-container",
    ".plyr__captions",
    "[class*='caption' i]",
    "[class*='subtitle' i]",
    "[id*='caption' i]",
    "[id*='subtitle' i]"
  ];

  function scanCaptions() {
    for (const selector of captionSelectors) {
      let nodes=[];
      try { nodes=Array.from(document.querySelectorAll(selector)); } catch {}
      for (const node of nodes.slice(-8)) {
        if (node.closest("#ai-line-translator-host")) continue;
        const style=getComputedStyle(node);
        if (style.display==="none" || style.visibility==="hidden" || Number(style.opacity)===0) continue;
        const rect=node.getBoundingClientRect();
        if (rect.width<20 || rect.height<8) continue;
        const text=normalize(node.innerText||node.textContent);
        if (text && text.length<500) submitCaption(text);
      }
    }
  }

  function watchTextTracks() {
    document.querySelectorAll("video").forEach(video=>{
      try {
        Array.from(video.textTracks||[]).forEach(track=>{
          if (track.__aiLineTranslatorBound) return;
          track.__aiLineTranslatorBound=true;
          track.addEventListener("cuechange",()=>{
            const active=Array.from(track.activeCues||[]).map(c=>c.text).join(" ");
            if(active) submitCaption(active);
          });
        });
      } catch {}
    });
  }

  function startReader() {
    if (observer) return;
    observer=new MutationObserver(()=>{scanCaptions();watchTextTracks();});
    observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true});
    scanCaptions(); watchTextTracks();
    setInterval(()=>{scanCaptions();watchTextTracks();},900);
  }

  chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if(message.type==="START_SUBTITLE_READING"){startReader();sendResponse({ok:true});}
    if(message.type==="STOP_SUBTITLE_READING"){observer?.disconnect();observer=null;sendResponse({ok:true});}
    if(message.type==="SUBTITLE"){show(message.original||"",message.translated||"");}
    if(message.type==="CAPTURE_ERROR"){ensureOverlay();host.shadowRoot.querySelector(".error").textContent=message.error||"未知错误";}
    return true;
  });

  // Reader is opt-in; extension popup starts/stops it explicitly.
})();