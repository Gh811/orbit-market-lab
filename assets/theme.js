// Stable device mode: rotating a phone never changes the app into the desktop view.
(()=>{'use strict';
  const root=document.documentElement;
  const mobileOnlyEntry=root.hasAttribute('data-orbit-entry');
  const detectedPhone=/Android.*Mobile|iPhone|iPod/i.test(navigator.userAgent||'')||navigator.userAgentData?.mobile===true||((navigator.maxTouchPoints||0)>0&&window.matchMedia('(pointer:coarse)').matches&&Math.min(screen.width,screen.height)<=720);
  // The main entry now always loads the mobile application, including wide windows.
  const phone=mobileOnlyEntry||detectedPhone;
  const portraitEntry=detectedPhone||window.innerWidth<=720;
  const isMobile=()=>phone||window.innerWidth<=720;
  // Use this phone's available portrait area, preserving it across rotation and keyboard overlay.
  const portrait={width:Math.min(screen.width||window.innerWidth,screen.height||window.innerHeight),height:Math.max(screen.width||window.innerWidth,screen.height||window.innerHeight)};
  if(mobileOnlyEntry&&!detectedPhone){portrait.width=Math.min(480,window.innerWidth);portrait.height=window.innerHeight}
  else if(phone&&window.innerWidth<=window.innerHeight){portrait.width=window.innerWidth;portrait.height=window.innerHeight}
  const viewport=()=>{
    const pinned=window.MarketKeyboard?.lockedViewport?.();if(pinned)return pinned;
    // resize can arrive before orientation updates; never capture landscape width as portrait.
    const turned=window.innerWidth>window.innerHeight&&window.innerWidth>portrait.width*1.2;
    const view=window.visualViewport;
    if(mobileOnlyEntry&&!portraitEntry)return {width:Math.min(480,view?.width||window.innerWidth),height:view?.height||window.innerHeight,offsetTop:view?.offsetTop||0};
    if(phone&&turned)return {...portrait,offsetTop:0};
    return {width:view?.width||window.innerWidth,height:view?.height||window.innerHeight,offsetTop:view?.offsetTop||0};
  };
  root.dataset.device=phone?'phone':'desktop';
  window.MarketDevice={isMobile,isPhone:()=>phone,viewport};
  // Use native portrait locking where available; permission failures leave the UI alone.
  let portraitLockPending=false,portraitLocked=false,nextPortraitLockTry=0;
  function tryPortraitLock(event){
    const orientation=screen.orientation;
    if(!phone||document.hidden||event?.isTrusted===false||portraitLocked||portraitLockPending||Date.now()<nextPortraitLockTry||typeof orientation?.lock!=='function')return;
    portraitLockPending=true;
    const failed=()=>{portraitLocked=false;nextPortraitLockTry=Date.now()+5000};
    try{Promise.resolve(orientation.lock('portrait-primary')).then(()=>{portraitLocked=true},failed).finally(()=>{portraitLockPending=false})}
    catch{failed();portraitLockPending=false}
  }
  for(const type of ['touchend','click','keydown'])document.addEventListener(type,tryPortraitLock,{capture:true,passive:true});
  document.addEventListener('fullscreenchange',()=>{portraitLocked=false;nextPortraitLockTry=0;if(document.fullscreenElement)tryPortraitLock()});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){portraitLocked=false;nextPortraitLockTry=0}});
  const lockedSheets=new WeakSet(),phoneMediaRules=[];
  // Cover browser controls from the first paint, without following keyboard/toolbar shrink.
  const screenWallpaperHeight=screen.width<=720?Math.max(screen.height||0,screen.width||0):0;
  let wallpaperHeight=Math.max(window.innerHeight,portrait.height,screenWallpaperHeight);
  function lockPhoneStyles(){
    if(!phone)return;
    const view=viewport(),typing=document.activeElement?.matches?.('input,textarea,select,[contenteditable="true"]');
    if(!window.visualViewport?.scale||window.visualViewport.scale===1){
      portrait.width=view.width;
      if(!typing||view.height>=portrait.height)portrait.height=view.height;
    }
    const lockRules=rules=>{for(const rule of rules){
      if(rule.media)phoneMediaRules.push({rule,query:rule.media.mediaText});
      if(rule.style){for(const name of Array.from(rule.style)){
        const value=rule.style.getPropertyValue(name);
        const fixed=value.replace(/(-?[\d.]+)(?:d|s|l)?v(w|h)\b/g,(_,n,axis)=>'calc(var(--phone-layout-'+(axis==='w'?'width':'height')+') * '+Number(n)/100+')');
        if(fixed!==value)rule.style.setProperty(name,fixed,rule.style.getPropertyPriority(name));
      }}
      if(rule.cssRules)lockRules(rule.cssRules);
    }};
    for(const sheet of document.styleSheets){if(lockedSheets.has(sheet))continue;try{lockRules(sheet.cssRules);lockedSheets.add(sheet)}catch{}}
    for(const {rule,query} of phoneMediaRules){
      rule.media.mediaText=query.replace(/\((min|max)-(width|height):\s*([\d.]+)px\)/g,(_,bound,axis,n)=>{
        const matches=bound==='min'?portrait[axis]>=Number(n):portrait[axis]<=Number(n);
        return matches?'(min-width:0px)':'(max-width:0px)';
      });
    }
    const setViewportValue=(name,value)=>{if(root.style.getPropertyValue?.(name)!==value)root.style.setProperty(name,value)};
    setViewportValue('--phone-layout-width',portrait.width+'px');
    setViewportValue('--phone-layout-height',portrait.height+'px');
    wallpaperHeight=Math.max(wallpaperHeight,window.innerHeight,view.height,portrait.height);
    setViewportValue('--wallpaper-viewport-height',wallpaperHeight+'px');
    setViewportValue('--mobile-viewport-height',portrait.height+'px');
  }
  document.addEventListener('load',e=>{if(e.target.matches?.('link[rel="stylesheet"],link[data-entry-style]'))lockPhoneStyles()},true);
  document.addEventListener('DOMContentLoaded',lockPhoneStyles);
  window.addEventListener('resize',lockPhoneStyles,{passive:true});
  window.addEventListener('orientationchange',lockPhoneStyles,{passive:true});
  screen.orientation?.addEventListener?.('change',lockPhoneStyles);
  window.visualViewport?.addEventListener('resize',lockPhoneStyles,{passive:true});
  window.visualViewport?.addEventListener('scroll',lockPhoneStyles,{passive:true});
  window.addEventListener('pageshow',lockPhoneStyles,{passive:true});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)lockPhoneStyles()});
  lockPhoneStyles();
  // Inline HTML guard protects even the first frame before external CSS arrives.
  let entryDomReady=false;
  const entryStylesReady=()=>{
    const links=[...document.querySelectorAll('link[data-entry-style],link[data-entry-critical]')];
    return links.length>0&&links.every(link=>!!link.sheet&&link.media!=='print');
  };
  const revealStyledPage=()=>{if(entryDomReady&&entryStylesReady())root.classList.add('entryStylesReady')};
  document.addEventListener('load',revealStyledPage,true);
  document.addEventListener('DOMContentLoaded',()=>{entryDomReady=true;revealStyledPage()});
  const revealDesktop=()=>{if(!mobileOnlyEntry&&!isMobile()&&[...document.querySelectorAll('link[data-entry-style]')].every(link=>!!link.sheet)){const shell=document.querySelector('[data-entry-shell]');if(shell)shell.hidden=false}};
  document.addEventListener('load',e=>{if(e.target.matches?.('link[data-entry-style]')){e.target.media='all';revealStyledPage();revealDesktop()}},true);
  document.addEventListener('DOMContentLoaded',()=>{for(const link of document.querySelectorAll('link[data-entry-style]'))if(link.sheet)link.media='all';revealStyledPage();revealDesktop()});
  if(!root.hasAttribute('data-orbit-entry')||!isMobile())return;
  root.classList.add('bootLoading');
  let value=6,target=12,accountReady=false,domReady=false,failed=false,finished=false,failureMessage='',timedOut=false,visualReady=false,preparing=false,prepareVisuals=null;
  let visualAttempts=0,failurePhase='',watchdog;
  const resourceAttempts=new WeakMap(),scheduledResources=new WeakSet(),failedResources=new Set();
  const start=Date.now();
  const $=id=>document.getElementById(id);
  const stylesReady=entryStylesReady;
  const steps=[],entryListeners=[];
  function fixedDetailLines(lines){
    const visible=lines.slice(-6).map(line=>String(line).replace(/\s+/g,' ').trim());
    return visible.concat(Array(6-visible.length).fill('')).join('\n');
  }
  function stage(message,detail,progress){
    if(finished)return;
    if(Number.isFinite(progress))target=Math.max(target,Math.min(96,progress));
    if($('bootStatus')&&$('bootStatus').textContent!==message)$('bootStatus').textContent=message;
    if(detail&&!steps.includes(detail)){steps.push(detail);if($('bootDetails')){const completed=steps.filter(step=>step.startsWith('✓'));$('bootDetails').textContent=fixedDetailLines(completed.length?completed:steps.slice(-2))}}
  }
  function paint(){
    const fill=$('bootProgressFill'),bar=$('bootProgress');
    if(fill)fill.style.width=value+'%';if(bar)bar.setAttribute('aria-valuenow',String(Math.round(value)));
    if($('bootPercent'))$('bootPercent').textContent=Math.round(value)+'%';
  }
  function finish(){
    if(finished||failed||failedResources.size||!accountReady||!domReady||!stylesReady())return;
    if(!visualReady&&prepareVisuals){
      if(preparing)return;preparing=true;
      stage('正在准备启动资源…','初始化首屏布局、个人形象与交互音效',50);
      let preparationTimer;
      const deadline=new Promise((_,reject)=>{preparationTimer=setTimeout(()=>reject(new Error('启动资源等待超时')),45000)});
      Promise.race([Promise.resolve().then(prepareVisuals),deadline]).then(()=>{
        clearTimeout(preparationTimer);
        // Lay out the real page behind the still-opaque cover before exposing it.
        const shell=document.querySelector('[data-entry-shell]');if(shell)shell.hidden=false;
        const nextFrame=window.requestAnimationFrame||((fn)=>setTimeout(fn,0));
        // 资源就绪后等待布局绘制；后台页面等待恢复后再进入。
        let revealed=false;const reveal=()=>{if(revealed)return;revealed=true;visualReady=true;preparing=false;failed=false;stage('正在检查最终布局…','✓ 首屏布局与交互组件已就绪',96);finish()};
        nextFrame(()=>nextFrame(reveal));
      }).catch(error=>{
        clearTimeout(preparationTimer);
        preparing=false;visualAttempts++;
        const exhausted=visualAttempts>=3;
        fail(exhausted?'启动资源多次加载失败，请重新加载':'正在重新准备启动资源…',{exhausted,phase:'visual'});
        if(!exhausted)setTimeout(()=>{if(finished)return;failed=false;stage('正在重新准备启动资源…','自动重试启动资源 '+(visualAttempts+1)+'/3');finish()},2000*visualAttempts);
      });
      return;
    }
    target=Math.max(target,96);
    if(Date.now()-start<2800||value<95.5)return;
    finished=true;failed=false;timedOut=false;if($('bootRetry'))$('bootRetry').hidden=true;clearInterval(tick);clearTimeout(watchdog);value=100;paint();
    if($('bootStatus'))$('bootStatus').textContent='首屏已就绪，即将进入';
    if($('bootDetails'))$('bootDetails').textContent=fixedDetailLines(steps.filter(step=>step.startsWith('✓')).slice(-5).concat('✓ 首屏资源与布局准备完成'));
    setTimeout(()=>{const shell=document.querySelector('[data-entry-shell]');if(shell)shell.hidden=false;root.classList.add('bootComplete');root.classList.remove('bootLoading');$('bootCover')?.setAttribute('hidden','');for(const callback of entryListeners.splice(0)){try{callback()}catch{}}},700);
  }
  function fail(message,{exhausted=true,phase='account'}={}){
    if(finished)return;failed=true;timedOut=exhausted;failurePhase=phase;failureMessage=message||'连接有点慢，正在重试';if($('bootStatus'))$('bootStatus').textContent=failureMessage;
    if($('bootRetry'))$('bootRetry').hidden=!exhausted;
  }
  function retryResource(node){
    if(finished||scheduledResources.has(node))return;
    failedResources.add(node);
    const attempt=(resourceAttempts.get(node)||0)+1;
    if(attempt>2){fail('页面资源多次加载失败，请重新加载',{phase:'resource'});return}
    resourceAttempts.set(node,attempt);scheduledResources.add(node);
    stage('正在重新请求页面资源…','自动重试页面资源 '+(attempt+1)+'/3');
    setTimeout(()=>{
      scheduledResources.delete(node);if(finished)return;
      const source=node.href||node.src;if(!source)return;
      const url=new URL(source,location.href);url.searchParams.set('boot_attempt',String(attempt));
      if(node.tagName==='LINK'){node.href=url.href}
      else if(node.tagName==='SCRIPT'){
        const replacement=node.cloneNode(false);replacement.src=url.href;replacement.async=false;
        resourceAttempts.set(replacement,attempt);failedResources.delete(node);failedResources.add(replacement);node.replaceWith(replacement);
      }
    },1500*attempt);
  }
  const tick=setInterval(()=>{if(finished)return;if(!failed){value=Math.min(target,value+Math.max(.2,(target-value)*.12));paint()}finish()},100);
  function checkSlowResources(){
    if(finished)return;
    const waitingForResources=!accountReady||!domReady||!stylesReady()||(prepareVisuals&&!visualReady);
    if(!waitingForResources)return;
    for(const link of document.querySelectorAll('link[data-entry-style],link[data-entry-critical]'))if(!link.sheet)retryResource(link);
    if(!timedOut)stage('正在等待启动资源…','连接较慢，正在自动恢复');
    watchdog=setTimeout(checkSlowResources,15000);
  }
  watchdog=setTimeout(checkSlowResources,30000);
  document.addEventListener('load',e=>{
    failedResources.delete(e.target);
    if(failurePhase==='resource'&&!failedResources.size&&stylesReady()){failed=false;timedOut=false;if($('bootRetry'))$('bootRetry').hidden=true}
    if(e.target.matches?.('link[data-entry-style],link[data-entry-critical]')){e.target.media='all';stage('页面样式已加载','✓ 页面主题与移动布局样式已加载',40);finish()}
  },true);
  document.addEventListener('error',e=>{if(e.target.matches?.('script[defer][src],link[data-entry-style],link[data-entry-critical]')){failedResources.add(e.target);retryResource(e.target)}},true);
  document.addEventListener('DOMContentLoaded',()=>{
    domReady=true;stage('正在恢复账户与个人设置…','✓ 页面结构初始化完成',25);
    for(const link of document.querySelectorAll('link[data-entry-style]'))if(link.sheet)link.media='all';
    if($('bootRetry')){$('bootRetry').onclick=()=>{ $('bootRetry').disabled=true;stage('正在重新加载…','重新请求页面和启动资源');location.reload()};$('bootRetry').hidden=!timedOut}
    if(failed&&$('bootStatus'))$('bootStatus').textContent=failureMessage;
    paint();finish();
  });
  window.MarketBoot={stage,whenEntered(callback){if(root.classList.contains('bootComplete'))callback();else entryListeners.push(callback)},ready(prepare){if(prepare)prepareVisuals=prepare;accountReady=true;if(failurePhase!=='resource'||!failedResources.size){failed=false;timedOut=false;if($('bootRetry'))$('bootRetry').hidden=true}stage('账户已连接，正在准备资源…','✓ 账户服务与个人设置已恢复',50);finish()},fail};
})();

