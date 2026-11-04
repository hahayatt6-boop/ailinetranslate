// Shared by video capture and the extension's offscreen tab-audio capture.
(() => {
  const Bailian=typeof require==='function'?require('./bailian-provider.js'):globalThis.HappyBailian;
  class SpeechConnection {
    constructor(options={}) {
      this.options=options;
      this.makeSocket=options.wsFactory || ((url, protocols)=>protocols?new WebSocket(url,protocols):new WebSocket(url));
      this.schedule=options.schedule || ((callback,delay)=>globalThis.setTimeout(callback,delay));
      this.cancel=options.cancel || (token=>globalThis.clearTimeout(token));
      this.socket=null; this.timer=null; this.keepAlive=null; this.handshake=null; this.generation=0;
      this.stopped=true; this.retries=0; this.lastFinal=null;
    }
    async start() {
      this.stopped=false;
      const generation=++this.generation;
      const config=this.options.config || await (this.options.loadConfig
        ? this.options.loadConfig() : chrome.storage.local.get(['ydsSpeech','ydsSpeechKeyStates','ydsBailianKeyStates']).then(v=>({...v.ydsSpeech,keyStates:v.ydsSpeechKeyStates||[],bailianKeyStates:v.ydsBailianKeyStates||[]})));
      if(this.stopped || generation!==this.generation)return;
      this.config=config;
      this.provider=config.provider==='bailian'?'bailian':'deepgram';
      this.keyField=this.provider==='bailian'?'bailianKeys':'keys';
      this.indexField=this.provider==='bailian'?'bailianIndex':'index';
      this.stateField=this.provider==='bailian'?'ydsBailianKeyStates':'ydsSpeechKeyStates';
      this.keys=[...new Set((config[this.keyField]||[]).map(key=>String(key).trim()).filter(Boolean))].slice(0,5);
      this.keyStates=(this.provider==='bailian'?config.bailianKeyStates:config.keyStates)||[];
      const savedIndex=Math.max(0,Number(config[this.indexField])||0)%Math.max(1,this.keys.length);
      this.index=Array.from({length:this.keys.length},(_,offset)=>(savedIndex+offset)%this.keys.length)
        .find(index=>!['exhausted','invalid','forbidden'].includes(this.keyStates[index]?.status)) ?? this.keys.length;
      this.local=config.mode==='local' || (!this.keys.length && config.fallback!==false);
      if(!this.local && this.index>=this.keys.length){this.exhausted();return;}
      return this.open();
    }
    status(status,label) {
      const state={status,label,provider:this.local?'local':this.provider,keyIndex:this.local?null:this.index+1,tabId:this.options.tabId??null,updatedAt:Date.now()};
      this.options.onStatus?.(status,label);
      if(this.options.publish)this.options.publish(state);
      else chrome.storage.local.set({ydsSpeechStatus:state}).catch(()=>{});
    }
    rememberIndex() {
      if(this.options.persistIndex){this.options.persistIndex(this.index);return;}
      chrome.storage.local.get('ydsSpeech').then(({ydsSpeech})=>{
        if(ydsSpeech && ydsSpeech.revision===this.config.revision && JSON.stringify(ydsSpeech[this.keyField])===JSON.stringify(this.config[this.keyField]))
          return chrome.storage.local.set({ydsSpeech:{...ydsSpeech,[this.indexField]:this.index}});
      }).catch(()=>{});
    }
    recordKey(status) {
      const entry={status,updatedAt:Date.now()};this.keyStates[this.index]=entry;
      if(this.options.onKeyState){this.options.onKeyState(this.index,entry);return;}
      if(typeof chrome==='undefined')return;
      const index=this.index,keys=this.config[this.keyField];
      chrome.storage.local.get(['ydsSpeech',this.stateField]).then(values=>{
        if(values.ydsSpeech?.revision!==this.config.revision || JSON.stringify(values.ydsSpeech?.[this.keyField])!==JSON.stringify(keys))return;
        const states=values[this.stateField]||[];states[index]=entry;
        return chrome.storage.local.set({[this.stateField]:states});
      }).catch(()=>{});
    }
    exhausted() {
      if(this.config.fallback!==false){
        this.local=true;this.retries=0;
        this.status('connecting','云端 Key 均不可用，正在连接本地识别');this.open();
      }else this.status('unavailable','云端 Key 均不可用，本地回退未开启；请更新 Key 后重新开启听译');
    }
    async open() {
      if(this.stopped)return;
      this.cancel(this.timer);this.cancel(this.keepAlive);this.cancel(this.handshake);
      this.releaseAuth?.();this.releaseAuth=null;
      const generation=++this.generation;
      this.ready=false;this.pendingAudio=[];this.pendingBytes=0;
      const current=()=>!this.stopped && generation===this.generation && this.socket===ws;
      const label=this.local?'本地识别':`${this.provider==='bailian'?'百炼':'Deepgram'} · Key ${this.index+1}/${this.keys.length}`;
      this.status('connecting',`正在连接 ${label}`);
      let ws,auth;
      const release=()=>{const pending=auth;auth=null;if(pending)Promise.resolve(pending.release()).catch(()=>{});};
      this.releaseAuth=release;
      try {
        if(!this.local && this.provider==='bailian') {
          auth=await (this.options.prepareBailian||Bailian.prepare)(this.keys[this.index]);
          if(this.stopped || generation!==this.generation){release();return;}
        }
        const url=this.local?'ws://127.0.0.1:8765':auth?auth.url:
          'wss://api.deepgram.com/v1/listen?model=nova-3&language=en-US&encoding=linear16&sample_rate=16000&channels=1&interim_results=true&punctuate=true&smart_format=true&endpointing=300';
        ws=this.makeSocket(url,this.local||auth?undefined:['token',this.keys[this.index]]);
      }catch{release();this.failed(generation);return;}
      this.socket=ws;this.lastFinal=null;
      this.handshake=this.schedule(()=>{
        if(current() && !this.ready){release();ws.close();this.failed(generation);}
      },15000);
      ws.onopen=()=>{
        release();
        if(!current())return;
        if(!this.local && this.provider==='bailian') {
          this.taskId=crypto.randomUUID();ws.send(JSON.stringify(Bailian.runTask(this.taskId)));return;
        }
        this.ready=true;
        this.cancel(this.handshake);this.handshake=null;
        this.status('listening',`${label} 已连接`);
        if(!this.local){
          this.recordKey('available');
          this.options.onHello?.({type:'hello',version:'2.2.0',refine:true,provider:'deepgram',keyIndex:this.index+1});
          const keepAlive=()=>{
            if(!current())return;
            if(ws.readyState===1)ws.send(JSON.stringify({type:'KeepAlive'}));
            this.keepAlive=this.schedule(keepAlive,4000);
          };
          this.keepAlive=this.schedule(keepAlive,4000);
        }
      };
      ws.onmessage=e=>{
        if(!current())return;
        let msg;try{msg=JSON.parse(e.data);}catch{return;}
        if(this.local){
          if(msg.type==='hello')this.options.onHello?.(msg);
          else if(typeof msg.text==='string')this.options.onText?.(msg.text,!!msg.final);
          return;
        }
        if(this.provider==='bailian') {
          if(msg.header?.task_id && msg.header.task_id!==this.taskId)return;
          if(msg.header?.event==='task-started') {
            this.cancel(this.handshake);this.ready=true;this.recordKey('available');
            this.status('listening',`${label} 已连接`);
            this.options.onHello?.({type:'hello',version:'2.2.0',refine:true,provider:'bailian',keyIndex:this.index+1});
            for(const chunk of this.pendingAudio)this.sendAudio(chunk);
            this.pendingAudio=[];this.pendingBytes=0;return;
          }
          if(msg.header?.event==='task-failed') {
            const status=Bailian.errorStatus(msg.header.error_code,msg.header.error_message);
            if(['exhausted','invalid','forbidden'].includes(status)) {
              this.recordKey(status);this.cancel(this.handshake);this.socket=null;release();ws.close();this.advance();
            }else{ws.close();this.failed(generation);}
            return;
          }
          if(msg.header?.event==='task-finished'){ws.close();this.failed(generation);return;}
          if(msg.header?.event!=='result-generated')return;
          const sentence=msg.payload?.output?.sentence;
          const text=sentence?.text?.trim();if(!text || sentence.heartbeat)return;
          this.retries=0;
          if(sentence.sentence_end) {
            const identity=JSON.stringify([sentence.begin_time,sentence.end_time,text]);
            if(identity===this.lastFinal)return;this.lastFinal=identity;
          }
          this.options.onText?.(text,!!sentence.sentence_end);return;
        }
        if(msg.type==='Error'){ws.close();return;}
        if(msg.type!=='Results')return;
        const text=msg.channel?.alternatives?.[0]?.transcript?.trim();
        if(!text)return;
        this.retries=0;
        if(msg.is_final){
          const identity=JSON.stringify([msg.start,msg.duration,text]);
          if(identity===this.lastFinal)return;
          this.lastFinal=identity;
        }
        this.options.onText?.(text,!!msg.is_final);
      };
      ws.onclose=()=>{release();if(current())this.failed(generation);};
      ws.onerror=()=>{if(current())ws.close();};
    }
    failed(generation) {
      if(this.stopped || generation!==this.generation)return;
      this.cancel(this.keepAlive);this.cancel(this.handshake);this.socket=null;
      if(this.local){
        this.status('unavailable','本地识别未连接，请启动 happysubs-server');
        this.timer=this.schedule(()=>this.open(),3000);return;
      }
      if(this.retries++===0){
        this.status('connecting',`Key ${this.index+1} 连接中断，正在重试`);
        this.timer=this.schedule(()=>this.open(),1500);return;
      }
      const diagnose=this.options.diagnose || (typeof chrome!=='undefined' && chrome.runtime?.sendMessage
        ? key=>chrome.runtime.sendMessage({type:'YDS_SPEECH_CHECK_KEY',provider:this.provider,key}) : null);
      if(diagnose){
        this.status('connecting',`正在检查 Key ${this.index+1} 的额度和状态`);
        Promise.resolve().then(()=>diagnose(this.keys[this.index])).catch(()=>({status:'unknown'})).then(result=>{
          if(this.stopped || generation!==this.generation)return;
          this.recordKey(result?.status==='available'?'connection_error':result?.status||'unknown');
          this.advance();
        });
      }else{this.recordKey('unknown');this.advance();}
    }
    advance() {
      this.index++;this.retries=0;
      while(this.index<this.keys.length && ['exhausted','invalid','forbidden'].includes(this.keyStates[this.index]?.status))this.index++;
      this.rememberIndex();
      if(this.index>=this.keys.length){this.exhausted();return;}
      this.status('connecting',`正在切换到 Key ${this.index+1}`);
      this.timer=this.schedule(()=>this.open(),500);
    }
    sendAudio(data) {
      if(!this.stopped && !this.local && this.provider==='bailian' && !this.ready) {
        if(!this.pendingAudio)return;
        this.pendingAudio.push(data);this.pendingBytes+=data.byteLength;
        while(this.pendingBytes>32000 && this.pendingAudio.length)this.pendingBytes-=this.pendingAudio.shift().byteLength;
        return;
      }
      if(!this.stopped && this.socket?.readyState===1 && this.socket.bufferedAmount<256000)
        this.socket.send(data);
    }
    reset() {
      if(this.stopped)return;
      if(this.local){if(this.socket?.readyState===1)this.socket.send(JSON.stringify({type:'reset'}));return;}
      this.generation++;this.socket?.close();this.retries=0;this.open();
    }
    stop() {
      this.stopped=true;this.generation++;
      this.cancel(this.timer);this.cancel(this.keepAlive);this.cancel(this.handshake);
      this.timer=null;this.keepAlive=null;this.handshake=null;
      this.socket?.close();this.socket=null;
      this.releaseAuth?.();this.releaseAuth=null;
      this.status('stopped','听译已停止');
    }
  }
  if(typeof module!=='undefined' && module.exports)module.exports={SpeechConnection};
  else globalThis.HappySpeechConnection=SpeechConnection;
})();
