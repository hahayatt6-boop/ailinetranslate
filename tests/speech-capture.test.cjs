const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function capture(source,options={}){
  const processors=[],connections=[];let listener,tracksStopped=0;
  class AudioContext {
    destination={};resume=async()=>{};close=()=>options.close?options.close():Promise.resolve();
    createMediaStreamSource(){return {connect(){},disconnect(){}};}
    createGain(){return {gain:{value:1},connect(){},disconnect(){}};}
    createScriptProcessor(){if(options.failProcessor)throw new Error('processor failed');const p={connect(){},disconnect(){}};processors.push(p);return p;}
  }
  class Connection {
    constructor(options){this.options=options;this.audio=[];connections.push(this);}
    async start(){}sendAudio(data){this.audio.push(data);}stop(){this.stopped=true;}reset(){this.resetCalled=true;}
  }
  const stream={getAudioTracks:()=>[{addEventListener(){}}],getTracks:()=>[{stop(){tracksStopped++;}}]};
  const sockets=[];
  const context={window:{},AudioContext,HappySpeechConnection:Connection,Int16Array,
    WebSocket:class{constructor(url,protocols){this.url=url;this.protocols=protocols;this.readyState=0;this.bufferedAmount=0;this.sent=[];sockets.push(this);}send(data){this.sent.push(data);}close(){this.readyState=3;}},
    navigator:{mediaDevices:{getUserMedia:async()=>stream}},setTimeout,clearTimeout,
    crypto:require('node:crypto').webcrypto,chrome:{runtime:{onMessage:{addListener(fn){listener=fn;}},sendMessage:async message=>options.runtime?options.runtime(message):options.response||({ok:true})}}};
  if(options.realConnector)vm.runInNewContext(fs.readFileSync('extension/speech-connection.js','utf8'),context);
  vm.runInNewContext(fs.readFileSync('artifacts/happysubs-csod/'+source,'utf8'),context);
  return {context,processors,connections,sockets,stream,get tracksStopped(){return tracksStopped;},dispatch(msg){listener(msg,{},()=>{});},message(msg){return new Promise(resolve=>listener(msg,{},resolve));}};
}
test('video capture sends PCM through the configurable connector and stops it',async()=>{
  const r=capture('live.js');
  assert.equal((await r.context.window.YDS_LIVE.start({captureStream:()=>r.stream},{})).ok,true);
  r.processors[0].onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array([.5,-.5])}});
  assert.deepEqual(Array.from(new Int16Array(r.connections[0].audio[0])),[16383,-16384]);
  r.context.window.YDS_LIVE.reset();assert.equal(r.connections[0].resetCalled,true);
  r.context.window.YDS_LIVE.stop();assert.equal(r.connections[0].stopped,true);
});
test('tab-audio capture uses the same connector for cloud rotation and local fallback',async()=>{
  const r=capture('offscreen.js');
  assert.equal((await r.message({target:'offscreen',type:'start',streamId:'test',tabId:42})).ok,true);
  r.processors[0].onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array([.25])}});
  assert.equal(r.connections[0].audio.length,1);
  await r.message({target:'offscreen',type:'reset',tabId:42});assert.equal(r.connections[0].resetCalled,true);
  await r.message({target:'offscreen',type:'stop',tabId:42});assert.equal(r.connections[0].stopped,true);
});
test('reopening the popup does not replace a running video capture instance',async()=>{
  const r=capture('live.js');
  await r.context.window.YDS_LIVE.start({captureStream:()=>r.stream},{});
  const live=r.context.window.YDS_LIVE;
  vm.runInNewContext(fs.readFileSync('artifacts/happysubs-csod/live.js','utf8'),r.context);
  assert.equal(r.context.window.YDS_LIVE,live);
  live.stop();assert.equal(r.connections[0].stopped,true);
});
test('failed offscreen initialization releases tracks even before a current capture is assigned',async()=>{
  const r=capture('offscreen.js',{failProcessor:true});
  assert.equal((await r.message({target:'offscreen',type:'start',streamId:'test',tabId:42})).ok,false);
  assert.equal(r.tracksStopped,1);
});
test('offscreen stop acknowledgement waits for both audio contexts to close',async()=>{
  const releases=[],r=capture('offscreen.js',{close:()=>new Promise(resolve=>releases.push(resolve))});
  await r.message({target:'offscreen',type:'start',streamId:'test',tabId:42});
  let acknowledged=false;const pending=r.message({target:'offscreen',type:'stop',tabId:42}).then(()=>acknowledged=true);
  await new Promise(setImmediate);assert.equal(acknowledged,false);assert.equal(r.tracksStopped,1);
  releases.forEach(resolve=>resolve());await pending;assert.equal(acknowledged,true);
});
test('tab-audio ignores text from an older capture session',async()=>{
  const texts=[],r=capture('live.js',{response:{ok:true,sessionId:'current'}});
  await r.context.window.YDS_LIVE.start(null,{onText:text=>texts.push(text)},{tabAudio:true});
  r.dispatch({type:'YDS_TABCAP_EVENT',sessionId:'old',event:{kind:'text',text:'stale'}});
  r.dispatch({type:'YDS_TABCAP_EVENT',sessionId:'current',event:{kind:'text',text:'current'}});
  assert.deepEqual(texts,['current']);r.context.window.YDS_LIVE.stop();
});
test('real offscreen connector works with runtime messaging as its only Chrome API',async()=>{
  const messages=[],r=capture('offscreen.js',{realConnector:true,runtime:async message=>{
    messages.push(message);
    if(message.type==='YDS_SPEECH_CONFIG')return {mode:'cloud',keys:['test-key'],fallback:false,revision:1};
    return {ok:true};
  }});
  await r.message({target:'offscreen',type:'start',streamId:'test',tabId:42,frameId:7,sessionId:'test-session'});
  await new Promise(setImmediate);
  assert.equal(r.sockets.length,1);
  const ws=r.sockets[0];ws.readyState=1;ws.onopen();
  r.processors[0].onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array([.25])}});
  assert.equal(ws.sent[0].byteLength,2);
  ws.onmessage({data:JSON.stringify({type:'Results',is_final:true,channel:{alternatives:[{transcript:'Hello world.'}]}})});
  const event=messages.find(message=>message.event?.text==='Hello world.');
  assert.equal(event.frameId,7);assert.equal(event.sessionId,'test-session');
  assert.ok(messages.some(message=>message.type==='YDS_SPEECH_PUBLISH' && message.state.status==='listening'));
  await r.message({target:'offscreen',type:'stop',tabId:42});assert.equal(ws.readyState,3);
});
test('recognition status arriving before the start acknowledgement is retained',async()=>{
  const statuses=[];let r;
  r=capture('live.js',{runtime:async message=>{
    if(message.type==='YDS_TABCAP_START') {
      r.dispatch({type:'YDS_TABCAP_EVENT',sessionId:'current',event:{kind:'status',status:'unavailable',detail:'test unavailable'}});
      return {ok:true,sessionId:'current',state:{status:'connecting'}};
    }return {ok:true};
  }});
  await r.context.window.YDS_LIVE.start(null,{onStatus:status=>statuses.push(status)},{tabAudio:true});
  assert.equal(statuses.at(-1),'unavailable');r.context.window.YDS_LIVE.stop();
});
