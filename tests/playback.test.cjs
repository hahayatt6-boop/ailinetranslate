const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('artifacts/happysubs-csod/content.js','utf8');
function section(start,end){const index=source.indexOf(start);assert.ok(index>=0,'Missing playback feature');return source.slice(index,source.indexOf(end,index));}
function player(){
  const timers=new Map(),events={};let id=0;
  class Media{paused=true;playbackRate=1;}
  const video=new Media(),classes=new Set(['yds-live-visible']);
  const context={live:{active:true,textBuf:'English',partial:'',transBuf:'中文',shownTrans:'中文',holdUntil:0},STATE:{settings:{enabled:true}},P:{getVideoEl:()=>video},
    overlayEl:{classList:{add:c=>classes.add(c),remove:c=>classes.delete(c)}},HTMLMediaElement:Media,
    document:{addEventListener:(name,fn)=>events[name]=fn},renderSourceLine(){},renderOverlay(){},tailTrim:t=>t,Date,preferredPlaybackRate:1,
    LIVE_DISPLAY_CHARS:90,LIVE_HIDE_MS:4000,LIVE_READ_MIN_MS:6000,LIVE_READ_MAX_MS:12000,LIVE_READ_MS_PER_CHAR:220,LIVE_PAUSE_HOLD_MS:8000,
    setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:token=>timers.delete(token)};
  vm.createContext(context);
  vm.runInContext(section('  function ydsSetPlaybackRate(', '  // Media speed preferences')+section('  function liveRender() {','  function isUntranslated(')+section('  function watchPlayback() {','  // A seek makes'),context);
  return {context,timers,events,video,classes};
}
test('paused subtitles remain visible with no expiry even when a final translation arrives',()=>{
  const r=player();r.context.liveRender();assert.equal(r.timers.size,0);
  r.context.live.transBuf='新的中文';r.context.liveRender();assert.equal(r.timers.size,0);
  assert.equal(r.classes.has('yds-live-visible'),true);
});
test('pause cancels an existing hide timer and play restores normal silence expiry',()=>{
  const r=player();r.video.paused=false;r.context.liveRender();r.context.watchPlayback();
  r.video.paused=true;r.events.pause({target:r.video});assert.equal(r.timers.size,0);
  r.video.paused=false;r.events.play({target:r.video});assert.equal(r.timers.size,1);
  for(const cb of r.timers.values())cb();assert.equal(r.classes.has('yds-live-visible'),false);
});
test('speed control updates the selected video and rejects invalid values',()=>{
  const r=player();r.context.preferredPlaybackRate=1;
  vm.runInContext(section('  function ydsSetPlaybackRate(', '  // Media speed preferences'),r.context);
  assert.equal(r.context.ydsSetPlaybackRate(1.5).ok,true);assert.equal(r.video.playbackRate,1.5);
  assert.equal(r.context.ydsSetPlaybackRate(9).ok,false);assert.equal(r.video.playbackRate,1.5);
});
