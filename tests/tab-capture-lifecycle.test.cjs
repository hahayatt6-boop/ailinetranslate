const {test}=require('node:test'),assert=require('node:assert/strict');
const {TabCaptureController}=require('../extension/tab-capture-controller.js');
function setup({activeTab=null,failStart=false}={}) {
  const calls=[];let active=activeTab,owner=activeTab?{tabId:activeTab,frameId:4}:null;
  const api={runtime:{getURL:()=> 'chrome-extension://test/offscreen.html',getContexts:async()=>[{}],
    async sendMessage(message){calls.push(message.type);
      if(message.type==='status')return owner?{running:true,...owner}:{running:false};
      if(message.type==='stop'){if(!message.tabId || owner?.tabId===message.tabId){active=null;owner=null;}return {ok:true};}
      if(message.type==='start'){if(failStart)throw new Error('offscreen-start-failed');active=message.tabId;owner=message;return {ok:true,sessionId:message.sessionId};}
    }},offscreen:{createDocument:async()=>{},closeDocument:async()=>{active=null;owner=null;}},
    tabCapture:{getCapturedTabs:async()=>active?[{tabId:active,status:'active'}]:[],async getMediaStreamId({targetTabId}){calls.push('stream-id');if(active)throw new Error('Cannot capture a tab with an active stream.');return 'stream-'+targetTabId;}}};
  const controller=new TabCaptureController(api,{wait:async()=>{}});
  return {controller,calls,api,get active(){return active;}};
}
test('service worker restart recovers an existing offscreen stream before requesting a new ID',async()=>{
  const r=setup({activeTab:42});const result=await r.controller.start(42,4);
  assert.equal(result.ok,true);assert.ok(r.calls.indexOf('stop')<r.calls.indexOf('stream-id'));assert.equal(r.active,42);
});
test('simultaneous start requests from the same frame share one capture',async()=>{
  const r=setup();const results=await Promise.all([r.controller.start(42,4),r.controller.start(42,4)]);
  assert.equal(results[0].sessionId,results[1].sessionId);assert.equal(r.calls.filter(call=>call==='stream-id').length,1);
});
test('capture initialization failure clears the reserved stream',async()=>{
  const r=setup({failStart:true});await assert.rejects(r.controller.start(42,4),/offscreen-start-failed/);
  assert.equal(r.calls.at(-1),'stop');assert.equal(r.active,null);
});
test('a late stop from another tab does not stop the current capture',async()=>{
  const r=setup();await r.controller.start(42,4);await r.controller.stop(99);assert.equal(r.active,42);
  await r.controller.stop(42);assert.equal(r.active,null);
});
test('stop waits for an in-progress start and releases it',async()=>{
  const r=setup();const start=r.controller.start(42,4),stop=r.controller.stop(42);
  await start;await stop;assert.equal(r.active,null);
});
test('offscreen text is routed to the actual course iframe',()=>{
  const fs=require('node:fs'),vm=require('node:vm'),listeners=[],sent=[];
  vm.runInNewContext(fs.readFileSync('extension/tab-capture-controller.js','utf8'),{chrome:{
    runtime:{onMessage:{addListener:fn=>listeners.push(fn)}},
    tabs:{onRemoved:{addListener(){}},onUpdated:{addListener(){}},sendMessage:(...args)=>sent.push(args)}}});
  listeners[0]({type:'YDS_TABCAP_EVENT',tabId:42,frameId:4,event:{kind:'text',text:'hello'}},{},()=>{});
  assert.equal(sent[0][0],42);assert.equal(sent[0][2].frameId,4);
});
