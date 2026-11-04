const {test}=require('node:test');
const assert=require('node:assert/strict');
const Bailian=require('../extension/bailian-provider.js');
test('Bailian billing, invalid key, permissions and rate errors remain distinct',()=>{
  for(const [code,status] of [['Arrearage','exhausted'],['AllocationQuota.FreeTierOnly','exhausted'],['InvalidApiKey','invalid'],['Forbidden','forbidden'],['Throttling.RateQuota','rate_limited'],['InvalidParameter','unavailable']])
    assert.equal(Bailian.errorStatus(code),status);
});
test('browser authorization rules match one unique handshake and do not put the key in the URL',async()=>{
  const changes=[];const api={getSessionRules:async()=>[],updateSessionRules:async change=>changes.push(change)};
  const one=await Bailian.authorize('test-key',api),two=await Bailian.authorize('different-key',api);
  assert.notEqual(one.ruleId,two.ruleId);assert.notEqual(one.url,two.url);
  assert.equal(new URL(one.url).hostname,'dashscope.aliyuncs.com');assert.ok(!one.url.includes('test-key'));
  const rule=changes[0].addRules[0];assert.equal(rule.condition.urlFilter,'|'+one.url+'|');
  assert.deepEqual(rule.condition.resourceTypes,['websocket']);assert.equal(rule.action.requestHeaders[0].value,'Bearer test-key');
});
test('key diagnostic confirms an actual completed ASR task and releases authorization',async()=>{
  let socket,removed;const pending=Bailian.checkKey('test',{
    authorize:async()=>({url:'wss://dashscope.aliyuncs.com/test',ruleId:99}),release:async id=>removed=id,
    wsFactory:()=>socket={sent:[],send(data){this.sent.push(data);},close(){}}});
  await new Promise(setImmediate);socket.onopen();
  socket.onmessage({data:JSON.stringify({header:{event:'task-started'}})});
  assert.equal(socket.sent[1].byteLength,3200);assert.equal(JSON.parse(socket.sent[2]).header.action,'finish-task');
  socket.onmessage({data:JSON.stringify({header:{event:'task-finished'}})});
  assert.deepEqual(await pending,{status:'available'});assert.equal(removed,99);
});
test('key diagnostic records explicit billing errors and treats transport failures as unknown',async()=>{
  for(const [message,status] of [[{event:'task-failed',error_code:'Arrearage'},'exhausted'],[null,'unknown']]){
    let socket;const pending=Bailian.checkKey('test',{authorize:async()=>({url:'wss://dashscope.aliyuncs.com/test',ruleId:1}),release:async()=>{},
      wsFactory:()=>socket={send(){},close(){}}});
    await new Promise(setImmediate);
    if(message)socket.onmessage({data:JSON.stringify({header:message})});else socket.onerror();
    assert.equal((await pending).status,status);
  }
});
