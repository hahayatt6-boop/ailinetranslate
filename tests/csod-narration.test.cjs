const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function setup(host='ready.csod.com') {
  const events=[],button={getAttribute:()=>paused?'true':'false'},progress={value:'12300',max:'30000'};
  let paused=false;const slide={getBoundingClientRect:()=>({left:38,top:65,width:649,height:487}),querySelector:()=>null};
  const frame={getBoundingClientRect:()=>({width:725,height:617})};
  const document={querySelector:sel=>({'#frame':frame,'#slide':slide,'#play-pause':button,'input[aria-label="slide progress"]':progress})[sel]||null,
    dispatchEvent:event=>events.push(event.type)};
  const window={},context={window,document,location:{hostname:host},Event:class{constructor(type){this.type=type;}},module:{exports:{}}};
  vm.runInNewContext(fs.readFileSync('extension/csod-media.js','utf8'),context);
  return {api:context.module.exports,events,setPaused:value=>paused=value};
}
test('Storyline narration exposes its real pause and timeline state without pretending to capture video',()=>{
  const r=setup(),media=r.api.getMedia();assert.ok(media);
  assert.equal(media.paused,false);assert.equal(media.currentTime,12.3);assert.equal(media.duration,30);
  assert.equal(typeof media.captureStream,'undefined');assert.equal(media.getBoundingClientRect().width,649);
  r.setPaused(true);assert.equal(media.paused,true);r.api.poll();assert.deepEqual(r.events,['yds-course-pause']);
  r.setPaused(false);r.api.poll();assert.deepEqual(r.events,['yds-course-pause','yds-course-play']);
  assert.throws(()=>media.playbackRate=1.5,/speed/);
});
test('narration adapter is restricted to CSOD Storyline pages',()=>{
  assert.equal(setup('example.com').api.getMedia(),null);
});
test('built popup recognizes audio-only Storyline frames before script injection',()=>{
  const source=fs.readFileSync('artifacts/happysubs-csod/popup.js','utf8');
  const start=source.indexOf('      func: () => {',source.indexOf('async function injectGeneric'));
  const end=source.indexOf('\n      }\n    });',start);
  const body=source.slice(start+'      func: () => {'.length,end);
  const result=vm.runInNewContext('(function(){'+body+'})()',{
    location:{hostname:'ready.csod.com'},window:{},
    document:{querySelector:sel=>sel.includes('#slide')||sel==='#play-pause'?{}:null,querySelectorAll:()=>[]}});
  assert.equal(result.hasVideo,true);
});
test('narration start requests tab audio and the authorized retry reaches the capture layer',async()=>{
  const source=fs.readFileSync('artifacts/happysubs-csod/content.js','utf8');
  const fn=source.slice(source.indexOf('  async function startLive(opts) {'),source.indexOf('  function stopLive() {'));
  let received;
  const context={P:{getVideoEl:()=>({tabAudioOnly:true})},live:{active:false,gen:0},applyOverlayStyles(){},liveOnText(){},liveOnStatus(){},
    window:{YDS_LIVE:{async start(video,handlers,opts){received={video,opts};return {ok:true};}}}};
  vm.createContext(context);vm.runInContext(fn,context);
  assert.equal((await context.startLive()).error,'capture-failed');assert.equal(received,undefined);
  assert.equal((await context.startLive({tabAudio:true})).ok,true);
  assert.equal(received.video.tabAudioOnly,true);assert.equal(received.opts.tabAudio,true);
});
test('first tab-audio permission never navigates away from a CSOD course',async()=>{
  const source=fs.readFileSync('artifacts/happysubs-csod/popup.js','utf8');
  const fn=source.slice(source.indexOf('async function reloadForTabCapture('),source.indexOf('async function startLiveFromTabAudio()'));
  const navigations=[];const context={activeTabId:42,activeTabUrl:'https://ready.csod.com/lms/scorm/clientLMS/Scorm12IframeContainer.aspx',
    chrome:{storage:{session:{get:async()=>({}),set:async()=>{}}},tabs:{get:async()=>({url:'https://ready.csod.com/course'}),update:async(...args)=>navigations.push(args)}},setTimeout:fn=>fn()};
  vm.createContext(context);vm.runInContext(fn,context);
  const result=await context.reloadForTabCapture();
  assert.equal(result.error,'reopen-for-tab-audio');assert.deepEqual(navigations,[]);
});