// Set the palette before the stylesheet paints, then build the mechanical
// cyberpunk backdrop: a segmented ring station with space-elevator tethers,
// a counter-rotating sister ring, distant yard craft, and a flowing galactic
// current behind it all.
document.documentElement.dataset.theme = 'fusion';

document.addEventListener('DOMContentLoaded', () => {
  // 3D 星轨背景（环形空间站、缆绳、飞船、银河轨迹、流星）是桌面端专属画面，
  // 不属于移动端：手机/窄屏下不创建该层、不启动 canvas 动画。
  // 此前移动端仅推迟到启动页结束后绘制，慢网速/转场时序中该层会从半透明
  // 界面下方穿透显示，且常驻动画徒耗手机 GPU 与电量。CSS 侧另有兜底规则。
  if(window.MarketDevice?.isMobile?.())return;
  const field = document.createElement('div');
  field.className = 'ambientField';
  field.setAttribute('aria-hidden', 'true');
  field.innerHTML = '<canvas class="ambient3D"></canvas>';
  document.body.prepend(field);
  startStationBackdrop(field.querySelector('.ambient3D'));
});

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function startStationBackdrop(canvas) {
  const context = canvas.getContext('2d');
  if (!context) return;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let width = 0, height = 0, dpr = 1, frame = 0, lastPaint = 0, resizeTimer = 0;
  let scrollSettlesAt = 0;
  const pointer = {x: 0, y: 0, tx: 0, ty: 0};
  let sky = null;

  const rotate = (x, y, z, ax, ay, az) => {
    const cx = Math.cos(ax), sx = Math.sin(ax);
    const cy = Math.cos(ay), sy = Math.sin(ay);
    const cz = Math.cos(az), sz = Math.sin(az);
    const yy = y * cx - z * sx, zz = y * sx + z * cx;
    const xx = x * cy + zz * sy, z2 = -x * sy + zz * cy;
    return [xx * cz - yy * sz, xx * sz + yy * cz, z2];
  };

  // ---------------------------------------------------------------- sky layer
  // Thin, restrained long-exposure tracks kept faint so the machinery dominates.
  const ice = [178, 240, 255], neon = [232, 148, 255], amber = [255, 205, 138], jade = [140, 244, 214];
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const flareRandom = Math.random;
  const flarePlaces = [[.09,.24],[.31,.12],[.71,.1],[.91,.39],
    [.83,.7],[.48,.88],[.13,.58],[.94,.86]];
  let flareEvents = [], nextFlareAt = 0, previousFlarePlace = -1;
  let meteorEvents = [], nextMeteorShowerAt = 0;

  function buildSky() {
    const rand = mulberry32(0x5EA5EED);
    const R = (a, b) => a + rand() * (b - a);
    const diag = Math.hypot(width, height);
    const S = Math.min(2200, Math.max(1400, Math.round(diag * 1.35)));
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    const C = S / 2;
    g.fillStyle = '#010309';
    g.fillRect(0, 0, S, S);
    for (let n = 0; n < 460; n++) {
      g.beginPath();
      g.arc(rand() * S, rand() * S, rand() * 0.8 + 0.3, 0, Math.PI * 2);
      g.fillStyle = `rgba(200,220,240,${(0.12 + rand() * 0.45).toFixed(3)})`;
      g.fill();
    }
    const pals = [ice, neon, amber, jade];
    const kinds = ['arc', 'spiral', 'loop', 'escape', 'wave', 'dart'];
    const stroke = (seg, color, w, alpha) => {
      g.lineCap = g.lineJoin = 'round';
      for (const pass of [[5, 0.22], [1, 1.0]]) {
        g.beginPath();
        g.moveTo(...seg[0]);
        for (let n = 1; n < seg.length; n++) g.lineTo(...seg[n]);
        g.strokeStyle = rgba(color, alpha * pass[1]);
        g.lineWidth = w * pass[0];
        g.stroke();
      }
    };
    for (let i = 0; i < 22; i++) {
      const kind = kinds[Math.floor(rand() * kinds.length)];
      const color = pals[Math.floor(rand() * pals.length)];
      const w = R(0.7, 1.3);
      const alpha = R(0.3, 0.55);
      let seg = [];
      if (kind === 'arc') {
        const px = C + R(-0.35, 0.35) * S, py = C + R(-0.35, 0.35) * S;
        const r = R(0.15, 0.6) * S, a0 = R(0, Math.PI * 2), span = R(0.25, 1.1) * Math.PI;
        for (let n = 0; n <= 56; n++) {
          const a = a0 + span * n / 56;
          seg.push([px + r * Math.cos(a), py + r * Math.sin(a)]);
        }
      } else if (kind === 'spiral') {
        const px = C + R(-0.3, 0.3) * S, py = C + R(-0.3, 0.3) * S;
        const r0 = R(0.01, 0.05) * S, growth = R(0.0005, 0.0016) * S;
        const a0 = R(0, Math.PI * 2), total = R(1.2, 3) * Math.PI * 2;
        for (let n = 0; n <= 110; n++) {
          const th = total * n / 110, r = r0 + growth * th, a = a0 + th;
          seg.push([px + r * Math.cos(a), py + r * Math.sin(a)]);
        }
      } else if (kind === 'loop') {
        const px = R(0.1, 0.9) * S, py = R(0.1, 0.9) * S;
        const rx = R(0.05, 0.18) * S, ry = rx * R(0.3, 0.85), tilt = R(0, Math.PI);
        for (let n = 0; n <= 64; n++) {
          const a = Math.PI * 2 * n / 64, x = rx * Math.cos(a), y = ry * Math.sin(a);
          seg.push([px + x * Math.cos(tilt) - y * Math.sin(tilt), py + x * Math.sin(tilt) + y * Math.cos(tilt)]);
        }
      } else if (kind === 'escape') {
        const px = R(0.15, 0.85) * S, py = R(0.15, 0.85) * S, tilt = R(0, Math.PI * 2);
        const k = R(0.02, 0.05) * S, t0 = R(0.4, 0.9), t1 = t0 + R(2, 3.6);
        for (let n = 0; n <= 56; n++) {
          const t = t0 + (t1 - t0) * n / 56;
          const x = t * S * 0.055, y = k * S * 0.055 / t;
          seg.push([px + x * Math.cos(tilt) - y * Math.sin(tilt), py + x * Math.sin(tilt) + y * Math.cos(tilt)]);
        }
      } else if (kind === 'wave') {
        const a = R(0, Math.PI * 2);
        const px = C + Math.cos(a) * R(0.25, 0.6) * S, py = C + Math.sin(a) * R(0.25, 0.6) * S;
        const dir = a + Math.PI + R(-0.5, 0.5), len = R(0.2, 0.5) * S;
        const dx = Math.cos(dir), dy = Math.sin(dir), nx = -dy, ny = dx;
        const f1 = R(1.5, 3.4), amp1 = R(0.008, 0.026) * S, p1 = R(0, Math.PI * 2);
        for (let n = 0; n <= 90; n++) {
          const t = n / 90, d = len * t;
          const off = amp1 * Math.sin(f1 * t * Math.PI * 2 + p1);
          seg.push([px + dx * d + nx * off, py + dy * d + ny * off]);
        }
      } else {
        const edge = Math.floor(R(0, 4));
        const start = edge === 0 ? [R(0, 1) * S, 0] : edge === 1 ? [S, R(0, 1) * S] :
          edge === 2 ? [R(0, 1) * S, S] : [0, R(0, 1) * S];
        const end = [C + R(-0.2, 0.2) * S, C + R(-0.2, 0.2) * S];
        const c1 = [start[0] + R(-0.2, 0.2) * S, start[1] + R(-0.2, 0.2) * S];
        for (let n = 0; n <= 72; n++) {
          const t = n / 72, u = 1 - t;
          seg.push([u * u * start[0] + 2 * u * t * c1[0] + t * t * end[0],
            u * u * start[1] + 2 * u * t * c1[1] + t * t * end[1]]);
        }
        const head = seg[seg.length - 1];
        g.beginPath(); g.arc(head[0], head[1], 2, 0, Math.PI * 2);
        g.fillStyle = rgba(color, alpha); g.fill();
      }
      if (seg.length > 1) stroke(seg, color, w, alpha);
    }
    return c;
  }

  // Separate fine star trails cross the viewport in different directions.
  // Each has a narrow halo and glints that travel along its own curve.
  function drawGalacticCurrent(g, time) {
    const trails = [
      {from:[-.12,.64],to:[1.12,.2],bend:.12,color:ice,alpha:.72,phase:0,speed:.013,dir:1},
      {from:[-.13,.08],to:[1.13,.55],bend:-.12,color:neon,alpha:.55,phase:1.4,speed:.01,dir:-1},
      {from:[.19,-.13],to:[.85,1.13],bend:.17,color:jade,alpha:.58,phase:2.7,speed:.012,dir:1},
      {from:[1.12,-.08],to:[-.12,.82],bend:-.1,color:amber,alpha:.52,phase:3.9,speed:.009,dir:-1},
      {from:[-.12,.43],to:[1.12,.85],bend:.08,color:ice,alpha:.43,phase:5.2,speed:.011,dir:1}
    ];
    const point = (trail, t) => {
      const x0 = trail.from[0] * width, y0 = trail.from[1] * height;
      const dx = (trail.to[0] - trail.from[0]) * width;
      const dy = (trail.to[1] - trail.from[1]) * height;
      const length = Math.hypot(dx, dy) || 1;
      const curve = Math.sin(Math.PI * t) *
        (trail.bend * Math.min(width, height) + 7 * Math.sin(t * Math.PI * 3 - time * .42 + trail.phase));
      return [x0 + dx * t - dy / length * curve,
        y0 + dy * t + dx / length * curve];
    };
    g.save();
    g.globalCompositeOperation = 'screen';
    g.lineCap = g.lineJoin = 'round';
    for (const [index, trail] of trails.entries()) {
      g.beginPath();
      for (let step = 0; step <= 72; step++) {
        const p = point(trail, step / 72);
        if (step) g.lineTo(p[0], p[1]);
        else g.moveTo(p[0], p[1]);
      }
      g.strokeStyle = rgba(trail.color, trail.alpha * .17);
      g.lineWidth = 7;
      g.shadowColor = rgba(trail.color, trail.alpha * .6);
      g.shadowBlur = 16;
      g.stroke();
      g.shadowBlur = 7;
      g.strokeStyle = rgba(trail.color, trail.alpha);
      g.lineWidth = index === 0 ? 1.5 : 1.1;
      g.stroke();
      for (let i = 0; i < 15; i++) {
        const progress = (i * .61803398875 + time * trail.speed) % 1;
        const t = trail.dir > 0 ? progress : 1 - progress;
        const p = point(trail, t);
        const tail = point(trail, Math.max(0, Math.min(1, t - trail.dir * .012)));
        const pulse = .48 + .34 * Math.sin(time * 1.6 + i * 2.7 + index);
        g.shadowBlur = i % 5 === 0 ? 14 : 6;
        g.strokeStyle = rgba(trail.color, pulse * .75);
        g.lineWidth = i % 5 === 0 ? 1.3 : .65;
        g.beginPath();g.moveTo(tail[0], tail[1]);g.lineTo(p[0], p[1]);g.stroke();
        g.fillStyle = rgba(trail.color, pulse);
        g.beginPath();g.arc(p[0], p[1], i % 5 === 0 ? 1.8 : .8, 0, Math.PI * 2);g.fill();
      }
    }
    g.restore();
  }

  function drawGalacticFlares(g, time) {
    if (reducedMotion) return;
    if (!nextFlareAt) nextFlareAt = time + 1.3 + flareRandom() * 2.8;
    if (time >= nextFlareAt) {
      let place = Math.floor(flareRandom() * flarePlaces.length);
      if (place === previousFlarePlace) place = (place + 1 + Math.floor(flareRandom() * 3)) % flarePlaces.length;
      previousFlarePlace = place;
      const anchor = flarePlaces[place];
      flareEvents.push({start:time, duration:2.1 + flareRandom() * 2.4,
        x:anchor[0] + (flareRandom() - .5) * .09,
        y:anchor[1] + (flareRandom() - .5) * .08,
        radius:.035 + flareRandom() * .095,
        color:[ice,neon,jade,amber][Math.floor(flareRandom() * 4)]});
      nextFlareAt = time + 2.8 + flareRandom() * 7.3;
    }
    flareEvents = flareEvents.filter(flare => time - flare.start < flare.duration);
    if (!flareEvents.length) return;
    g.save();
    g.globalCompositeOperation = 'screen';
    for (const flare of flareEvents) {
      g.shadowBlur = 0;
      const progress = (time - flare.start) / flare.duration;
      const glow = Math.sin(Math.PI * progress);
      const x = width * flare.x, y = height * flare.y;
      const radius = Math.min(width, height) * flare.radius * (.55 + progress * .85);
      const halo = g.createRadialGradient(x,y,0,x,y,radius * 1.4);
      halo.addColorStop(0,rgba(flare.color,.52 * glow));
      halo.addColorStop(.17,rgba(flare.color,.28 * glow));
      halo.addColorStop(.55,rgba(flare.color,.085 * glow));
      halo.addColorStop(1,rgba(flare.color,0));
      g.fillStyle = halo;
      g.fillRect(x-radius*1.4,y-radius*1.4,radius*2.8,radius*2.8);
      g.beginPath();g.arc(x,y,radius*.7,0,Math.PI*2);
      g.strokeStyle = rgba(flare.color,.39 * glow);
      g.lineWidth = 1;
      g.shadowColor = rgba(flare.color,.7 * glow);
      g.shadowBlur = 13;
      g.stroke();
      g.beginPath();g.arc(x,y,1.5 + glow,0,Math.PI*2);
      g.fillStyle = rgba(flare.color,.8 * glow);
      g.fill();
    }
    g.restore();
  }

  function drawMeteors(g, time) {
    if (reducedMotion) return;
    if (!nextMeteorShowerAt) nextMeteorShowerAt = time + 1.5 + flareRandom() * 3;
    if (time >= nextMeteorShowerAt) {
      const shower = flareRandom() < .38;
      const count = shower ? 9 + Math.floor(flareRandom() * 10) : 2 + Math.floor(flareRandom() * 2);
      const span = shower ? 1.2 + flareRandom() * 1.3 : .35 + flareRandom() * .5;
      for (let i = 0; i < count; i++) {
        meteorEvents.push({start:time + flareRandom() * span,
          duration:.6 + flareRandom() * .4,
          fromX:.84 + flareRandom() * .48, fromY:-.3 + flareRandom() * .34,
          toX:-.34 + flareRandom() * .52, toY:1.04 + flareRandom() * .35,
          tail:.13 + flareRandom() * .1,
          color:[ice,ice,jade,neon,amber][Math.floor(flareRandom() * 5)]});
      }
      nextMeteorShowerAt = time + 8 + flareRandom() * 19;
    }
    meteorEvents = meteorEvents.filter(meteor => time - meteor.start < meteor.duration);
    if (!meteorEvents.length) return;
    g.save();
    g.globalCompositeOperation = 'screen';
    g.lineCap = 'round';
    for (const meteor of meteorEvents) {
      if (time < meteor.start) continue;
      const progress = (time - meteor.start) / meteor.duration;
      const opacity = Math.min(1,progress * 9,(1 - progress) * 9);
      const position = t => [width * (meteor.fromX + (meteor.toX - meteor.fromX) * t),
        height * (meteor.fromY + (meteor.toY - meteor.fromY) * t)];
      const head = position(progress);
      const tail = position(Math.max(0,progress - meteor.tail));
      const light = g.createLinearGradient(tail[0],tail[1],head[0],head[1]);
      light.addColorStop(0,rgba(meteor.color,0));
      light.addColorStop(.65,rgba(meteor.color,.34 * opacity));
      light.addColorStop(1,rgba(meteor.color,.95 * opacity));
      g.beginPath();g.moveTo(tail[0],tail[1]);g.lineTo(head[0],head[1]);
      g.strokeStyle = light;
      g.lineWidth = 3.5;
      g.shadowColor = rgba(meteor.color,.75 * opacity);
      g.shadowBlur = 13;
      g.stroke();
      g.lineWidth = 1;
      g.shadowBlur = 5;
      g.stroke();
      g.beginPath();g.arc(head[0],head[1],2.4,0,Math.PI*2);
      g.fillStyle = rgba([244,251,255],.9 * opacity);
      g.shadowBlur = 12;
      g.fill();
    }
    g.restore();
  }

  // ------------------------------------------------------------ 3D machinery
  const palettes = {
    cyan: ['rgba(126,235,242,.53)', 'rgba(106,226,235,.28)', 'rgba(161,247,251,.85)'],
    gold: ['rgba(247,211,143,.47)', 'rgba(235,194,127,.25)', 'rgba(255,231,176,.77)']
  };

  // Solid armoured ring: filled hull plates whose brightness follows the plate
  // normal, so the lit face reads as metal and the far face falls into shadow.
  function torusStation(g, radius, cx, cy, ax, ay, az, tint, lights, plateCount) {
    const unit = Math.min(width, height);
    const scale = Math.max(460, unit * 1.35);
    const palette = palettes[tint];
    const project = (x, y, z = 0) => {
      const [rx, ry, rz] = rotate(x, y, z, ax, ay, az);
      const perspective = scale / Math.max(scale * .4, scale + rz);
      return [cx + rx * perspective, cy + ry * perspective, rz];
    };
    const v = (x, y, z = 0) => [radius * x, radius * y, radius * z];
    const thick = radius * .055;

    // hull plates
    for (let piece = 0; piece < plateCount; piece++) {
      const a0 = piece * Math.PI * 2 / plateCount + .02;
      const a1 = (piece + 1) * Math.PI * 2 / plateCount - .02;
      const mid = (a0 + a1) / 2;
      const facing = rotate(Math.cos(mid), Math.sin(mid), 0, ax, ay, az)[2] / radius;
      const lit = Math.max(0, facing);
      const shade = Math.max(0, -facing);
      const plateAlpha = .25 + lit * .39;
      const corners = [
        project(radius * .86 * Math.cos(a0), radius * .86 * Math.sin(a0), thick),
        project(radius * Math.cos(a0), radius * Math.sin(a0), thick),
        project(radius * Math.cos(a1), radius * Math.sin(a1), thick),
        project(radius * .86 * Math.cos(a1), radius * .86 * Math.sin(a1), thick)
      ];
      g.beginPath();
      corners.forEach((p, n) => { if (!n) g.moveTo(...p); else g.lineTo(...p); });
      g.closePath();
      g.fillStyle = tint === 'gold'
        ? `rgba(${150 + lit * 80},${128 + lit * 60},${86 + lit * 40},${plateAlpha.toFixed(3)})`
        : `rgba(${96 + lit * 70},${140 + lit * 70},${152 + lit * 80},${plateAlpha.toFixed(3)})`;
      g.fill();
      g.strokeStyle = `rgba(208,229,235,${(.17 + lit * .28).toFixed(3)})`;
      g.lineWidth = 1;
      g.stroke();
      // shadowed counterpart plate on the far rim
      if (shade > 0.1) {
        const back = [
          project(radius * Math.cos(a0), radius * Math.sin(a0), -thick),
          project(radius * .86 * Math.cos(a0), radius * .86 * Math.sin(a0), -thick),
          project(radius * .86 * Math.cos(a1), radius * .86 * Math.sin(a1), -thick),
          project(radius * Math.cos(a1), radius * Math.sin(a1), -thick)
        ];
        g.beginPath();
        back.forEach((p, n) => { if (!n) g.moveTo(...p); else g.lineTo(...p); });
        g.closePath();
        g.fillStyle = `rgba(30,46,58,${(shade * .4).toFixed(3)})`;
        g.fill();
      }
      // rim edge struts
      g.beginPath();
      let p = project(radius * Math.cos(a0), radius * Math.sin(a0), -thick);
      let q = project(radius * Math.cos(a0), radius * Math.sin(a0), thick);
      g.moveTo(...p); g.lineTo(...q);
      g.strokeStyle = `rgba(140,180,192,${(.12 + lit * .2).toFixed(3)})`;
      g.lineWidth = 1.2;
      g.stroke();
      if (piece % 2 === 0) {
        g.beginPath();
        p = project(radius * .86 * Math.cos(mid), radius * .86 * Math.sin(mid), thick);
        q = project(radius * Math.cos(mid), radius * Math.sin(mid), thick);
        g.moveTo(...p); g.lineTo(...q);
        g.strokeStyle = palette[1];
        g.lineWidth = 2;
        g.stroke();
      }
    }

    const ringPts = (factor, z, steps = 96) => {
      const points = [];
      for (let step = 0; step <= steps; step++) {
        const a = step * Math.PI * 2 / steps;
        points.push(v(factor * Math.cos(a), factor * Math.sin(a), z));
      }
      return points;
    };
    const strokePath = (points, stroke, size, close = false) => {
      g.beginPath();
      for (let n = 0; n < points.length; n++) {
        const [x, y] = project(...points[n]);
        if (!n) g.moveTo(x, y); else g.lineTo(x, y);
      }
      if (close) g.closePath();
      g.strokeStyle = stroke; g.lineWidth = size; g.stroke();
    };
    const line3 = (a, b, stroke, size) => {
      const p = project(...a), q = project(...b);
      g.beginPath(); g.moveTo(...p); g.lineTo(...q);
      g.strokeStyle = stroke; g.lineWidth = size; g.stroke();
    };
    const joint3 = (point, size) => {
      const [x, y] = project(...point);
      g.beginPath(); g.arc(x, y, size, 0, Math.PI * 2);
      g.fillStyle = 'rgba(215,228,222,.8)'; g.fill();
    };

    // rims
    strokePath(ringPts(1, -thick), 'rgba(60,88,102,.55)', Math.max(2, radius * .018));
    strokePath(ringPts(1, thick), 'rgba(168,196,206,.7)', Math.max(3, radius * .026));
    strokePath(ringPts(.86, thick), 'rgba(120,160,175,.5)', Math.max(2, radius * .014));
    strokePath(ringPts(.62, 0), 'rgba(120,200,210,.28)', Math.max(1, radius * .008));

    // spokes
    for (let spoke = 0; spoke < 12; spoke++) {
      const a = spoke * Math.PI / 6;
      const ca = Math.cos(a), sa = Math.sin(a);
      line3(v(.16 * ca, .16 * sa, 0), v(.86 * ca, .86 * sa, 0), spoke % 3 ? palette[1] : 'rgba(215,228,222,.6)', spoke % 3 ? 1.6 : 2.6);
      joint3(v(.86 * ca, .86 * sa, 0), 1.8);
    }

    // hub: armoured box with a glowing ring
    const hubSize = radius * .11;
    const corners = [];
    for (const z of [-1, 1]) for (const y of [-1, 1]) for (const x of [-1, 1])
      corners.push(project(x * hubSize, y * hubSize, z * hubSize));
    for (const [a, b] of [[0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7]]) {
      g.beginPath(); g.moveTo(...corners[a]); g.lineTo(...corners[b]);
      g.strokeStyle = palette[1]; g.lineWidth = 1.6; g.stroke();
    }
    g.beginPath();
    const hc = project(0, 0, 0);
    g.arc(hc[0], hc[1], Math.max(2.5, radius * .012), 0, Math.PI * 2);
    g.fillStyle = palette[0]; g.fill();
    // gimbal
    const gimbal = (axisA, axisB, factor, stroke, size) => {
      const points = [];
      for (let step = 0; step <= 64; step++) {
        const a = step * Math.PI * 2 / 64;
        points.push(v(factor * (axisA[0] * Math.cos(a) + axisB[0] * Math.sin(a)),
          factor * (axisA[1] * Math.cos(a) + axisB[1] * Math.sin(a)),
          factor * (axisA[2] * Math.cos(a) + axisB[2] * Math.sin(a))));
      }
      strokePath(points, stroke, size, true);
    };
    gimbal([1, 0, 0], [0, 0, 1], .4, palette[1], 1.6);
    gimbal([1, 0, 0], [0, 1, 0], .33, palette[0], 1.3);
    // running lights
    for (const light of lights) {
      const p = project(Math.cos(light.a) * .93, Math.sin(light.a) * .93, thick * 1.5);
      const energy = Math.pow(Math.max(0, Math.sin(light.t)), 6);
      g.beginPath(); g.arc(p[0], p[1], 2.2 + energy * 1.8, 0, Math.PI * 2);
      g.fillStyle = light.warm ? `rgba(255,206,120,${.4 + energy * .6})` : `rgba(110,238,248,${.4 + energy * .6})`;
      g.fill();
    }
    // sweep highlight on the rim
    const sweep = (az * 3.1) % (Math.PI * 2);
    g.shadowColor = '#6ce5ec';
    g.shadowBlur = 12;
    strokePath(ringPts(1.03, thick).slice(Math.floor(sweep * 96 / (Math.PI * 2)), Math.floor(sweep * 96 / (Math.PI * 2)) + 7), palette[2], 2.6);
    g.shadowBlur = 0;
  }

  // Space-elevator tether bundle hanging off the mega ring, with clamp modules.
  function drawTethers(g, t, ax, ay, az) {
    const unit = Math.min(width, height);
    const scale = Math.max(460, unit * 1.35);
    const R = unit * .4;
    const cx = width * .62, cy = height * .34;
    const project = (x, y, z = 0) => {
      const [rx, ry, rz] = rotate(x, y, z, ax, ay, az);
      const perspective = scale / Math.max(scale * .4, scale + rz);
      return [cx + rx * perspective, cy + ry * perspective, rz];
    };
    const rand = mulberry32(0x7E7A11);
    for (let cable = 0; cable < 6; cable++) {
      const spread = (cable - 2.5) * .17;
      const dir = [-1.9 + spread * .3, -1.1 - Math.abs(spread) * .1, .36 + spread * .5];
      const len = Math.hypot(...dir);
      const ux = dir[0] / len, uy = dir[1] / len, uz = dir[2] / len;
      const sag = 22 + rand() * 26;
      const pts = [];
      for (let n = 0; n <= 60; n++) {
        const f = n / 60;
        const reach = R * (1.05 + 3.4 * f);
        const drop = Math.sin(f * Math.PI) * sag * (0.4 + f);
        pts.push([ux * reach, uy * reach + drop * .4, uz * reach + drop * .6]);
      }
      // dark under-cable for weight, then the lit line
      g.beginPath();
      for (let n = 0; n < pts.length; n++) {
        const [x, y] = project(...pts[n]);
        if (!n) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.strokeStyle = 'rgba(8,14,20,.55)';
      g.lineWidth = 4.5;
      g.stroke();
      g.beginPath();
      for (let n = 0; n < pts.length; n++) {
        const [x, y] = project(...pts[n]);
        if (!n) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.strokeStyle = cable % 2 ? 'rgba(168,196,208,.5)' : 'rgba(122,162,178,.42)';
      g.lineWidth = cable === 2 ? 2.4 : 1.5;
      g.stroke();
      for (let k = 4; k < 60; k += 8) {
        const [x, y] = project(...pts[k]);
        g.fillStyle = 'rgba(196,214,222,.75)';
        g.fillRect(x - 3, y - 1.8, 6, 3.6);
        const blink = Math.pow(Math.max(0, Math.sin(t * 1.7 + cable + k)), 8);
        if (blink > .05) {
          g.beginPath(); g.arc(x, y - 4.4, 1.4, 0, Math.PI * 2);
          g.fillStyle = `rgba(255,120,110,${(.3 + blink * .7).toFixed(3)})`;
          g.fill();
        }
      }
    }
  }

  // Distant yard craft from the original field, kept as background traffic.
  const orbits = [
    {x: .1, y: .88, r: .2, phase: 3.9, speed: .05, drift: .5, tint: 'cyan', kind: 'gyro'},
    {x: .9, y: .1, r: .14, phase: 1.7, speed: -.04, drift: .45, tint: 'gold', kind: 'array'},
    {x: .04, y: .16, r: .12, phase: 4.6, speed: -.03, drift: .3, tint: 'cyan', kind: 'rotor'}
  ];

  function drawCraft(g, time, index, orbit) {
    const unit = Math.min(width, height);
    const scale = Math.max(460, unit * 1.35);
    const small = orbit.r < .15;
    const palette = palettes[orbit.tint];
    const phase = orbit.phase;
    const centerX = width * (orbit.x + orbit.drift * .2 * Math.sin(time * (.0037 + index * .0004) + phase)) + pointer.x * (index % 2 ? -4 : 4);
    const centerY = height * (orbit.y + orbit.drift * .18 * Math.sin(time * (.0043 + index * .0005) + phase * 1.7)) + pointer.y * (index % 2 ? 3 : -3);
    const radius = unit * orbit.r;
    const ax = time * orbit.speed + phase;
    const ay = time * orbit.speed * .73 - phase * .7;
    const az = -time * orbit.speed * .61 + phase * .4;
    g.globalAlpha = small ? .7 : .92;
    const project = (x, y, z = 0) => {
      const [rx, ry, rz] = rotate(x, y, z, ax, ay, az);
      const perspective = scale / Math.max(scale * .4, scale + rz);
      return [centerX + rx * perspective, centerY + ry * perspective];
    };
    const v = (x, y, z = 0) => [radius * x, radius * y, radius * z];
    const line3 = (a, b, stroke, size) => {
      const p = project(...a), q = project(...b);
      g.beginPath(); g.moveTo(...p); g.lineTo(...q);
      g.strokeStyle = stroke; g.lineWidth = size; g.stroke();
    };
    const face3 = (points, fill, stroke) => {
      g.beginPath();
      points.forEach((point, n) => {
        const [x, y] = project(...point);
        if (!n) g.moveTo(x, y); else g.lineTo(x, y);
      });
      g.closePath(); g.fillStyle = fill; g.fill();
      g.strokeStyle = stroke; g.lineWidth = .8; g.stroke();
    };
    const joint3 = (point, size) => {
      const [x, y] = project(...point);
      g.beginPath(); g.arc(x, y, size, 0, Math.PI * 2);
      g.fillStyle = 'rgba(209,222,216,.8)'; g.fill();
    };
    const trace3 = (points, stroke, size, closed) => {
      for (let n = 1; n < points.length; n++) line3(points[n - 1], points[n], stroke, size);
      if (closed) line3(points[points.length - 1], points[0], stroke, size);
    };
    const circle3 = (center, axisA, axisB, factor, stroke, size) => {
      const points = [];
      for (let step = 0; step < 48; step++) {
        const a = step * Math.PI * 2 / 48;
        points.push(center.map((n, k) => n + radius * factor * (axisA[k] * Math.cos(a) + axisB[k] * Math.sin(a))));
      }
      trace3(points, stroke, size, true);
    };
    const metal = 'rgba(164,190,198,.34)', shadowMetal = 'rgba(83,123,139,.24)', brightMetal = 'rgba(209,222,216,.8)';
    if (orbit.kind === 'gyro') {
      circle3(v(0, 0, 0), [1, 0, 0], [0, 1, 0], .91, brightMetal, 3);
      circle3(v(0, 0, 0), [1, 0, 0], [0, 0, 1], .77, palette[0], 2.2);
      circle3(v(0, 0, 0), [0, 1, 0], [0, 0, 1], .63, metal, 2);
      for (let n = 0; n < 12; n++) {
        const a = n * Math.PI / 6;
        line3(v(.58 * Math.cos(a), .58 * Math.sin(a), .16 * (n % 2 ? 1 : -1)),
          v(.91 * Math.cos(a), .91 * Math.sin(a), 0), n % 3 ? shadowMetal : brightMetal, n % 3 ? 1 : 2);
        if (n % 3 === 0) joint3(v(.91 * Math.cos(a), .91 * Math.sin(a), 0), 2.3);
      }
      const core = [];
      for (let n = 0; n < 8; n++) core.push(v(.27 * Math.cos(n * Math.PI / 4), .27 * Math.sin(n * Math.PI / 4), n % 2 ? .13 : -.13));
      trace3(core, brightMetal, 1.6, true);
      for (let n = 0; n < 4; n++) line3(core[n], core[n + 4], palette[1], 1);
    } else if (orbit.kind === 'array') {
      for (const x of [-.12, .12]) for (const z of [-.13, .13])
        line3(v(x, -1.18, z), v(x, 1.05, z), brightMetal, 1.8);
      for (const y of [-1.08, -.65, -.22, .22, .65, 1])
        trace3([v(-.14, y, -.15), v(.14, y, -.15), v(.14, y, .15), v(-.14, y, .15)], metal, 1, true);
      for (const side of [-1, 1]) {
        line3(v(side * .14, -.45, 0), v(side * 1.22, -.45, 0), brightMetal, 2.5);
        line3(v(side * .14, .45, 0), v(side * 1.22, .45, 0), brightMetal, 2.5);
        for (let cell = 0; cell < 4; cell++) {
          const near = side * (.24 + cell * .24), far = side * (.44 + cell * .24);
          face3([v(near, -.42, .035), v(far, -.42, .035), v(far, .42, .035), v(near, .42, .035)],
            cell % 2 ? 'rgba(30,78,91,.48)' : 'rgba(107,150,162,.37)', brightMetal);
          joint3(v(far, .42, .05), 1.4);
        }
      }
      line3(v(0, -1.18, 0), v(0, -1.7, 0), palette[0], 1.4);
      joint3(v(0, -1.7, 0), 2.8);
    } else {
      circle3(v(0, 0, -.16), [1, 0, 0], [0, 1, 0], .31, metal, 2);
      circle3(v(0, 0, .17), [1, 0, 0], [0, 1, 0], .24, palette[2], 1.6);
      for (let arm = 0; arm < 6; arm++) {
        const a = arm * Math.PI / 3 + phase;
        const point = (r, angle, z = 0) => v(r * Math.cos(angle), r * Math.sin(angle), z);
        line3(point(.2, a, -.1), point(.94, a, .12), brightMetal, 2);
        face3([point(.73, a - .12, .12), point(1.05, a - .11, .14), point(1.05, a + .11, .14), point(.73, a + .12, .12)],
          arm % 2 ? 'rgba(54,103,118,.45)' : 'rgba(142,169,170,.46)', brightMetal);
        joint3(point(.94, a, .15), 2.7);
      }
    }
    g.shadowColor = orbit.tint === 'gold' ? '#eac27b' : '#6ce5ec';
    g.shadowBlur = 10;
    joint3(v(0, 0, 0), small ? 2.5 : 3.5);
    g.shadowBlur = 0;
    g.globalAlpha = 1;
  }

  function drawCockpit(g) {
    const inset = Math.min(width, height) * .05;
    g.save();
    g.filter = 'blur(7px)';
    g.beginPath();
    if (g.roundRect) g.roundRect(inset * .6, inset * .6, width - inset * 1.2, height - inset * 1.2, inset * 2.6);
    else g.rect(inset * .6, inset * .6, width - inset * 1.2, height - inset * 1.2);
    g.lineWidth = inset * .9;
    const hull = g.createLinearGradient(0, 0, width, height);
    hull.addColorStop(0, 'rgba(10,16,24,.6)');
    hull.addColorStop(.45, 'rgba(24,38,48,.46)');
    hull.addColorStop(1, 'rgba(8,13,20,.56)');
    g.strokeStyle = hull;
    g.stroke();
    g.lineWidth = Math.max(1.2, inset * .09);
    g.strokeStyle = 'rgba(148,186,204,.13)';
    g.stroke();
    g.filter = 'blur(2px)';
    g.strokeStyle = 'rgba(110,214,255,.18)';
    g.lineWidth = 1.2;
    const holo = (x, y, w, h) => {
      g.strokeRect(x, y, w, h);
      g.beginPath();
      for (let line = 1; line < 5; line++) {
        g.moveTo(x + w * .08, y + h * line / 5);
        g.lineTo(x + w * (.4 + (line % 3) * .2), y + h * line / 5);
      }
      g.stroke();
    };
    holo(inset * 1.8, height * .68, width * .13, height * .17);
    holo(width - inset * 1.9 - width * .09, height * .13, width * .09, height * .12);
    g.restore();
  }

  function draw(time) {
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    pointer.x += (pointer.tx - pointer.x) * .035;
    pointer.y += (pointer.ty - pointer.y) * .035;
    if (sky) {
      const diag = Math.hypot(width, height);
      const side = diag * 1.18;
      context.save();
      context.translate(width * .5 + pointer.x * 2, height * .5 + pointer.y * 1.5);
      context.rotate(time * .004);
      context.drawImage(sky, -side / 2, -side / 2, side, side);
      context.restore();
    }
    drawGalacticCurrent(context, time);
    drawGalacticFlares(context, time);
    const unit = Math.min(width, height);
    const megaAx = .9 + Math.sin(time * .05) * .12 + pointer.y * .08;
    const megaAy = .5 + Math.sin(time * .04 + 1.3) * .1 + pointer.x * .09;
    const megaAz = time * .05;
    for (const glow of [[.62,.36,.33,'rgba(72,212,228,.14)'],[.15,.76,.22,'rgba(238,187,104,.12)']]) {
      const [x,y,r,color]=glow;
      const light=context.createRadialGradient(width*x,height*y,0,width*x,height*y,unit*r);
      light.addColorStop(0,color);light.addColorStop(1,'rgba(0,0,0,0)');
      context.fillStyle=light;context.fillRect(0,0,width,height);
    }
    torusStation(context, unit * .17, width * .15, height * .76,
      1.2 + Math.sin(time * .06) * .1, -.4, -time * .075, 'gold', [], 20);
    drawTethers(context, time, megaAx, megaAy, megaAz);
    torusStation(context, unit * .4, width * .62, height * .36, megaAx, megaAy, megaAz, 'cyan',
      Array.from({length: 12}, (n, i) => ({a: i * Math.PI * 2 / 12 + .3, t: time * 1.4 + i * 1.7, warm: i % 3 === 0})), 30);
    for (const [index, orbit] of orbits.entries()) drawCraft(context, time, index, orbit);
    drawMeteors(context, time);
    const diag = Math.hypot(width, height);
    const vig = context.createRadialGradient(width * .5, height * .5, diag * .16, width * .5, height * .5, diag * .6);
    vig.addColorStop(0, 'rgba(2,4,12,0)');
    vig.addColorStop(.75, 'rgba(2,4,12,.18)');
    vig.addColorStop(1, 'rgba(1,2,8,.43)');
    context.fillStyle = vig;
    context.fillRect(0, 0, width, height);
    drawCockpit(context);
  }

  const tick = stamp => {
    if (stamp >= scrollSettlesAt && stamp - lastPaint >= 33) {
      draw(stamp / 1000);
      lastPaint = stamp;
    }
    frame = requestAnimationFrame(tick);
  };

  const resize = () => {
    width = window.innerWidth;
    height = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      sky = buildSky();
      if (reducedMotion) draw(8);
    }, 180);
  };

  window.addEventListener('resize', resize, {passive: true});
  document.addEventListener('scroll', () => {
    scrollSettlesAt = performance.now() + 180;
  }, {capture: true, passive: true});
  if (!reducedMotion) {
    window.addEventListener('pointermove', event => {
      if (event.pointerType !== 'mouse') return;
      pointer.tx = (event.clientX / Math.max(width, 1) - .5) * 2;
      pointer.ty = (event.clientY / Math.max(height, 1) - .5) * 2;
    }, {passive: true});
    document.addEventListener('pointerleave', () => {pointer.tx = 0; pointer.ty = 0});
    window.addEventListener('blur', () => {pointer.tx = 0; pointer.ty = 0});
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) cancelAnimationFrame(frame);
      else frame = requestAnimationFrame(tick);
    });
  }
  resize();
  sky = buildSky();
  if (reducedMotion) {
    draw(8);
  } else {
    frame = requestAnimationFrame(stamp => {
      draw(stamp / 1000);
      lastPaint = stamp;
      frame = requestAnimationFrame(tick);
    });
  }
}

