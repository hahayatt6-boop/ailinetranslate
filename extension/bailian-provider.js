// Paraformer protocol shared by live recognition and the key diagnostic.
(() => {
  const endpoint='wss://dashscope.aliyuncs.com/api-ws/v1/inference';
  function runTask(taskId) {
    return {header:{action:'run-task',task_id:taskId,streaming:'duplex'},payload:{
      task_group:'audio',task:'asr',function:'recognition',model:'paraformer-realtime-v2',
      parameters:{format:'pcm',sample_rate:16000,language_hints:['en'],max_sentence_silence:400,
        semantic_punctuation_enabled:false,punctuation_prediction_enabled:true},input:{}}};
  }
  function errorStatus(code='',message='') {
    if(/Arrearage|FreeTierOnly|InsufficientBalance|OutOfCredit|OUT_OF_SERVICE/i.test(code))return 'exhausted';
    if(/InvalidApiKey|InvalidToken|Unauthorized|Authentication/i.test(code))return 'invalid';
    if(/Throttl|TooManyRequests|RateLimit/i.test(code))return 'rate_limited';
    if(/Forbidden|AccessDenied|NotAuthori[sz]ed|ModelNotFound/i.test(code))return 'forbidden';
    if(/free allocated quota exceeded|insufficient balance|account is in good standing/i.test(message))return 'exhausted';
    return 'unavailable';
  }
  async function prepare(key) {
    const result=await chrome.runtime.sendMessage({type:'YDS_BAILIAN_PREPARE',key});
    if(!result?.url)throw new Error('百炼连接准备失败，请重新加载插件');
    return {url:result.url,release:()=>chrome.runtime.sendMessage({type:'YDS_BAILIAN_RELEASE',ruleId:result.ruleId}).catch(()=>{})};
  }
  // Native browser WebSocket cannot set Authorization. A short-lived, exact-URL
  // session rule adds it to this handshake only; no local bridge is required.
  let queue=Promise.resolve(),nextRuleId=810000;
  function authorize(key,api=chrome.declarativeNetRequest) {
    const operation=queue.then(async()=>{
      if(typeof key!=='string' || !key.trim() || /[\r\n]/.test(key))throw new Error('Invalid key');
      const existing=await api.getSessionRules();
      const ruleId=Math.max(nextRuleId,...existing.map(rule=>rule.id))+1;nextRuleId=ruleId;
      const url=endpoint+'?happysubs_session='+crypto.randomUUID();
      await api.updateSessionRules({addRules:[{id:ruleId,priority:1,
        action:{type:'modifyHeaders',requestHeaders:[{header:'Authorization',operation:'set',value:'Bearer '+key.trim()}]},
        condition:{urlFilter:'|'+url+'|',resourceTypes:['websocket']}}],removeRuleIds:[]});
      // Expiry also handles a tab closing before its pending handshake resolves.
      const expiry=globalThis.setTimeout(()=>api.updateSessionRules({removeRuleIds:[ruleId]}).catch(()=>{}),30000);
      expiry.unref?.();
      return {url,ruleId};
    });
    queue=operation.catch(()=>{});return operation;
  }
  async function checkKey(key,options={}) {
    let auth,ws,timer;
    try {
      auth=await (options.authorize||authorize)(key);
      return await new Promise(resolve=>{
        let finished=false;const taskId=crypto.randomUUID();
        const done=result=>{if(finished)return;finished=true;resolve(result);};
        timer=globalThis.setTimeout(()=>done({status:'unknown'}),12000);
        ws=(options.wsFactory||((url)=>new WebSocket(url)))(auth.url);
        ws.onopen=()=>ws.send(JSON.stringify(runTask(taskId)));
        ws.onmessage=event=>{
          let msg;try{msg=JSON.parse(event.data);}catch{return;}
          if(msg.header?.event==='task-started') {
            ws.send(new ArrayBuffer(3200));
            ws.send(JSON.stringify({header:{action:'finish-task',task_id:taskId,streaming:'duplex'},payload:{input:{}}}));
          }else if(msg.header?.event==='task-finished')done({status:'available'});
          else if(msg.header?.event==='task-failed')done({status:errorStatus(msg.header.error_code,msg.header.error_message)});
        };
        ws.onclose=()=>done({status:'unknown'});ws.onerror=()=>done({status:'unknown'});
      });
    }catch{return {status:'unknown'};}
    finally {
      globalThis.clearTimeout(timer);ws?.close();
      if(auth)await Promise.resolve((options.release||((ruleId)=>chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[ruleId]})))(auth.ruleId)).catch(()=>{});
    }
  }
  const api={endpoint,runTask,errorStatus,prepare,authorize,checkKey};
  if(typeof module!=='undefined' && module.exports)module.exports=api;
  else globalThis.HappyBailian=api;
})();
