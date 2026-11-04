const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function setup(info) {
  const source=fs.readFileSync('extension/speech-settings.js','utf8');
  const section=source.slice(source.indexOf('  let liveInfo='),source.indexOf('  function cloudHint('));
  const status={textContent:''},events={};
  const context={status,probedInfo:info,currentTabId:42,window:{addEventListener:(name,fn)=>events[name]=fn}};
  vm.createContext(context);vm.runInContext(section,context);return {context,status,events};
}
test('a stopped page never displays an old connected status from storage',()=>{
  const r=setup({live:{active:false,status:'stopped'}});
  r.context.renderState({status:'listening',label:'Deepgram Key 2 已连接',tabId:42});
  assert.equal(r.status.textContent,'尚未开启语音识别');
});
test('a capture failure takes precedence over a stale cloud connection',()=>{
  const r=setup({live:{active:false,status:'unavailable',detail:'音频捕获失败'}});
  r.context.renderState({status:'listening',label:'Deepgram 已连接',tabId:42});assert.equal(r.status.textContent,'音频捕获失败');
});
test('another tabs cloud status is ignored and live page updates refresh the label',()=>{
  const r=setup({live:{active:true,status:'connecting'}});
  r.context.renderState({label:'Deepgram 已连接',tabId:99});assert.equal(r.status.textContent,'正在连接识别服务');
  r.events['yds-live-info']({detail:{live:{active:true,status:'listening',detail:'百炼 Key 1 已连接'}}});
  assert.equal(r.status.textContent,'百炼 Key 1 已连接');
});
