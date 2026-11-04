// The offscreen document can outlive a suspended service worker. Its actual
// stream state, rather than an in-memory tab ID, owns the capture lifecycle.
(() => {
  class TabCaptureController {
    constructor(api,options={}) {
      this.api=api;this.queue=Promise.resolve();this.starts=new Map();
      this.wait=options.wait||((ms)=>new Promise(resolve=>globalThis.setTimeout(resolve,ms)));
    }
    enqueue(operation) {
      const result=this.queue.then(operation);this.queue=result.catch(()=>{});return result;
    }
    async ensureOffscreen() {
      const api=this.api,url=api.runtime.getURL('offscreen.html');
      if((await api.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[url]})).length)return;
      await api.offscreen.createDocument({url:'offscreen.html',reasons:['USER_MEDIA'],justification:'Capture tab audio for live transcription'});
    }
    async state() {
      try{return await this.api.runtime.sendMessage({target:'offscreen',type:'status'});}catch{return {running:false};}
    }
    async waitReleased(tabId) {
      if(!this.api.tabCapture?.getCapturedTabs)return true;
      for(let attempt=0;attempt<20;attempt++) {
        const tabs=await this.api.tabCapture.getCapturedTabs();
        if(!tabs.some(tab=>(!tabId || tab.tabId===tabId) && ['active','pending'].includes(tab.status)))return true;
        await this.wait(50);
      }
      return false;
    }
    async release(tabId) {
      const state=await this.state();
      if(tabId && state.running && state.tabId!==tabId)return;
      try{await this.api.runtime.sendMessage({target:'offscreen',type:'stop',...(tabId?{tabId}:{})});}catch{}
      if(!await this.waitReleased(tabId)) {
        // Also clears resources allocated by an older failed initialization.
        await this.api.offscreen.closeDocument();
        if(!await this.waitReleased(tabId))throw new Error('旧音频流尚未释放，请稍后重新开启听译');
      }
    }
    start(tabId,frameId=0) {
      const key=tabId+':'+frameId;
      if(this.starts.has(key))return this.starts.get(key);
      const result=this.enqueue(async()=>{
        if(!this.api.tabCapture)return {ok:false,error:'no-permission'};
        await this.ensureOffscreen();await this.release();await this.ensureOffscreen();
        const sessionId=crypto.randomUUID();
        try {
          const streamId=await this.api.tabCapture.getMediaStreamId({targetTabId:tabId});
          const result=await this.api.runtime.sendMessage({target:'offscreen',type:'start',streamId,tabId,frameId,sessionId});
          if(!result?.ok)throw new Error(result?.error||'offscreen-silent');
          return {...result,sessionId};
        }catch(error){await this.release(tabId).catch(()=>{});throw error;}
      });
      this.starts.set(key,result);
      const clear=()=>{if(this.starts.get(key)===result)this.starts.delete(key);};
      result.then(clear,clear);return result;
    }
    stop(tabId) {return this.enqueue(()=>this.release(tabId));}
  }
  if(typeof module!=='undefined' && module.exports){module.exports={TabCaptureController};return;}
  const controller=new TabCaptureController(chrome);
  chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if(!message)return;
    const tabId=sender.tab?.id;
    if(message.type==='YDS_TABCAP_START' && tabId) {
      controller.start(tabId,sender.frameId||0).then(sendResponse).catch(error=>sendResponse({ok:false,error:error.message}));return true;
    }
    if(message.type==='YDS_TABCAP_STOP' && tabId) {
      controller.stop(tabId).then(()=>sendResponse({ok:true})).catch(()=>sendResponse({ok:false}));return true;
    }
    if(message.type==='YDS_TABCAP_RESET' && tabId) {
      chrome.runtime.sendMessage({target:'offscreen',type:'reset',tabId}).catch(()=>{});return;
    }
    if(message.type==='YDS_TABCAP_EVENT' && message.tabId) {
      chrome.tabs.sendMessage(message.tabId,message,{frameId:message.frameId||0},()=>void chrome.runtime.lastError);
    }
  });
  chrome.tabs.onRemoved.addListener(tabId=>controller.stop(tabId).catch(()=>{}));
  chrome.tabs.onUpdated.addListener((tabId,info)=>{if(info.status==='loading')controller.stop(tabId).catch(()=>{});});
})();
