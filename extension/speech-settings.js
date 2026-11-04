(() => {
  const fields=[],keyLabels=[],names={deepgram:'Deepgram',bailian:'百炼'};
  const drafts={deepgram:[],bailian:[]},banks={deepgram:[],bailian:[]},savedKeys={deepgram:[],bailian:[]};
  const labels={available:'可用',exhausted:'额度不足：请更新 Key 或补充额度',invalid:'Key 已失效或地域不匹配，请检查',forbidden:'权限不足或地域不匹配',rate_limited:'暂时限流，请稍后再试',connection_error:'实时连接失败，未确认余额',unknown:'连接异常，未确认余额',unavailable:'服务暂不可用'};
  const mode=document.getElementById('speechMode'),provider=document.getElementById('speechProvider'),fallback=document.getElementById('speechFallback');
  const status=document.getElementById('speechCurrentStatus'),saved=document.getElementById('speechSaveStatus');
  let shown='deepgram',loaded=false,checking=false;
  const normalize=keys=>[...new Set(keys.map(key=>key.trim()).filter(Boolean))].slice(0,5);
  function renderKeys(){keyLabels.forEach((label,index)=>label.textContent=fields[index].value?(fields[index].value.trim()===savedKeys[shown][index] && labels[banks[shown][index]?.status]||'未检查'):'未配置');}
  function capture(){drafts[shown]=fields.map(field=>field.value);}
  function renderProvider(){
    shown=provider.value;
    fields.forEach((field,index)=>{
      field.value=drafts[shown][index]||'';field.setAttribute('aria-label',`${names[shown]} Key ${index+1}`);
      document.getElementById('speechKeyTitle'+index).textContent=`${names[shown]} Key ${index+1}`;
    });
    document.getElementById('speechConsoleLink').href=shown==='bailian'?'https://bailian.console.aliyun.com/':'https://console.deepgram.com/';
    document.getElementById('speechProviderHint').textContent=shown==='bailian'?'请填写北京地域的百炼按量 Key（支持 sk-ws-）；用于英文课程实时识别。':'使用 Deepgram Nova-3 英文实时识别。';
    renderKeys();
  }
  for(let i=0;i<5;i++){
    const label=document.createElement('label');label.style.cssText='display:block;font-size:12px;margin:7px 0';
    const title=document.createElement('span');title.id='speechKeyTitle'+i;
    const input=document.createElement('input');input.type='password';input.autocomplete='off';input.spellcheck=false;
    input.placeholder=`可选：第 ${i+1} 个 Key`;input.style.cssText='display:block;width:100%;box-sizing:border-box;margin-top:4px';
    const state=document.createElement('span');state.style.cssText='display:block;font-size:11px;color:#a24d38;margin-top:2px';
    input.addEventListener('input',()=>state.textContent=input.value.trim()?'未检查':'未配置');
    label.appendChild(title);label.appendChild(input);label.appendChild(state);document.getElementById('speechKeys').appendChild(label);fields.push(input);keyLabels.push(state);
  }
  let liveInfo=null,lastSpeechState=null;
  function renderState(state){
    lastSpeechState=state;
    const info=liveInfo || (typeof probedInfo!=='undefined'?probedInfo:null);
    if(info) {
      if(!info.live?.active){status.textContent=info.live?.status==='unavailable'?(info.live.detail||'音频未连接，请重新开启听译'):'尚未开启语音识别';return;}
      status.textContent=info.live.detail || (typeof currentTabId!=='undefined' && state?.tabId===currentTabId?state.label:'') || (info.live.status==='listening'?'正在识别':'正在连接识别服务');return;
    }
    status.textContent='尚未开启语音识别';
  }
  window.addEventListener('yds-live-info',event=>{liveInfo=event.detail;renderState(lastSpeechState);});
  function cloudHint(config){
    const selected=config.provider==='bailian'?'bailian':'deepgram';
    window.ydsSpeechCloudEnabled=config.mode!=='local' && !!(selected==='bailian'?config.bailianKeys:config.keys)?.length;
    if(window.ydsSpeechCloudEnabled){
      document.getElementById('liveStartHint')?.setAttribute('hidden','');
      const hint=document.getElementById('liveStatus');if(hint)hint.textContent=`${names[selected]} 已配置，开启听译后直接连接云端。`;
    }
  }
  renderProvider();
  const saveButton=document.getElementById('speechSave'),checkButton=document.getElementById('speechCheckKeys');
  saveButton.disabled=true;checkButton.disabled=true;
  chrome.storage.local.get(['ydsSpeech','ydsSpeechStatus','ydsPlaybackRate','ydsSpeechKeyStates','ydsBailianKeyStates']).then(values=>{
    const config=values.ydsSpeech||{};
    mode.value=config.mode||'cloud';provider.value=config.provider==='bailian'?'bailian':'deepgram';fallback.checked=config.fallback!==false;
    drafts.deepgram=(config.keys||[]).slice(0,5);drafts.bailian=(config.bailianKeys||[]).slice(0,5);
    savedKeys.deepgram=[...drafts.deepgram];savedKeys.bailian=[...drafts.bailian];
    banks.deepgram=values.ydsSpeechKeyStates||[];banks.bailian=values.ydsBailianKeyStates||[];renderProvider();
    saved.textContent=`已保存 Deepgram ${drafts.deepgram.length} 个、百炼 ${drafts.bailian.length} 个 Key。`;
    cloudHint(config);renderState(values.ydsSpeechStatus);
    document.getElementById('speechPlaybackRate').value=String(values.ydsPlaybackRate||1);
    loaded=true;saveButton.disabled=false;checkButton.disabled=false;
  }).catch(()=>saved.textContent='读取设置失败，请重新打开插件。');
  provider.addEventListener('change',()=>{capture();renderProvider();saved.textContent='已切换配置列表。点击保存后，关闭再开启实时听译生效。';});
  saveButton.addEventListener('click',async()=>{
    if(!loaded || checking)return;capture();
    try{
      const values=await chrome.storage.local.get(['ydsSpeech','ydsSpeechKeyStates','ydsBailianKeyStates']);
      const keys=normalize(drafts.deepgram),bailianKeys=normalize(drafts.bailian);
      const dgSame=JSON.stringify(keys)===JSON.stringify(values.ydsSpeech?.keys||[]);
      const aliSame=JSON.stringify(bailianKeys)===JSON.stringify(values.ydsSpeech?.bailianKeys||[]);
      const config={...values.ydsSpeech,mode:mode.value,provider:provider.value,keys,bailianKeys,fallback:fallback.checked,
        index:dgSame?values.ydsSpeech?.index||0:0,bailianIndex:aliSame?values.ydsSpeech?.bailianIndex||0:0,revision:Date.now()};
      banks.deepgram=dgSame?values.ydsSpeechKeyStates||[]:[];banks.bailian=aliSame?values.ydsBailianKeyStates||[]:[];
      await chrome.storage.local.set({ydsSpeech:config,ydsSpeechKeyStates:banks.deepgram,ydsBailianKeyStates:banks.bailian});
      savedKeys.deepgram=[...keys];savedKeys.bailian=[...bailianKeys];
      drafts.deepgram=keys;drafts.bailian=bailianKeys;renderProvider();cloudHint(config);
      saved.textContent=`已保存，当前选择${names[provider.value]}。请关闭再开启实时听译，使设置生效。`;
    }catch{saved.textContent='保存失败，请重试。';}
  });
  checkButton.addEventListener('click',async()=>{
    if(!loaded)return;checking=true;checkButton.disabled=true;saveButton.disabled=true;
    const selected=provider.value;
    try{
      const {ydsSpeech:config}=await chrome.storage.local.get('ydsSpeech');
      const keys=(selected==='bailian'?config?.bailianKeys:config?.keys)||[];
      if(!keys.length)throw new Error('请先填写并保存 Key');
      const states=[];
      for(let index=0;index<keys.length;index++){
        saved.textContent=`正在检查${names[selected]} Key ${index+1}…`;
        const result=await chrome.runtime.sendMessage({type:'YDS_SPEECH_CHECK_KEY',provider:selected,key:keys[index]});
        states[index]={status:result?.status||'unknown',updatedAt:Date.now()};
      }
      const current=(await chrome.storage.local.get('ydsSpeech')).ydsSpeech;
      if(current?.revision!==config.revision)throw new Error('设置已更改，请重新检查');
      await chrome.storage.local.set({[selected==='bailian'?'ydsBailianKeyStates':'ydsSpeechKeyStates']:states});
      banks[selected]=states;renderKeys();saved.textContent=`${names[selected]}检查完成。`;
    }catch(error){saved.textContent=error.message;}finally{checking=false;checkButton.disabled=false;saveButton.disabled=false;}
  });
  document.getElementById('speechPlaybackRate').addEventListener('change',async event=>{
    const output=document.getElementById('speechRateStatus');
    try{
      const rate=Number(event.target.value);
      if(typeof getActiveSupportedTab!=='function'){output.textContent='调速将在课件里的实际插件中生效。';return;}
      const tab=await getActiveSupportedTab();if(!tab)throw new Error('当前页面尚未检测到视频');
      const result=await sendContent(tab.id,{type:'YDS_SET_PLAYBACK_RATE',rate});
      if(!result?.ok)throw new Error(result?.error||'调速失败');
      await chrome.storage.local.set({ydsPlaybackRate:result.rate});output.textContent=`已设置为 ${result.rate}×`;
    }catch(error){output.textContent=error.message;}
  });
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=='local')return;
    if(changes.ydsSpeechStatus)renderState(changes.ydsSpeechStatus.newValue);
    if(changes.ydsSpeechKeyStates)banks.deepgram=changes.ydsSpeechKeyStates.newValue||[];
    if(changes.ydsBailianKeyStates)banks.bailian=changes.ydsBailianKeyStates.newValue||[];
    renderKeys();
  });
})();
