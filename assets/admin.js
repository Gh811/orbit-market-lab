(()=>{'use strict';
const $=id=>document.getElementById(id);
let csrf='',timer=0,busy=false,banReasons=[];
async function api(path,body){
 const r=await fetch('/api/admin/'+path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json','X-Admin-CSRF':csrf}:undefined,body:body?JSON.stringify(body):undefined});
 const data=await r.json();if(!r.ok){if(r.status===401&&path!=='login')showLogin();throw Error(data.error||'操作未完成')}return data;
}
function showLogin(){clearTimeout(timer);csrf='';$('login').hidden=false;$('dashboard').hidden=true;$('logout').hidden=true;if($('banDialog').open)$('banDialog').close()}
function show(data){
 csrf=data.csrf||csrf;banReasons=data.banReasons||banReasons;
 $('login').hidden=true;$('dashboard').hidden=false;$('logout').hidden=false;
 $('total').textContent=data.totalUsers;$('online').textContent=data.onlineUsers;
 renderUsers(data.users||[]);$('regions').replaceChildren();
 for(const region of data.regions||[]){const row=document.createElement('p'),label=document.createElement('span'),count=document.createElement('strong');label.textContent=region.region||'未知';count.textContent=region.users+' 人';row.append(label,count);$('regions').append(row)}
 $('updated').textContent='更新于 '+new Date().toLocaleTimeString('zh-CN');clearTimeout(timer);if(!document.hidden)timer=setTimeout(refresh,15000);
}
function chooseBan(user){
 const dialog=$('banDialog'),form=$('banForm'),select=$('banReason');form.reset();$('banError').textContent='';$('banNoteLabel').hidden=true;
 $('banTarget').textContent=user.username+' · '+user.userId;
 select.replaceChildren(new Option('请选择理由',''));for(const reason of banReasons)select.append(new Option(reason.label,reason.id));
 select.onchange=()=>{$('banNoteLabel').hidden=select.value!=='other';$('banNote').required=select.value==='other'};
 return new Promise(resolve=>{let done=false;const finish=value=>{if(done)return;done=true;dialog.close();resolve(value)};form.onsubmit=event=>{event.preventDefault();if(!form.reportValidity())return;finish({reason:select.value,note:$('banNote').value.trim()})};$('banCancel').onclick=()=>finish(null);dialog.oncancel=event=>{event.preventDefault();finish(null)};dialog.onclose=()=>{if(!done){done=true;resolve(null)}};dialog.showModal()});
}
function renderUsers(users){
 const host=$('users');host.replaceChildren();
 const categories=[['online','在线用户'],['offline','离线用户'],['banned','已封禁用户']];
 for(const [state,label]of categories){const members=users.filter(u=>(u.banned?'banned':u.online?'online':'offline')===state);if(!members.length)continue;
  const group=document.createElement('section');group.className='userGroup '+state;const heading=document.createElement('h3');heading.textContent=label+' · '+members.length;group.append(heading);
  for(const user of members){
   const row=document.createElement('article');row.className='userRow '+state;row.dataset.userId=String(user.id);
   const identity=document.createElement('div'),name=document.createElement('strong'),badge=document.createElement('span'),detail=document.createElement('small');
   name.textContent=user.username;badge.className='userState '+state;badge.textContent=user.banned?'已封禁':user.online?'在线':'离线';detail.textContent='ID '+user.userId+' · IP '+(user.ipRegion||'未知');identity.append(name,badge,detail);
   if(user.banned&&user.banReason){const reason=document.createElement('p');reason.className='banReason';reason.textContent='原因：'+user.banReason;if(user.bannedAt){const time=document.createElement('small');time.textContent=new Date(user.bannedAt*1000).toLocaleString('zh-CN');reason.append(time)}identity.append(reason)}
   const actions=document.createElement('div');actions.className='userActions';const offline=document.createElement('button');offline.type='button';offline.textContent='下线';offline.onclick=async()=>{if(!confirm('确认让 '+user.username+' 退出登录？'))return;offline.disabled=true;try{show(await api('offline-user',{userId:user.id}));$('message').textContent=user.username+' 的登录已失效'}catch(e){$('message').textContent=e.message;offline.disabled=false}};
   const button=document.createElement('button');button.type='button';button.className=user.banned?'unbanButton':'banButton';button.textContent=user.banned?'解封':'封禁';
   button.onclick=async()=>{let selection={};if(user.banned){if(!confirm('确认解封账号 '+user.username+'？'))return}else{selection=await chooseBan(user);if(!selection)return}button.disabled=true;try{show(await api('user-status',{userId:user.id,banned:!user.banned,...selection}));$('message').textContent=user.banned?'账号已解封':'账号已封禁，现有登录已失效'}catch(e){$('message').textContent=e.message;button.disabled=false}};
   actions.append(offline,button);row.append(identity,actions);group.append(row);
  }host.append(group);
 }
}
async function refresh(){if(busy)return;busy=true;try{show(await api('session'))}catch(e){if(csrf)$('message').textContent=e.message}finally{busy=false}}
$('login').onsubmit=async event=>{event.preventDefault();const button=$('login').querySelector('button');button.disabled=true;$('message').textContent='';try{show(await api('login',{username:$('login').elements.username.value.trim(),password:$('login').elements.password.value}));$('login').elements.password.value=''}catch(e){$('message').textContent=e.message}finally{button.disabled=false}};
$('offline').onclick=async()=>{if(!confirm('确认让所有普通用户退出登录？账户和记录会保留。'))return;const button=$('offline');button.disabled=true;try{const data=await api('offline-all',{});show(data);$('message').textContent='已使 '+data.offlineUsers+' 位用户的登录失效'}catch(e){$('message').textContent=e.message}finally{button.disabled=false}};
$('logout').onclick=async()=>{try{await api('logout',{});showLogin();$('message').textContent='已退出管理后台'}catch(e){$('message').textContent=e.message}};
$('refresh').onclick=refresh;document.addEventListener('visibilitychange',()=>{clearTimeout(timer);if(!document.hidden&&csrf&&!$('banDialog').open)refresh()});refresh();
})();
