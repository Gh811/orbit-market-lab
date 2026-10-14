// 手机共用触控反馈；事件委托覆盖动态按钮和弹窗，不改变原有点击行为。
(()=>{'use strict';
  if(typeof document==='undefined')return;
  const interactive='button,a[href],[role="button"],summary,select,input[type="checkbox"],input[type="radio"],input[type="range"],label:has(input[type="checkbox"]),label:has(input[type="radio"])';
  const mobile=()=>(window.MarketDevice?.isMobile?.()??window.innerWidth<=720);
  const motion=()=>!window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let press=null,pendingClick=null,lastPulse=-Infinity;
  const timers=new WeakMap();
  function pulse(){} // 本版手机不启用震动，保留调用兼容。
  function control(target){
    const el=target instanceof Element?target.closest(interactive):null;
    if(!el||el.matches(':disabled,[aria-disabled="true"]')||el.closest('[inert]'))return null;
    if(el.tagName==='LABEL'&&el.querySelector('input:disabled'))return null;
    return el;
  }
  function release(){if(press)press.el.classList.remove('touchPressed');press=null}
  function acknowledge(el){
    clearTimeout(timers.get(el));el.classList.add('touchReleased');
    timers.set(el,setTimeout(()=>el.classList.remove('touchReleased'),260));
  }
  document.addEventListener('pointerdown',e=>{
    if(!mobile()||!e.isPrimary||e.button!==0)return;
    release();pendingClick=null;const el=control(e.target);if(!el)return;
    press={el,id:e.pointerId,x:e.clientX,y:e.clientY};el.classList.add('touchPressed');
  },{capture:true,passive:true});
  document.addEventListener('pointermove',e=>{
    if(press&&e.pointerId===press.id&&Math.hypot(e.clientX-press.x,e.clientY-press.y)>12)release();
  },{capture:true,passive:true});
  document.addEventListener('pointerup',e=>{
    if(!press||e.pointerId!==press.id)return;
    const el=press.el;release();
    if(mobile()&&!el.matches(':disabled,[aria-disabled="true"]')){
      pendingClick={el,t:performance.now()};acknowledge(el);pulse();
    }
  },{capture:true,passive:true});
  document.addEventListener('pointercancel',release,{capture:true,passive:true});
  document.addEventListener('click',e=>{
    // Some 3D/press transforms retarget a compatibility click to the parent.
    // Recover only that ancestor case; never forward clicks into a new page.
    if(mobile()&&e.detail>0&&pendingClick){
      const {el,t}=pendingClick;pendingClick=null;
      if(performance.now()-t<500&&el.isConnected&&!el.contains(e.target)&&e.target instanceof Element&&e.target.contains(el)){
        e.preventDefault();e.stopImmediatePropagation();el.click();return;
      }
    }
    if(!mobile()||e.detail!==0)return;
    const el=control(e.target);if(el){acknowledge(el);pulse()}
  },true);
  document.addEventListener('change',e=>{
    if(mobile()&&e.target.matches('select,input[type="checkbox"],input[type="radio"],input[type="range"]')){
      const el=control(e.target);if(el){acknowledge(el);pulse('selection')}
    }
  },true);
  document.addEventListener('invalid',e=>{
    if(mobile()){e.target.classList.add('touchInvalid');setTimeout(()=>e.target.classList.remove('touchInvalid'),700);pulse('error')}
  },true);
  window.addEventListener('blur',release);
  window.addEventListener('resize',()=>{if(!mobile())release()});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)release()});
  window.MarketTouch=Object.freeze({pulse});
})();

