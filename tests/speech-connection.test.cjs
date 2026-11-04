const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {SpeechConnection}=require('../extension/speech-connection.js');
function setup(config){
  const sockets=[],timers=new Map(),texts=[],states=[];let id=0;
  const connection=new SpeechConnection({config,loadConfig:async()=>config,persistIndex:async()=>{},publish:s=>states.push(s),
    onText:(text,final)=>texts.push({text,final}),
    wsFactory:(url,protocols)=>{const ws={url,protocols,readyState:0,bufferedAmount:0,sent:[],send(data){this.sent.push(data);},close(){this.readyState=3;}};sockets.push(ws);return ws;},
    schedule:fn=>{timers.set(++id,fn);return id;},cancel:token=>timers.delete(token)});
  return {connection,sockets,texts,states,timers,
    tick(){const entry=timers.entries().next().value;assert.ok(entry);timers.delete(entry[0]);entry[1]();},
    fail(){const ws=sockets.at(-1);ws.readyState=3;ws.onclose({code:1006,reason:''});}};
}
test('cloud uses user keys in order, then falls back to local',async()=>{
  const r=setup({mode:'cloud',keys:['first','second'],fallback:true});await r.connection.start();
  assert.deepEqual(r.sockets[0].protocols,['token','first']);
  r.fail();r.tick();assert.equal(r.sockets.length,2); // retry same key
  r.fail();r.tick();assert.deepEqual(r.sockets.at(-1).protocols,['token','second']);
  r.fail();r.tick();r.fail();
  assert.equal(r.sockets.at(-1).url,'ws://127.0.0.1:8765');
  r.connection.stop();
});
test('disabled fallback never connects to local after all keys fail',async()=>{
  const r=setup({mode:'cloud',keys:['only'],fallback:false});await r.connection.start();
  r.fail();r.tick();r.fail();
  assert.equal(r.sockets.length,2);assert.equal(r.timers.size,0);
  assert.match(r.states.at(-1).label,/本地回退未开启/);
});
test('stop cancels retry and ignores late cloud results',async()=>{
  const r=setup({mode:'cloud',keys:['one'],fallback:true});await r.connection.start();
  const old=r.sockets[0];r.fail();r.connection.stop();
  old.onmessage({data:JSON.stringify({type:'Results',is_final:true,channel:{alternatives:[{transcript:'late'}]}})});
  assert.equal(r.timers.size,0);assert.equal(r.texts.length,0);
});
test('cloud stable segments are forwarded once while partials stay live',async()=>{
  const r=setup({mode:'cloud',keys:['one'],fallback:true});await r.connection.start();const ws=r.sockets[0];
  const event={type:'Results',start:0,duration:1,is_final:false,channel:{alternatives:[{transcript:'Hello'}]}};
  ws.onmessage({data:JSON.stringify(event)});event.is_final=true;
  ws.onmessage({data:JSON.stringify(event)});ws.onmessage({data:JSON.stringify(event)});
  assert.deepEqual(r.texts,[{text:'Hello',final:false},{text:'Hello',final:true}]);r.connection.stop();
});
test('seek closes old cloud stream and prevents stale words',async()=>{
  const r=setup({mode:'cloud',keys:['one'],fallback:true});await r.connection.start();const old=r.sockets[0];
  r.connection.reset();assert.equal(old.readyState,3);assert.equal(r.sockets.length,2);
  old.onmessage({data:JSON.stringify({type:'Results',is_final:true,channel:{alternatives:[{transcript:'old position'}]}})});
  assert.equal(r.texts.length,0);r.connection.stop();
});
test('local mode works without any cloud key',async()=>{
  const r=setup({mode:'local',keys:[],fallback:false});await r.connection.start();
  assert.equal(r.sockets[0].url,'ws://127.0.0.1:8765');r.connection.stop();
});
test('a stalled handshake times out and can advance to the next key',async()=>{
  const r=setup({mode:'cloud',keys:['slow','next'],fallback:false});await r.connection.start();
  r.tick();r.tick();r.tick();r.tick();
  assert.deepEqual(r.sockets.at(-1).protocols,['token','next']);r.connection.stop();
});
test('only the first five distinct nonempty keys can be used',async()=>{
  const r=setup({mode:'cloud',keys:['','one','one','two','three','four','five','six'],fallback:false});
  await r.connection.start();assert.deepEqual(r.connection.keys,['one','two','three','four','five']);r.connection.stop();
});
test('stop during settings load prevents a delayed connection',async()=>{
  let resolve;const r=setup(undefined);r.connection.options.loadConfig=()=>new Promise(done=>resolve=done);
  const start=r.connection.start();r.connection.stop();resolve({mode:'cloud',keys:['one']});await start;
  assert.equal(r.sockets.length,0);
});
test('default browser timers are called on the browser global, not the connector',async()=>{
  const result=vm.runInNewContext(`
    globalThis.setTimeout=function(){if(this!==globalThis)throw new TypeError('Illegal invocation');return 1;};
    globalThis.clearTimeout=function(){if(this!==globalThis)throw new TypeError('Illegal invocation');};
    ${fs.readFileSync('extension/speech-connection.js','utf8')}
    const connection=new module.exports.SpeechConnection({config:{mode:'local'},publish(){},wsFactory(){return {readyState:0,close(){}};}});
    connection.start().then(()=>connection.stop());
  `,{module:{exports:{}}});
  await result;
});
test('explicit exhausted credit is recorded and the next key is selected',async()=>{
  const r=setup({mode:'cloud',keys:['empty','next'],fallback:true}),records=[];
  r.connection.options.diagnose=async()=>({status:'exhausted'});
  r.connection.options.onKeyState=(index,state)=>records.push({index,...state});
  await r.connection.start();r.fail();r.tick();r.fail();await new Promise(setImmediate);r.tick();
  assert.equal(records[0].status,'exhausted');assert.equal(records[0].index,0);
  assert.deepEqual(r.sockets.at(-1).protocols,['token','next']);r.connection.stop();
});
test('working cloud audio never contacts local recognition',async()=>{
  const r=setup({mode:'cloud',keys:['valid'],fallback:true});await r.connection.start();
  const ws=r.sockets[0];ws.readyState=1;ws.onopen();r.connection.sendAudio(new ArrayBuffer(8));
  assert.equal(ws.sent.length,1);assert.ok(r.sockets.every(socket=>socket.url.startsWith('wss://api.deepgram.com/')));r.connection.stop();
});
test('previously exhausted keys are skipped on the next start',async()=>{
  const r=setup({mode:'cloud',keys:['empty','good'],keyStates:[{status:'exhausted'}],fallback:true});await r.connection.start();
  assert.deepEqual(r.sockets[0].protocols,['token','good']);r.connection.stop();
});
