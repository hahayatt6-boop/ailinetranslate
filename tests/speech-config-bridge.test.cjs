const {test}=require('node:test'),assert=require('node:assert/strict');
const {SpeechConfigBridge}=require('../extension/speech-config-bridge.js');
function setup(){
  const data={ydsSpeech:{provider:'bailian',revision:4,keys:['deepgram-test'],bailianKeys:['bailian-test']},ydsSpeechKeyStates:[{status:'available'}]};
  const bridge=new SpeechConfigBridge({storage:{local:{get:async()=>structuredClone(data),set:async values=>Object.assign(data,values)}}});
  return {bridge,data};
}
test('offscreen config contains both provider banks and their diagnostics',async()=>{
  const r=setup(),config=await r.bridge.handle({type:'YDS_SPEECH_CONFIG'});
  assert.deepEqual(config.keys,['deepgram-test']);assert.deepEqual(config.bailianKeys,['bailian-test']);
  assert.equal(config.keyStates[0].status,'available');assert.deepEqual(config.bailianKeyStates,[]);
});
test('offscreen key rotation and labels update only their own provider',async()=>{
  const r=setup();await r.bridge.handle({type:'YDS_SPEECH_INDEX',provider:'bailian',revision:4,index:1});
  await r.bridge.handle({type:'YDS_SPEECH_KEY_STATE',provider:'bailian',revision:4,index:0,state:{status:'exhausted'}});
  assert.equal(r.data.ydsSpeech.bailianIndex,1);assert.equal(r.data.ydsBailianKeyStates[0].status,'exhausted');
  assert.equal(r.data.ydsSpeechKeyStates[0].status,'available');
  await r.bridge.handle({type:'YDS_SPEECH_PUBLISH',state:{status:'listening',tabId:42}});
  assert.equal(r.data.ydsSpeechStatus.tabId,42);
});
test('late messages from a replaced configuration cannot overwrite current keys',async()=>{
  const r=setup();const result=await r.bridge.handle({type:'YDS_SPEECH_INDEX',provider:'bailian',revision:3,index:2});
  assert.equal(result.ok,false);assert.equal(r.data.ydsSpeech.bailianIndex,undefined);
});
