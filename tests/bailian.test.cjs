const {test}=require('node:test');
const assert=require('node:assert/strict');
const {SpeechConnection}=require('../extension/speech-connection.js');
const flush=()=>new Promise(setImmediate);
function setup(extra={}) {
  const sockets=[],timers=new Map(),texts=[],states=[],records=[],released=[];let serial=0;
  const connection=new SpeechConnection({config:{mode:'cloud',provider:'bailian',keys:['deepgram-key'],bailianKeys:['ali-one','ali-two'],fallback:false,...extra},
    publish:state=>states.push(state),persistIndex(){},onKeyState:(index,state)=>records.push({index,...state}),
    onText:(text,final)=>texts.push({text,final}),
    prepareBailian:async key=>({url:'wss://dashscope.aliyuncs.com/test-'+key,release:()=>released.push(key)}),
    wsFactory:(url,protocols)=>{const ws={url,protocols,readyState:0,bufferedAmount:0,sent:[],send(data){this.sent.push(data);},close(){this.readyState=3;}};sockets.push(ws);return ws;},
    schedule:fn=>{timers.set(++serial,fn);return serial;},cancel:token=>timers.delete(token)});
  return {connection,sockets,timers,texts,states,records,released,
    tick(){const [id,fn]=timers.entries().next().value;timers.delete(id);fn();},
    event(event,payload={}){const ws=sockets.at(-1);ws.onmessage({data:JSON.stringify({header:{event,task_id:connection.taskId},payload})});},
    open(){const ws=sockets.at(-1);ws.readyState=1;ws.onopen();}};
}
test('Bailian selects its own keys, starts the task and waits before sending audio',async()=>{
  const r=setup();await r.connection.start();await flush();
  assert.match(r.sockets[0].url,/ali-one/);assert.equal(r.sockets[0].protocols,undefined);
  r.open();const task=JSON.parse(r.sockets[0].sent[0]);
  assert.equal(task.header.action,'run-task');assert.equal(task.payload.model,'paraformer-realtime-v2');
  assert.equal(task.payload.parameters.sample_rate,16000);
  const audio=new ArrayBuffer(3200);r.connection.sendAudio(audio);
  assert.equal(r.sockets[0].sent.length,1);
  r.event('task-started');assert.equal(r.sockets[0].sent[1],audio);
  assert.equal(r.states.at(-1).provider,'bailian');assert.equal(r.states.at(-1).status,'listening');
  r.connection.stop();assert.deepEqual(r.released,['ali-one']);
});
test('Bailian partials and final sentences are forwarded, final duplicates ignored',async()=>{
  const r=setup();await r.connection.start();await flush();r.open();r.event('task-started');
  const sentence={begin_time:0,end_time:900,text:'Hello world.',sentence_end:false};
  r.event('result-generated',{output:{sentence}});sentence.sentence_end=true;
  r.event('result-generated',{output:{sentence}});r.event('result-generated',{output:{sentence}});
  assert.deepEqual(r.texts,[{text:'Hello world.',final:false},{text:'Hello world.',final:true}]);r.connection.stop();
});
test('Bailian explicit quota error marks only that key and advances without local',async()=>{
  const r=setup();await r.connection.start();await flush();r.open();
  const ws=r.sockets[0];ws.onmessage({data:JSON.stringify({header:{event:'task-failed',error_code:'AllocationQuota.FreeTierOnly'}})});
  assert.equal(r.records.at(-1).status,'exhausted');r.tick();await flush();
  assert.match(r.sockets.at(-1).url,/ali-two/);assert.equal(r.sockets.length,2);r.connection.stop();
});
test('Bailian task-start timeout closes an already open socket',async()=>{
  const r=setup();await r.connection.start();await flush();r.open();r.tick();
  assert.equal(r.sockets[0].readyState,3);assert.equal(r.states.at(-1).status,'connecting');r.connection.stop();
});
test('stop during Bailian authorization releases the rule and never opens a socket',async()=>{
  const r=setup();let resolve;r.connection.options.prepareBailian=()=>new Promise(done=>resolve=done);
  const start=r.connection.start();await flush();r.connection.stop();
  resolve({url:'wss://dashscope.aliyuncs.com/test',release:()=>r.released.push('pending')});await start;await flush();
  assert.equal(r.sockets.length,0);assert.deepEqual(r.released,['pending']);
});
test('Bailian status bank is independent and exhausted keys are skipped',async()=>{
  const r=setup({keyStates:[{status:'invalid'}],bailianKeyStates:[{status:'exhausted'}]});await r.connection.start();await flush();
  assert.match(r.sockets[0].url,/ali-two/);r.connection.stop();
});
