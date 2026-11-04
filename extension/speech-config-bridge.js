// Offscreen documents support chrome.runtime only. Keep extension storage in
// the service worker and access it through messages from our offscreen page.
(() => {
  class SpeechConfigBridge {
    constructor(api){this.api=api;}
    async handle(message) {
      const local=this.api.storage.local;
      if(message.type==='YDS_SPEECH_CONFIG') {
        const values=await local.get(['ydsSpeech','ydsSpeechKeyStates','ydsBailianKeyStates']);
        return {...values.ydsSpeech,keyStates:values.ydsSpeechKeyStates||[],bailianKeyStates:values.ydsBailianKeyStates||[]};
      }
      if(message.type==='YDS_SPEECH_PUBLISH'){await local.set({ydsSpeechStatus:message.state});return {ok:true};}
      const values=await local.get(['ydsSpeech','ydsSpeechKeyStates','ydsBailianKeyStates']);
      const config=values.ydsSpeech;
      if(!config || config.revision!==message.revision || !Number.isInteger(message.index) || message.index<0 || message.index>5)return {ok:false};
      const bailian=message.provider==='bailian';
      if(message.type==='YDS_SPEECH_INDEX') {
        await local.set({ydsSpeech:{...config,[bailian?'bailianIndex':'index']:message.index}});return {ok:true};
      }
      if(message.type==='YDS_SPEECH_KEY_STATE' && message.index<5) {
        const field=bailian?'ydsBailianKeyStates':'ydsSpeechKeyStates',states=values[field]||[];
        states[message.index]=message.state;await local.set({[field]:states});return {ok:true};
      }
      return {ok:false};
    }
  }
  if(typeof module!=='undefined' && module.exports){module.exports={SpeechConfigBridge};return;}
  const bridge=new SpeechConfigBridge(chrome);
  const messages=new Set(['YDS_SPEECH_CONFIG','YDS_SPEECH_PUBLISH','YDS_SPEECH_INDEX','YDS_SPEECH_KEY_STATE']);
  chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if(!messages.has(message?.type) || sender.url!==chrome.runtime.getURL('offscreen.html'))return;
    bridge.handle(message).then(sendResponse).catch(()=>sendResponse({ok:false}));return true;
  });
})();
