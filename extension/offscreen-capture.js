// One owned tab-audio stream. Stop is acknowledged only after tracks and audio
// contexts have been released, including a partially failed initialization.
const SAMPLE_RATE=16000,BUFFER_SIZE=4096;
let cur=null,operations=Promise.resolve();
function emit(c,event) {
  chrome.runtime.sendMessage({type:'YDS_TABCAP_EVENT',tabId:c.tabId,frameId:c.frameId,sessionId:c.sessionId,event}).catch(()=>{});
}
function enqueue(operation) {
  const result=operations.then(operation);operations=result.catch(()=>{});return result;
}
function floatTo16(f32) {
  const i16=new Int16Array(f32.length);
  for(let i=0;i<f32.length;i++){const sample=Math.max(-1,Math.min(1,f32[i]));i16[i]=sample<0?sample*0x8000:sample*0x7fff;}
  return i16;
}
async function dispose(c) {
  if(!c)return;
  if(c.processor)c.processor.onaudioprocess=null;
  c.connection?.stop();
  for(const node of [c.source,c.processor,c.mute,c.playSource])try{node?.disconnect();}catch{}
  for(const track of c.stream?.getTracks()||[])try{track.stop();}catch{}
  await Promise.allSettled([c.playCtx,c.recCtx].filter(Boolean).map(context=>Promise.resolve().then(()=>context.close())));
}
async function stop(tabId) {
  const c=cur;if(!c || tabId && c.tabId!==tabId)return;
  cur=null;await dispose(c);emit(c,{kind:'status',status:'stopped',detail:'听译已停止'});
}
async function start(message) {
  await stop();
  const c={tabId:message.tabId,frameId:message.frameId||0,sessionId:message.sessionId||crypto.randomUUID(),status:'connecting',detail:'正在连接识别服务'};
  try {
    c.stream=await navigator.mediaDevices.getUserMedia({audio:{mandatory:{chromeMediaSource:'tab',chromeMediaSourceId:message.streamId}},video:false});
    c.playCtx=new AudioContext();await c.playCtx.resume();
    c.playSource=c.playCtx.createMediaStreamSource(c.stream);c.playSource.connect(c.playCtx.destination);
    c.recCtx=new AudioContext({sampleRate:SAMPLE_RATE});await c.recCtx.resume();
    c.source=c.recCtx.createMediaStreamSource(c.stream);c.processor=c.recCtx.createScriptProcessor(BUFFER_SIZE,1,1);
    c.mute=c.recCtx.createGain();c.mute.gain.value=0;
    c.source.connect(c.processor);c.processor.connect(c.mute);c.mute.connect(c.recCtx.destination);
    c.processor.onaudioprocess=event=>{if(cur===c)c.connection?.sendAudio(floatTo16(event.inputBuffer.getChannelData(0)).buffer);};
    for(const track of c.stream.getAudioTracks())track.addEventListener('ended',()=>{if(cur===c)enqueue(()=>stop(c.tabId)).catch(()=>{});});
    cur=c;
    let config;
    const send=message=>chrome.runtime.sendMessage(message).catch(()=>({ok:false}));
    const metadata=()=>({revision:config?.revision,provider:config?.provider||'deepgram'});
    c.connection=new HappySpeechConnection({tabId:c.tabId,
      loadConfig:async()=>{config=await chrome.runtime.sendMessage({type:'YDS_SPEECH_CONFIG'});if(!config || config.ok===false)throw new Error('无法读取语音设置');return config;},
      publish:state=>{if(cur===c)send({type:'YDS_SPEECH_PUBLISH',state});},
      persistIndex:index=>send({type:'YDS_SPEECH_INDEX',index,...metadata()}),
      onKeyState:(index,state)=>send({type:'YDS_SPEECH_KEY_STATE',index,state,...metadata()}),
      diagnose:key=>chrome.runtime.sendMessage({type:'YDS_SPEECH_CHECK_KEY',key,provider:config?.provider||'deepgram'}),
      onText:(text,final)=>{if(cur===c)emit(c,{kind:'text',text,final});},
      onStatus:(status,detail)=>{if(cur!==c)return;c.status=status;c.detail=detail;emit(c,{kind:'status',status,detail});},
      onHello:hello=>{if(cur===c){c.hello=hello;emit(c,{kind:'hello',hello});}}
    });
    c.connection.start().catch(()=>{if(cur===c){c.status='unavailable';c.detail='语音识别启动失败，请重新开启听译';emit(c,{kind:'status',status:c.status,detail:c.detail});}});
    return {ok:true,sessionId:c.sessionId,state:{status:c.status,detail:c.detail,hello:c.hello}};
  }catch(error){if(cur===c)cur=null;await dispose(c);throw error;}
}
chrome.runtime.onMessage.addListener((message,_sender,sendResponse)=>{
  if(message?.target!=='offscreen')return;
  if(message.type==='status'){sendResponse(cur?{running:true,tabId:cur.tabId,frameId:cur.frameId,sessionId:cur.sessionId}:{running:false});return;}
  if(message.type==='start') {
    enqueue(()=>start(message)).then(sendResponse).catch(error=>sendResponse({ok:false,error:error.message}));return true;
  }
  if(message.type==='stop') {
    enqueue(()=>stop(message.tabId)).then(()=>sendResponse({ok:true})).catch(error=>sendResponse({ok:false,error:error.message}));return true;
  }
  if(message.type==='reset') {
    if(cur && cur.tabId===message.tabId)cur.connection?.reset();sendResponse({ok:true});
  }
});
