// A tiny silent WAV lets the speech API return an explicit billing/auth status
// when browser WebSocket failures hide the HTTP response. No course audio used.
(() => {
  function probeAudio() {
    const buffer=new ArrayBuffer(3244),view=new DataView(buffer);
    const word=(offset,text)=>[...text].forEach((char,index)=>view.setUint8(offset+index,char.charCodeAt(0)));
    word(0,'RIFF');view.setUint32(4,3236,true);word(8,'WAVE');word(12,'fmt ');
    view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
    view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);
    word(36,'data');view.setUint32(40,3200,true);return buffer;
  }
  async function checkKey(key,fetcher=globalThis.fetch) {
    const controller=new AbortController();const timer=globalThis.setTimeout(()=>controller.abort(),12000);
    try {
      const response=await fetcher('https://api.deepgram.com/v1/listen?model=nova-3&language=en-US',{
        method:'POST',headers:{Authorization:'Token '+key,'Content-Type':'audio/wav'},body:probeAudio(),signal:controller.signal});
      const status=({200:'available',401:'invalid',402:'exhausted',403:'forbidden',429:'rate_limited'})[response.status]||'unavailable';
      return {status,httpStatus:response.status};
    }catch{return {status:'unknown'};}
    finally{globalThis.clearTimeout(timer);}
  }
  const api={checkKey};
  if(typeof module!=='undefined' && module.exports)module.exports=api;
  else globalThis.HappyKeyDiagnostics=api;
})();