((root,factory)=>{const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;
else root.MarketPhysics=value})(typeof window==='object'?window:globalThis,()=>{
  'use strict';
  const palette=Array.from({length:100},(_,i)=>({h:(i%25)*14.4,s:54+Math.floor(i/25)*8,l:31+Math.floor(i/25)*6}));
  function percentages(values){
    const rows=['up','flat','down'].map(k=>Number(values?.[k]));
    if(rows.some(v=>!Number.isFinite(v)||v<0)||rows.reduce((a,b)=>a+b,0)<=0)return null;
    const sum=rows.reduce((a,b)=>a+b,0),raw=rows.map(v=>100*v/sum),result=raw.map(Math.floor);
    const order=[0,1,2].sort((a,b)=>(raw[b]-result[b])-(raw[a]-result[a]));
    for(let i=0,n=100-result.reduce((a,b)=>a+b,0);i<n;i++)result[order[i%3]]++;
    return result;
  }
  let audio=null,last=-Infinity,soundSerial=0;
  let muted=false,masterGain=null;
  try{muted=localStorage.getItem('orbit_effects_muted_v1')==='1'}catch{}
  function setMuted(value){muted=!!value;soundSerial++;last=-Infinity;if(masterGain&&audio)masterGain.gain.setValueAtTime(muted?0:1,audio.currentTime);try{localStorage.setItem('orbit_effects_muted_v1',muted?'1':'0')}catch{}return muted}
  let soundBuffers=new Map(),buffersReady=false;
  function audioStatus(){
    const supported=typeof window!=='undefined'&&!!(window.AudioContext||window.webkitAudioContext);
    return {supported,prepared:buffersReady,state:audio?.state||'uninitialized',enabled:!muted&&audio?.state==='running',muted};
  }
  function prepareAudio(){
    if(typeof window==='undefined'||!(window.MarketDevice?.isMobile?.()??window.innerWidth<=720))return audioStatus();
    try{
      const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return audioStatus();
      if(!audio||audio.state==='closed'){audio=new Audio();last=-Infinity;soundBuffers=new Map();buffersReady=false;masterGain=audio.createGain();masterGain.gain.setValueAtTime(muted?0:1,audio.currentTime);masterGain.connect(audio.destination)}
      if(!buffersReady){
        for(const [kind,duration] of [['card',.24],['swap',.16],['operation',.12]]){
          const buffer=audio.createBuffer(1,Math.ceil(audio.sampleRate*duration),audio.sampleRate),data=buffer.getChannelData(0);
          let smooth=0;
          for(let i=0;i<data.length;i++){
            const noise=Math.random()*2-1;
            if(kind==='card'){smooth=.35*smooth+.65*noise;data[i]=smooth*Math.sin(Math.PI*i/(data.length-1))}
            else data[i]=noise*(1-i/data.length);
          }
          soundBuffers.set(kind,buffer);
        }
        buffersReady=true;
      }
    }catch{return {...audioStatus(),prepared:false,error:true}}
    return audioStatus();
  }
  function unlock(){
    if(!prepareAudio().prepared)return Promise.resolve(false);
    try{
      if(audio.state==='running')return Promise.resolve(true);
      const context=audio;
      // Prime the output silently in the gesture handler, before awaiting Safari's resume.
      const prime=context.createBufferSource();prime.buffer=context.createBuffer(1,1,context.sampleRate);
      prime.connect(context.destination);prime.onended=()=>prime.disconnect();prime.start(0);
      return Promise.resolve(context.resume()).then(()=>audio===context&&context.state==='running').catch(()=>false);
    }catch{return Promise.resolve(false)}
  }
  function sound(kind='card'){
    if(muted)return;
    const serial=++soundSerial,requested=Date.now(),ready=unlock();
    if(audio?.state==='running'){playSound(kind);return}
    ready.then(ok=>{if(ok&&serial===soundSerial&&Date.now()-requested<350&&!(typeof document!=='undefined'&&document.hidden))playSound(kind)});
  }
  function playSound(kind){
    if(muted||!audio||audio.state!=='running'||audio.currentTime-last<.045)return;
    last=audio.currentTime;
    try{
      const t=audio.currentTime,gain=audio.createGain();gain.connect(masterGain||audio.destination);
      if(kind==='card'){
        // A soft air sweep: rounded attack/tail and no hard impact transient.
        const duration=.24,source=audio.createBufferSource();source.buffer=soundBuffers.get('card');
        const high=audio.createBiquadFilter();high.type='highpass';high.frequency.setValueAtTime(380,t);high.Q.value=.5;
        const low=audio.createBiquadFilter();low.type='lowpass';low.Q.value=.45;
        low.frequency.setValueAtTime(1800,t);low.frequency.exponentialRampToValueAtTime(5400,t+.095);low.frequency.exponentialRampToValueAtTime(1300,t+duration);
        gain.gain.setValueAtTime(0,t);gain.gain.linearRampToValueAtTime(.11,t+.065);gain.gain.linearRampToValueAtTime(.075,t+.13);gain.gain.linearRampToValueAtTime(0,t+duration);
        source.connect(high);high.connect(low);low.connect(gain);source.start(t);
        source.onended=()=>{source.disconnect();high.disconnect();low.disconnect();gain.disconnect()};return;
      }
      if(kind==='lift'){
        const source=audio.createOscillator();source.type='sine';source.frequency.setValueAtTime(220,t);source.frequency.exponentialRampToValueAtTime(65,t+.085);
        gain.gain.setValueAtTime(.0001,t);gain.gain.exponentialRampToValueAtTime(.045,t+.01);gain.gain.exponentialRampToValueAtTime(.0001,t+.1);
        source.connect(gain);source.start(t);source.stop(t+.11);source.onended=()=>{source.disconnect();gain.disconnect()};return;
      }
      const duration=kind==='swap'?.16:.12,source=audio.createBufferSource();source.buffer=soundBuffers.get(kind==='swap'?'swap':'operation');
      const filter=audio.createBiquadFilter();filter.type='bandpass';filter.frequency.setValueAtTime(2600,t);filter.frequency.exponentialRampToValueAtTime(900,t+duration);filter.Q.value=.65;
      gain.gain.setValueAtTime(.0001,t);gain.gain.exponentialRampToValueAtTime(.065,t+.015);gain.gain.exponentialRampToValueAtTime(.0001,t+duration);
      source.connect(filter);filter.connect(gain);source.start(t);source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect()};
    }catch{}
  }
  if(typeof document!=='undefined'){
    for(const type of ['pointerdown','touchend','click','keydown'])document.addEventListener(type,unlock,{capture:true,passive:true});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)soundSerial++;else if(audio)unlock()});
    window.addEventListener?.('pageshow',()=>{if(audio&&!document.hidden)unlock()});
  }
  return {palette,percentages,sound,prepareAudio,audioStatus,unlockAudio:unlock,setMuted,isMuted:()=>muted};
});
