const {test}=require('node:test');
const assert=require('node:assert/strict');
const {checkKey}=require('../extension/key-diagnostics.js');
test('402 is shown as exhausted, while 401 and 429 stay distinct',async()=>{
  for(const [http,status] of [[402,'exhausted'],[401,'invalid'],[403,'forbidden'],[429,'rate_limited'],[503,'unavailable'],[200,'available']]){
    const result=await checkKey('test',async()=>({status:http,ok:http===200}));
    assert.equal(result.status,status);
  }
});
test('network failure is never labeled as exhausted credit',async()=>{
  const result=await checkKey('test',async()=>{throw new Error('offline');});
  assert.equal(result.status,'unknown');
});
