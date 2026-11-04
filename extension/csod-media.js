// Storyline can play narration through Web Audio without an HTMLMediaElement.
// Expose only the timeline/geometry the overlay needs; audio uses tab capture.
(() => {
  let media=null,lastPaused=null,lastSlide=null;
  function getMedia() {
    if(location.hostname!=='ready.csod.com' || !document.querySelector('#frame') ||
      !document.querySelector('#slide') || !document.querySelector('#play-pause'))return null;
    if(!media)media={
      tabAudioOnly:true,textTracks:[],
      get paused(){return document.querySelector('#play-pause')?.getAttribute('aria-pressed')==='true';},
      get currentTime(){return (Number(document.querySelector('input[aria-label="slide progress"]')?.value)||0)/1000;},
      get duration(){return (Number(document.querySelector('input[aria-label="slide progress"]')?.max)||0)/1000;},
      get playbackRate(){return 1;},set playbackRate(value){if(Number(value)!==1)throw new Error('Narration speed is controlled by the course');},
      getBoundingClientRect(){return (document.querySelector('#slide')||document.querySelector('#frame')).getBoundingClientRect();},
      querySelectorAll(){return [];},classList:{toggle(){}}
    };
    if(lastPaused===null)lastPaused=media.paused;
    return media;
  }
  function poll() {
    const current=getMedia();if(!current)return;
    const paused=current.paused;
    if(lastPaused!==paused){lastPaused=paused;document.dispatchEvent(new Event('yds-course-'+(paused?'pause':'play')));}
    // A new slide invalidates speech results still arriving from the old one.
    const slide=document.querySelector('#slide')?.querySelector('[data-slide-id], [data-model-id], [aria-label^="slide:"]');
    if(lastSlide && slide && lastSlide!==slide)document.dispatchEvent(new Event('yds-course-seek'));
    lastSlide=slide;
  }
  const api={getMedia,poll};
  if(typeof module!=='undefined' && module.exports)module.exports=api;
  else window.HappyCsodMedia=api;
})();