// Stable mobile keyboard overlay: no automatic page pan or focus after dismissal.
function installMobileKeyboard(win=window,doc=document){
  if(!win.MarketDevice?.isPhone?.())return null;
  const editable=node=>node?.matches?.('textarea,input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="hidden"]):not([type="file"]):not([type="range"]):not([type="color"]),[contenteditable="true"]')&&!node.disabled&&!node.readOnly;
  const rawView=()=>({width:win.visualViewport?.width||win.innerWidth,height:win.visualViewport?.height||win.innerHeight});
  let pinned=null,dismissTimer=null,frame=null,pointer=null;
  function release(){if(!pinned)return;pinned=null;doc.documentElement.dataset.keyboardOpen='false';win.clearTimeout(dismissTimer);dismissTimer=null;if(win.dispatchEvent&&win.Event)win.dispatchEvent(new win.Event('resize'))}
  function restoreOpeningScroll(){
    if(!pinned||pinned.manualScroll||Date.now()-pinned.started>650)return;
    for(const row of pinned.surfaces){if(row.node.scrollTop!==row.top)row.node.scrollTop=row.top;if(row.node.scrollLeft!==row.left)row.node.scrollLeft=row.left}
    if((win.scrollY||0)!==pinned.y||(win.scrollX||0)!==pinned.x)win.scrollTo(pinned.x,pinned.y);
  }
  function begin(node){
    if(!editable(node))return;
    if(!pinned){const view=win.MarketDevice.viewport?.()||rawView(),surfaces=[];for(let parent=node.parentElement;parent;parent=parent.parentElement)surfaces.push({node:parent,top:parent.scrollTop||0,left:parent.scrollLeft||0});pinned={width:view.width,rawWidth:rawView().width,height:view.height,x:win.scrollX||0,y:win.scrollY||0,surfaces,started:Date.now(),seen:false,manualScroll:false}}
    doc.documentElement.dataset.keyboardOpen='true';win.clearTimeout(dismissTimer);dismissTimer=null;
    if(win.requestAnimationFrame){if(frame)win.cancelAnimationFrame(frame);frame=win.requestAnimationFrame(()=>{frame=null;restoreOpeningScroll()})}
  }
  function observe(){
    if(!pinned)return;const view=rawView();
    if(Math.abs(view.width-pinned.rawWidth)>50){doc.activeElement?.blur?.();release();return}
    if(pinned.height-view.height>150)pinned.seen=true;
    restoreOpeningScroll();
    if(pinned.seen&&view.height>=pinned.height-120){
      if(dismissTimer)return;const owner=pinned;
      // Safari can close its keyboard while leaving the input focused. Blur once;
      // never re-focus it in viewport callbacks, so the down arrow stays effective.
      dismissTimer=win.setTimeout(()=>{dismissTimer=null;if(pinned!==owner||rawView().height<owner.height-120)return;if(editable(doc.activeElement))doc.activeElement.blur();release()},120);
    }
  }
  doc.addEventListener('focusin',event=>begin(event.target),true);
  doc.addEventListener('focusout',()=>win.setTimeout(()=>{if(!pinned||editable(doc.activeElement))return;if(rawView().height>=pinned.height-120)release()},0),true);
  doc.addEventListener('pointerdown',event=>{pointer={x:event.clientX,y:event.clientY};if(editable(event.target))begin(event.target);else if(pinned&&editable(doc.activeElement))doc.activeElement.blur()},true);
  doc.addEventListener('pointermove',event=>{if(pinned&&pointer&&Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)>8)pinned.manualScroll=true},{passive:true});
  doc.addEventListener('pointerup',()=>{pointer=null},{passive:true});
  win.visualViewport?.addEventListener('resize',observe,{passive:true});win.visualViewport?.addEventListener('scroll',observe,{passive:true});win.addEventListener('resize',observe,{passive:true});win.addEventListener('scroll',restoreOpeningScroll,{passive:true});
  doc.addEventListener('visibilitychange',()=>{if(doc.hidden){doc.activeElement?.blur?.();release()}});
  const api={lockedViewport:()=>pinned?{width:pinned.width,height:pinned.height,offsetTop:0}:null,dismiss(){if(editable(doc.activeElement))doc.activeElement.blur();observe();if(pinned&&!pinned.seen)release()}};
  win.MarketKeyboard=api;return api;
}
installMobileKeyboard();
