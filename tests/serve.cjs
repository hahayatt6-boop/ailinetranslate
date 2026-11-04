// Local browser fixture only. Serve the fixture and content script, never project secrets.
const http = require('node:http');
const fs = require('node:fs');
http.createServer((req,res)=>{
  const routes={'/':'tests/browser.html','/content.js':'content.js','/speech-settings':'tests/speech-settings.html','/speech-settings.js':'extension/speech-settings.js','/speech-live':'tests/speech-live.html','/speech-connection.js':'extension/speech-connection.js'};
  const file = routes[req.url] || null;
  if(!file){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8');
  let body=fs.readFileSync(file,'utf8');
  if(file==='tests/speech-settings.html'){
    body=body.replace('<!--SPEECH_CONFIG-->',fs.readFileSync('extension/speech-settings.html','utf8'));
    const content=fs.readFileSync('artifacts/happysubs-csod/content.js','utf8');
    const extract=(start,end)=>content.slice(content.indexOf(start),content.indexOf(end,content.indexOf(start)));
    const controls=`const P={getVideoEl:()=>document.getElementById('probeVideo')};let preferredPlaybackRate=1;
      const live={active:true,textBuf:'Paused subtitle',partial:'',transBuf:'暂停后字幕应一直保留',shownTrans:'',holdUntil:0};
      const STATE={settings:{enabled:true}},overlayEl=document.getElementById('probeCaption');
      const LIVE_DISPLAY_CHARS=90,LIVE_READ_MIN_MS=6000,LIVE_READ_MAX_MS=12000,LIVE_READ_MS_PER_CHAR=220,LIVE_HIDE_MS=4000;
      const tailTrim=text=>text,renderSourceLine=text=>document.getElementById('probeEnglish').textContent=text,renderOverlay=text=>document.getElementById('probeChinese').textContent=text;
      ${extract('  function ydsSetPlaybackRate(', '  // Media speed preferences')}
      ${extract('  function liveRender() {','  function isUntranslated(')}
      liveRender();`;
    body=body.replace('<!--PLAYBACK_FN-->',controls);
  }
  res.end(body);
}).listen(18765,'127.0.0.1',()=>console.log('Browser fixture: http://127.0.0.1:18765'));
