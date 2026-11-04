const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function reader() {
  const intervals = new Map(), timers = new Map(), requests = [], fields = {};
  let listener, nextId = 0;
  const track = { activeCues: [], addEventListener(type, cb) { this.cuechange = cb; }, removeEventListener() {} };
  const video = { textTracks: [track], getBoundingClientRect: () => ({width:640,height:360}) };
  const host = { isConnected: true, style: {}, attachShadow() { return this.shadowRoot = {querySelector: s => fields[s] ||= {style:{},addEventListener(){}}}; }, remove() { this.isConnected = false; } };
  const context = {
    window: {}, document: {documentElement:{appendChild(){}}, querySelectorAll: s => s === 'video' ? [video] : [], createElement:()=>host},
    MutationObserver: class { observe(){} disconnect(){} },
    setInterval: cb => { intervals.set(++nextId, cb); return nextId; }, clearInterval: id => intervals.delete(id),
    setTimeout: cb => { timers.set(++nextId, cb); return nextId; }, clearTimeout: id => timers.delete(id),
    chrome: {storage:{local:{get:async()=>({})},onChanged:{addListener(){}}},runtime:{onMessage:{addListener(cb){listener=cb;}},sendMessage:msg=>new Promise(resolve=>requests.push({msg,resolve}))}},
  };
  vm.runInNewContext(fs.readFileSync('content.js','utf8'), context);
  return { intervals, timers, requests, fields, track, host,
    message(type) { let response; listener({type},{},r=>response=r); return response; },
    cue(text) { track.activeCues=[{text}]; track.cuechange?.(); },
    flush() { const callbacks=[...timers.values()]; timers.clear(); return Promise.all(callbacks.map(cb=>cb())); }
  };
}

test('stop cancels polling and pending caption translations', () => {
  const r=reader(); r.message('START_SUBTITLE_READING'); r.cue('Hello world');
  r.message('STOP_SUBTITLE_READING');
  assert.equal(r.intervals.size,0);
  assert.equal(r.timers.size,0);
  r.cue('Another sentence');
  assert.equal(r.timers.size,0);
});

test('late translation cannot restore subtitles after stop', async () => {
  const r=reader(); r.message('START_SUBTITLE_READING'); r.cue('Hello world');
  const pending=r.flush(); r.message('STOP_SUBTITLE_READING');
  r.requests[0].resolve({ok:true,translated:'你好'}); await pending;
  assert.notEqual(r.fields['.translated']?.textContent,'你好');
});

test('start reports videos without readable captions', () => {
  const r=reader(); const status=r.message('START_SUBTITLE_READING');
  assert.equal(status.videos,1);
  assert.equal(status.hasCaption,false);
});

test('older responses cannot overwrite the latest caption', async () => {
  const r=reader(); r.message('START_SUBTITLE_READING');
  r.cue('First sentence'); const first=r.flush();
  r.cue('Second sentence'); const second=r.flush();
  r.requests[1].resolve({ok:true,translated:'第二句'}); await second;
  r.requests[0].resolve({ok:true,translated:'第一句'}); await first;
  assert.equal(r.fields['.translated'].textContent,'第二句');
});
