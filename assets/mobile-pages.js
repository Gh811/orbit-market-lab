// 手机独立页面与返回栈；沿用原有表单、资料和图表事件，不修改行情/账户存储。
(()=>{'use strict';
  const mobile=()=>window.MarketDevice?.isMobile?.()??innerWidth<=720;
  const $=id=>document.getElementById(id);
  const token='orbit-'+Math.random().toString(36).slice(2);
  const navKey='orbitMobilePage';
  let actions={},applying=false,backPending=false,homeReturnPending=false,parentReturnPending=null,subpage='menu',edge=null,swallowClickUntil=0;
  const dialogStack=[];
  // Only entries in this directory are pages. Everything else is an operation.
  const pageDirectory=Object.freeze({
    home:{title:'主界面',parent:null},
    deck:{title:'卡牌',parent:'home'},chart:{title:'K 线',parent:'deck'},
    manager:{title:'分组管理',parent:'home'},
    researchDialog:{title:'策略',parent:'home'},walletDialog:{title:'我的资产',parent:'home'},petNewsDialog:{title:'新闻',parent:'home'},petHelpDialog:{title:'指南',parent:'home'},
    petLoreDialog:{title:'图鉴',parent:'home'},petWorldDialog:{title:'伙伴档案',parent:'petLoreDialog'},
    authDialog:{title:'个人',parent:'home'},mobilePasswordPage:{title:'修改密码',parent:'authDialog'},
    mobileMoreDialog:{title:'功能',parent:'home'},
    'more:settings':{title:'显示设置',parent:'mobileMoreDialog'},
    'more:search':{title:'搜索添加',parent:'mobileMoreDialog'},
    'more:news':{title:'相关新闻',parent:'mobileMoreDialog'},
    'more:insight':{title:'图表解读',parent:'mobileMoreDialog'},
    groupManageDialog:{title:'管理分组',parent:'home'},
    alertsDialog:{title:'提醒记录',parent:'home'},
    infoDialog:{title:'标的资料',parent:'source'},petAssetSearchDialog:{title:'添加标的',parent:'manager'}
  });
  const pageId=r=>r.kind==='dialog'?(r.id==='mobileMoreDialog'&&r.sub&&r.sub!=='menu'?'more:'+r.sub:r.id):r.kind;
  function parentRoute(r){
    const parent=pageDirectory[pageId(r)]?.parent;
    if(!parent||parent==='home')return {kind:'home'};
    if(parent==='source')return r.source||{kind:'home'};
    if(parent==='deck')return {...r,kind:'deck'};
    if(parent==='manager')return r.source?.kind==='manager'?r.source:{kind:'manager',group:r.source?.group};
    return {kind:'dialog',id:parent,sub:null,source:r.source||{kind:'home'}};
  }

  const titles={authDialog:'个人',infoDialog:'标的资料',alertsDialog:'提醒记录',mobileMoreDialog:'功能',groupManageDialog:'分组',watchActionDialog:'自选操作',groupConfirmDialog:'确认',mobilePasswordPage:'修改密码'};
  const menu=[['search','搜索添加'],['settings','显示设置'],['news','相关新闻'],['insight','图表解读']];
  const moreNodes=[];
  let passwordMarker=null;
  function topDialog(){return dialogStack.filter(d=>d.open).at(-1)||null}
  function deckRoute(){
    const deck=$('petDeck');if(deck&&!deck.hidden)return {kind:deck.classList.contains('deckChartMode')?'chart':'deck',group:deck.dataset.groupId,index:Number(deck.dataset.index)||0};
    return {kind:'home'};
  }
  function surfaceRoute(){
    const manager=$('petManager');
    if(manager&&!manager.hidden)return {kind:'manager',group:manager.dataset.groupId,draft:actions.managerDraft?.()||null,source:deckRoute()};
    return deckRoute();
  }
  function route(){
    const dialog=dialogStack.filter(d=>d.open&&pageDirectory[d.id]).at(-1);
    if(dialog)return {kind:'dialog',id:dialog.id,sub:dialog.id==='mobileMoreDialog'?subpage:dialog.id==='petNewsDialog'?($('petNewsPicker')?.hidden?'news':'picker'):null,source:surfaceRoute()};
    return surfaceRoute();
  }
  const key=r=>JSON.stringify(r);
  // A history entry represents a page; its selected card or form values are state.
  const pageKey=r=>JSON.stringify([pageId(r),r.kind==='dialog'?null:r.group||null]);
  function stateFor(r,depth){return {...(history.state||{}),[navKey]:{token,route:r,depth}}}
  function remember(replace=false){
    if(!mobile()||applying)return;
    const current=route(),old=history.state?.[navKey];
    if(replace||!old||old.token!==token)history.replaceState(stateFor(current,old?.token===token?old.depth:0),'');
    else if(key(old.route)!==key(current)){
      if(pageKey(old.route)===pageKey(current)||(old.route.kind==='manager'&&['home','deck','chart'].includes(current.kind)))history.replaceState(stateFor(current,old.depth),'');
      else history.pushState(stateFor(current,old.depth+1),'');
    }
  }
  function directBack(){
    const dialog=topDialog();
    if(dialog){
      if(dialog.id==='mobileMoreDialog'&&subpage!=='menu'){setMorePage('menu');return}
      // 登录仍由原有账户锁控制，返回不会授予任何数据权限。
      dialog.close();return;
    }
    if($('petManager')&&!$('petManager').hidden){actions.closeManager?.();return}
    if($('petDeck')?.classList.contains('deckChartMode'))actions.closeChart?.();
    else if($('petDeck')&&!$('petDeck').hidden)actions.closeDeck?.();
  }
  function returnHome(){
    if(applying||backPending)return;
    const state=history.state?.[navKey];
    if(state?.token===token&&state.depth>0){
      backPending=true;homeReturnPending=true;history.go(-state.depth);
    }else{applyRoute({kind:'home'});history.replaceState(stateFor({kind:'home'},0),'')}
  }
  function back(){
    if(applying||backPending)return;
    const dialog=topDialog();
    if(dialog&&!pageDirectory[dialog.id]){dialog.close();remember(true);return}
    const current=route(),parent=parentRoute(current);
    if(parent.kind==='home'){returnHome();return}
    const state=history.state?.[navKey];
    if(state?.token===token&&state.depth>0){
      backPending=true;parentReturnPending=parent;history.back();
    }else{applyRoute(parent);history.replaceState(stateFor(parent,0),'')}
  }
  // Close an embedded page without navigating or replacing the parent document.
  function closeLocalDialog(dialog){
    if(!dialog?.open)return;
    applying=true;backPending=false;homeReturnPending=false;parentReturnPending=null;
    dialog.close();const i=dialogStack.indexOf(dialog);if(i>=0)dialogStack.splice(i,1);
    const old=history.state?.[navKey];history.replaceState(stateFor(route(),Math.max(0,(old?.depth||0)-1)),'');
    setTimeout(()=>{applying=false;remember(true)},0);
  }
  function deckBack(){back()}
  function managerBack(){back()}
  function ensureHeader(dialog){
    if(dialog.classList.contains('mobileSheet'))return;
    if(dialog.querySelector(':scope > .mobilePageHeader'))return;
    const head=document.createElement('header');head.className='mobilePageHeader';
    const button=document.createElement('button');button.type='button';button.className='mobilePageBack';button.setAttribute('aria-label','返回');
    button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 5 8.5 12 15.5 19"/></svg>';
    button.onclick=back;
    const title=document.createElement('strong');title.className='mobilePageTitle';title.textContent=titles[dialog.id]||dialog.getAttribute('aria-label')||'星轨';
    head.append(button,title);dialog.prepend(head);
  }
  function setMorePage(name){
    if(name==='search'&&document.body.classList.contains('petHomeMode')){ $('mobileMoreDialog')?.close();actions.openSearch?.();return }
    subpage=name;
    const dialog=$('mobileMoreDialog'),body=$('mobileMoreBody');if(!dialog||!body)return;
    if(!body.querySelector('.mobileFunctionMenu')){
      const list=document.createElement('nav');list.className='mobileFunctionMenu';list.setAttribute('aria-label','功能');
      for(const [id,label] of menu){const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.mobileSubpage=id;b.onclick=()=>{setMorePage(id);remember()};list.append(b)}
      body.prepend(list);
    }
    const pairs=[[$('addForm'),'search'],[$('addError'),'search'],[body.querySelector('.settings'),'settings'],[body.querySelector('.sidebarNews'),'news'],[body.querySelector('.insightDisclosure'),'insight']];
    for(const [node,id] of pairs){if(!node)continue;if(!moreNodes.includes(node))moreNodes.push(node);node.classList.toggle('mobileRouteHidden',name!==id)}
    body.querySelector('.mobileFunctionMenu').classList.toggle('mobileRouteHidden',name!=='menu');
    $('petHomeEntry')?.classList.toggle('mobileRouteHidden',name!=='menu');
    if(name==='insight'){const d=body.querySelector('.insightDisclosure');if(d)d.open=true}
    const title=dialog.querySelector('.mobilePageTitle');if(title)title.textContent=menu.find(([id])=>id===name)?.[1]||'功能';
  }
  function resetMore(){for(const node of moreNodes)node.classList.remove('mobileRouteHidden');moreNodes.length=0;$('petHomeEntry')?.classList.remove('mobileRouteHidden');subpage='menu'}
  function openPassword(){
    let dialog=$('mobilePasswordPage');
    if(!dialog){dialog=document.createElement('dialog');dialog.id='mobilePasswordPage';dialog.className='detailDialog';dialog.setAttribute('aria-label','修改密码');document.body.append(dialog);ensureHeader(dialog)}
    const form=$('passwordForm');if(!passwordMarker){passwordMarker=document.createComment('mobilePasswordReturn');form.before(passwordMarker);dialog.append(form)}
    dialog.tabIndex=-1;dialog.setAttribute('autofocus','');dialog.showModal();dialog.focus({preventScroll:true});
  }
  function restorePassword(){if(passwordMarker){passwordMarker.replaceWith($('passwordForm'));passwordMarker=null}}
  function activateDialog(dialog){
    ensureHeader(dialog);
    if(dialog.id==='mobileMoreDialog')setMorePage(subpage);
  }
  function applySurface(target){
    if(target.kind==='manager'){
      applySurface(target.source||{kind:'home'});actions.openManager?.(target.group,target.draft||null,true);return;
    }
    actions.closeManager?.();
    if(target.kind==='home'){actions.closeDeck?.();actions.goHome?.();return}
    const deck=$('petDeck');
    if(deck?.hidden||deck?.dataset.groupId!==target.group||Number(deck?.dataset.index||0)!==(target.index||0))actions.openDeck?.(target.group,target.index||0);
    if(target.kind==='chart')actions.openChart?.();else actions.closeChart?.();
  }
  function applyRoute(target){
    applying=true;
    for(const dialog of [...dialogStack].reverse())if(dialog.open&&(target.kind!=='dialog'||dialog.id!==target.id))dialog.close();
    if(target.kind==='dialog'){
      if(target.source)applySurface(target.source);
      const dialog=$(target.id);
      if(dialog&&!dialog.open){
        if(target.id==='mobileMoreDialog')$('mobileMoreButton').click();
        else if(target.id==='mobilePasswordPage')openPassword();
        else {dialog.showModal();dialog.focus({preventScroll:true});}
      }
      if(target.id==='mobileMoreDialog')setMorePage(target.sub||'menu');
      if(target.id==='petNewsDialog'&&$('petNewsPicker')){const picker=target.sub==='picker';$('petNewsPicker').hidden=!picker;$('petNewsList').hidden=picker;$('petNewsSearchButton').hidden=picker;}
    }else applySurface(target);
    setTimeout(()=>{applying=false;remember(true)},0);
  }
  window.addEventListener('popstate',e=>{backPending=false;const state=e.state?.[navKey];if(mobile()&&state?.token===token){const home=homeReturnPending,parent=parentReturnPending;homeReturnPending=false;parentReturnPending=null;const target=home?{kind:'home'}:parent||state.route;if(home||parent)history.replaceState(stateFor(target,home?0:state.depth),'');applyRoute(target)}});
  document.addEventListener('click',e=>{
    if(!mobile())return;
    if(performance.now()<swallowClickUntil){e.preventDefault();e.stopImmediatePropagation();return}
    if(e.target.closest('#passwordDetails > summary')){e.preventDefault();openPassword();return}
    if(e.target.closest('#deckClose')){e.preventDefault();e.stopImmediatePropagation();deckBack();return}
    if(e.target.closest('.petManagerBack')){e.preventDefault();e.stopImmediatePropagation();managerBack();return}
    if(e.target.closest('#petNewsBack')){e.preventDefault();e.stopImmediatePropagation();returnHome();return}
    const close=e.target.closest('dialog .dialogClose,[data-close],.mobilePageBack');
    if(close){e.preventDefault();e.stopImmediatePropagation();back()}
  },true);
  // 页内容保留原来的事件，观察开关状态来维护浏览器返回栈。
  new MutationObserver(records=>{
    for(const record of records){
      const node=record.target;
      if(node instanceof HTMLDialogElement&&record.attributeName==='open'){
        if(node.open){const i=dialogStack.indexOf(node);if(i>=0)dialogStack.splice(i,1);dialogStack.push(node);if(mobile())activateDialog(node)}
        else{const i=dialogStack.indexOf(node);if(i>=0)dialogStack.splice(i,1);if(node.id==='mobileMoreDialog')resetMore();if(node.id==='mobilePasswordPage')restorePassword()}
      }
    }
    if(mobile())remember();
  }).observe(document.body,{subtree:true,attributes:true,attributeFilter:['open','hidden','class']});
  document.addEventListener('reset',e=>{if(e.target.id==='passwordForm'&&$('mobilePasswordPage')?.open)$('mobilePasswordPage').close()},true);
  // 手机浏览器的原生返回使用 popstate；其他设备补充左边缘右滑。
  document.addEventListener('pointerdown',e=>{
    if(!mobile()||!e.isPrimary||e.clientX>22||route().kind==='home'||e.target.closest('.petSlot,input,textarea,select,button,.petSearchField,.petPouchCards'))return;
    e.stopImmediatePropagation();
    edge={id:e.pointerId,x:e.clientX,y:e.clientY,t:performance.now(),dx:0,dragging:false,node:topDialog()||($('petManager')&&!$('petManager').hidden?$('petManager'):$('petDeck'))};
  },{capture:true,passive:true});
  document.addEventListener('pointermove',e=>{
    if(!edge||edge.id!==e.pointerId)return;
    const dx=e.clientX-edge.x,dy=e.clientY-edge.y;
    if(!edge.dragging&&Math.abs(dy)>12&&Math.abs(dy)>Math.abs(dx)){edge=null;return}
    if(dx>12&&dx>Math.abs(dy)*1.3)edge.dragging=true;
    if(!edge.dragging)return;
    if(e.cancelable)e.preventDefault();e.stopImmediatePropagation();edge.dx=dx;
    edge.node.style.transition='none';edge.node.style.transform=`translateX(${Math.max(0,dx)}px)`;
  },{capture:true,passive:false});
  function endEdge(e,cancel=false){
    if(!edge||edge.id!==e.pointerId)return;
    const gesture=edge;edge=null;
    gesture.node.style.transition='transform 180ms ease';gesture.node.style.transform='';
    if(gesture.dragging){swallowClickUntil=performance.now()+300;e.stopImmediatePropagation();if(!cancel&&(gesture.dx>innerWidth*.22||(gesture.dx>40&&gesture.dx/(performance.now()-gesture.t)>.5)))back()}
  }
  document.addEventListener('pointerup',e=>endEdge(e),true);
  document.addEventListener('pointercancel',e=>endEdge(e,true),true);
  window.addEventListener('resize',()=>{if(!mobile()){edge=null;if($('mobilePasswordPage')?.open)$('mobilePasswordPage').close();for(const d of dialogStack)d.querySelector(':scope > .mobilePageHeader')?.remove();restorePassword();resetMore()}else{for(const d of dialogStack)activateDialog(d);remember(true)}});
  window.MarketMobilePages=Object.freeze({prepareDialog(){remember()},setActions(value){actions=value;for(const dialog of document.querySelectorAll('dialog[open]')){if(!dialogStack.includes(dialog))dialogStack.push(dialog);if(mobile())activateDialog(dialog)}remember(true)},showSearch(){if(mobile()){setMorePage('search');remember()}},pageDirectory,closeLocalDialog,back,deckBack,managerBack});
})();
