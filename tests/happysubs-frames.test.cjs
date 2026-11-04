const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=process.env.HAPPYSUBS_TEST_DIR || path.resolve(__dirname,'../artifacts/happysubs-csod');
const source=fs.readFileSync(path.join(root,'popup.js'),'utf8');
function section(start,end){return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));}
function setup(){
  const calls=[];
  const tab={id:42,url:'https://ready.csod.com/lms/scorm/clientLMS/Scorm12IframeContainer.aspx'};
  const context={activeTabId:null,activeFrameId:null,activeTabUrl:'',currentTabId:null,probedInfo:null,
    SUPPORTED_URL:/^https?:\/\/www\.youtube\.com\//, noteSiteAccess:async()=>{},noteVideoInfo:()=>{},
    chrome:{runtime:{},tabs:{query:async()=>[tab],sendMessage(...args){
      calls.push({kind:'message',args}); const cb=args.at(-1);
      cb(args[2]?.frameId===4?{videoId:'course-video',platform:'generic'}:null);
    }},scripting:{async executeScript(options){calls.push({kind:'script',options});
      if(options.files)return [];
      return options.target.allFrames ? [{frameId:0,result:{hasVideo:false}},{frameId:4,result:{hasVideo:true,score:10000}},{frameId:5,result:{hasVideo:false}}] : [{frameId:0,result:{hasVideo:false}}];
    },async insertCSS(options){calls.push({kind:'css',options});}}}};
  vm.createContext(context);
  vm.runInContext([
    section('async function getActiveSupportedTab()', '// Sites that work better'),
    section('async function injectGeneric(tab)', '// The content script reports'),
    section('async function askContent(tabId)', '// Every answer from the page'),
    section('async function sendContent(tabId, msg)', 'function populateLanguages(info)')
  ].join('\n'),context);
  return {context,calls};
}
test('CSOD locates its iframe video and routes start and stop into that frame',async()=>{
  const {context:c,calls}=setup();
  const tab=await c.getActiveSupportedTab();
  assert.equal(tab?.id,42);
  c.activeTabId=42;
  await c.sendContent(42,{type:'YDS_LIVE_START'});
  await c.sendContent(42,{type:'YDS_LIVE_STOP'});
  const css=calls.find(call=>call.kind==='css');
  assert.deepEqual(Array.from(css.options.target.frameIds),[4]);
  for(const call of calls.filter(call=>call.kind==='message'))assert.equal(call.args[2].frameId,4);
});
test('supported top-level players retain their existing routing',async()=>{
  const {context:c,calls}=setup();
  c.chrome.tabs.query=async()=>[{id:43,url:'https://www.youtube.com/watch?v=test'}];
  assert.equal((await c.getActiveSupportedTab()).id,43);
  assert.equal(calls.length,0);
});
