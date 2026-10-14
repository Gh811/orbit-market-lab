(()=>{'use strict';


const $=id=>document.getElementById(id), STORE='market_desk_v2';
const GROUP_NAME_LIMIT=4;
const HOT_GROUP_ID='ghot';
const MAX_GROUP_ASSETS=50;
function groupNameError(name){
  if(!name)return '请输入分组名称';
  if(Array.from(name).length>GROUP_NAME_LIMIT)return `分组名称最多 ${GROUP_NAME_LIMIT} 个字`;
  if(!/^[\u3400-\u9fffA-Za-z0-9]+$/u.test(name))return '分组名称只能使用中文、数字和英文字母';
  return '';
}
// 个人 5 个分组对外显示的名字：手机端优先显示伙伴名（petName），没有时回退分组名。
function groupDisplayName(group){return group?.petName||group?.name||''}
// 重名判定（忽略大小写、忽略首尾空格）：5 个分组名字必须互不相同。
// self 为正在改名/复用的分组本体，改名时与自身同名不算重复。
function groupNameTaken(name,self){
  const key=name.trim().toLowerCase();
  return groups.some(group=>group!==self&&groupDisplayName(group).toLowerCase()===key);
}
const ACCOUNT_MARKER='market_desk_account_v1', ACCOUNT_PENDING='market_desk_pending_';
const analyzeCandle=window.MarketInsight.analyzeCandle;
const analyzeStrategy=window.MarketStrategy.analyzeStrategy;
const chartViewport=window.MarketGesture.viewport;
const candleAudit=window.MarketAudit;
function openDetailDialog(dialog,focusTarget){
  if(dialog.open)return dialog;
  window.MarketMobilePages?.prepareDialog?.();
  const guestPhone=dialog.id==='authDialog'&&!accountUser&&(window.MarketDevice?.isMobile?.()??window.innerWidth<=720);
  if(guestPhone)dialog.setAttribute('autofocus','');
  dialog.showModal();
  // 浏览器会默认聚焦弹窗内第一个可聚焦控件（即右上角的 ×），Chrome 会把它判为
  // :focus-visible 而画出金色焦点环，看起来像“亮灯”。改为聚焦弹窗容器，键盘用户
  // 用 Tab 仍能移到 × 上并保留焦点环。
  (guestPhone?dialog:(focusTarget||dialog)).focus({preventScroll:true});
  return dialog;
}


let legacy={};

try{legacy=JSON.parse(localStorage.getItem('market_desk_v1')||'{}')}catch{}
// Erase the previous version's browser-stored token on this origin.
if(legacy.apiKey){delete legacy.apiKey;
try{localStorage.setItem('market_desk_v1',JSON.stringify(legacy))}catch{}}
let saved={};
try{saved=JSON.parse(localStorage.getItem(STORE)||'{}')}catch{}
let assets=Array.isArray(saved.assets)?saved.assets:Array.isArray(legacy.assets)?legacy.assets:[{type:'swap',symbol:'BTC'},{type:'swap',symbol:'ETH'}];

assets=assets.filter(a=>a&&['stock','crypto','swap','ashare'].includes(a.type)&&/^[A-Z0-9]{1,15}$/.test(a.symbol))
  .map(a=>({...a,type:assetMarketType(a)}));

let groups=Array.isArray(saved.groups)?saved.groups.filter(g=>g&&typeof g.id==='string'&&typeof g.name==='string').slice(0,10):[];

if(!groups.some(g=>g.id==='main')){groups=groups.slice(0,9);groups.unshift({id:'main',name:'自选'})}
groups=groups.map(g=>g.id==='main'?{...g,name:'自选'}:g.id===HOT_GROUP_ID?{...g,name:'热门'}:g);

assets=assets.map(a=>({...a,groupId:groups.some(g=>g.id===a.groupId)?a.groupId:'main',pinned:a.pinned===true}));
{const seen=new Set(),counts={};assets=assets.filter(a=>{const key=a.groupId+':'+a.symbol;
  if(seen.has(key)||(counts[a.groupId]||0)>=MAX_GROUP_ASSETS)return false;
  seen.add(key);counts[a.groupId]=(counts[a.groupId]||0)+1;return true})}
let activeGroupId=groups.some(g=>g.id===saved.activeGroup)?saved.activeGroup:'main';

let selected=(saved.selected||'').startsWith('ashare:')?saved.selected:'swap:'+(saved.selected||'swap:BTC').split(':').at(-1),tf=saved.tf||'1d',scheme=saved.scheme||'redUp',swing=Number(saved.swing)||1;

{const asset=assets.find(a=>a.symbol===selected.split(':').at(-1));if(asset)selected=asset.type+':'+asset.symbol}

let toggles=saved.toggles||{volume:true,levels:true,fib:true,ma:true};
let targets=saved.targets||{};
let walletHoldings=window.MarketWallet?.normalize(saved.wallet)||(Array.isArray(saved.wallet)?saved.wallet:[]);
let accountUser=null,accountId=null,accountSpace='',accountSaveTimer=null,accountSaveChain=Promise.resolve(true),authMode='login';
let registrationPetKind=0,companionWarmScheduled=false;
let accountAvatarKind=0,accountAvatarChoice=0,accountAvatarCanChange=true,accountAvatarBusy=false;
let accountRevision=0,accountBase=null,accountDirty=false,accountChecking=false;

let candles=[],quotes={},miniData={},miniLoading=new Set(),miniErrorUntil={},profiles={},profileLoading=new Set(),profileErrorUntil={},searchResults=[],searchChoice=null,searchIndex=-1,searchSerial=0,okxWS=null,wsRetry=null,wsPing=null,chartPlot=null,feed=[],recentTicks={},lastAlerts={},seenNews=new Set(),newsReady=new Set(),watchTimer=null,drawTimer=null;
let alreadyInGroupTimer=null;
let searchSuggestionsTimer=null;
let searchPersistTimer=null;
let infoPreviewAsset=null;
let hotDay='',hotUpdatedAt=0;
let hotStale=false;
let hotLoading=null;
const miniJobs=[],profileJobs=[],queuedMini=new Set(),queuedProfile=new Set();
let activeMiniJobs=0,activeProfileJobs=0,backgroundRequestsReady=false;
function queueMini(a,refresh=false){
  const key=assetId(a);
  if((!refresh&&miniData[key]?.length)||miniLoading.has(key)||queuedMini.has(key))return;
  queuedMini.add(key);miniJobs.push({...a});pumpBackgroundRequests();
}
function queueProfile(a){
  const key=assetId(a);
  if((profiles[key]&&Date.now()-(profileCachedAt[key]||0)<PROFILE_FRESH_MS)||profileLoading.has(key)||queuedProfile.has(key))return;
  queuedProfile.add(key);profileJobs.push({...a});pumpBackgroundRequests();
}
function pumpBackgroundRequests(){
  if(!backgroundRequestsReady||document.hidden||navigator.onLine===false)return;
  while(activeMiniJobs<2&&miniJobs.length){
    const item=miniJobs.shift(),key=assetId(item);
    queuedMini.delete(key);activeMiniJobs++;
    loadMini(item).finally(()=>{activeMiniJobs--;pumpBackgroundRequests()});
  }
  while(activeProfileJobs<1&&profileJobs.length){
    const item=profileJobs.shift(),key=assetId(item);
    queuedProfile.delete(key);activeProfileJobs++;
    loadProfile(item).finally(()=>{activeProfileJobs--;pumpBackgroundRequests()});
  }
}
// Public data persists on this phone; account state remains in its separate store.
let pageCacheClosed=false;
let publicMarketCache;
try{publicMarketCache=window.MarketData?.createPublicCache?.(localStorage,sessionStorage)}catch{}
publicMarketCache||={getItem(key){try{return sessionStorage.getItem(key)}catch{return null}},setItem(key,value){try{sessionStorage.setItem(key,value)}catch{}}};
window.addEventListener('pagehide',event=>{
  if(event.persisted)return;
  pageCacheClosed=true;clearTimeout(candleSessionTimer);
  window.MarketData?.clearTransientCache?.();
});
const PROFILE_CACHE='market_profiles_v29';
const PROFILE_FRESH_MS=30*86400000;
let assetProfileCache,assetImageCache;try{assetProfileCache=window.MarketData?.createAssetCache?.(localStorage);if(window.caches)assetImageCache=window.MarketData?.createAssetImageCache?.(window.caches)}catch{}
function syncProfilePins(){if(!accountUser)return;const retained=assets.filter(a=>a.groupId!==HOT_GROUP_ID);assetProfileCache?.setPinned(retained.map(a=>a.type+':'+a.symbol));assetImageCache?.setPinned(retained.map(a=>a.symbol))}
syncProfilePins();
const profileRetryTimers=new Map();
const MINI_STORE='market_mini_cache_v1';
const miniFetchedAt={};
try{const savedMinis=JSON.parse(publicMarketCache.getItem(MINI_STORE)||'{}');
  for(const [key,entry] of Object.entries(savedMinis))
    if(Date.now()-entry.t<24*3600000&&Array.isArray(entry.rows)){miniData[key]=entry.rows;miniFetchedAt[key]=entry.t}} catch{}
let profileCachedAt={};
try{const cache=JSON.parse(publicMarketCache.getItem(PROFILE_CACHE)||'{}');
  for(const [id,record] of Object.entries(cache))if(record&&record.p&&id===record.p.type+':'+record.p.symbol&&window.MarketData.profileReady(record.p)&&Date.now()-record.t<30*86400000){
    assetProfileCache?.put(id,record.p,record.t);profiles[id]=record.p;profileCachedAt[id]=(record.p.incomplete||record.p.stale)?0:record.t;
  }}catch{}
const newsPreviewCache=new Map();
const CATALOG_STORE='okx_swap_catalog_v2';
let instrumentCatalog=null,catalogLoading=null,catalogFetchedAt=0;
let catalogSearchIndex=null;
// OKX's contract catalogue supplies codes but often omits company names.
// Keep these labels local to the stock-linked (category 3) contracts.
const STOCK_NAMES={
  CXMT:['长鑫存储','长鑫科技','DRAM'],ZHONGJI:['中际旭创','光模块'],
  ZHIPU:['智谱','GLM'],XIAOMI:['小米集团','小米'],
  ACN:['Accenture','埃森哲'],ADBE:['Adobe'],ALAB:['Astera Labs','阿斯特拉实验室'],
  AMAT:['Applied Materials','应用材料'],AMD:['AMD','超威半导体'],
  AMZN:['Amazon','亚马逊'],APP:['AppLovin'],ARM:['Arm Holdings','安谋'],
  ASML:['ASML','阿斯麦'],ASTS:['AST SpaceMobile'],AVGO:['Broadcom','博通'],
  COIN:['Coinbase'],CRWV:['CoreWeave'],
  COST:['Costco','好市多'],CRM:['Salesforce','赛富时'],CRWD:['CrowdStrike'],
  CSCO:['Cisco','思科'],DDOG:['Datadog'],DELL:['Dell Technologies','戴尔'],
  DKNG:['DraftKings'],GEV:['GE Vernova','通用电气能源'],GLW:['Corning','康宁'],
  GOOGL:['Alphabet Google','谷歌','Alphabet'],HIMS:['Hims & Hers','好姆斯'],
  ANTHROPIC:['Anthropic','安特罗匹克'],OPENAI:['OpenAI','开放人工智能'],
  HOOD:['Robinhood','罗宾汉'],HPE:['Hewlett Packard Enterprise','慧与'],
  IBM:['IBM','国际商业机器'],IONQ:['IonQ'],
  INTC:['Intel','英特尔'],ISRG:['Intuitive Surgical','直觉外科'],
  JNJ:['Johnson & Johnson','强生'],KLAC:['KLA','科磊'],KO:['Coca-Cola','可口可乐'],
  LLY:['Eli Lilly','礼来'],LRCX:['Lam Research','泛林集团'],
  MARA:['MARA Holdings','马拉松数字'],
  META:['Meta Platforms','脸书','Facebook'],MSFT:['Microsoft','微软'],
  MSTR:['Strategy','微策略','MicroStrategy'],NET:['Cloudflare'],
  NFLX:['Netflix','奈飞','网飞'],NKE:['Nike','耐克'],
  NOW:['ServiceNow'],NVDA:['NVIDIA','英伟达'],OKLO:['Oklo'],
  ORCL:['Oracle','甲骨文'],PLTR:['Palantir','帕兰提尔'],PYPL:['PayPal','贝宝'],
  QCOM:['Qualcomm','高通'],RDDT:['Reddit'],RIVN:['Rivian','瑞维安'],
  RKLB:['Rocket Lab','火箭实验室'],SHOP:['Shopify'],
  SMCI:['Super Micro Computer','超微电脑'],
  SNOW:['Snowflake','雪花公司'],SOFTBANK:['SoftBank','软银'],
  SONY:['Sony','索尼'],SPY:['SPDR S&P 500 ETF','标普500 ETF'],
  TQQQ:['ProShares UltraPro QQQ','纳指三倍做多'],SQQQ:['ProShares UltraPro Short QQQ','纳指三倍做空'],
  TSEM:['Tower Semiconductor'],TTWO:['Take-Two Interactive'],
  TSM:['Taiwan Semiconductor','台积电','TSMC'],TSLA:['Tesla','特斯拉'],
  VRT:['Vertiv','维谛技术'],WDC:['Western Digital','西部数据'],
  WMT:['Walmart','沃尔玛'],XOM:['Exxon Mobil','埃克森美孚'],
  QQQ:['Invesco QQQ','纳斯达克100 ETF','纳指100'],
  SKHYNIX:['SK hynix','海力士'],SAMSUNG:['Samsung Electronics','三星电子'],
  MU:['Micron','美光'],SNDK:['Sandisk','闪迪'],SOXL:['Direxion Semiconductor Bull 3X ETF','半导体三倍'],
  AAPL:['Apple','苹果'],CRCL:['Circle','圆圈公司'],MRVL:['Marvell','迈威尔']
};
function enrichCatalog(items){return items.map(item=>{
  const names=item.category==='3'&&STOCK_NAMES[item.symbol];
  if(!names)return item;
  return {...item,name:names[0],aliases:[...new Set([...(item.aliases||[]),...names.slice(1)])]};
})}
function hydrateAssetNames(){
  if(!instrumentCatalog)return;
  const names=new Map(instrumentCatalog.map(item=>[item.symbol,item.name]));
  for(const asset of assets)if(names.has(asset.symbol))asset.name=names.get(asset.symbol);
}
try{let savedCatalog=JSON.parse(publicMarketCache.getItem(CATALOG_STORE)||'null');
if(savedCatalog&&Array.isArray(savedCatalog.items)){
  instrumentCatalog=enrichCatalog(savedCatalog.items);catalogFetchedAt=Number(savedCatalog.t)||0}}catch{}
// 首次访问也能立即本地匹配；后台完整目录随后替换项目快照。
if(!instrumentCatalog)instrumentCatalog=enrichCatalog([["BTC","1"],["ETH","1"],["OKB","1"],["SOL","1"],["DOGE","1"],["XRP","1"],["BCH","1"],["MAGIC","1"],["STRK","1"],["ZEC","1"],["CHIP","1"],["0G","1"],["1INCH","1"],["2Z","1"],["A","1"],["AAOI","3"],["AAPL","3"],["AAVE","1"],["ACH","1"],["ACN","3"],["ACT","1"],["ACU","1"],["ADA","1"],["ADBE","3"],["AEHR","3"],["AEON","1"],["AERO","1"],["AEVO","1"],["AGLD","1"],["AI","1"],["AIXBT","1"],["AKE","1"],["ALAB","3"],["ALGO","1"],["ALLO","1"],["AMAT","3"],["AMC","3"],["AMD","3"],["AMZN","3"],["ANIME","1"],["ANTHROPIC","3"],["APE","1"],["API3","1"],["APLD","3"],["APP","3"],["APR","1"],["APT","1"],["AR","1"],["ARB","1"],["ARKM","1"],["ARM","3"],["ARX","1"],["ASML","3"],["ASTER","1"],["ASTS","3"],["AT","1"],["ATH","1"],["ATOM","1"],["AUCTION","1"],["AVAX","1"],["AVGO","3"],["AVNT","1"],["AXS","1"],["AXTI","3"],["AZTEC","1"],["BABY","1"],["BAND","1"],["BARD","1"],["BASED","1"],["BAT","1"],["BB","3"],["BE","3"],["BEAT","1"],["BERA","1"],["BICO","1"],["BIGTIME","1"],["BILL","1"],["BIO","1"],["BLEND","1"],["BLUR","1"],["BMNR","3"],["BNB","1"],["BOME","1"],["BONK","1"],["BOT","3"],["BRETT","1"],["BREV","1"],["BRKB","3"],["BSB","1"],["BSP","3"],["BWET","3"],["BX","3"],["BZ","4"],["CAP","1"],["CASHCAT","1"],["CBRS","3"],["CC","1"],["CELO","1"],["CFX","1"],["CGNX","3"],["CHZ","1"],["CIEN","3"],["CL","4"],["CNPY","1"],["COAI","1"],["COHR","3"],["COIN","3"],["COMP","1"],["CORE","1"],["COST","3"],["CP","1"],["CRCL","3"],["CRDO","3"],["CRM","3"],["CRO","1"],["CRV","1"],["CRWV","3"],["CRWD","3"],["CSCO","3"],["CSOPSKHYNIX2L","3"],["CSOPSAMSUNG2L","3"],["CT","1"],["CVX","1"],["CXMT","3"],["CYPH","3"],["DASH","1"],["DDOG","3"],["DELL","3"],["DGAI","1"],["DKNG","3"],["DOOD","1"],["DOS","1"],["DOT","1"],["DRAM","3"],["DYDX","1"],["EDEN","1"],["EDGE","1"],["EGLD","1"],["EIGEN","1"],["ENA","1"],["ENJ","1"],["ENS","1"],["ENSO","1"],["ESP","1"],["ETC","1"],["ETHW","1"],["ETHFI","1"],["EWJ","3"],["EWY","3"],["EWZ","3"],["F","1"],["FARTCOIN","1"],["FET","1"],["FIL","1"],["FLNC","3"],["FLOKI","1"],["FLOW","1"],["FLOCK","1"],["FLY","3"],["FOGO","1"],["FWDI","3"],["GALA","1"],["GAS","1"],["GEV","3"],["GIGGLE","1"],["GLM","1"],["GLW","3"],["GME","3"],["GMT","1"],["GMX","1"],["GOOGL","3"],["GPRO","3"],["GPS","1"],["GRASS","1"],["GRT","1"],["GRVT","1"],["GTLB","3"],["H","1"],["H100","4"],["HANMI","3"],["HBAR","1"],["HIMS","3"],["HMSTR","1"],["HOME","1"],["HOOD","3"],["HPE","3"],["HUMA","1"],["HUT","3"],["HYPE","1"],["HYUNDAI","3"],["IBM","3"],["ICP","1"],["IMX","1"],["INFQ","3"],["INIT","1"],["INJ","1"],["INTC","3"],["INTW","3"],["IONQ","3"],["IOST","1"],["IOTA","1"],["DATA","1"],["IREN","3"],["IRYS","1"],["ISRG","3"],["IWM","3"],["JELLYJELLY","1"],["JNJ","3"],["JP225","3"],["JTO","1"],["JUP","1"],["KAITO","1"],["KAT","1"],["KGEN","1"],["KII","1"],["KIOXIA","3"],["KITE","1"],["KLAC","3"],["KMNO","1"],["KO","3"],["KORU","3"],["KR200","3"],["KSM","1"],["KSTR","3"],["LA","1"],["LAB","1"],["LAYER","1"],["LDO","1"],["LGELECTRONICS","3"],["LIGHT","1"],["LINK","1"],["LINEA","1"],["LIT","1"],["LITE","3"],["LLY","3"],["LPT","1"],["LQTY","1"],["LRCX","3"],["LTC","1"],["LUNA","1"],["LUNR","3"],["LYTE","3"],["MANA","1"],["MARA","3"],["MASK","1"],["ME","1"],["MEGA","1"],["MEME","1"],["MERL","1"],["METIS","1"],["MET","1"],["META","3"],["MEW","1"],["MINA","1"],["MINIMAX","3"],["MMT","1"],["MON","1"],["MOODENG","1"],["MOONSHOT","3"],["MORPHO","1"],["MOVE","1"],["MRK","3"],["MRNA","3"],["MRVL","3"],["MSFT","3"],["MSTR","3"],["MSTU","3"],["MU","3"],["MUBARAK","1"],["MUU","3"],["MVLL","3"],["NAVER","3"],["NBIS","3"],["NEAR","1"],["NEIRO","1"],["NEO","1"],["NES","1"],["NET","3"],["NFLX","3"],["NG","4"],["NIGHT","1"],["NKE","3"],["NMR","1"],["NOK","3"],["NOT","1"],["NOW","3"],["NVDA","3"],["NVDL","3"],["O","1"],["OFC","1"],["OKLO","3"],["OKTA","3"],["OL","1"],["ON","3"],["ONDO","1"],["ONDS","3"],["ONE","1"],["ONT","1"],["OP","1"],["OPENAI","3"],["OPG","1"],["OPN","1"],["ORCL","3"],["ORDI","1"],["ORDER","1"],["OSCR","3"],["OURA","3"],["OUST","3"],["PARTI","1"],["PENGU","1"],["PENDLE","1"],["PENG","3"],["PEOPLE","1"],["PEPE","1"],["PI","1"],["PIEVERSE","1"],["PIPPIN","1"],["PLTR","3"],["PLUME","1"],["PNUT","1"],["POET","3"],["POL","1"],["PONS","1"],["POPCAT","1"],["POPMART","3"],["PROVE","1"],["PROS","1"],["PUMP","1"],["PURR","3"],["PYPL","3"],["PYTH","1"],["QCOM","3"],["QNT","3"],["QQQ","3"],["QTUM","1"],["QUANT","1"],["RAM","3"],["RAVE","1"],["RAY","1"],["RDDT","3"],["RDW","3"],["RE","1"],["RECALL","1"],["RENDER","1"],["RESOLV","1"],["RIOT","3"],["RIVER","1"],["RIVN","3"],["RKLB","3"],["RLS","1"],["ROBO","1"],["ROK","3"],["RSR","1"],["RVN","1"],["S","1"],["SAHARA","1"],["SAMSUNG","3"],["SAND","1"],["SAPIEN","1"],["SATS","1"],["SECZ","3"],["SEI","1"],["SENT","1"],["SHAZ","3"],["SHELL","1"],["SHEIN","3"],["SHIB","1"],["SHLD","3"],["SHOP","3"],["SIGN","1"],["SIMO","3"],["SKDD","3"],["SKHYNIX","3"],["SKHY","3"],["SKUU","3"],["SKY","1"],["SLX","1"],["SMCI","3"],["SMH","3"],["SNDK","3"],["SNOW","3"],["SNX","1"],["SNXX","3"],["SOFTBANK","3"],["SONY","3"],["SOON","1"],["SOPH","1"],["SOXL","3"],["SOXS","3"],["SPACE","1"],["SPCX","3"],["SPCH","3"],["SPK","1"],["SPX","1"],["SPY","3"],["SQQQ","3"],["SSV","1"],["STABLE","1"],["STRC","3"],["STX","1"],["SUI","1"],["SUSHI","1"],["SYRUP","1"],["TAO","1"],["TEAM","3"],["TEM","3"],["TER","3"],["THETA","1"],["TIA","1"],["TMF","3"],["GRAM","1"],["TQQQ","3"],["TRB","1"],["TRIA","1"],["TRUMP","1"],["TRUST","1"],["TRUTH","1"],["TRX","1"],["TSEM","3"],["TSLA","3"],["TSLL","3"],["TSM","3"],["TTMI","3"],["TTWO","3"],["TURBO","1"],["TWLO","3"],["UB","1"],["UMA","1"],["UNH","3"],["UNI","1"],["UNITREE","3"],["UP","1"],["URNM","3"],["US100","3"],["US500","3"],["USAR","3"],["USDC","1"],["USELESS","1"],["USO","3"],["UVXY","3"],["VANA","1"],["VIRTUAL","1"],["VRT","3"],["VVV","1"],["W","1"],["WAL","1"],["WCT","1"],["WDC","3"],["WEN","3"],["WET","1"],["WIF","1"],["WLD","1"],["WLFI","1"],["WMT","3"],["WOO","1"],["XAG","4"],["XAU","4"],["XBI","3"],["XCU","4"],["XDP","1"],["XIAOMI","3"],["XLE","3"],["XLM","1"],["XOM","3"],["XPL","1"],["XPT","4"],["XTZ","1"],["YB","1"],["YFI","1"],["YGG","1"],["ZAMA","1"],["ZBT","1"],["ZEN","1"],["ZETA","1"],["ZHIPU","3"],["ZHONGJI","3"],["ZIL","1"],["ZK","1"],["ZKP","1"],["ZM","3"],["ZORA","1"],["ZRO","1"],["ZRX","1"],["XPD","4"],["EWT","3"]].map(([symbol,category])=>({type:'swap',symbol,name:symbol,category})));
let strategyTimer=null;
let lastCandleFetchAt=0,refreshingCandles=false,stockQuoteLoading=false;
let candleRecoveryTimer=null,watchQuotesLoading=false;
function recoverCandlesSoon(){
  if(candleRecoveryTimer)return;
  candleRecoveryTimer=setTimeout(()=>{candleRecoveryTimer=null;
    if(accountUser&&!document.hidden&&navigator.onLine!==false)refreshCandles(true);
  },2000);
}
const CANDLE_SESSION='market_candle_session_v1';
const HISTORY_TARGET={'1m':1800,'5m':3000,'15m':3600,'1h':6000,'2h':9000,
  '4h':12000,'6h':10000,'1d':5000,'2d':4000,'1w':2000,'1M':500};
const cachedBarLimit=()=>16000;
const timeframeCache=new Map();
const historyRequests=new Set();
const historyRetryAfter=new Map();
try{
  const savedRows=JSON.parse(publicMarketCache.getItem(CANDLE_SESSION)||'[]');
  if(Array.isArray(savedRows))for(const [key,value] of savedRows){
    if(typeof key==='string'&&/^(?:swap|ashare):[A-Z0-9]{1,15}\|(1m|5m|15m|1h|2h|4h|6h|1d|2d|1w|1M)$/.test(key)
      &&value&&Date.now()-value.fetchedAt<12*3600000&&Array.isArray(value.rows))
      timeframeCache.set(key,{rows:validBars(value.rows).slice(-cachedBarLimit(key.split('|')[1])),
        fetchedAt:value.fetchedAt,exhausted:value.exhausted===true});
  }
}catch{}
let candleSessionTimer=null;
const timeframeRequests=new Map();
let prefetchedAsset='';
let reorderMode=false,watchDragging=false,reorderIdleTimer=null;
let actionAssetId='',suppressWatchClick=false;
const auditCache=new Map();
const INSIGHT_ARCHIVE='market_analysis_v1';
let insightArchive=new Map(),archiveTimer=null;
try{for(const [key,value] of JSON.parse(localStorage.getItem(INSIGHT_ARCHIVE)||'[]'))
  if(typeof key==='string'&&value&&typeof value.title==='string')insightArchive.set(key,value)}catch{}
function freezeInsight(key,result){
  if(insightArchive.has(key))return insightArchive.get(key);
  insightArchive.set(key,result);
  if(insightArchive.size>1200)insightArchive.delete(insightArchive.keys().next().value);
  clearTimeout(archiveTimer);
  archiveTimer=setTimeout(()=>{try{localStorage.setItem(INSIGHT_ARCHIVE,JSON.stringify([...insightArchive]))}catch{}},500);
  return result;
}

const COIN_ICONS=new Set(['BTC','ETH','SOL','XRP','DOGE','ADA','LTC','AVAX','LINK','DOT','BNB','USDC','ZEC']);
const OKX_ICONS=new Set(['BTC','ETH','AAPL','NVDA','SOXL','SNDK','MU','CRCL','KORU','MRVL']);
const BRAND_ICONS=new Set(['SPCX','ZHONGJI','XIAOMI','SKHYNIX','SAMSUNG','QQQ','WDC','NKE','GOOGL','GOOG','TSLA','XAU','ANTHROPIC','INTC','OPENAI','SH600519','SZ002384','SH600362','SZ301308','SZ000651']);
const BRAND_ICON_PATHS={SZ301308:'/assets/icons/brand/sz301308.png',SZ000651:'/assets/icons/brand/sz000651.png',SH600362:'/assets/icons/brand/sh600362.png',SH600519:'/assets/icons/brand/sh600519.png',SZ002384:'/assets/icons/brand/sz002384.png',SPCX:'/assets/icons/crypto/spcx.svg',SKHYNIX:'/assets/icons/brand/skhynix.png',
  ZHONGJI:'/api/logo-image?symbol=ZHONGJI',XIAOMI:'/api/logo-image?symbol=XIAOMI',
  SAMSUNG:'/assets/icons/brand/samsung.png',QQQ:'/assets/icons/brand/qqq.svg',
  WDC:'/assets/icons/brand/wdc.svg',
  NKE:'/assets/icons/brand/nike.svg',GOOGL:'/assets/icons/brand/google.png',
  GOOG:'/assets/icons/brand/google.png',TSLA:'/assets/icons/brand/tesla.svg',
  XAU:'/assets/icons/brand/gold.svg?v=20261011-gold2',
  ANTHROPIC:'/assets/icons/brand/anthropic.png',
  INTC:'/assets/icons/brand/intel.png',
  OPENAI:'/assets/icons/brand/openai.svg'};
const LOGO_STORE='market_logo_cache_v7';
let resolvedLogos={};
try{
  resolvedLogos=JSON.parse(publicMarketCache.getItem(LOGO_STORE)||'{}');
  // Retry images that the previous page policy blocked in the browser.
  for(const [symbol,entry] of Object.entries(resolvedLogos))
    if(entry?.source==='图标图片暂不可用')delete resolvedLogos[symbol];
  publicMarketCache.setItem(LOGO_STORE,JSON.stringify(resolvedLogos));
}catch{}
function validLogoURL(url){
  return typeof url==='string'&&(/^(?:\/api\/logo-image\?symbol=[A-Z0-9]{1,15}|\/assets\/icons\/(?:okx|brand)\/[a-z0-9-]+\.(?:png|svg))$/.test(url)||/^https:\/\/(?:coin-images\.coingecko\.com|assets\.coingecko\.com|cdn\.tickerlogos\.com|img\.loadlogo\.com)\//.test(url));
}
function rememberAssetLogos(items){
  for(const item of items||[])if(item?.symbol&&validLogoURL(item.logo))resolvedLogos[item.symbol]={url:item.logo,source:item.logoSource||'已缓存的标的图标',expires:Date.now()+7*86400000};
}
rememberAssetLogos(instrumentCatalog);
const pendingLogos=new Set(),logoQueue=[],logoRetryTimers=new Map(),logoRetryCounts=new Map(),logoLookupAt=new Map();
let activeLogoLookups=0;
function retryLogo(symbol,delay=2000){
  if(logoRetryTimers.has(symbol))return;
  const attempts=(logoRetryCounts.get(symbol)||0)+1;logoRetryCounts.set(symbol,attempts);
  if(attempts>8)return;
  logoRetryTimers.set(symbol,setTimeout(()=>{
    logoRetryTimers.delete(symbol);
    if(!document.hidden&&(document.querySelector('[data-logo-symbol="'+symbol+'"]')||document.querySelector('#heroLogo[data-symbol="'+symbol+'"]'))){if(resolvedLogos[symbol]&&!resolvedLogos[symbol].url)resolvedLogos[symbol].expires=0;lookupLogo(symbol)}
  },Math.min(15000,delay*attempts)));
}
function lookupLogo(symbol,urgent=false){
  const existing=resolvedLogos[symbol];
  if(existing?.url&&existing.expires>Date.now())return;
  if(!urgent&&existing?.expires>Date.now())return;
  if(urgent&&Date.now()-(logoLookupAt.get(symbol)||0)<2000)return;
  if(pendingLogos.has(symbol)){
    const index=logoQueue.indexOf(symbol);if(urgent&&index>0){logoQueue.splice(index,1);logoQueue.unshift(symbol)}return;
  }
  if(logoRetryTimers.has(symbol)){if(!urgent)return;clearTimeout(logoRetryTimers.get(symbol));logoRetryTimers.delete(symbol)}
  pendingLogos.add(symbol);urgent?logoQueue.unshift(symbol):logoQueue.push(symbol);pumpLogoQueue();
}
function pumpLogoQueue(){
  while(activeLogoLookups<3&&logoQueue.length){
    const symbol=logoQueue.shift();activeLogoLookups++;logoLookupAt.set(symbol,Date.now());
    api('/api/logo?symbol='+encodeURIComponent(symbol),{timeoutMs:5000,retries:0}).then(async result=>{
      const url=validLogoURL(result.url)?result.url:'';
      resolvedLogos[symbol]={url,source:result.source||'',expires:Date.now()+(url?7*86400000:result.pending?0:30000)};
      if(url){
        const image=await prepareLogoImage(url).promise;
        if(image){logoRetryCounts.delete(symbol);try{publicMarketCache.setItem(LOGO_STORE,JSON.stringify(resolvedLogos))}catch{}refreshResolvedLogo(symbol)}
        else{resolvedLogos[symbol]={url:'',expires:0};retryLogo(symbol,6000)}
      }else if(result.pending){
        retryLogo(symbol,(Number(result.retryAfter)||2)*1000);
      }
    }).catch(()=>{
      resolvedLogos[symbol]={url:'',source:'图标来源暂不可用',expires:Date.now()+10000};
      retryLogo(symbol,3000);
    }).finally(()=>{pendingLogos.delete(symbol);activeLogoLookups--;pumpLogoQueue()});
  }
}

const tfMs={'1m':60000,'5m':300000,'15m':900000,'1h':3600000,'2h':7200000,'4h':14400000,'6h':21600000,'1d':86400000,'2d':172800000,'1w':604800000,'1M':2592000000};
function completedCount(rows,period=tf){let last=rows.at(-1);
if(!last)return 0;
if(last.confirmed===true)return rows.length;
if(last.confirmed===false)return Math.max(0,rows.length-1);
const end=period==='1M'?Date.UTC(new Date(last.t+28800000).getUTCFullYear(),
  new Date(last.t+28800000).getUTCMonth()+1,1)-28800000:last.t+(tfMs[period]||0);
return Date.now()>=end?rows.length:Math.max(0,rows.length-1)}

const assetId=a=>a.type+':'+a.symbol, watchId=a=>a.groupId+'|'+assetId(a),
  findWatch=id=>assets.find(a=>watchId(a)===id),
  current=()=>assets.find(a=>a.groupId===activeGroupId&&assetId(a)===selected)||
    assets.find(a=>assetId(a)===selected)||assets[0];

function assetMarketType(a){return a?.type==='ashare'||/^(?:SH6\d{5}|SZ[03]\d{5}|BJ(?:(?:43|83|87)\d{4}|920\d{3}))$/.test(a?.symbol||'')?'ashare':'swap'}
const ASHARE_PERIODS=new Set(['1m','5m','15m','1h','1d','1w','1M']);
function marketLabel(a){return a?.type==='ashare'?'A股 · 人民币现货':'OKX · USDT 永续'}
function effectivePeriod(a,period){return a?.type==='ashare'&&!ASHARE_PERIODS.has(period)?'1d':period}
function deckSlotsFor(a){return a?.type==='ashare'?['15m','1h','1d','1M']:deckPeriodSlots}
function priceText(value){
  if(!Number.isFinite(value))return '—';
  const magnitude=Math.abs(value);
  if(magnitude>0&&magnitude<1){
    const [coefficient,exponentText]=magnitude.toExponential(4).split('e');
    const exponent=Number(exponentText),raw=coefficient.replace('.','');
    const fractional=exponent<0?'0'.repeat(-exponent-1)+raw:
      raw.slice(0,exponent+1)+'.'+raw.slice(exponent+1);
    return (value<0?'-':'')+'0.'+fractional;
  }
  const digits=magnitude>=1&&magnitude<10?4:2;
  return value.toLocaleString('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits});
}
const fmt=(x,a=typeof current==='function'?current():null)=>Number.isFinite(x)?(assetMarketType(a)==='ashare'?'¥':'$')+priceText(x):'—';

const nfmt=x=>!Number.isFinite(x)?'—':x>=1e9?(x/1e9).toFixed(1)+'B':x>=1e6?(x/1e6).toFixed(1)+'M':x>=1e3?(x/1e3).toFixed(1)+'K':x.toFixed(0);

const date=t=>new Date(t).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
const historyRange=(rows,period)=>rows.length+' 根真实 K 线 · '+period+
  ' · 最早 '+new Date(rows[0].t).toLocaleDateString('zh-CN')+
  ' · 最新 '+date(rows.at(-1).t);

function stateSnapshot(){return {assets:assets.map(a=>({type:assetMarketType(a),symbol:a.symbol,groupId:a.groupId||'main',pinned:a.pinned===true,...(Number.isInteger(a.cardColor)?{cardColor:a.cardColor}:{})})),
  groups,activeGroup:activeGroupId,selected,tf:deckDesktopTf||tf,scheme,swing,toggles,targets,wallet:walletHoldings}}
function pendingKey(){return ACCOUNT_PENDING+accountSpace}
function save(){syncProfilePins();const snapshot=stateSnapshot();accountDirty=true;
  try{if(accountSpace)localStorage.setItem(pendingKey(),JSON.stringify({t:Date.now(),baseRevision:accountRevision,
    base:accountBase,state:snapshot}))}catch{}
  if(accountUser){clearTimeout(accountSaveTimer);accountSaveTimer=setTimeout(syncAccount,35)}}
function mergeStates(base,local,remote){
  if(!base)return local;
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),out={...remote};
  out.wallet=window.MarketWallet?.merge(base.wallet,local.wallet,remote.wallet)||local.wallet||remote.wallet||[];
  for(const key of ['selected','activeGroup','tf','scheme','swing','toggles','targets'])
    if(!same(local[key],base[key]))out[key]=local[key];
  const key=a=>(a.groupId||'main')+'|'+a.symbol;
  const baseAssets=new Map((base.assets||[]).map(a=>[key(a),a]));
  const localAssets=new Map((local.assets||[]).map(a=>[key(a),a]));
  const removed=new Set([...baseAssets.keys()].filter(k=>!localAssets.has(k)));
  const remoteAssets=(remote.assets||[]).filter(a=>!removed.has(key(a)));
  const remoteSymbols=new Set(remoteAssets.map(key));
  out.assets=[...remoteAssets.map(a=>{
    const changed=localAssets.has(key(a))&&!same(localAssets.get(key(a)),baseAssets.get(key(a)));
    return changed?localAssets.get(key(a)):a}),
    ...[...localAssets.values()].filter(a=>!remoteSymbols.has(key(a))&&
      (!baseAssets.has(key(a))||!same(a,baseAssets.get(key(a)))))];
  if(!same((local.assets||[]).map(key),(base.assets||[]).map(key))){
    const merged=new Map(out.assets.map(a=>[key(a),a]));
    out.assets=[...(local.assets||[]).filter(a=>merged.has(key(a))).map(a=>merged.get(key(a))),
      ...out.assets.filter(a=>!localAssets.has(key(a)))];
  }
  const counts={};out.assets=out.assets.filter(a=>{
    const group=a.groupId||'main';counts[group]=(counts[group]||0)+1;return counts[group]<=MAX_GROUP_ASSETS});
  const baseGroups=new Map((base.groups||[]).map(g=>[g.id,g]));
  const localGroups=new Map((local.groups||[]).map(g=>[g.id,g]));
  const removedGroups=new Set([...baseGroups.keys()].filter(k=>!localGroups.has(k)));
  const remoteGroups=(remote.groups||[]).filter(g=>!removedGroups.has(g.id));
  const remoteGroupIds=new Set(remoteGroups.map(g=>g.id));
  out.groups=[...remoteGroups.map(g=>localGroups.has(g.id)&&!same(localGroups.get(g.id),baseGroups.get(g.id))?localGroups.get(g.id):g),
    ...[...localGroups.values()].filter(g=>!remoteGroupIds.has(g.id)&&
      (!baseGroups.has(g.id)||!same(g,baseGroups.get(g.id))))].slice(0,10);
  return out}
function syncAccount(){
  clearTimeout(accountSaveTimer);
  if(!accountUser)return accountSaveChain;
  if(!accountDirty)return accountSaveChain;
  const owner=accountUser,space=accountSpace;
  accountSaveChain=accountSaveChain.catch(()=>{}).then(async()=>{
    if(accountUser!==owner)return true;
    let payload=JSON.parse(JSON.stringify(stateSnapshot()));
    for(let attempt=0;attempt<3;attempt++){
      try{const saved=await postApi('/api/user/state',{...payload,expectedUpdated:accountRevision},true);
        accountRevision=Number(saved.stateUpdated)||0;
        accountBase=JSON.parse(JSON.stringify(saved.state));
        if(JSON.stringify(payload)===JSON.stringify(stateSnapshot()))accountDirty=false;
        break;
      }catch(error){if(error.status!==409||attempt===2)throw error;
        payload=mergeStates(accountBase,payload,error.body.state||defaultAccountState());
        accountRevision=Number(error.body.stateUpdated)||0;
        applyAccountState(payload);
      }}
    try{const pending=JSON.parse(localStorage.getItem(ACCOUNT_PENDING+space)||'null');
      if(pending&&JSON.stringify(pending.state)===JSON.stringify(payload))localStorage.removeItem(ACCOUNT_PENDING+space)}catch{}
    $('accountButton').title='';$('authSignedError').textContent='';
    return true;
  }).catch(()=>{if(accountUser===owner){
    $('accountButton').title='账户同步暂不可用；下一次修改会重试';
    $('authSignedError').textContent='自选同步失败，请保持页面打开并稍后重试。';
  }return false});
  return accountSaveChain;
}
let marketLiveAt=0,marketFailureCount=0,marketQuoteReady=false;
function updateMarketSignal({reachable=false,degraded=false,cached=false}={}){
  const signal=window.MarketData.quoteSignal({online:navigator.onLine!==false,liveRecent:Date.now()-marketLiveAt<30000,reachable,degraded,cached,failures:marketFailureCount});
  setStatus(signal.text,signal.state==='bad',signal.state);
}
function setStatus(text,bad=false,state=bad?'bad':'ok'){$('connection').textContent=text;
$('connection').className='status '+state;
$('connection').title=text;$('connection').setAttribute('aria-label',text);
const petStatus=$('petStatus');
if(petStatus){petStatus.textContent=text;petStatus.className='petStatus '+state;petStatus.title=text;petStatus.setAttribute('aria-label',text)}}
function colors(){return scheme==='redUp'?{up:'#e94872',down:'#28b878'}:{up:'#28b878',down:'#e94872'}}
function notify(title,body,kind='行情'){feed.unshift({title,body,kind,t:Date.now()});
feed=feed.slice(0,35);
renderFeed();
if('Notification'in window&&Notification.permission==='granted')new Notification(title,{body,tag:kind+title})}
function renderFeed(){let box=$('feed');
box.replaceChildren();
if(!feed.length){box.innerHTML='<div class="feedempty">当设置的价格或波动规则触发时，这里会显示提醒。</div>';
return}for(let e of feed){let row=document.createElement('div');
row.className='feeditem';
let strong=document.createElement('strong');
strong.textContent=e.title;
let content=document.createElement('div');
content.textContent=e.body;
let small=document.createElement('small');
small.textContent=e.kind+' · '+date(e.t);
row.append(strong,content,small);
box.append(row)}}
function updateHero(){let a=current();
if(!a){$('assetLabel').textContent='添加资产开始';
$('perpetualBadge').hidden=true;
$('assetMeta').textContent='';
$('heroLogo').replaceChildren();
$('heroLogo').disabled=true;
$('newsLink').href='/news.html';
renderNewsPreview(null);
return}let q=quotes[assetId(a)],last=candles.at(-1),p=q?.p||last?.c,base=q?.base||candles.at(-2)?.c;
$('newsLink').href='/news.html?type='+a.type+'&symbol='+encodeURIComponent(a.symbol);
let pct=p&&base?(p/base-1)*100:null;
let c=colors();
document.documentElement.style.setProperty('--up',c.up);
document.documentElement.style.setProperty('--down',c.down);
$('assetLabel').textContent=a.type==='ashare'?(a.name||a.symbol)+' / CNY':a.symbol+' / USDT';
$('perpetualBadge').hidden=false;$('perpetualBadge').textContent=a.type==='ashare'?'A股':'USDT 永续';
$('assetMeta').textContent=marketLabel(a)+' · '+(q?'报价 '+date(q.t):last?'K 线 '+date(last.t):'等待数据');
$('lastPrice').textContent=p?fmt(p):'—';
$('priceChange').textContent=pct==null?'—':(a.type==='ashare'?'今日 ':'24h ')+(pct>=0?'+':'')+pct.toFixed(2)+'%';
$('priceChange').className=pct==null?'':pct>=0?'up':'down';
renderHeroLogo()}
function renderStrategy(){
  const a=current(), title=$('strategyTitle'), summary=$('strategySummary');
  const fields={up:$('strategyUp'),flat:$('strategyFlat'),down:$('strategyDown')};
  const probabilityCards={up:$('probLong'),flat:$('probWatch'),down:$('probShort')};
  const setCall=(direction,label,detail,conclusion)=>{
    $('strategyCall').className='strategyCall '+direction;
    $('strategyCallTitle').textContent=label;
    if($('strategyCallDetail').textContent!==detail)$('strategyCallDetail').textContent=detail;
    if($('strategyCallConclusion').textContent!==conclusion)$('strategyCallConclusion').textContent=conclusion;
  };
  const highlightHighest=probabilities=>{
    const highest=probabilities?Object.entries(probabilities)
      .filter(([,value])=>Number.isFinite(value)).sort((a,b)=>b[1]-a[1])[0]?.[0]:null;
    for(const [outcome,card] of Object.entries(probabilityCards))
      card.classList.toggle('active',outcome===highest);
    return highest;
  };
  const setProbability=(outcome,value)=>{
    const text=Number.isFinite(value)?(value*100).toFixed(0)+'%':'—';
    const node=fields[outcome],card=probabilityCards[outcome];
    if(node.textContent!==text&&text!=='—'){
      card.classList.remove('changed');
      void card.offsetWidth;
      card.classList.add('changed');
    }
    node.textContent=text;
    card.style.setProperty('--prob',Number.isFinite(value)?(value*100).toFixed(1)+'%':'0%');
  };
  const clearExtras=()=>{
    $('strategyMAOrder').textContent='均线排列：等待历史数据';
    $('strategyMAOrder').className='maOrder';
    $('strategyLongPlan').textContent='止盈、止损：暂无有效参考位';
    $('strategyShortPlan').textContent='止盈、止损：暂无有效参考位';
    setCall('watch','观望','等待足够的历史数据后评估方向与盈亏比。','结论：暂不判断方向。');
    delete $('strategyCallDetail').dataset.narrativeKey;
  };
  if(!a||candles.length<35){
    title.textContent=candles.length?'历史数据不足':'等待历史数据';
    summary.textContent='至少需要 35 根已完成的 K 线，当前不显示概率或盈亏比。';
    $('strategyStamp').textContent='—';
    Object.keys(fields).forEach(outcome=>setProbability(outcome,null));
    highlightHighest(null);
    setRR($('strategyLongRR'),null);
    setRR($('strategyShortRR'),null);
    $('strategyBasis').textContent='历史数据不足时，不生成策略数字。';
    clearExtras();
    return;
  }
  const completed=candles.slice(0,completedCount(candles)), modelRows=completed.slice(-6000), q=quotes[assetId(a)];
  const latestBar=candles.at(-1), lastCompleted=completed.at(-1);
  const useQuote=q&&Number.isFinite(q.p)&&q.p>0&&q.t>0&&q.t>=latestBar.t;
  const useLatestBar=!useQuote&&latestBar.t>lastCompleted.t;
  const entry=useQuote?q.p:useLatestBar?latestBar.c:lastCompleted.c;
  const result=analyzeStrategy(modelRows,entry);
  const labels={up:'上涨',flat:'横盘',down:'下跌'};
  if(!result.ready){
    title.textContent='历史数据不足';
    summary.textContent=result.reason;
    $('strategyStamp').textContent='—';
    Object.keys(fields).forEach(outcome=>setProbability(outcome,null));
    highlightHighest(null);
    setRR($('strategyLongRR'),null);
    setRR($('strategyShortRR'),null);
    $('strategyBasis').textContent='等待更多已完成的 K 线。';
    clearExtras();
    return;
  }
  const averages=window.MarketStrategy.movingAverageOrder(completed);
  const orderLabels={bullish:'多头排列：MA5 > MA10 > MA20。',
    bearish:'空头排列：MA5 < MA10 < MA20。',
    mixed:'均线交错：MA5、MA10、MA20 没有整齐排列。'};
  const pricePosition=entry<averages.ma5?'参考价低于 MA5，短线位置偏弱。':
    entry>averages.ma5?'参考价高于 MA5，短线位置偏强。':'参考价接近 MA5。';
  $('strategyMAOrder').textContent='已完成 K 线 · '+orderLabels[averages.order]+' '+pricePosition;
  $('strategyMAOrder').className='maOrder '+averages.order;
  title.textContent='已完成 K 线'+(result.state==='flat'?'横盘或方向分歧':result.state==='up'?'上行':'下行')+'结构';
  $('strategyStamp').textContent=(useQuote?'最近报价 ':'K 线 ')+date(useQuote?q.t:useLatestBar?latestBar.t:result.barTime);
  if(result.probabilities){
    for(const direction of Object.keys(fields))setProbability(direction,result.probabilities[direction]);
    highlightHighest(result.probabilities);
    summary.textContent=result.leading
      ?'有方向的同类历史走势中，'+labels[result.leading]+'占 '+(result.directionalRate*100).toFixed(0)+'%；三方向占比见下方，入场还需通过盈亏比与止损距离检查。'
      :'当前方向优势不足；继续观察支撑、压力与成交额变化。';
  }else{
    Object.keys(fields).forEach(outcome=>setProbability(outcome,null));
    highlightHighest(null);
    summary.textContent='当前呈'+labels[result.state]+'结构，但同类历史样本只有 '+result.samples+' 组，暂不显示三方向概率。';
  }
  const levels=result.levels;
  setRR($('strategyLongRR'),levels?.long,result.price,levels?.plans?.long?.target,levels?.plans?.long?.stop);
  setRR($('strategyShortRR'),levels?.short,result.price,levels?.plans?.short?.target,levels?.plans?.short?.stop);
  const call=window.MarketStrategy.tradeCall(result);
  const callStyle=call.direction==='up'?'long':call.direction==='down'?'short':'watch';
  const callLabel=call.direction==='up'?'做多':call.direction==='down'?'做空':'观望';
  const detailNode=$('strategyCallDetail');
  const narrativeKey=[assetId(a),tf,result.barTime,callStyle,call.reason||''].join('|');
  const shouldRefresh=detailNode.dataset.narrativeKey!==narrativeKey||
    Date.now()-Number(detailNode.dataset.narrativeAt||0)>45000;
  if(shouldRefresh){
    const stateText={up:'上行',flat:'横盘或方向分歧',down:'下行'}[result.state];
    const orderText={bullish:'MA5、MA10、MA20 呈多头排列',bearish:'MA5、MA10、MA20 呈空头排列',
      mixed:'短中期均线交错'}[result.movingAverages?.order]||'均线排列尚不明确';
    const history=result.probabilities
      ?`同类历史 ${result.samples} 组，上涨 ${Math.round(result.probabilities.up*100)}%、横盘 ${Math.round(result.probabilities.flat*100)}%、下跌 ${Math.round(result.probabilities.down*100)}%。`
      :`同类历史仅 ${result.samples} 组，尚不足以显示三方向频率。`;
    const zoneText=zone=>`${fmt(zone.low)}–${fmt(zone.high)}（${zone.evidence?.join("、")||"历史局部拐点"}，触及 ${zone.touches} 次，距今 ${zone.lastTouchBars} 根）`;
    const levelsText=levels?.supportZone&&levels?.resistanceZone
      ?`支撑区 ${zoneText(levels.supportZone)}；压力区 ${zoneText(levels.resistanceZone)}。止盈设在对侧区间前，止损设在本侧区间后。`
      :`缺少${!levels?.supportZone?'局部支撑区':''}${!levels?.supportZone&&!levels?.resistanceZone?'和':''}${!levels?.resistanceZone?'局部压力区':''}，暂不显示毛盈亏比。`;
    const decision=call.direction
      ?`历史方向、均线、入场距离、动量触发及止损距离均通过检查，向${call.direction==='up'?'上':'下'}理论毛盈亏比 ${call.ratio.toFixed(2)}:1。`
      :`暂不满足入场条件：${call.reason}`;
    const turnover=Number.isFinite(result.volumeRatio)
      ?`最新已完成 K 线成交额为前 20 根均值的 ${result.volumeRatio.toFixed(2)} 倍，仅作活跃度参考。`:'';
    const detail=`${history}当前为${stateText}结构，${orderText}。${turnover}${levelsText}未计实际手续费、滑点和资金费。`;
    detailNode.dataset.narrativeKey=narrativeKey;
    detailNode.dataset.narrativeAt=String(Date.now());
    setCall(callStyle,callLabel,detail,'结论：'+decision);
  }else setCall(callStyle,callLabel,detailNode.textContent,$('strategyCallConclusion').textContent);
  $('strategyCall').classList.toggle('entry',Boolean(call.direction));
  renderPlan('strategyLongPlan',result.price,levels?.plans?.long,'压力区前','支撑区后');
  renderPlan('strategyShortPlan',result.price,levels?.plans?.short,'支撑区前','压力区后');
  $('strategyBasis').textContent='同资产·'+tf+'，每组间隔 '+result.horizon+' 根；'+result.samples+' 组历史样本，观察后续 '+result.horizon+' 根。上涨/下跌阈值为当时 ATR14 的 0.5 倍与 0.3% 中较大者。有方向时占比仅在上涨和下跌样本中计算，横盘样本仍计入下方三方向占比。'+
    (levels?.plans?'支撑与压力取最近 120 根已完成 K 线中最接近参考价的局部高低点，以 ATR 与价格容差标出参考区间；止盈放在对侧区间前、止损放在本侧区间后，并留 0.15 ATR 或 0.1% 中较大的缓冲。显示的是理论毛盈亏比，未计实际手续费、滑点和资金费率。':'参考价两侧缺少可用的局部高低点，不计算盈亏比。')+
    (useQuote?' 最近报价可能延迟。':useLatestBar?' 参考价取最新 K 线收盘价，当前 K 线可能未结束。':' 报价不可用，参考价取上一根已完成 K 线。')+
    ' 历史频率不等于未来概率。';
}
function renderPlan(id,entry,plan,takeNote,stopNote){
  const target=$(id);
  if(!Number.isFinite(entry)||!plan||!plan.validRisk){
    target.textContent=plan&&!plan.validRisk?'止损距离不符合波动门槛，暂不显示止盈止损。':
      '参考价两侧缺少可用的局部高低点，暂不显示止盈止损。';
    return;
  }
  const makePrice=(label,value,note,kind)=>{
    const cell=document.createElement('div');cell.className='planPrice '+kind;
    const distance=Math.abs((value-entry)/entry)*100;
    const heading=document.createElement('small');heading.textContent=label+' · '+note+' · '+distance.toFixed(2)+'%';
    const price=document.createElement('b');price.textContent=fmt(value);
    cell.append(heading,price);
    return cell;
  };
  const prices=document.createElement('div');prices.className='planPrices';
  prices.append(makePrice('止盈',plan.target,takeNote,'take'),makePrice('止损',plan.stop,stopNote,'stop'));
  const reference=document.createElement('small');reference.className='planReference';reference.textContent='参考价 '+fmt(entry);
  target.replaceChildren(prices,reference);
}
function setRR(node,value,entry,takeProfit,stopLoss){
  node.replaceChildren();
  const ratio=document.createElement('span');ratio.textContent=Number.isFinite(value)?value.toFixed(2)+':1':'—';
  node.append(ratio);
  if(Number.isFinite(value)&&entry>0&&Number.isFinite(takeProfit)&&Number.isFinite(stopLoss)){
    const gain=Math.abs((takeProfit-entry)/entry)*100,loss=Math.abs((stopLoss-entry)/entry)*100;
    const detail=document.createElement('small');detail.className='rrDetail';
    detail.textContent='理论毛比 · 盈利 '+gain.toFixed(2)+'% · 亏损 '+loss.toFixed(2)+'%';
    const bar=document.createElement('span');bar.className='rrRange';
    const green=document.createElement('i');green.style.width=(gain/(gain+loss)*100).toFixed(1)+'%';
    bar.append(green);node.append(detail,bar);
  }
  node.className=Number.isFinite(value)?'rrTier '+(value>=50?'rr50':value>=20?'rr20':value>=10?'rr10':'rrBase'):'';
}
function miniChart(canvas,rows,offset=null){let dpr=window.devicePixelRatio||1,w=canvas.clientWidth||80,h=canvas.clientHeight||37;
canvas.width=Math.round(w*dpr);
canvas.height=Math.round(h*dpr);
let g=canvas.getContext('2d');
g.scale(dpr,dpr);
if(!rows||!rows.length)return;
const count=Math.min(rows.length,w>=70?22:18),shift=offset===null?0:Math.max(0,Math.min(rows.length-count,offset)),extra=Math.ceil(shift);
let data=rows.slice(rows.length-count-extra,rows.length-Math.floor(shift)),range=offset===null?data:rows,lo=Math.min(...range.map(x=>x.l)),hi=Math.max(...range.map(x=>x.h)),span=hi-lo||1,step=w/count,c=colors();
for(let i=0;
i<data.length;
i++){let r=data[i],x=step*(i+.5+shift-extra),y=v=>3+(hi-v)/span*(h-6);
g.strokeStyle=r.c>=r.o?c.up:c.down;
g.fillStyle=g.strokeStyle;
g.beginPath();
g.moveTo(x,y(r.h));
g.lineTo(x,y(r.l));
g.stroke();
g.fillRect(x-Math.max(1,step*.26),Math.min(y(r.o),y(r.c)),Math.max(2,step*.52),Math.max(1.5,Math.abs(y(r.o)-y(r.c))))}}
function symbolMark(symbol){
  const mark=document.createElement('span');
  mark.className='symbolMark';
  mark.setAttribute('role','img');
  mark.setAttribute('aria-label',symbol+' 代码标识，非品牌 Logo');
  mark.classList.add('unverified');
  const letters=document.createElement('span');letters.className='symbolLetters';
  if(symbol.length>6){
    letters.classList.add('long');
    const split=Math.ceil(symbol.length/2);
    for(const part of [symbol.slice(0,split),symbol.slice(split)]){
      const line=document.createElement('span');line.textContent=part;letters.append(line);
    }
  }else{
    letters.textContent=symbol;
    letters.classList.add(symbol.length>3?'medium':'short');
    if(symbol.length>=4)letters.classList.add('length-'+symbol.length);
  }
  mark.append(letters);
  return mark;
}
// White transparent artwork needs a contrasting circle, rather than a white placeholder.
function logoSurfaceFor(image){
  try{const canvas=document.createElement('canvas');canvas.width=canvas.height=16;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0,16,16);const pixels=ctx.getImageData(0,0,16,16).data;let visible=0,light=0;
    for(let i=0;i<pixels.length;i+=4){if(pixels[i+3]<96)continue;visible++;if(Math.min(pixels[i],pixels[i+1],pixels[i+2])>215)light++}
    return visible&&visible<220&&light/visible>.8?'#24415c':'#f4f7fa';
  }catch{return '#f4f7fa'}
}
// Decode a URL once; every card starts with the same ready image on subsequent renders.
const readyLogoImages=new Map();
function prepareLogoImage(url){
  const cached=readyLogoImages.get(url);
  if(cached&&(!cached.failed||Date.now()<cached.retryAt))return cached;
  const image=document.createElement('img'),record={image,ready:false,failed:false};
  image.referrerPolicy='no-referrer';image.decoding='async';
  record.promise=new Promise(resolve=>{
    image.onload=async()=>{try{if(image.decode)await image.decode()}catch{}record.ready=true;resolve(image)};
    image.onerror=()=>{record.failed=true;record.retryAt=Date.now()+60000;resolve(null)};
  });
  readyLogoImages.set(url,record);
  if(typeof assetImageCache!=='undefined'&&assetImageCache&&/^\/(?:assets\/icons\/|api\/logo-image)/.test(url))assetImageCache.get(url).then(blob=>{if(blob){const objectURL=URL.createObjectURL(blob);record.objectURL=objectURL;if(record.retired)setTimeout(()=>URL.revokeObjectURL(objectURL),60000);image.src=objectURL}else image.src=url}).catch(()=>{image.src=url});
  else image.src=url;
  if(readyLogoImages.size>((window.MarketDevice?.isMobile?.()??window.innerWidth<=720)?24:128)){const oldest=readyLogoImages.keys().next().value,old=readyLogoImages.get(oldest);old.retired=true;if(old.objectURL)setTimeout(()=>URL.revokeObjectURL(old.objectURL),60000);readyLogoImages.delete(oldest)}
  return record;
}
function logoURLFor(a){
  const official=OKX_ICONS.has(a.symbol);
  return official?'/assets/icons/okx/'+a.symbol.toLowerCase()+'.png':
    BRAND_ICONS.has(a.symbol)?BRAND_ICON_PATHS[a.symbol]:
    COIN_ICONS.has(a.symbol)?'/assets/icons/crypto/'+a.symbol.toLowerCase()+(['DOGE','SOL'].includes(a.symbol)?'.png':'.svg'):resolvedLogos[a.symbol]?.url||(validLogoURL(a.logo)?a.logo:'');
}
function logoFor(a,large=false,deferLookup=false){
  const box=document.createElement('span');box.className=large?'heroLogo':'watchLogo';
  box.dataset.logoSymbol=a.symbol;box.dataset.market=a.type==='ashare'||/^(SH|SZ|BJ)\d{6}$/.test(a.symbol)?'ashare':'swap';
  const official=OKX_ICONS.has(a.symbol);
  const url=logoURLFor(a);
  box.title=official?'OKX 页面使用的标的图标':a.symbol==='XAU'?'黄金商品示意图；商品没有公司 Logo':a.symbol==='OPENAI'?'代码文字标识；非公司官方 Logo':BRAND_ICONS.has(a.symbol)?'公司品牌图标；非 OKX 官方图标':
    COIN_ICONS.has(a.symbol)?'本地币种识别图；非 OKX 官方图标':url?(resolvedLogos[a.symbol]?.source||'标的图标'):'代码标识；暂无核实的品牌图标';
  if(!url){box.append(symbolMark(a.symbol));if(!official&&!BRAND_ICONS.has(a.symbol)&&!COIN_ICONS.has(a.symbol))lookupLogo(a.symbol);return box}
  const record=prepareLogoImage(url),alreadyReady=record.ready;
  const show=image=>{if(!image){box.classList.remove('logoPending');box.replaceChildren(symbolMark(a.symbol));box.title=a.symbol+' 代码标识，图标暂不可用';if(!official&&!BRAND_ICONS.has(a.symbol)&&!COIN_ICONS.has(a.symbol)){delete resolvedLogos[a.symbol];retryLogo(a.symbol,6000)}return}
    if(typeof updateLogoCardPalette==='function')updateLogoCardPalette(url,image);
    if(typeof logoSurfaceFor==='function')box.style.setProperty('--logo-surface',logoSurfaceFor(image));
    const copy=image.cloneNode(false);copy.alt=a.symbol+' 标的图标';box.classList.remove('logoPending');box.replaceChildren(copy);
    if(!alreadyReady)box.classList.add('logoArrived');
  };
  if(record.ready)show(record.image)
  else if(record.failed)show(null);
  else{box.classList.add('logoPending');record.promise.then(show)}
  return box;
}
function refreshResolvedLogo(symbol){
  for(const box of document.querySelectorAll('[data-logo-symbol]')){
    if(box.dataset.logoSymbol!==symbol)continue;
    const replacement=logoFor({symbol,type:box.dataset.market},box.classList.contains('heroLogo'));
    box.replaceWith(replacement);
  }
  if($('heroLogo')?.dataset.symbol===symbol)renderHeroLogo();
}
function renderHeroLogo(){let a=current(),box=$('heroLogo');
if(a&&box.dataset.symbol===a.symbol&&box.querySelector('img')?.naturalWidth>0)return;
box.replaceChildren();
box.dataset.symbol=a?.symbol||'';box.dataset.market=a?.type==='ashare'?'ashare':'swap';
box.disabled=!a;
box.setAttribute('aria-label',a?'查看 '+a.symbol+' 标的资料':'请先选择标的');
if(a){let item=logoFor(a,true);
while(item.firstChild)box.append(item.firstChild)}}
function renderGroupOptions(){let select=$('addGroup'),old=activeGroupId===HOT_GROUP_ID?'main':activeGroupId;
select.replaceChildren();
for(let g of groups.filter(group=>group.id!==HOT_GROUP_ID)){let opt=document.createElement('option');
opt.value=g.id;
opt.textContent=g.name;
select.append(opt)}select.value=groups.some(g=>g.id===old&&g.id!==HOT_GROUP_ID)?old:'main'}
function miniRowsFor(a){
  const key=assetId(a);
  if(miniData[key]?.length)return miniData[key];
  for(const period of [tf,'1d','1h','4h','6h','1w']){
    const rows=timeframeCache.get(key+'|'+period)?.rows;
    if(rows?.length)return rows;
  }
  return null;
}
function renderGroupTabs(){
  const strip=$('groupTabs'),previous=strip.scrollLeft;
  strip.replaceChildren();
  for(const group of groups){
    const button=document.createElement('button');
    button.type='button';button.className='groupTab'+(group.id===activeGroupId?' active':'');
    button.title=group.id===HOT_GROUP_ID?(hotStale?'热门 · 沿用 '+(hotDay||'上次')+' 榜单':
      '热门 · '+(hotDay||'今日')+' 24 小时成交额排名'):group.name;
    button.setAttribute('role','tab');button.setAttribute('aria-selected',String(group.id===activeGroupId));
    const isHot=group.id===HOT_GROUP_ID;
    const count=assets.filter(a=>a.groupId===group.id).length;
    button.setAttribute('aria-label',isHot?'热门分组':group.name+'，'+count+' 个标的');
    const name=document.createElement('span');name.className='groupTabName';name.textContent=group.name;
    const meta=document.createElement('span');meta.className='groupTabMeta';
    if(isHot){
      const fire=document.createElement('span');fire.className='groupTabFire';fire.textContent='🔥';
      fire.setAttribute('aria-hidden','true');meta.append(fire);
    }else{
      const separator=document.createElement('span');separator.className='groupTabSeparator';separator.textContent='·';
      const amount=document.createElement('span');amount.className='groupTabCount';amount.textContent=String(count);
      meta.append(separator,amount);
    }
    button.append(name,meta);
    button.onclick=()=>{activeGroupId=group.id;$('addGroup').value=group.id===HOT_GROUP_ID?'main':group.id;
      if(group.id===HOT_GROUP_ID){reorderMode=false;clearTimeout(reorderIdleTimer);reorderIdleTimer=null}
      const member=assets.find(a=>a.groupId===group.id&&assetId(a)===selected)||
        assets.find(a=>a.groupId===group.id);
      const changed=member&&selected!==assetId(member);
      if(member)selected=assetId(member);
      save();renderWatch();if(changed)loadAsset()};
    strip.append(button);
  }
  strip.scrollLeft=previous;
  requestAnimationFrame(updateGroupScrollRail);
}
function updateGroupScrollRail(){
  const strip=$('groupTabs'),rail=$('groupScrollRail'),thumb=$('groupScrollThumb');
  const overflow=Math.max(0,strip.scrollWidth-strip.clientWidth);
  const visible=!(window.MarketDevice?.isMobile?.()??window.innerWidth<=720)&&overflow>1;
  rail.hidden=!visible;
  rail.parentElement.classList.toggle('hasGroupOverflow',visible);
  if(!visible)return;
  const travel=Math.max(0,rail.clientWidth-thumb.offsetWidth);
  thumb.style.transform=`translateX(${travel*strip.scrollLeft/overflow}px)`;
}
function setupGroupScrollRail(){
  const strip=$('groupTabs'),rail=$('groupScrollRail'),thumb=$('groupScrollThumb');
  const moveTo=event=>{
    const overflow=strip.scrollWidth-strip.clientWidth;
    const travel=rail.clientWidth-thumb.offsetWidth;
    if(overflow<=0||travel<=0)return;
    const x=event.clientX-rail.getBoundingClientRect().left-thumb.offsetWidth/2;
    strip.scrollLeft=Math.max(0,Math.min(travel,x))*overflow/travel;
  };
  rail.addEventListener('pointerdown',event=>{
    event.preventDefault();rail.setPointerCapture(event.pointerId);moveTo(event);
  });
  rail.addEventListener('pointermove',event=>{
    if(rail.hasPointerCapture(event.pointerId))moveTo(event);
  });
  strip.addEventListener('scroll',updateGroupScrollRail,{passive:true});
  window.addEventListener('resize',updateGroupScrollRail,{passive:true});
}
function confirmGroupAction(title,message,confirmLabel,danger=false,options={}){
  const dialog=$('groupConfirmDialog'),accept=$('groupConfirmAccept'),cancel=$('groupConfirmCancel');
  $('groupConfirmTitle').textContent=title;
  $('groupConfirmMessage').textContent=message;
  $('groupConfirmMove').hidden=!options.moveAssets;
  $('groupConfirmMoveCheck').checked=true;
  $('groupConfirmError').textContent='';
  $('groupConfirmMoveCheck').onchange=()=>$('groupConfirmError').textContent='';
  accept.textContent=confirmLabel;
  accept.classList.toggle('danger',danger);
  return new Promise(resolve=>{
    let settled=false;
    const finish=approved=>{
      if(settled)return;
      settled=true;
      dialog.close();
      resolve(approved);
    };
    accept.onclick=()=>{
      const error=options.validate?.($('groupConfirmMoveCheck').checked);
      if(error){$('groupConfirmError').textContent=error;return}
      finish(true);
    };
    cancel.onclick=()=>finish(false);
    dialog.oncancel=event=>{event.preventDefault();finish(false)};
    dialog.showModal();
    cancel.focus();
  });
}
function renderGroupManager(){
  const box=$('groupManageList');box.replaceChildren();
  for(const group of groups.filter(item=>item.id!==HOT_GROUP_ID)){
    const row=document.createElement('div');row.className='groupManageRow';row.dataset.groupId=group.id;
    const title=document.createElement('strong');title.className='groupManageName';title.textContent=group.name;
    row.append(title);
    if(group.id!=='main'){
      const edit=document.createElement('button');edit.type='button';edit.className='groupEditButton';edit.textContent='修改';
      const beginEdit=()=>{
        if(edit.textContent!=='修改')return;
        const input=document.createElement('input');input.value=group.name;
        input.setAttribute('aria-label','修改 '+group.name+' 分组名称');
        title.replaceWith(input);edit.textContent='保存';input.focus();input.select();
        let confirming=false;
        const cleanup=()=>{
          document.removeEventListener('click',outside,true);
          $('groupManageDialog').removeEventListener('close',cleanup);
        };
        const restore=()=>{
          cleanup();input.replaceWith(title);edit.textContent='修改';
          edit.onclick=beginEdit;
          $('groupError').textContent='';
        };
        input.oninput=()=>$('groupError').textContent='';
        const validName=()=>{
          const name=input.value.trim();
          const error=groupNameError(name);
          if(error){$('groupError').textContent=error;input.focus();return null}
          if(groupNameTaken(name,group)){
            $('groupError').textContent='分组名称已存在';input.focus();return null}
          return name;
        };
        const commit=name=>{
          cleanup();group.name=name;$('groupError').textContent='';
          save();renderGroupOptions();renderGroupManager();renderWatch();
        };
        const askToSave=async()=>{
          if(confirming)return;
          if(input.value.trim()===group.name){restore();return}
          const name=validName();if(!name)return;
          confirming=true;
          const approved=await confirmGroupAction('保存分组名称',
            `是否将“${group.name}”改为“${name}”？`,'保存');
          confirming=false;
          if(approved)commit(name);
          else input.focus();
        };
        const outside=event=>{
          if(confirming||event.target===input||event.target===edit)return;
          event.preventDefault();event.stopPropagation();
          askToSave();
        };
        edit.onclick=()=>{
          if(input.value.trim()===group.name){restore();return}
          const name=validName();if(name)commit(name);
        };
        input.onkeydown=event=>{
          if(event.key==='Enter'){event.preventDefault();askToSave()}
          else if(event.key==='Escape'){event.preventDefault();restore()}
        };
        document.addEventListener('click',outside,true);
        $('groupManageDialog').addEventListener('close',cleanup);
      };
      edit.onclick=beginEdit;
      row.append(edit);
      const remove=document.createElement('button');remove.type='button';remove.className='groupDeleteButton';remove.textContent='删除';
      remove.title='删除分组';
      remove.onclick=async()=>{
        const moved=assets.filter(a=>a.groupId===group.id);
        const main=assets.filter(a=>a.groupId==='main');
        const mainIds=new Set(main.map(assetId));
        const unique=moved.filter(a=>!mainIds.has(assetId(a)));
        if(!(await confirmGroupAction(`确定删除“${group.name}”吗？`,
          '',
          '确认删除',true,{moveAssets:true,validate:move=>move&&main.length+unique.length>MAX_GROUP_ASSETS?
            '自选空间不足，请取消勾选后删除。':''})))return;
        const moveAssets=$('groupConfirmMoveCheck').checked;
        const previousSelected=selected,previousGroup=activeGroupId;
        assets=assets.filter(a=>a.groupId!==group.id);
        if(moveAssets)assets.push(...unique.map(a=>({...a,groupId:'main'})));
        for(const asset of moved)if(!assets.some(a=>assetId(a)===assetId(asset)))delete miniData[assetId(asset)];
        groups=groups.filter(g=>g!==group);
        if(activeGroupId===group.id)activeGroupId='main';
        if(!assets.some(a=>a.groupId===activeGroupId&&assetId(a)===selected)){
          const next=assets.find(a=>a.groupId===activeGroupId)||assets[0];
          selected=next?assetId(next):'';
          if(next)activeGroupId=next.groupId;
        }
        $('groupError').textContent='';
        save();renderGroupOptions();renderGroupManager();renderWatch();connectOkx();
        if(selected!==previousSelected||activeGroupId!==previousGroup)loadAsset();
      };
      row.append(remove);
    }else{
      const fixed=document.createElement('span');fixed.className='groupFixedLabel';fixed.textContent='默认分组';row.append(fixed);
    }
    const handle=document.createElement('button');handle.type='button';handle.className='groupDragHandle';
    handle.title='拖动调整 '+group.name+' 的位置';handle.setAttribute('aria-label',handle.title);
    handle.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14"/></svg>';
    handle.onpointerdown=event=>{
      if(event.button!==0)return;
      event.preventDefault();
      row.classList.add('dragging');box.classList.add('sorting');
      const move=moveEvent=>{
        const others=[...box.querySelectorAll('.groupManageRow')].filter(item=>item!==row);
        for(const other of others){
          const rect=other.getBoundingClientRect();
          if(moveEvent.clientY>=rect.top&&moveEvent.clientY<=rect.bottom){
            if(moveEvent.clientY<rect.top+rect.height/2)other.before(row);
            else other.after(row);
            break;
          }
        }
      };
      const finish=()=>{
        document.removeEventListener('pointermove',move);
        document.removeEventListener('pointerup',finish);
        document.removeEventListener('pointercancel',finish);
        row.classList.remove('dragging');box.classList.remove('sorting');
        const byId=new Map(groups.map(g=>[g.id,g]));
        groups=[...box.querySelectorAll('.groupManageRow')].map(item=>byId.get(item.dataset.groupId)).filter(Boolean);
        save();renderGroupOptions();renderWatch();renderGroupManager();
      };
      document.addEventListener('pointermove',move);
      document.addEventListener('pointerup',finish);
      document.addEventListener('pointercancel',finish);
    };
    row.append(handle);box.append(row);
  }
}
const groupSeedChosen=new Map();
const HOT_GROUP_SEED_SYMBOLS=[
  'NVDA','AAPL','TSLA','MSFT','AMZN','META',
  'GOOGL','AMD','TSM','MU','CXMT','ZHONGJI'
];
function hotGroupSeedAssets(){
  return HOT_GROUP_SEED_SYMBOLS.map(symbol=>
    instrumentCatalog?.find(item=>item.symbol===symbol)||
    {type:'swap',symbol,name:STOCK_NAMES[symbol]?.[0]||symbol});
}
let groupSeedResults=[],groupSeedRemoteResults=[],groupSeedSearchIndex=-1,groupSeedSearchSerial=0;
function hideGroupSeedSuggestions(){
  $('groupSeedSuggestions').hidden=true;
  $('groupSeedSearch').setAttribute('aria-expanded','false');
  groupSeedSearchIndex=-1;
}
function chooseGroupSeedSuggestion(asset){
  const id=assetId(asset);
  if(!groupSeedChosen.has(id)){
    if(groupSeedChosen.size>=MAX_GROUP_ASSETS){$('groupError').textContent=`每个分组最多 ${MAX_GROUP_ASSETS} 个标的`;return}
    groupSeedChosen.set(id,asset);
  }
  $('groupError').textContent='';
  renderGroupSeedSelected();renderGroupSeedOptions();
  hideGroupSeedSuggestions();
}
function renderGroupSeedSuggestions(pending=false){
  const box=$('groupSeedSuggestions');box.replaceChildren();
  if(!$('groupSeedSearch').value.trim()){hideGroupSeedSuggestions();return}
  box.hidden=false;
  $('groupSeedSearch').setAttribute('aria-expanded','true');
  if(!groupSeedResults.length){
    const empty=document.createElement('div');empty.className='emptyHint';
    empty.textContent=pending?'正在查找匹配的标的…':'没有匹配的标的';
    box.append(empty);return;
  }
  groupSeedResults.forEach((asset,index)=>{
    const row=document.createElement('div');
    row.className='suggestion'+(index===groupSeedSearchIndex?' active':'');
    row.setAttribute('role','option');
    row.setAttribute('aria-selected',String(groupSeedChosen.has(assetId(asset))));
    const info=document.createElement('button');info.type='button';info.className='groupSeedSuggestionInfo';
    info.setAttribute('aria-label','查看 '+asset.symbol+' 简介');
    const icon=logoFor(asset);icon.classList.add('suggestLogo');
    const name=document.createElement('span');name.className='suggestName';
    const symbol=document.createElement('strong');symbol.textContent=asset.symbol;
    const detail=document.createElement('small');detail.textContent=asset.name||asset.symbol;
    name.append(symbol,detail);
    info.append(icon,name);info.onclick=()=>openInfoForPreview(asset);
    const add=document.createElement('button');add.type='button';add.className='groupSeedSuggestionAdd';
    add.textContent=groupSeedChosen.has(assetId(asset))?'已选择':'加入分组';
    add.setAttribute('aria-label','选择 '+asset.symbol+' 加入分组');
    add.onclick=()=>chooseGroupSeedSuggestion(asset);
    row.append(info,add);box.append(row);
  });
}
function refreshGroupSeedSuggestions(pending=false){
  const query=$('groupSeedSearch').value.trim(),unique=new Map();
  if(!query){groupSeedResults=[];hideGroupSeedSuggestions();return}
  // 和桌面端一致：统一用 matchCatalog 的模糊匹配（含编辑距离），不再用简单 includes
  for(const asset of matchCatalog(query))unique.set(assetId(asset),asset);
  // 目录未加载时用服务端结果兜底；已加载则目录结果优先
  if(!instrumentCatalog)for(const asset of groupSeedRemoteResults)unique.set(assetId(asset),asset);
  groupSeedResults=[...unique.values()].slice(0,20);
  groupSeedSearchIndex=Math.min(groupSeedSearchIndex,groupSeedResults.length-1);
  renderGroupSeedSuggestions(pending);
}
function searchGroupSeed(){
  const query=$('groupSeedSearch').value.trim(),serial=++groupSeedSearchSerial;
  groupSeedRemoteResults=[];groupSeedSearchIndex=-1;
  refreshGroupSeedSuggestions(Boolean(query&&!instrumentCatalog));
  if(query&&instrumentCatalog)recordSearch(query);
  if(!query||instrumentCatalog)return;
  loadCatalog().then(()=>{
    if(serial!==groupSeedSearchSerial)return;
    renderGroupSeedOptions();refreshGroupSeedSuggestions(false);
  });
  api('/api/search?q='+encodeURIComponent(query)).then(data=>{
    if(serial!==groupSeedSearchSerial)return;
    groupSeedRemoteResults=Array.isArray(data.results)?data.results:[];
    renderGroupSeedOptions();refreshGroupSeedSuggestions(false);
  }).catch(()=>{
    if(serial===groupSeedSearchSerial)refreshGroupSeedSuggestions(false);
  });
}
function renderGroupSeedSelected(){
  const box=$('groupSeedSelected');box.replaceChildren();
  const heading=document.createElement('strong');heading.className='groupSeedSelectedTitle';
  heading.textContent=`待加入标的 · ${groupSeedChosen.size}/${MAX_GROUP_ASSETS}`;
  box.append(heading);
  if(!groupSeedChosen.size){
    const empty=document.createElement('span');empty.className='groupSeedSelectedEmpty';
    empty.textContent='从下方勾选，或搜索后选择标的';box.append(empty);return;
  }
  const list=document.createElement('div');list.className='groupSeedChips';
  for(const [id,asset] of groupSeedChosen){
    const chip=document.createElement('span');chip.className='groupSeedChip';
    chip.title=asset.symbol+' · '+(asset.name||asset.symbol);
    const icon=logoFor(asset);icon.classList.add('groupSeedChipLogo');
    const logoButton=document.createElement('button');logoButton.type='button';
    logoButton.className='groupSeedChipLogoButton';
    logoButton.setAttribute('aria-label','查看 '+asset.symbol+' 简介');
    logoButton.onclick=()=>openInfoForPreview(asset);
    logoButton.append(icon);
    const label=document.createElement('span');label.className='groupSeedChipText';
    const symbol=document.createElement('strong');symbol.textContent=asset.symbol;
    const name=document.createElement('small');name.textContent=asset.name||asset.symbol;
    label.append(symbol,name);
    const remove=document.createElement('button');remove.type='button';remove.textContent='×';
    remove.setAttribute('aria-label','移除 '+asset.symbol);
    remove.onclick=()=>{groupSeedChosen.delete(id);$('groupError').textContent='';
      renderGroupSeedSelected();renderGroupSeedOptions();
      if(!$('groupSeedSuggestions').hidden)refreshGroupSeedSuggestions()};
    chip.append(logoButton,label,remove);list.append(chip);
  }
  box.append(list);
}
function renderGroupSeedOptions(){
  const box=$('groupSeedList'),query=$('groupSeedSearch').value.trim();box.replaceChildren();
  $('groupSeedResultTitle').textContent=query?'搜索结果':'可选标的';
  const unique=new Map();
  const matches=asset=>searchTerms(asset).some(term=>term.includes(normalizeSearch(query)));
  for(const asset of groupSeedChosen.values())if(!query||matches(asset))unique.set(assetId(asset),asset);
  if(!query)for(const asset of hotGroupSeedAssets())unique.set(assetId(asset),asset);
  if(query)for(const asset of matchCatalog(query))unique.set(assetId(asset),asset);
  if(query)for(const asset of groupSeedRemoteResults)unique.set(assetId(asset),asset);
  if(!unique.size){
    const empty=document.createElement('p');empty.className='groupSeedEmpty';
    empty.textContent=query?'没有匹配的标的':'暂无标的，可在上方搜索 OKX 合约';box.append(empty);return;
  }
  for(const [id,asset] of unique){
    const row=document.createElement('div');row.className='groupSeedOption';
    const check=document.createElement('input');check.type='checkbox';check.value=id;
    check.name='groupSeedAsset';check.checked=groupSeedChosen.has(id);
    check.setAttribute('aria-label','选择 '+asset.symbol+' 加入分组');
    check.onchange=()=>{
      if(check.checked){
        if(groupSeedChosen.size>=MAX_GROUP_ASSETS){check.checked=false;
          $('groupError').textContent=`每个分组最多 ${MAX_GROUP_ASSETS} 个标的`;return}
        groupSeedChosen.set(id,asset);
      }
      else groupSeedChosen.delete(id);
      $('groupError').textContent='';
      renderGroupSeedSelected();
      if(!$('groupSeedSuggestions').hidden)refreshGroupSeedSuggestions();
    };
    const info=document.createElement('span');info.className='groupSeedOptionInfo';
    const symbol=document.createElement('strong');symbol.textContent=asset.symbol;
    const name=document.createElement('span');name.textContent=asset.name||asset.symbol;
    info.append(symbol,name);
    row.append(check,info);box.append(row);
  }
}
// 「调整位置」是临时模式：拖完后若 5 秒内没有继续拖动，或期间添加了新标的，就自动回到「调整位置」。
function scheduleReorderIdle(){
  clearTimeout(reorderIdleTimer);
  reorderIdleTimer=setTimeout(()=>{reorderIdleTimer=null;applyReorderMode(false)},5000);
}
function applyReorderMode(on){
  reorderMode=on;
  if(on)scheduleReorderIdle();
  else{clearTimeout(reorderIdleTimer);reorderIdleTimer=null}
  renderWatch();
}
function renderWatch(){
if((window.MarketDevice?.isMobile?.()??window.innerWidth<=720)&&petHomeOn){renderPets();return}
let box=$('watchlist');
let previousScroll=box.scrollTop;
const stableLogos=new Map([...box.querySelectorAll('.watch')].map(row=>
  [row.dataset.assetId,row.querySelector('.watchLogo')]).filter(([,logo])=>logo?.querySelector('img')?.naturalWidth>0));
box.replaceChildren();
if(!groups.some(g=>g.id===activeGroupId))activeGroupId=groups[0]?.id||'main';
const group=groups.find(g=>g.id===activeGroupId);
const members=assets.filter(a=>a.groupId===activeGroupId).sort((a,b)=>Number(b.pinned)-Number(a.pinned));
box.classList.toggle('scrolling',members.length>6);
$('toggleReorder').disabled=activeGroupId===HOT_GROUP_ID;
$('toggleReorder').classList.toggle('active',reorderMode);
$('toggleReorder').setAttribute('aria-pressed',String(reorderMode));
$('toggleReorder').textContent=reorderMode?'完成调整':'调整位置';
renderGroupTabs();
if(group.id===HOT_GROUP_ID&&hotStale){
  const stale=document.createElement('div');stale.className='watchGroupStale';
  stale.textContent='热门榜更新暂不可用，显示'+(hotDay||'上次')+'的数据';
  box.append(stale);
}
if(!members.length){let empty=document.createElement('div');
empty.className='watchGroupEmpty';empty.textContent='这个分组还没有标的';box.append(empty)}
for(let j=0;
j<members.length;
j++){let a=members[j],k=assetId(a),wid=watchId(a),q=quotes[k],row=document.createElement('div');
const isHotRow=group.id===HOT_GROUP_ID;
row.className='watch'+(isHotRow?' hot':'')+(k===selected&&group.id===activeGroupId?' selected':'')+(a.pinned?' pinned':'');
row.dataset.assetId=wid;
row.dataset.groupId=group.id;
let logo=stableLogos.get(wid)||logoFor(a);
let logoButton=document.createElement('button');
logoButton.type='button';
logoButton.className='watchLogoButton';
logoButton.setAttribute('aria-label','查看 '+a.symbol+' 标的资料');
logoButton.title='查看 '+a.symbol+' 标的资料';
logoButton.append(logo);
logoButton.onclick=()=>{if(!suppressWatchClick)openInfoFor(k)};
let main=document.createElement('button');
main.className='watchmain';
let strong=document.createElement('strong');
strong.textContent=a.symbol;
if(a.symbol.length>6)strong.classList.add('compactSymbol');
if(a.symbol.length>10)strong.classList.add('denseSymbol');
let subtitle=document.createElement('span');
subtitle.textContent=a.name||profiles[k]?.name||(a.type==='ashare'?'A股':'OKX 永续合约');
subtitle.title=subtitle.textContent;
main.append(strong,subtitle);
main.onclick=()=>{if(!suppressWatchClick)selectAsset(k,group.id)};
let mini=document.createElement('button');
mini.className='miniButton';
mini.title='打开 '+a.symbol+' 完整 K 线';
mini.setAttribute('aria-label','打开 '+a.symbol+' 完整 K 线');
let canvas=document.createElement('canvas');
canvas.className='miniCanvas';
mini.append(canvas);
mini.onclick=()=>{if(!suppressWatchClick)selectAsset(k,group.id)};
let price=document.createElement('div');
price.className='watchprice';
price.dataset.assetId=k;
price.textContent=q?fmt(q.p,a):'—';
let actions=document.createElement('div');
actions.className='watchactions';
if(reorderMode&&group.id!==HOT_GROUP_ID){
  let handle=document.createElement('button');
  handle.type='button';
  handle.className='dragHandle';
  handle.title='按住拖动 '+a.symbol;
  handle.setAttribute('aria-label','按住拖动 '+a.symbol+' 调整位置');
  handle.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14"/></svg>';
  handle.onpointerdown=e=>startWatchDrag(e,row,handle,group.id);
  actions.append(handle);
}else if(group.id!==HOT_GROUP_ID){let menu=document.createElement('button');
menu.type='button';menu.className='watchMenuButton';menu.textContent='···';
menu.title='管理 '+a.symbol;menu.setAttribute('aria-label','管理 '+a.symbol);
menu.onclick=()=>openWatchActions(wid);actions.append(menu)}
if(isHotRow){let rank=document.createElement('span');rank.className='hotRank';rank.textContent=String(j+1);rank.title='成交额榜第 '+(j+1)+' 名';row.append(rank)}
row.append(logoButton,main,mini,price,actions);
row.oncontextmenu=e=>{if(group.id!==HOT_GROUP_ID){e.preventDefault();openWatchActions(wid)}};
let holdTimer=null,startX=0,startY=0;
row.addEventListener('pointerdown',e=>{if(group.id===HOT_GROUP_ID||reorderMode||e.button!==0||e.target.closest('.watchactions'))return;
startX=e.clientX;startY=e.clientY;
holdTimer=setTimeout(()=>{suppressWatchClick=true;openWatchActions(wid);
setTimeout(()=>suppressWatchClick=false,450)},550)});
row.addEventListener('pointermove',e=>{if(Math.hypot(e.clientX-startX,e.clientY-startY)>9){clearTimeout(holdTimer);holdTimer=null}});
for(const type of ['pointerup','pointercancel','pointerleave'])row.addEventListener(type,()=>{clearTimeout(holdTimer);holdTimer=null});
box.append(row);
const miniRows=miniRowsFor(a);
mini.classList.toggle('pending',!miniRows);
miniChart(canvas,miniRows);
if(!miniData[k]?.length||Date.now()-(miniFetchedAt[k]||0)>60000)queueMini(a,true);
if(!profiles[k])queueProfile(a)}box.scrollTop=previousScroll;
renderPets()}
function persistWatchOrder(groupId){
  const rows=[...$('watchlist').querySelectorAll('.watch')].filter(row=>row.dataset.groupId===groupId);
  const order=rows.map(row=>findWatch(row.dataset.assetId));
  const slots=assets.map((a,index)=>a.groupId===groupId?index:-1).filter(index=>index>=0);
  const ordered=[...order.filter(a=>a.pinned),...order.filter(a=>!a.pinned)];
  slots.forEach((slot,index)=>{assets[slot]=ordered[index]});
  save();
}
function insertInGroup(asset,atEnd=false){
  const slots=assets.map((a,index)=>a.groupId===asset.groupId?index:-1).filter(index=>index>=0);
  if(!slots.length){assets.push(asset);return}
  const firstNormal=slots.find(index=>!assets[index].pinned);
  const position=atEnd?slots.at(-1)+1:(firstNormal??slots.at(-1)+1);
  assets.splice(position,0,asset);
}
function moveWatchAsset(id,pinned,toEnd=false){
  const index=assets.findIndex(a=>watchId(a)===id);if(index<0)return;
  const [a]=assets.splice(index,1);a.pinned=pinned;
  if(pinned){const first=assets.findIndex(x=>x.groupId===a.groupId);
    assets.splice(first<0?assets.length:first,0,a)}
  else insertInGroup(a,toEnd);
  save();renderWatch();
}
function openWatchActions(id){
  const a=findWatch(id);if(!a||a.groupId===HOT_GROUP_ID)return;
  actionAssetId=id;$('watchActionTitle').textContent=a.symbol+' · 自选操作';
  $('watchPin').textContent=a.pinned?'取消置顶':'置顶';
  openDetailDialog($('watchActionDialog'));
}
function removeWatchAsset(id){
  const removed=findWatch(id);if(!removed||removed.groupId===HOT_GROUP_ID)return;
  assets=assets.filter(a=>watchId(a)!==id);
  if(!assets.some(a=>assetId(a)===assetId(removed)))delete miniData[assetId(removed)];
  if(selected===assetId(removed)&&activeGroupId===removed.groupId){
    const replacement=assets.find(a=>a.groupId===activeGroupId)||assets[0];
    selected=replacement?assetId(replacement):'';
  }
  save();renderWatch();renderGroupOptions();connectOkx();loadAsset();
}
function startWatchDrag(event,row,handle,groupId){
  if(event.button!==0||!reorderMode)return;
  event.preventDefault();
  watchDragging=true;
  const list=$('watchlist'),origin=row.getBoundingClientRect(),startY=event.clientY;
  const placeholder=document.createElement('div');
  placeholder.className='watchPlaceholder';
  placeholder.style.height=origin.height+'px';
  row.before(placeholder);
  document.body.append(row);
  row.classList.add('dragging');
  Object.assign(row.style,{position:'fixed',left:origin.left+'px',top:origin.top+'px',width:origin.width+'px',pointerEvents:'none',zIndex:'1000'});
  let pointerY=event.clientY,frame=0;
  const place=()=>{
    const rows=[...list.querySelectorAll('.watch')].filter(item=>item.dataset.groupId===groupId);
    if(!rows.length)return;
    const old=new Map(rows.map(item=>[item,item.getBoundingClientRect().top]));
    const target=rows.find(item=>pointerY<item.getBoundingClientRect().top+item.offsetHeight/2);
    if(target)target.before(placeholder);
    else rows.at(-1).after(placeholder);
    for(const item of rows){const delta=old.get(item)-item.getBoundingClientRect().top;
      if(Math.abs(delta)>1)item.animate([{transform:`translateY(${delta}px)`},{transform:'translateY(0)'}],{duration:125,easing:'ease-out'});
    }
  };
  const scroll=()=>{
    const bounds=list.getBoundingClientRect(),edge=42;
    if(pointerY>bounds.top&&pointerY<bounds.bottom){
      const speed=pointerY<bounds.top+edge?-Math.ceil((bounds.top+edge-pointerY)/5):pointerY>bounds.bottom-edge?Math.ceil((pointerY-bounds.bottom+edge)/5):0;
      if(speed){list.scrollTop+=speed;place()}
    }
    frame=requestAnimationFrame(scroll);
  };
  const move=e=>{
    if(e.pointerId!==event.pointerId)return;
    pointerY=e.clientY;
    row.style.top=origin.top+(e.clientY-startY)+'px';
    place();
    scheduleReorderIdle();
  };
  const finish=e=>{
    if(e.pointerId!==event.pointerId)return;
    window.removeEventListener('pointermove',move);
    window.removeEventListener('pointerup',finish);
    window.removeEventListener('pointercancel',finish);
    cancelAnimationFrame(frame);
    placeholder.replaceWith(row);
    row.removeAttribute('style');
    row.classList.remove('dragging');
    persistWatchOrder(groupId);
    watchDragging=false;
    renderWatch();
    scheduleReorderIdle();
  };
  window.addEventListener('pointermove',move);
  window.addEventListener('pointerup',finish);
  window.addEventListener('pointercancel',finish);
  frame=requestAnimationFrame(scroll);
}
function infoMetric(grid,label,value){let item=document.createElement('div');
item.className='infoMetric';
let small=document.createElement('small');
small.textContent=label;
let strong=document.createElement('strong');
strong.textContent=value==null||value===''?'—':String(value);
item.append(small,strong);
grid.append(item)}
function openInfoFor(id){
  infoPreviewAsset=null;
  if(selected!==id)selectAsset(id);
  const a=current();
  if(!a)return;
  renderInfo();
  loadProfile(a);
  openDetailDialog($('infoDialog'));
}
let infoPreviewRequest=0;
async function openInfoForPreview(item){
  if(!item?.symbol)return;
  const serial=++infoPreviewRequest,owner=accountSpace,group=petDeckGroup,index=petDeckIndex,epoch=petManagerEpoch;
  const mobile=window.MarketDevice?.isMobile?.()??window.innerWidth<=720;
  const button=mobile&&group?$('deckCard')?.querySelector('.deckLogo'):null;
  button?.closest('.deckArt')?.querySelector('.deckInfoHint')?.remove();
  button?.classList.add('deckInfoLoading');
  const sameSource=()=>serial===infoPreviewRequest&&owner===accountSpace&&group===petDeckGroup&&index===petDeckIndex&&epoch===petManagerEpoch;
  const preview={type:assetMarketType(item),symbol:item.symbol,name:item.name},key=assetId(preview);
  // A slow or failed profile request must not disable the card's information page.
  infoPreviewAsset=preview;
  renderInfo();openDetailDialog($('infoDialog'));
  try{
    await loadProfile(preview,Date.now()<(profileErrorUntil[key]||0));
    if(sameSource()&&infoPreviewAsset===preview)renderInfo();
  }catch{
    if(sameSource()&&infoPreviewAsset===preview){profileErrorUntil[key]=Date.now()+30000;renderInfo()}
  }finally{if(serial===infoPreviewRequest)button?.classList.remove('deckInfoLoading')}
}
function briefAssetSummary(text,limit=240){
  const plain=String(text||'').replace(/\s+/g,' ').trim();
  if(!plain)return '简介暂未收录。';
  const sentences=plain.match(/[^。！？!?]+[。！？!?]|[^。！？!?]+$/g)||[];
  let result='',count=0;
  for(const raw of sentences){
    const sentence=raw.trim();
    if(/(?:…|\.\.\.)$/.test(sentence))break;
    const complete=/[。！？!?.]$/.test(sentence)?sentence:sentence+'。';
    if(result.length+complete.length>limit)break;
    result+=complete;count++;
    if(count===2)break;
  }
  if(result)return /[。！？!?.]$/.test(result)?result:result+'。';
  // Keep a complete primary business clause; never cut through words or a product list.
  const clause=plain.split(/[，,；;。！？!?]/)[0].trim();
  if(clause.length+1<=limit&&!/[：:、…]$/.test(clause)&&/主营|主要业务|提供|专注|从事|生产|销售|研发/.test(clause))return clause+'。';
  return sentences[0]?.trim()||plain;
}
function renderInfo(){let a=infoPreviewAsset||current(),box=$('assetInfo');
box.replaceChildren();
if(!a){box.textContent='请先添加标的。';
$('infoSource').textContent='';
return}
const key=assetId(a),loaded=profiles[key],item=instrumentCatalog?.find(row=>row.symbol===a.symbol);
const p=loaded||{
  name:a.name||item?.name||a.symbol,
  pair:a.type==='ashare'?a.symbol:item?.instId||a.symbol+'-USDT-SWAP',exchange:a.type==='ashare'?(item?.exchange||'A股市场'):'OKX',status:'—',
  base:a.symbol,quote:a.type==='ashare'?'CNY':'USDT',tickSize:'—',contractValue:'—',
  summary:Date.now()<(profileErrorUntil[key]||0)?'详细简介暂时无法加载，请稍后重试。':'正在读取中文简介…',
  source:'OKX 合约基础资料'
};
$('infoSource').textContent=loaded?(p.source||'资料')+(p.stale?' · 缓存资料，待更新':''):
  Date.now()<(profileErrorUntil[key]||0)?'基础资料 · 详细资料暂不可用':'基础资料 · 正在补全';
let identity=document.createElement('div');
identity.className='profileIdentity';
let logo=document.createElement('span');
logo.className='profileLogo';
logo.append(logoFor(a,true));
let heading=document.createElement('div');
heading.className='profileHeading';
let kind=document.createElement('span');
kind.className='profileKind';
kind.textContent=marketLabel(a);
let title=document.createElement('h3');
title.className='infoTitle';
title.textContent=a.symbol;
let name=document.createElement('span');
name.className='profileName';
name.textContent=p.name||a.name||a.symbol;
heading.append(kind,title,name);
identity.append(logo,heading);
box.append(identity);
let about=document.createElement('section');
about.className='infoSummary';
let label=document.createElement('h4');
label.textContent='简介';
let paragraph=document.createElement('p');
paragraph.textContent=briefAssetSummary(p.summary);
about.append(label,paragraph);box.append(about);
if(!loaded&&Date.now()<(profileErrorUntil[key]||0)){
  const retry=document.createElement('button');retry.type='button';retry.className='profileRetry';retry.textContent='重试加载资料';
  retry.onclick=()=>{delete profileErrorUntil[key];renderInfo();loadProfile(a,true)};box.append(retry);
}
let grid=document.createElement('div');
grid.className='infoGrid';
infoMetric(grid,'交易对',p.pair);
infoMetric(grid,'交易平台',p.exchange);
infoMetric(grid,'状态',p.status);
infoMetric(grid,'最小价格变动',p.tickSize);
infoMetric(grid,'产品类型',a.type==='ashare'?'股票现货':'永续合约');

infoMetric(grid,'基础资产',p.base);
infoMetric(grid,'计价资产',p.quote);
box.append(grid);
let links=document.createElement('div');
links.className='profileLinks';
function addLink(url,label){if(!url)return;
let link=document.createElement('a');
link.href=url;
link.target='_blank';
link.rel='noopener noreferrer';
link.textContent=label+' ↗';
links.append(link)}
addLink(p.website,'官方网站');
if(links.childElementCount)box.append(links)}
async function loadProfile(a,force=false){let k=assetId(a);
if(profileLoading.has(k))return loadProfile.pending?.get(k);
let restoredFromDisk=false;
if(!profiles[k]){const cached=assetProfileCache?.get(k);if(cached){profiles[k]=cached.profile;profileCachedAt[k]=cached.t;restoredFromDisk=true;if(cached.profile.name){a.name=cached.profile.name;for(const item of assets)if(assetId(item)===k)item.name=cached.profile.name}}}
if(!force&&profiles[k]&&Date.now()-(profileCachedAt[k]||0)<PROFILE_FRESH_MS){if(restoredFromDisk&&(selected===k||(infoPreviewAsset&&assetId(infoPreviewAsset)===k)))renderInfo();return profiles[k]}
if(!force&&Date.now()<(profileErrorUntil[k]||0))return;
profileLoading.add(k);
const work=(async()=>{
const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),18000);
try{let p=await api('/api/info?type='+a.type+'&symbol='+encodeURIComponent(a.symbol),{signal:controller.signal});
if(p.symbol!==a.symbol||p.type!==a.type||(a.type==='swap'&&p.pair!==a.symbol+'-USDT-SWAP'))throw new Error('标的资料身份不匹配');
if(typeof window!=='undefined'&&window.MarketData?.profileReady&&!window.MarketData.profileReady(p))p.incomplete=true;
profiles[k]=p;delete profileErrorUntil[k];
if(profileRetryTimers.has(k)){clearTimeout(profileRetryTimers.get(k));profileRetryTimers.delete(k)}
if(p.incomplete||p.stale){const owner=accountSpace;profileRetryTimers.set(k,setTimeout(()=>{profileRetryTimers.delete(k);if(owner===accountSpace&&!document.hidden&&navigator.onLine!==false&&(assets.some(item=>assetId(item)===k)||infoPreviewAsset&&assetId(infoPreviewAsset)===k))loadProfile(a,true)},p.incomplete?30000:2000))}
profileCachedAt[k]=(p.stale||p.incomplete)?Date.now()-PROFILE_FRESH_MS+10000:Date.now();
assetProfileCache?.put(k,p,profileCachedAt[k]);
if(p.name){a.name=p.name;for(const asset of assets)if(assetId(asset)===k)asset.name=p.name;}
if(p.logo)rememberAssetLogos([{...a,logo:p.logo,logoSource:p.logoSource}]);
if(typeof petDeckGroup!=='undefined'&&petDeckGroup&&deckMembers()[petDeckIndex]?.symbol===a.symbol){const sub=$('deckCard')?.querySelector('.deckTitleRow span');if(sub&&p.name)sub.textContent=p.name;}
scheduleWatch();
if(selected===k||(infoPreviewAsset&&assetId(infoPreviewAsset)===k)){renderInfo();
renderHeroLogo()}return p;}catch(e){profileErrorUntil[k]=Date.now()+30000;
if(!profileRetryTimers.has(k)){const owner=accountSpace;profileRetryTimers.set(k,setTimeout(()=>{profileRetryTimers.delete(k);if(owner===accountSpace&&!document.hidden&&navigator.onLine!==false&&(assets.some(item=>assetId(item)===k)||infoPreviewAsset&&assetId(infoPreviewAsset)===k))queueProfile(a)},30000))}
if(selected===k||(infoPreviewAsset&&assetId(infoPreviewAsset)===k))renderInfo()}finally{clearTimeout(timeout);profileLoading.delete(k)}})();
(loadProfile.pending||=new Map()).set(k,work);
try{return await work}finally{loadProfile.pending.delete(k)}
}
function scheduleWatch(){if(!watchTimer)watchTimer=setTimeout(()=>{watchTimer=null;
if(!watchDragging)renderWatch()},500)}
function updateWatchQuote(k,p){for(const node of document.querySelectorAll('.watchprice')){if(node.dataset.assetId===k){node.textContent=fmt(p,{type:k.split(':')[0]});
break}}}
function scheduleDraw(){if(document.hidden||!mobileChartVisible())return;if(!drawTimer)drawTimer=setTimeout(()=>{drawTimer=null;
requestAnimationFrame(draw)},32)}
async function loadMini(a){let k=assetId(a);
if(miniLoading.has(k)||Date.now()<(miniErrorUntil[k]||0))return;
miniLoading.add(k);
try{let data=await loadDailyBars(a);
let rows=validBars(data.candles).slice(-30);
if(rows.length){if(data.stale&&miniData[k]?.length){miniErrorUntil[k]=Date.now()+15000;return}
  miniData[k]=rows;
  if(data.stale){miniErrorUntil[k]=Date.now()+15000;scheduleWatch();return}
  miniFetchedAt[k]=Date.now();
  try{const cache=JSON.parse(publicMarketCache.getItem(MINI_STORE)||'{}');
    cache[k]={t:Date.now(),rows};
    for(const [id,entry] of Object.entries(cache))if(Date.now()-entry.t>24*3600000)delete cache[id];
    publicMarketCache.setItem(MINI_STORE,JSON.stringify(cache))}catch{}
  scheduleWatch()}
else miniErrorUntil[k]=Date.now()+30000;
}catch{miniErrorUntil[k]=Date.now()+15000}finally{miniLoading.delete(k)}}
function mobileChartVisible(){return !(window.MarketDevice?.isMobile?.()??window.innerWidth<=720)||!petHomeOn||!!$('petDeck')?.classList.contains('deckChartMode')}
function refreshMinis(){if(document.hidden)return;const mobile=window.MarketDevice?.isMobile?.()??window.innerWidth<=720;for(let a of (mobile?deckMembers():assets))queueMini(a,true)}
function selectAsset(id,groupId=activeGroupId){if(selected!==id||activeGroupId!==groupId){selected=id;activeGroupId=groupId;
save();
renderWatch();
loadAsset()}if(!(window.MarketDevice?.isMobile?.()??window.innerWidth<=720))document.querySelector('.hero').scrollIntoView({behavior:'smooth',block:'nearest'})}
const mobileMoved=[];
function openMobileMore(focusAdd=false){
  if(focusAdd&&(window.MarketDevice?.isMobile?.()??window.innerWidth<=720)&&petHomeOn){openPetManager(petDeckGroup&&petDeckGroup!==HOT_GROUP_ID?petDeckGroup:activeGroupId===HOT_GROUP_ID?'main':activeGroupId);return}
  const dialog=$('mobileMoreDialog'),body=$('mobileMoreBody');
  dialog.dataset.section=petHomeOn&&(window.MarketDevice?.isMobile?.()??window.innerWidth<=720)?(focusAdd?'add':'settings'):'all';
  dialog.querySelector('.mobileMoreHead strong').textContent=dialog.dataset.section==='add'?'添加标的':dialog.dataset.section==='settings'?'设置与资讯':'更多功能';
  if(!mobileMoved.length){
    const nodes=[$('addForm'),$('addError'),document.querySelector('.workspace > .settings'),
      document.querySelector('.sidebarNews'),document.querySelector('.insightDisclosure')];
    for(const node of nodes){if(!node)continue;
      const marker=document.createComment('mobileMoreReturn');node.before(marker);
      mobileMoved.push([marker,node]);body.append(node)}
  }
  openDetailDialog($('mobileMoreDialog'));
  if(focusAdd){window.MarketMobilePages?.showSearch();requestAnimationFrame(()=>$('symbol').focus({preventScroll:true}))}
}
function closeMobileMore(){
  for(const [marker,node] of mobileMoved){marker.replaceWith(node)}
  mobileMoved.length=0;scheduleDraw();
}
async function api(url,options={}){
try{
  if(window.MarketData?.readJSON)return await window.MarketData.readJSON(url,{retries:url.startsWith('/api/auth/')?0:1,...options});
  // 已打开的旧服务可能尚未提供新数据脚本；账户请求仍须能完成。
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),options.timeoutMs||15000);
  const cancel=()=>controller.abort();if(options.signal?.aborted)cancel();else options.signal?.addEventListener('abort',cancel,{once:true});
  try{
    const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...options,signal:controller.signal});
    const data=await response.json();
    if(!response.ok)throw Object.assign(Error(data.error||'HTTP '+response.status),{status:response.status});
    return data;
  }finally{clearTimeout(timer);options.signal?.removeEventListener('abort',cancel)}
}
catch(error){if(error.status===401&&accountUser){accountUser=null;accountId=null;accountSpace='';setAccess(false);renderAccount()}
throw error}}
async function postApi(url,body={},keepalive=false){
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},
    credentials:'same-origin',cache:'no-store',keepalive,body:JSON.stringify(body)});
  const data=await response.json();
  if(response.status===401&&accountUser){accountUser=null;accountId=null;accountSpace='';setAccess(false);renderAccount()}
  if(!response.ok){const error=Error(data.error==='未找到'?'请求的地址不存在，请刷新页面重试':(data.error||'HTTP '+response.status));
    error.status=response.status;error.body=data;throw error}
  return data;
}
function renderAccount(){
  $('authDialog').classList.remove('mobilePasswordView');
  if((window.MarketDevice?.isMobile?.()??window.innerWidth<=720))$('passwordDetails').open=false;
  $('accountButton').textContent=accountUser?accountUser+' · 账户':'登录 / 注册';
  $('accountButton').title='';
  renderHomeAccountBadge();
  $('authSigned').hidden=!accountUser;
  $('authTabs').hidden=!!accountUser;
  $('authForm').hidden=!!accountUser;
  $('authTitle').hidden=!!accountUser;
  $('authSignedName').textContent=accountUser||'';
  $('accountId').textContent=accountId??'—';renderAccountAvatar();syncAuthMascot();
}
function setAccess(allowed){document.body.classList.toggle('authLocked',!allowed);
  if(!allowed){
    document.body.classList.add('accountOverlay');
    if(document.documentElement.classList.contains('bootLoading')&&window.MarketBoot?.whenEntered){
      // A modal makes the rest of the page inert even when invisible; keep the loader tappable.
      if(!setAccess.pendingBootOpen){setAccess.pendingBootOpen=true;window.MarketBoot.whenEntered(()=>{setAccess.pendingBootOpen=false;if(!accountUser)openDetailDialog($('authDialog'),$('authUsername'))})}
    }else openDetailDialog($('authDialog'),$('authUsername'));
  }
  else {document.body.classList.remove('accountOverlay');if($('authDialog').open)$('authDialog').close()}}
function defaultAccountState(){return {assets:[
  ...['BTC','ETH'].map(symbol=>({type:'swap',symbol,groupId:'main',pinned:false})),
  ...['AAPL','MSFT','GOOGL','AMZN','NVDA','META','TSLA'].map(symbol=>({type:'swap',symbol,groupId:'gus7',pinned:false})),
  ...['SZ002384','SH603986','SZ300308','SH600519'].map(symbol=>({type:'ashare',symbol,groupId:'gashare',pinned:false}))],
  groups:[{id:'main',name:'自选',petKind:0,petSlot:0},{id:'gus7',name:'美股',petKind:1,petSlot:1},{id:'gashare',name:'A股',petKind:6,petSlot:2}],activeGroup:'main',
  selected:'swap:BTC',tf:'1d',scheme:'redUp',swing:1,
  toggles:{volume:true,levels:true,fib:true,ma:true},targets:{},wallet:[]}}
function restoreAccount(result){
  accountUser=result.username;accountId=result.userId;accountSpace=result.spaceId||result.username;
  accountRevision=Number(result.stateUpdated)||0;
  localStorage.removeItem(STORE);
  const pageUrl=new URL(location.href);pageUrl.searchParams.set('space',accountSpace);
  history.replaceState(null,'',pageUrl);
  localStorage.setItem(ACCOUNT_MARKER,accountUser);
  let pending=null;
  try{pending=JSON.parse(localStorage.getItem(pendingKey())||'null')}catch{}
  const serverState=result.state||defaultAccountState();
  accountBase=JSON.parse(JSON.stringify(serverState));
  const pendingState=pending?.state&&pending.baseRevision===accountRevision?pending.state:
    pending?.state&&pending.base?mergeStates(pending.base,pending.state,serverState):null;
  applyAccountState(pendingState||serverState);
  applyAvatarProfile(result,true);
  accountDirty=!result.state||!!pendingState&&JSON.stringify(pendingState)!==JSON.stringify(serverState);
  afterMobileEntry(()=>{loadCatalog();loadDailyHot()});
  if(accountDirty)syncAccount();
  setAccess(true);renderAccount();
}
let lastAccountCheck=0;
function clearAccountView(){
  marketLiveAt=0;marketFailureCount=0;marketQuoteReady=false;
  accountUser=null;accountId=null;accountSpace='';accountDirty=false;
  for(const timer of logoRetryTimers.values())clearTimeout(timer);logoRetryTimers.clear();logoRetryCounts.clear();
  accountAvatarKind=0;accountAvatarChoice=0;accountAvatarCanChange=true;accountAvatarBusy=false;
  hotDay='';hotStale=false;
  if(searchPersistTimer){clearTimeout(searchPersistTimer);searchPersistTimer=null}
  localStorage.removeItem(ACCOUNT_MARKER);
  const pageUrl=new URL(location.href);pageUrl.searchParams.delete('space');
  history.replaceState(null,'',pageUrl);
  assets=[];groups=[{id:'main',name:'自选'}];selected='';candles=[];quotes={};walletHoldings=[];
  if($('walletDialog')?.open)$('walletDialog').close();
  $('watchlist').replaceChildren();$('chartStatus').textContent='请先登录';
  closePetManager();renderAccount();setAccess(false);renderPets();
}
async function refreshAccount(){
  if(!accountUser||accountChecking||document.hidden||Date.now()-lastAccountCheck<5000)return;
  accountChecking=true;lastAccountCheck=Date.now();
  try{const result=await api('/api/auth/session');
    if(!result.username){clearAccountView();return}
    if(result.username!==accountUser||result.spaceId!==accountSpace){restoreAccount(result);return}
    applyAvatarProfile(result);
    const revision=Number(result.stateUpdated)||0;
    if(revision>accountRevision&&result.state&&!accountDirty){
      accountRevision=revision;accountBase=JSON.parse(JSON.stringify(result.state));
      applyAccountState(result.state);
      $('accountButton').title='自选已从账户同步';
    }
  }catch{}finally{accountChecking=false}
}
function applyAccountState(state){
  if(!state||!Array.isArray(state.assets)||!Array.isArray(state.groups))return;
  assets=state.assets.map(item=>({...item,type:assetMarketType(item)}));
  syncProfilePins();
  hydrateAssetNames();
  groups=state.groups.map(item=>item.id==='main'?{...item,name:'自选'}:
    item.id===HOT_GROUP_ID?{...item,name:'热门'}:{...item});
  if(!groups.some(group=>group.id===HOT_GROUP_ID))groups.push({id:HOT_GROUP_ID,name:'热门'});
  selected=state.selected||'';
  if(selected){const symbol=selected.split(':').at(-1),asset=assets.find(a=>a.symbol===symbol);if(asset)selected=assetId(asset)}
  activeGroupId=groups.some(g=>g.id===state.activeGroup)?state.activeGroup:'main';
  tf=state.tf||'1d';scheme=state.scheme||'redUp';swing=Number(state.swing)||1;
  toggles=state.toggles||{volume:true,levels:true,fib:true,ma:true};
  targets=state.targets||{};
  walletHoldings=window.MarketWallet?.normalize(state.wallet)||(Array.isArray(state.wallet)?state.wallet:[]);
  $('colorScheme').value=scheme;$('swing').value=String(swing);
  for(const id of ['showVolume','showLevels','showFib','showMA'])
    $(id).checked=toggles[id.slice(4).toLowerCase()]!==false;
  document.querySelectorAll('#timeframes button').forEach(button=>
    button.classList.toggle('active',button.dataset.tf===tf));
  renderGroupOptions();renderWatch();afterMobileEntry(()=>{loadAsset();connectOkx();pollWatchQuotes()});
}
function afterMobileEntry(callback){
  const owner=accountSpace;
  const run=()=>{if(!accountUser||owner!==accountSpace)return;if(document.documentElement.classList.contains('bootLoading')){setTimeout(run,250);return}callback()};run();
}
async function prepareMobileEntryVisuals(){
  const status=(message,detail,progress)=>window.MarketBoot?.stage?.(message,detail,progress);
  status('正在初始化音效引擎…','准备滑动、卡兜与伙伴操作音效');
  if(typeof window.MarketPhysics?.prepareAudio!=='function')throw new Error('音效组件尚未加载，请重新加载');
  if(typeof window.MarketNewsPaper?.create!=='function')throw new Error('新闻组件尚未加载，请重新加载');
  if(typeof window.MarketWallet?.install!=='function')throw new Error('资产组件尚未加载');
  installHomeUtilities();
  const audio=window.MarketPhysics.prepareAudio();
  if(audio.supported&&!audio.prepared)throw new Error('音效资源尚未准备完整，请重新加载');
  status('音效资源已准备…',audio.supported?'✓ 滑动与操作音效已预生成':'当前浏览器不支持音效',52);
  if(accountUser){
    status('正在同步首屏卡组…','恢复自选卡组与热门榜单');
    await Promise.all([loadDailyHot(),loadCatalog()]);
    if(!assets.some(a=>a.groupId===HOT_GROUP_ID))throw new Error('热门卡组尚未加载');
    if(!instrumentCatalog?.some(a=>a.type==='ashare'))throw new Error('标的目录尚未加载，请重新加载');
    status('首屏卡组与目录已同步','✓ 自选卡组、热门榜单与标的目录已确认',65);
  }
  status('正在准备字体与界面…','初始化字体、字号与移动端布局');
  if(document.fonts?.ready)await document.fonts.ready;
  status('字体与界面已准备','✓ 字体与移动端布局已初始化',72);
  const roots=accountUser&&petHomeOn?[$('petHome')]:accountUser?[document.querySelector('.mast'),document.querySelector('.layout')]:[$('authDialog')];
  const urls=new Set(),pending=[];
  status('正在加载首屏插画…','加载背景与当前界面的个人形象');
  for(const root of roots){
    if(!root)continue;
    for(const match of getComputedStyle(root).backgroundImage.matchAll(/url\(["']?([^"')]+)["']?\)/g))urls.add(match[1]);
    for(const node of root.querySelectorAll('.petArtwork image,.petHelmetAvatar')){
      const url=node.currentSrc||node.getAttribute('src')||node.getAttribute('href')||node.getAttribute('xlink:href');if(url)urls.add(url);
    }
    for(const node of root.querySelectorAll('.authMascot,.petModel')){
      if(getComputedStyle(node).display==='none')continue;
      for(const pseudo of [null,'::before','::after']){
        const style=getComputedStyle(node,pseudo);
        if(style.display==='none')continue;
        for(const match of style.backgroundImage.matchAll(/url\(["']?([^"')]+)["']?\)/g))urls.add(match[1]);
      }
    }
  }
  for(const url of urls)pending.push(new Promise((resolve,reject)=>{
    let settled=false;
    const done=error=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve()};
    // 超时保持启动页并允许重试，不展示缺失插画的首屏。
    const timer=setTimeout(()=>done(new Error('首屏图片加载超时')),20000);
    const image=new Image();image.decoding='async';
    image.onload=()=>{try{if(image.decode)image.decode().then(()=>done(),()=>done(new Error('首屏图片解码失败')));else done()}catch{done(new Error('首屏图片解码失败'))}};
    image.onerror=()=>done(new Error('首屏图片加载失败'));
    image.src=url;
  }));
  await Promise.all(pending);
  status('正在完成首屏检查…','✓ 首屏背景与个人形象已解码',90);
}
async function bootAccount(attempt=0){
  window.MarketBoot?.stage?.('正在连接账户服务…',attempt?'重新连接账户服务':'连接账户服务，检查登录状态');
  try{
    const result=await api('/api/auth/session');
    if(accountUser)return;
    $('authError').textContent='';
    if(result.username)restoreAccount(result);
    else clearAccountView();
    window.MarketBoot?.ready(prepareMobileEntryVisuals);warmCompanionArtwork();
  }catch{if(accountUser)return;
    $('authError').textContent=attempt<3?'账户服务连接中，正在自动重试…':'账户服务暂不可用，请稍后刷新页面重试。';
    setAccess(false);window.MarketBoot?.fail(attempt<3?'正在重新连接…':'账户服务多次连接失败，请重新加载',{exhausted:attempt>=3});
    if(attempt<3)setTimeout(()=>{if(!accountUser)bootAccount(attempt+1)},500*2**attempt)}
}
function setAuthMode(mode){
  authMode=mode;
  $('authTitle').textContent=mode==='register'?'创建用户':'登录星轨';
  $('authSubmit').textContent=mode==='register'?'创建用户':'登录';
  $('authPassword').autocomplete=mode==='register'?'new-password':'current-password';
  $('authPassword').minLength=mode==='register'?8:1;
  $('authPassword').placeholder=mode==='register'?'至少 8 位，包含字母和数字':'输入密码';
  document.querySelectorAll('#authTabs button').forEach(button=>
    button.classList.toggle('active',button.dataset.authMode===mode));
  $('authError').textContent='';
  renderAuthPetChoices();syncAuthMascot();
}
function renderAuthPetChoices(){
  const form=$('authForm');if(!form)return;
  if((window.MarketDevice?.isMobile?.()??window.innerWidth<=720)===false){if($('authPetPicker'))$('authPetPicker').hidden=true;return}
  let picker=$('authPetPicker');
  if(!picker){
    picker=document.createElement('fieldset');picker.id='authPetPicker';picker.className='authPetPicker';
    const legend=document.createElement('legend');legend.textContent='选择你的星际形象';picker.append(legend);
    const choices=document.createElement('div');choices.className='authPetChoices';
    SPACE_PETS.forEach((pet,kind)=>{
      const button=document.createElement('button');button.type='button';button.dataset.kind=String(kind);button.setAttribute('aria-label',pet.name);
      const image=document.createElement('img');image.src=companionArtworkUrl(kind);image.alt='';image.width=64;image.height=64;image.loading='lazy';image.decoding='async';
      // 图片加载失败时先用新缓存键重试一次，仍失败就隐藏破图，只保留名字，绝不显示“未找到”式破图状态。
      image.onerror=()=>{if(!image.dataset.retried){image.dataset.retried='1';image.src=companionArtworkUrl(kind)+'&retry=1'}else image.style.visibility='hidden'};
      const label=document.createElement('span');label.textContent=pet.name;button.append(image,label);
      button.onclick=()=>{registrationPetKind=kind;renderAuthPetChoices();syncAuthMascot()};choices.append(button);
    });appendComingSoonPets(choices);picker.append(choices);$('authSubmit').before(picker);
  }
  picker.hidden=authMode!=='register';
  for(const button of picker.querySelectorAll('button'))button.setAttribute('aria-pressed',String(Number(button.dataset.kind)===registrationPetKind));
}
function appendComingSoonPets(box){
  if([...box.children].some(node=>node.className?.includes('petComingSoon')))return;
  const silhouettes=[
    '<path d="M51 59 47 27 67 45Q80 39 93 45L113 27 109 59Q120 75 108 92L115 124Q81 144 45 124L52 92Q40 74 51 59Z"/>',
    '<path d="M56 51Q51 25 70 20Q89 17 97 39L99 53Q117 61 117 79L107 95 111 125Q80 140 49 125L53 95Q38 78 48 61Z"/>'
  ];
  silhouettes.forEach((shape,index)=>{
    const item=document.createElement('div');item.className='petChoice petComingSoon'+(index?' violet':'');
    item.setAttribute('aria-label','神秘伙伴，敬请期待');item.setAttribute('aria-disabled','true');
    item.innerHTML='<span class="petCrystalCabinet"><span class="petCrystalCeiling"></span><span class="petMysteryGlow"></span><svg viewBox="0 0 160 160" aria-hidden="true">'+shape+'</svg><span class="petCrystalPedestal"></span></span><span class="petChoiceName">敬请期待</span>';
    box.append(item);
  });
}
function applyAvatarProfile(result,reset=false){
  const kind=Number.isInteger(result.avatarKind)&&result.avatarKind>=0&&result.avatarKind<8?result.avatarKind:(groups.find(g=>g.id==='main')?.petKind??0);
  if(reset||kind!==accountAvatarKind)accountAvatarChoice=kind;
  accountAvatarKind=kind;accountAvatarCanChange=result.avatarCanChange!==false;
  renderHomeAccountBadge();
  renderAccountAvatar();syncAuthMascot();
}
function renderAccountAvatar(){
  const details=$('accountAvatarDetails');if(!details)return;
  details.hidden=!accountUser||!(window.MarketDevice?.isMobile?.()??window.innerWidth<=720);
  if(details.hidden){details.open=false;return}
  const choices=$('accountAvatarChoices');
  if(!choices.children.length)SPACE_PETS.forEach((pet,kind)=>{
    const button=document.createElement('button');button.type='button';button.dataset.kind=String(kind);button.setAttribute('aria-label',pet.name);
    const image=document.createElement('img');image.src=companionArtworkUrl(kind);image.alt='';image.width=64;image.height=64;image.loading='lazy';
    image.onerror=()=>{if(!image.dataset.retried){image.dataset.retried='1';image.src=companionArtworkUrl(kind)+'&retry=1'}else image.style.visibility='hidden'};
    const name=document.createElement('span');name.textContent=pet.name;button.append(image,name);
    button.onclick=()=>{accountAvatarChoice=kind;renderAccountAvatar()};choices.append(button);
  });
  choices.querySelectorAll('.petComingSoon').forEach(node=>node.remove());
  for(const button of choices.querySelectorAll('button')){
    button.setAttribute('aria-pressed',String(Number(button.dataset.kind)===accountAvatarChoice));
    button.disabled=accountAvatarBusy||!accountAvatarCanChange;
  }
  $('accountAvatarCurrent').textContent=SPACE_PETS[accountAvatarKind]?.name||'星际伙伴';
  $('accountAvatarLimit').textContent=accountAvatarCanChange?'今日次数 0 / 1':'今日次数 1 / 1 · 已用完';
  const save=$('accountAvatarSave');save.disabled=accountAvatarBusy||!accountAvatarCanChange||accountAvatarChoice===accountAvatarKind;
  save.onclick=saveAccountAvatar;
}
async function saveAccountAvatar(){
  if(!accountUser||accountAvatarBusy||!accountAvatarCanChange||accountAvatarChoice===accountAvatarKind)return;
  const owner=accountSpace,kind=accountAvatarChoice;
  accountAvatarBusy=true;$('accountAvatarError').textContent='';renderAccountAvatar();
  try{
    const result=await postApi('/api/auth/avatar',{avatarKind:kind});
    if(owner!==accountSpace)return;
    applyAvatarProfile(result,true);$('accountAvatarError').textContent='形象已保存';
  }catch(error){if(owner===accountSpace){const message=error&&error.message||'';$('accountAvatarError').textContent=!accountAvatarCanChange?'今日次数 1 / 1 · 已用完':/未找到|地址不存在|404/.test(message)?'形象服务暂不可用，请稍后重试':message||'保存未完成，请重试'}}
  finally{if(owner===accountSpace){accountAvatarBusy=false;renderAccountAvatar()}}
}
function setupAccount(){
  $('authUsername').addEventListener('input',syncAuthMascot);
  $('authUsername').addEventListener('change',syncAuthMascot);
  const syncAuthInput=()=>syncAuthInputLayout();
  $('authDialog').addEventListener('focusin',syncAuthInput);
  $('authDialog').addEventListener('focusout',()=>setTimeout(syncAuthInput,0));
  window.visualViewport?.addEventListener('resize',syncAuthInput);
  syncAuthInput();
  window.addEventListener('focus',refreshAccount);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshAccount()});
  setInterval(refreshAccount,20000);
  $('accountButton').onclick=()=>{$('authError').textContent='';document.body.classList.add('accountOverlay');
    openDetailDialog($('authDialog'),accountUser?null:$('authUsername'))};
  $('authDialog').addEventListener('cancel',event=>{if(!accountUser)event.preventDefault()});
  $('authDialog').addEventListener('close',()=>{document.body.classList.remove('accountOverlay');if(!accountUser)setAccess(false)});
  document.querySelectorAll('#authTabs button').forEach(button=>
    button.onclick=()=>setAuthMode(button.dataset.authMode));
  $('authForm').onsubmit=async event=>{
    event.preventDefault();
    const submit=$('authSubmit');submit.disabled=true;$('authError').textContent='';
    try{
      const result=await postApi('/api/auth/'+authMode,{
        username:$('authUsername').value.trim(),password:$('authPassword').value,
        ...(authMode==='register'?{avatarKind:registrationPetKind}:{})});
      restoreAccount(result);
      $('authPassword').value='';
      if(!$('authSignedError').textContent&&$('authDialog').open)$('authDialog').close();
    }catch(error){$('authError').textContent=error.message}
    finally{submit.disabled=false}
  };
  $('passwordForm').onsubmit=async event=>{
    event.preventDefault();
    const current=$('currentPassword').value,newPassword=$('newPassword').value;
    const error=$('passwordError'),button=$('passwordSubmit');
    error.textContent='';
    if(!/[A-Za-z]/.test(newPassword)||!/[0-9]/.test(newPassword)){
      error.textContent='新密码须包含字母和数字';return}
    if(newPassword!==$('confirmPassword').value){error.textContent='两次输入的新密码不一致';return}
    button.disabled=true;
    try{
      await postApi('/api/auth/password',{currentPassword:current,newPassword});
      $('passwordForm').reset();$('passwordDetails').open=false;
      if((window.MarketDevice?.isMobile?.()??window.innerWidth<=720)&&$('authDialog').open)$('authDialog').close();
    }catch(cause){error.textContent=cause.message}
    finally{button.disabled=false}
  };
  $('authLogout').onclick=async()=>{
    const button=$('authLogout');button.disabled=true;
    try{
      if(!await syncAccount())return;
      await postApi('/api/auth/logout');
      clearAccountView();
    }catch(error){$('authError').textContent=error.message}
    finally{button.disabled=false}
  };
  renderAccount();return bootAccount();
}
let loadSerial=0;
function validBars(rows){return(rows||[]).filter(x=>[x.t,x.o,x.h,x.l,x.c,x.v].every(Number.isFinite)&&
  x.l>0&&x.v>=0&&x.l<=Math.min(x.o,x.c)&&x.h>=Math.max(x.o,x.c))}
function mergeBars(older,newer){let byTime=new Map();
for(const bar of older)byTime.set(bar.t,bar);
for(const bar of newer)byTime.set(bar.t,bar);
return[...byTime.values()].sort((a,b)=>a.t-b.t).slice(-30000)}
function rememberTimeframe(a,period,rows,fetchedAt=Date.now()){
  const key=assetId(a)+'|'+period;
  const exhausted=timeframeCache.get(key)?.exhausted===true;
  timeframeCache.delete(key);
  timeframeCache.set(key,{rows,fetchedAt,exhausted});
  if(timeframeCache.size>((window.MarketDevice?.isMobile?.()??window.innerWidth<=720)?6:12))timeframeCache.delete(timeframeCache.keys().next().value);
  if(rows.length&&!miniData[assetId(a)]?.length)scheduleWatch();
  clearTimeout(candleSessionTimer);
  candleSessionTimer=setTimeout(()=>{
    try{
      const active=current()?assetId(current())+'|'+tf:'';
      const entries=[...timeframeCache].sort(([left],[right])=>
        (right===active?1:0)-(left===active?1:0));
      let remaining=4000;
      const stored=[];
      for(const [entryKey,value] of entries){
        if(remaining<=0)break;
        const rows=value.rows.slice(-Math.min(600,cachedBarLimit(entryKey.split('|')[1]),remaining));
        remaining-=rows.length;
        stored.push([entryKey,{rows,fetchedAt:value.fetchedAt,exhausted:value.exhausted===true&&rows.length===value.rows.length}]);
      }
      if(!pageCacheClosed)publicMarketCache.setItem(CANDLE_SESSION,JSON.stringify(stored));
    }catch{}
  },450);
}
function fetchTimeframe(a,period){
  const key=assetId(a)+'|'+period;
  if(timeframeRequests.has(key))return timeframeRequests.get(key);
  const request=api('/api/candles?type='+a.type+'&symbol='+encodeURIComponent(a.symbol)+'&tf='+period)
    .finally(()=>timeframeRequests.delete(key));
  timeframeRequests.set(key,request);
  return request;
}
async function loadDailyBars(a){
  const key=assetId(a)+'|1d',cached=timeframeCache.get(key);
  if(cached&&Date.now()-cached.fetchedAt<30000)return {candles:cached.rows};
  let data;
  try{data=await fetchTimeframe(a,'1d')}
  catch(error){if(cached?.rows.length)return {candles:cached.rows,stale:true};throw error}
  const rows=validBars(data.candles);
  if(rows.length)rememberTimeframe(a,'1d',rows,data.stale?0:Date.now());
  return data;
}
function prefetchTimeframes(a,activePeriod){
  if(document.hidden||navigator.onLine===false)return;
  const mobile=(window.MarketDevice?.isMobile?.()??window.innerWidth<=720);
  if(mobile&&!deckChartMoved.length)return;
  const key=assetId(a);
  if(prefetchedAsset===key)return;
  prefetchedAsset=key;
  const order=(mobile?deckPeriodSlots:['1m','5m','15m','1h','2h','4h','6h','1d','2d','1w','1M'])
    .filter(period=>period!==activePeriod)
    .sort((left,right)=>Math.abs(Math.log(tfMs[left]/tfMs[activePeriod]))
      -Math.abs(Math.log(tfMs[right]/tfMs[activePeriod]))).slice(0,mobile?2:3);
  let cursor=0;
  const worker=async()=>{
    while(cursor<order.length&&selected===key){
      const period=order[cursor++];
      if(timeframeCache.has(key+'|'+period))continue;
      try{const data=await fetchTimeframe(a,period);
        const rows=validBars(data.candles).sort((left,right)=>left.t-right.t);
        if(rows.length&&!data.stale&&!timeframeCache.has(key+'|'+period))rememberTimeframe(a,period,rows);
      }catch{}
    }
  };
  setTimeout(worker,1500);
}
function updateHistoryMore(){
  const a=current(),key=a?assetId(a)+'|'+tf:'';
  const busy=historyRequests.has(key+'|'+loadSerial);
  const exhausted=timeframeCache.get(key)?.exhausted===true;
  const button=$('historyMore');
  button.disabled=!a||!candles.length||busy||exhausted||candles.length>=30000;
  button.textContent=busy?'补全中…':exhausted?'已到起点':'载入更早';
}
async function extendHistory(serial,a,period,before,target=HISTORY_TARGET[period]||900,maxPages=12){
  const requestKey=assetId(a)+'|'+period+'|'+serial;
  if(serial!==loadSerial||selected!==assetId(a)||tf!==period||
    !before||candles.length>=target||historyRequests.has(requestKey)||
    Date.now()<(historyRetryAfter.get(assetId(a)+'|'+period)||0)||
    timeframeCache.get(assetId(a)+'|'+period)?.exhausted)return;
  historyRequests.add(requestKey);
  updateHistoryMore();
  let exhausted=false;
  try{
    for(let page=0;page<maxPages&&candles.length<target;page++){
      const data=await api('/api/history?type='+a.type+'&symbol='+encodeURIComponent(a.symbol)+'&tf='+period+'&before='+before);
      if(serial!==loadSerial||selected!==assetId(a)||tf!==period)return;
      const older=validBars(data.candles).filter(bar=>bar.t<before);
      if(!older.length){if(data.stale)throw Error('历史行情暂不可用');exhausted=true;break}
      candles=mergeBars(older,candles);
      before=candles[0].t;
      rememberTimeframe(a,period,candles,timeframeCache.get(assetId(a)+'|'+period)?.fetchedAt);
      auditCache.clear();
      $('chartStatus').textContent=data.source+' · '+historyRange(candles,period)+
        (candles.length<target?' · 正在补全历史…':'');
      scheduleDraw();
    }
    if(serial===loadSerial&&selected===assetId(a)&&tf===period){
      if(exhausted){
        const cached=timeframeCache.get(assetId(a)+'|'+period);
        if(cached){cached.exhausted=true;rememberTimeframe(a,period,candles,cached.fetchedAt)}
      }
      $('chartStatus').textContent=marketLabel(a)+' · 历史 · '+historyRange(candles,period)+
        (exhausted?' · 已到该合约可用历史起点':'');
      renderStrategy();
      if(!exhausted&&candles.length<target)
        setTimeout(()=>extendHistory(serial,a,period,candles[0].t,target,maxPages),1200);
    }
  }catch(e){historyRetryAfter.set(assetId(a)+'|'+period,Date.now()+30000);
    if(serial===loadSerial&&selected===assetId(a)&&tf===period)
    $('chartStatus').textContent+=' · 更早历史暂不可用'}finally{historyRequests.delete(requestKey);updateHistoryMore()}
}

function prioritizeAssetDisplay(a){if(a){if(!logoURLFor(a))lookupLogo(a.symbol,true);loadProfile(a)}}
async function loadAsset(){let serial=++loadSerial,a=current();
prioritizeAssetDisplay(a);
if(a?.type==='ashare'&&!ASHARE_PERIODS.has(tf))tf='1d';
if(!mobileChartVisible()){backgroundRequestsReady=true;pumpBackgroundRequests();return}
backgroundRequestsReady=false;
lastCandleFetchAt=Date.now();
viewOffset=0;
viewCount=null;
hoveredTime=null;
let period=tf,cachedView=a?timeframeCache.get(assetId(a)+'|'+period):null;
const quickRows=!cachedView&&period==='1d'&&a?miniData[assetId(a)]:null;
candles=cachedView?.rows.map(bar=>({...bar}))||quickRows?.map(bar=>({...bar}))||[];
const resumeBackground=()=>{
  if(serial!==loadSerial)return;
  backgroundRequestsReady=true;pumpBackgroundRequests();
  if(a){loadProfile(a);if(!newsReady.has(assetId(a)))loadNews()}
};
updateHistoryMore();
auditCache.clear();
renderStrategy();
if(!a){$('chartStatus').textContent='请添加资产';
updateHero();
renderInfo();
draw();
resumeBackground();
return}selected=assetId(a);
$('target').value=targets[selected]||'';
$('chartStatus').textContent=cachedView?'已显示缓存的 '+a.symbol+' '+period+' K 线 · 正在同步…':'正在加载 '+a.symbol+' '+period+' K 线…';
updateHero();
renderNewsPreview(newsPreviewCache.get(assetId(a)));
renderInfo();
draw();
if(cachedView)renderStrategy();
const freshFor={'1m':5000,'5m':8000,'15m':12000,'1h':15000,'2h':20000,'4h':30000,'6h':30000,'1d':30000,'2d':30000,'1w':30000,'1M':30000}[period]||15000;
if(cachedView&&Date.now()-cachedView.fetchedAt<freshFor){
  $('chartStatus').textContent=marketLabel(a)+' · '+historyRange(candles,period);
  if(candles.length&&!cachedView.exhausted&&candles.length<(HISTORY_TARGET[period]||900))extendHistory(serial,a,period,candles[0].t,(window.MarketDevice?.isMobile?.()??window.innerWidth<=720)?900:undefined);
  prefetchTimeframes(a,period);
  resumeBackground();
  return;
}
try{let data=await fetchTimeframe(a,period);
if(serial!==loadSerial)return;
candles=data.stale?mergeBars(validBars(data.candles),candles):mergeBars(candles,validBars(data.candles));
if(candles.length)rememberTimeframe(a,period,candles,data.stale?(cachedView?.fetchedAt||0):Date.now());
if(data.refreshing)recoverCandlesSoon();
updateHistoryMore();
$('chartStatus').textContent=candles.length?data.source+' · '+historyRange(candles,tf)+(data.stale?' · 缓存数据，等待行情恢复':''):'该时段没有历史 K 线；请检查代码、市场时段或数据权限';
updateHero();
draw();
renderStrategy();
if(!data.stale&&candles.length&&!timeframeCache.get(assetId(a)+'|'+period)?.exhausted&&
  candles.length<(HISTORY_TARGET[period]||900))extendHistory(serial,a,period,candles[0].t,(window.MarketDevice?.isMobile?.()??window.innerWidth<=720)?900:undefined);
prefetchTimeframes(a,period)}catch(e){if(serial!==loadSerial)return;
$('chartStatus').textContent='K 线获取失败：'+e.message;
draw();
renderStrategy();
}finally{resumeBackground()}pollQuote()}
async function refreshCandles(force=false){let a=current();
if(!a||refreshingCandles||document.hidden||navigator.onLine===false||!mobileChartVisible())return;
const interval={'1m':10000,'5m':15000,'15m':20000,'1h':20000,'2h':30000,'4h':30000,'6h':30000,'1d':30000,'2d':30000,'1w':30000,'1M':30000}[tf]||30000;
if(!force&&Date.now()-lastCandleFetchAt<interval)return;
lastCandleFetchAt=Date.now();
refreshingCandles=true;
let key=assetId(a),period=tf;
try{let data=await fetchTimeframe(a,period);
if(assetId(current())!==key||tf!==period)return;
let next=validBars(data.candles).sort((x,y)=>x.t-y.t);
if(!next.length)return;
if(data.stale){candles=mergeBars(next,candles);rememberTimeframe(a,period,candles,timeframeCache.get(key+'|'+period)?.fetchedAt||0);draw();renderStrategy();
if(data.refreshing)recoverCandlesSoon();
$('chartStatus').textContent='缓存 K 线 · 正在后台同步';return}
let old=candles.at(-1);
if(!old||next.at(-1).t>=old.t){candles=mergeBars(candles,next);
rememberTimeframe(a,period,candles);
auditCache.clear();
$('chartStatus').textContent=data.source+' · '+historyRange(candles,period)+' · 自动更新 '+date(Date.now());
updateHero();
draw();
renderStrategy();
}}catch(e){$('chartStatus').textContent='自动更新暂停：'+e.message}finally{refreshingCandles=false}}
function renderNewsPreview(rows,error){
  const box=$('newsPreview'),subject=$('newsSubject'),a=current();
  box.replaceChildren();
  subject.textContent=a?a.symbol:'—';
  if(!a||!rows){const note=document.createElement('p');note.className='sidebarNewsEmpty';
    note.textContent=error||(!a?'选择标的后显示相关新闻。':'正在获取 '+a.symbol+' 的新闻…');box.append(note);return}
  if(!rows.length){const note=document.createElement('p');note.className='sidebarNewsEmpty';
    note.textContent='暂时没有与 '+a.symbol+' 直接相关的新闻。';box.append(note);return}
  rows.slice(0,10).forEach((item,index)=>{
    const meta=[item.source,Number(item.datetime)?date(Number(item.datetime)*1000):''].filter(Boolean).join(' · ');
    const summaryText=item.summary?new DOMParser().parseFromString(String(item.summary),'text/html').body.textContent.trim():'';
    const paper=window.MarketNewsPaper.create(item,{index,meta,summaryText});if(paper)box.append(paper);
  });
}
const newsRequests=new Map();
function fetchAssetNews(a){
  const key=assetId(a);if(newsRequests.has(key))return newsRequests.get(key);
  const request=api('/api/news?type='+a.type+'&symbol='+encodeURIComponent(a.symbol)).finally(()=>newsRequests.delete(key));
  newsRequests.set(key,request);return request;
}
async function loadNews(){let a=current();
if(!a)return;
let key=assetId(a);
try{let rows=await fetchAssetNews(a);
if(assetId(current())!==key)return;
let valid=rows.filter(n=>{try{return new URL(n.url).protocol==='https:'&&n.headline}catch{return false}}).slice(0,18);
newsPreviewCache.set(key,valid);
renderNewsPreview(valid);
for(let n of valid){
let nk=String(n.id||n.url);
if(newsReady.has(key)&&!seenNews.has(nk)&&Date.now()-Number(n.datetime)*1000<900000)notify(a.symbol+' 新消息',n.headline,'新闻');
seenNews.add(nk)}newsReady.add(key);
$('newsLink').title=valid.length?'查看 '+valid.length+' 条相关新闻':'暂时没有相关新闻'}catch(e){if(assetId(current())!==key)return;
$('newsLink').title='新闻暂不可用：'+e.message;
renderNewsPreview(newsPreviewCache.get(key),'新闻暂不可用，请稍后再试。')}}
function connectOkx(){if(okxWS){okxWS.onclose=null;
okxWS.close();
okxWS=null}clearTimeout(wsRetry);
clearInterval(wsPing);
let instruments=[...new Set(assets.filter(a=>a.type==='swap').map(a=>a.symbol+'-USDT-SWAP'))];
if(!instruments.length)return;
try{let ws=new WebSocket('wss://ws.okx.com:8443/ws/v5/public');
okxWS=ws;
ws.onopen=()=>{
  ws.send(JSON.stringify({op:'subscribe',args:instruments.map(instId=>({channel:'tickers',instId}))}));
  wsPing=setInterval(()=>{if(ws.readyState===WebSocket.OPEN)ws.send('ping')},25000)};
ws.onmessage=e=>{let message;
try{message=JSON.parse(e.data)}catch{return}
if(message.arg?.channel!=='tickers'||!Array.isArray(message.data))return;
for(const row of message.data){if(!instruments.includes(row.instId))continue;
let symbol=row.instId.slice(0,-10),p=Number(row.last),t=Number(row.ts),base=Number(row.open24h);
if(Number.isFinite(p)&&p>0&&Number.isFinite(t)&&t>0)onQuote({type:'swap',symbol},p,t,base,true)}};
ws.onclose=()=>{clearInterval(wsPing);if(okxWS===ws)wsRetry=setTimeout(connectOkx,5000)}}catch{wsRetry=setTimeout(connectOkx,10000)}}
async function pollQuote(){let a=current();
if(!a||stockQuoteLoading||document.hidden||navigator.onLine===false)return;
stockQuoteLoading=true;
try{let q=await api('/api/quote?type='+a.type+'&symbol='+encodeURIComponent(a.symbol));
if(Number(q.c)>0&&Number(q.t)>0)onQuote(a,Number(q.c),Number(q.t)*1000,Number(q.pc));
marketQuoteReady=true;marketFailureCount=0;updateMarketSignal({reachable:true,cached:!!q.stale})}catch(e){const latest=quotes[assetId(a)];marketFailureCount++;updateMarketSignal({reachable:Number(e.status)>=500,degraded:true,cached:!!latest});
$('assetMeta').textContent=e.message}finally{stockQuoteLoading=false}}
async function pollWatchQuotes(){if(!assets.length||watchQuotesLoading||document.hidden||navigator.onLine===false)return;
watchQuotesLoading=true;
try{
const unique=[...new Map(assets.map(a=>[a.symbol,a])).values()];
for(let offset=0;offset<unique.length;offset+=30){
  const batch=unique.slice(offset,offset+30);
  try{let result=await api('/api/quotes?symbols='+encodeURIComponent(batch.map(a=>a.symbol).join(',')));
    for(const a of batch){let q=result.quotes?.[a.symbol];
      if(Number(q?.c)>0&&Number(q?.t)>0)onQuote(a,Number(q.c),Number(q.t)*1000,Number(q.pc))}
  }catch{}
}}finally{watchQuotesLoading=false}}
function onQuote(a,p,t,base,live=false){if(live){marketQuoteReady=true;marketLiveAt=Date.now();marketFailureCount=0;updateMarketSignal({reachable:true})}let k=assetId(a),previous=quotes[k];
if(previous&&t<previous.t)return;
quotes[k]={p,t,base:base||previous?.base};
let list=recentTicks[k]||(recentTicks[k]=[]);
list.push({p,t});
recentTicks[k]=list.filter(x=>t-x.t<=360000).slice(-1000);
let target=Number(targets[k]);
if(previous&&target>0&&((previous.p<target&&p>=target)||(previous.p>target&&p<=target))&&t-(lastAlerts[k+':target']||0)>60000){lastAlerts[k+':target']=t;
notify(a.symbol+' 越过目标价',fmt(p)+' 已越过 '+fmt(target)+'；请核对风险计划。','目标价')}
let old=list.find(x=>x.t>=t-300000);
if(old&&t-old.t>=180000){let pct=(p/old.p-1)*100;
if(Math.abs(pct)>=swing&&t-(lastAlerts[k+':swing']||0)>900000){lastAlerts[k+':swing']=t;
notify(a.symbol+' 5 分钟波动 '+(pct>0?'+':'')+pct.toFixed(2)+'%',pct>0?'先观察回撤与成交额，避免追价。':'检查下跌原因及仓位风险。','波动规则')}}updateWatchQuote(k,p);
if(!$('petDeck').hidden)updateDeckLive();
if(selected===k){updateHero();
if(!strategyTimer)strategyTimer=setTimeout(()=>{strategyTimer=null;renderStrategy()},500);
if(candles.length){let last=candles.at(-1);
if(t>=last.t&&t<last.t+tfMs[tf]){last.h=Math.max(last.h,p);
last.l=Math.min(last.l,p);
last.c=p;
scheduleDraw()}}}}
function movingAverage(rows,n){let out=Array(rows.length).fill(null),sum=0;
for(let i=0;
i<rows.length;
i++){sum+=rows[i].c;
if(i>=n)sum-=rows[i-n].c;
if(i>=n-1)out[i]=sum/n}return out}
function pivots(rows,entry=rows.at(-1)?.c){
  const completed=rows.slice(0,completedCount(rows));
  const levels=window.MarketStrategy.nearbyLevels(completed,entry);
  return {support:levels?.support,resistance:levels?.resistance,
    supportZone:levels?.supportZone,resistanceZone:levels?.resistanceZone};
}
function fibLevels(rows){let v=rows.slice(-80);
if(v.length<10)return[];
let hi=Math.max(...v.map(x=>x.h)),lo=Math.min(...v.map(x=>x.l)),highIndex=v.findLastIndex(x=>x.h===hi),lowIndex=v.findLastIndex(x=>x.l===lo);
let up=highIndex>lowIndex;
return[.236,.382,.5,.618,.786].map(r=>({label:(r*100).toFixed(1)+'%',value:up?hi-(hi-lo)*r:lo+(hi-lo)*r}))}
// The main chart draws only the visible window. This keeps bars readable and
// makes quote updates cheap even when the historical series is long.
let viewCount = null;
let viewOffset = 0;
let drag = null;
let hoveredTime = null;
const CHART = {
  background: '#0b111d', grid: '#263541', axis: '#9baab5',
  ma5: '#e8bf69', ma10: '#ee7b9d', ma20: '#51d2dd',
  support: '#e9c16f', resistance: '#f07f9d', fib: '#9d91db'
};

function priceLabel(value) {
  return priceText(value);
}

function chartRows() { return candles; }

const deckMaEnabled={5:true,10:true,20:true};
function deckChartScale(rows,averages,start,end,height,volume){
  const prices=rows.flatMap(row=>[row.l,row.h]);
  for(const average of averages)for(const value of average.values.slice(start,end))if(Number.isFinite(value))prices.push(value);
  const low=Math.min(...prices),high=Math.max(...prices);
  const padding=(high-low)*.12||Math.max(Math.abs(high)*.005,.001);
  const top=Math.min(44,Math.max(18,height*.12));
  const reservedVolumeHeight=volume?Math.min(70,height*.17):0;
  const priceBottom=Math.max(top+1,height-28-reservedVolumeHeight-12);
  return {min:low-padding,max:high+padding,top,priceBottom,reservedVolumeHeight};
}
function renderDeckMa(){
  let nav=$('deckMaControls');
  if(!nav){nav=document.createElement('nav');nav.id='deckMaControls';nav.className='deckMaControls';nav.setAttribute('aria-label','均线开关');$('deckChartView').append(nav)}
  nav.replaceChildren();
  for(const [period,color] of [[5,CHART.ma5],[10,CHART.ma10],[20,CHART.ma20]]){
    const button=document.createElement('button');button.type='button';button.textContent='MA'+period;
    button.style.setProperty('--ma-color',color);button.classList.toggle('active',deckMaEnabled[period]);
    button.setAttribute('aria-pressed',String(deckMaEnabled[period]));
    button.onclick=()=>{deckMaEnabled[period]=!deckMaEnabled[period];renderDeckMa();scheduleDraw()};nav.append(button);
  }
}
function draw() {
  const canvas = $('chart');
  const box = canvas.parentElement;
  const width = box.clientWidth;
  const height = box.clientHeight;
  if (width <= 0 || height <= 0) return;

  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = CHART.background;
  ctx.fillRect(0, 0, width, height);

  const history = chartRows();
  const mobileDeck=(window.MarketDevice?.isMobile?.()??window.innerWidth<=720)&&$('petDeck')?.classList.contains('deckChartMode');
  if (!history.length) {
    $('chartMetrics').replaceChildren();
    $('chartMetrics').dataset.signature = '';
    ctx.fillStyle = CHART.axis;
    ctx.font = '13px sans-serif';
    ctx.fillText('暂无 K 线数据', 20, 72);
    chartPlot = null;
    renderInsight([], -1, false);
    return;
  }

  const preferred = width < 700
    ? Math.max(24, Math.floor((width - 82) / 16))
    : Math.max(58, Math.min(80, Math.floor((width - 82) / 16)));
  const capacity = Math.min(mobileDeck?Math.max(8,viewCount||preferred):(viewCount||preferred), history.length);
  viewOffset = Math.max(0, Math.min(viewOffset, history.length - capacity));
  const end = history.length - viewOffset;
  const start = Math.max(0, end - capacity);
  const rows = history.slice(start, end);
  const slots = rows.length;
  const left = 14;
  const right = width < 480 ? 86 : 102;
  const averages = [[5, CHART.ma5], [10, CHART.ma10], [20, CHART.ma20]];
  const averageValues = averages.filter(([period])=>mobileDeck?deckMaEnabled[period]:toggles.ma)
    .map(([period,color])=>({period,color,values:movingAverage(history,period)}));
  const mobileScale=mobileDeck?deckChartScale(rows,averageValues,start,end,height,toggles.volume):null;
  const top = mobileScale?.top??(width < 480 ? 72 : 68);
  const bottom = 28;
  const reservedVolumeHeight = mobileScale?.reservedVolumeHeight??Math.min(98, height * .2);
  const volumeHeight = toggles.volume ? reservedVolumeHeight : 0;
  const priceBottom = mobileScale?.priceBottom??(height - bottom - reservedVolumeHeight - 15);
  // Leave a clear gap between the newest candle and the fixed price axis.
  const plotWidth = Math.max(40, width - left - right - (width < 480 ? 40 : 62));
  const step = plotWidth / Math.max(1, slots);
  const x = index => left + step * (index + .5);
  const dataMin = Math.min(...rows.map(row => row.l));
  const dataMax = Math.max(...rows.map(row => row.h));
  const padding = (dataMax - dataMin) * .1 || Math.max(dataMax * .005, .001);
  const min = mobileScale?.min??(dataMin - padding);
  const max = mobileScale?.max??(dataMax + padding);
  const y = price => top + (max - price) / (max - min) * (priceBottom - top);
  const tones = colors();
  chartPlot = { rows, history, start, left, plotWidth, step, x, y, top, priceBottom, h: height };
  const levelLabels=[];

  ctx.lineWidth = 1;
  ctx.font = '11px -apple-system, sans-serif';
  for (let grid = 0; grid <= 4; grid++) {
    const value = min + (max - min) * grid / 4;
    const lineY = Math.round(y(value)) + .5;
    ctx.strokeStyle = CHART.grid;
    ctx.beginPath();
    ctx.moveTo(left, lineY);
    ctx.lineTo(width - right, lineY);
    ctx.stroke();
    if(viewOffset!==0||Math.abs(lineY-y(rows.at(-1).c))>=14){
      ctx.fillStyle = CHART.axis;
      ctx.fillText(priceLabel(value), width - right + 9, lineY + 4);
    }
  }
  for (let grid = 1; grid < 6; grid++) {
    const lineX = Math.round(left + plotWidth * grid / 6) + .5;
    ctx.strokeStyle = CHART.grid;
    ctx.beginPath();
    ctx.moveTo(lineX, top);
    ctx.lineTo(lineX, height - bottom);
    ctx.stroke();
  }

  const drawLevel = (value, color, label, dash, priority) => {
    if (!Number.isFinite(value) || value <= min || value >= max) return;
    const lineY = y(value);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(left, lineY);
    ctx.lineTo(width - right, lineY);
    ctx.stroke();
    ctx.restore();
    levelLabels.push({lineY,color,label,priority});
  };

  if (toggles.fib) {
    for (const level of fibLevels(rows)) drawLevel(level.value, CHART.fib, level.label, [2, 5], 1);
  }
  const chartQuote=quotes[assetId(current())];
  const chartEntry=viewOffset===0&&chartQuote?.t>=history.at(-1)?.t&&Number.isFinite(chartQuote.p)
    ?chartQuote.p:rows.at(-1)?.c;
  const points = toggles.levels ? pivots(viewOffset===0?history:rows,chartEntry) : {};
  if (toggles.levels) {
    drawLevel(points.support, CHART.support, '支撑区', [5, 4], 2);
    drawLevel(points.resistance, CHART.resistance, '压力区', [5, 4], 2);
  }

  // Keep annotations on the plot side of the axis; omit lower-priority labels
  // when levels converge, while preserving every horizontal guide line.
  const drawLevelLabels=()=>{
    const occupied=[];
    ctx.save();
    ctx.font='bold 10px sans-serif';
    ctx.textAlign='right';
    for(const item of levelLabels.sort((a,b)=>b.priority-a.priority)){
      if(Math.abs(item.lineY-y(rows.at(-1).c))<12&&viewOffset===0)continue;
      if(occupied.some(mark=>Math.abs(mark-item.lineY)<15))continue;
      occupied.push(item.lineY);
      const labelWidth=ctx.measureText(item.label).width;
      const labelRight=width-right-6;
      ctx.fillStyle=CHART.background;
      ctx.fillRect(labelRight-labelWidth-7,item.lineY-8,labelWidth+9,16);
      ctx.fillStyle=item.color;
      ctx.fillText(item.label,labelRight,item.lineY+3);
    }
    ctx.restore();
  };

  const clipPrice=()=>{ctx.beginPath();ctx.rect(left,top,width-right-left,priceBottom-top);ctx.clip()};
  if(mobileDeck){ctx.save();clipPrice()}
  for (const average of averageValues) {
    ctx.strokeStyle = average.color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let started = false;
    for (let index = 0; index < rows.length; index++) {
      const value = average.values[start + index];
      if (value == null) continue;
      if (!started) ctx.moveTo(x(index), y(value));
      else ctx.lineTo(x(index), y(value));
      started = true;
    }
    if (started) ctx.stroke();
  }

  if(mobileDeck)ctx.restore();
  const maxVolume = Math.max(1, ...rows.map(row => row.v));
  const bodyWidth = Math.max(2, Math.min(25, step * .78));
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const center = x(index);
    const color = row.c >= row.o ? tones.up : tones.down;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.2;
    if(mobileDeck){ctx.save();clipPrice()}
    ctx.beginPath();
    ctx.moveTo(center, y(row.h));
    ctx.lineTo(center, y(row.l));
    ctx.stroke();
    const bodyTop = Math.min(y(row.o), y(row.c));
    const bodyHeight = Math.max(1.6, Math.abs(y(row.o) - y(row.c)));
    ctx.fillRect(center - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight);
    if(mobileDeck)ctx.restore();
    if (volumeHeight) {
      const barHeight = row.v / maxVolume * (volumeHeight - 9);
      ctx.globalAlpha = .58;
      ctx.fillRect(center - bodyWidth / 2, height - bottom - barHeight, bodyWidth, barHeight);
      ctx.globalAlpha = 1;
    }
  }

  drawLevelLabels();
  const last = rows.at(-1);
  if (viewOffset === 0 && last.c >= min && last.c <= max) {
    const lineY = y(last.c);
    const color = last.c >= last.o ? tones.up : tones.down;
    ctx.save();
    ctx.fillStyle = color;
    ctx.fillRect(width - right + 2, lineY - 11, right - 6, 22);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(priceLabel(last.c), width - right + 6, lineY + 4);
    ctx.restore();
  }

  ctx.fillStyle = CHART.axis;
  ctx.font = '10px sans-serif';
  const labelEvery = Math.max(1, Math.ceil(rows.length / (width < 500 ? 2 : width < 850 ? 3 : 5)));
  const showTime = !['1d', '2d', '1w', '1M'].includes(tf);
  let previousLabelRight=-Infinity;
  for (let index = 0; index < rows.length; index += labelEvery) {
    const label = new Date(rows[index].t).toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      ...(showTime ? {hour: '2-digit', minute: '2-digit'} : {})
    });
    const labelWidth = ctx.measureText(label).width;
    const labelLeft=Math.max(left,Math.min(width-right-labelWidth,x(index)-labelWidth/2));
    if(labelLeft<previousLabelRight+12)continue;
    ctx.fillText(label,labelLeft,height-8);previousLabelRight=labelLeft+labelWidth;
  }

  const metrics = [];
  for (const average of averageValues) {
    const value = average.values[end - 1];
    if (Number.isFinite(value)) metrics.push(['MA' + average.period + ': ' + priceLabel(value), average.color]);
  }
  if (points.resistanceZone) metrics.push(['压力区: ' + priceLabel(points.resistanceZone.low) + '–' + priceLabel(points.resistanceZone.high), CHART.resistance]);
  if (points.supportZone) metrics.push(['支撑区: ' + priceLabel(points.supportZone.low) + '–' + priceLabel(points.supportZone.high), CHART.support]);
  const metricsBox = $('chartMetrics');
  const signature = metrics.map(item => item[0]).join('|');
  if (metricsBox.dataset.signature !== signature) {
    metricsBox.dataset.signature = signature;
    metricsBox.replaceChildren(...metrics.map(([label, color]) => {
      const item = document.createElement('span');
      item.textContent = label;
      item.style.color = color;
      return item;
    }));
  }
  if (hoveredTime === null) renderInsight(history, end - 1, false);
  else {const selectedIndex=history.findIndex(row=>row.t===hoveredTime);
    if(selectedIndex>=0)renderInsight(history,selectedIndex,true)}
  if(start<25&&history.length<30000){
    const a=current(),key=a?assetId(a)+'|'+tf:'';
    if(a&&!timeframeCache.get(key)?.exhausted&&!historyRequests.has(key+'|'+loadSerial))
      extendHistory(loadSerial,a,tf,history[0].t,history.length+300,1);
  }
}

function resetChartView() {
  viewOffset = 0;
  viewCount = null;
  hoveredTime = null;
  $('chartCrosshair').hidden = true;
  scheduleDraw();
}

function renderInsight(history,index,hovered){
  const panel=$('candleInsight');
  let result=analyzeCandle(history,index,{durationMs:tfMs[tf],now:Date.now(),historical:false});
  const completeCount=completedCount(history);
  if(result&&index<completeCount)
    result=freezeInsight(selected+'|'+tf+'|'+result.time+'|normal',result);
  renderAudit(history,index,result);
  if(!result){
    panel.className='candleInsight neutral';
    panel.dataset.signature='';
    $('insightEyebrow').textContent='图表解读 · 移动到 K 线查看';
    $('insightTitle').textContent='正在等待历史数据';
    $('insightTime').textContent='';
    $('insightSummary').textContent='加载后会结合价格、成交额、均线和此前关键价位进行解读。';
    $('insightMeasures').replaceChildren();
    $('insightEvidence').replaceChildren();
    $('insightFocus').textContent='';
    $('insightBasis').textContent='';
    return;
  }
  const signature=selected+'|'+tf+'|'+result.time+'|'+result.title+'|'+result.summary+'|'+result.evidence.join('|')+'|'+
    result.measures.map(item=>item.value).join('|')+'|'+result.focus+'|'+result.basis+'|'+hovered;
  if(panel.dataset.signature===signature)return;
  panel.dataset.signature=signature;
  panel.className='candleInsight '+result.tone;
  $('insightEyebrow').textContent='图表解读 · '+(hovered?'已选 K 线（回到最新可重置）':'当前视图最新 K 线');
  $('insightTitle').textContent=result.title;
  $('insightTime').textContent=date(result.time);
  $('insightSummary').textContent=result.summary;
  $('insightMeasures').replaceChildren(...result.measures.map(measure=>{
    const item=document.createElement('span');item.className='insightMeasure';
    const label=document.createElement('small');label.textContent=measure.label;
    const value=document.createElement('strong');value.textContent=measure.value;
    item.append(label,value);return item;
  }));
  $('insightEvidence').replaceChildren(...result.evidence.map(sentence=>{
    const item=document.createElement('li');item.textContent=sentence;return item;
  }));
  $('insightFocus').textContent=result.focus;
  $('insightBasis').textContent=result.basis;
}

function renderAudit(history,index,original){
  const verdict=$('auditVerdict'),outcome=$('auditOutcome'),reliability=$('auditReliability');
  if(index<0||!history[index]){verdict.textContent='等待 K 线';
    outcome.textContent='选择一根 K 线后查看后续验证。';reliability.textContent='';return}
  const completeCount=completedCount(history);
  if(index>=completeCount){verdict.textContent='尚未收盘';
    outcome.textContent='当前这根 K 线还在变化，收盘后才会冻结当时的分析并等待后续五根。';
    reliability.textContent='';return}
  const key=selected+'|'+tf+'|'+history[index].t+'|'+completeCount+'|normal';
  let record=auditCache.get(key);
  if(!record){
    const start=Math.max(0,index-6000),end=Math.min(history.length,index+candleAudit.HORIZON+1);
    const scoped=history.slice(start,end),scopedIndex=index-start;
    const scopedComplete=Math.min(completeCount,end)-start;
    const check=candleAudit.verify(scoped,scopedIndex,scopedComplete,original);
    record={check,score:candleAudit.reliability(scoped,scopedIndex,check,scopedComplete)};
    if(auditCache.size>=600)auditCache.clear();
    auditCache.set(key,record)}
  const {check,score}=record;
  if(!check){verdict.textContent='无法验证';outcome.textContent='这根 K 线的数据不足。';reliability.textContent='';return}
  if(!check.ready){verdict.textContent='等待后续 '+check.remaining+' 根';
    outcome.textContent='原始解读保持不变；后续五根完整 K 线到齐后公布方向与幅度。'}
  else{const direction={up:'上涨',down:'下跌',flat:'横盘'};
    verdict.textContent=check.verdict==='confirmed'?'方向吻合':check.verdict==='missed'?'方向未吻合':'当时未判方向';
    outcome.textContent='后续 '+check.horizon+' 根收盘'+(check.percent>=0?'+':'')+check.percent.toFixed(2)+'%，按当时波动阈值 '+check.thresholdPercent.toFixed(2)+'% 判为'+direction[check.outcome]+'。'+
      (check.verdict==='no_call'?'原解读没有作方向断言，不计入正确率。':
      '原提示偏'+direction[check.direction]+'，'+(check.verdict==='confirmed'?'这次得到验证。':'这次没有兑现。'));}
  if(!score){reliability.textContent='原解读没有方向断言，暂不统计方向正确率。';return}
  reliability.textContent=score.count<10?'此前可验证的同类方向样本只有 '+score.count+' 组，暂不估计可靠性。':
    score.scope+'此前 '+score.count+' 组验证中吻合 '+score.hits+' 组（'+(score.rate*100).toFixed(0)+'%）；'+
    (score.qualified?'通过历史可靠性门槛，可继续观察是否形成相同条件。':'未通过可靠性门槛，新的同类方向提示应降级为观察。');
}

function chartHover(e){
  if(!chartPlot||drag)return;
  const rect=$('chart').getBoundingClientRect();
  const px=e.clientX-rect.left;
  const index=Math.floor((px-chartPlot.left)/chartPlot.step);
  const bar=chartPlot.rows[index];
  const tip=$('chartTip');
  const crosshair=$('chartCrosshair');
  if(!bar){
    tip.hidden=true;crosshair.hidden=true;
    return;
  }
  crosshair.hidden=false;
  crosshair.style.left=chartPlot.x(index)+'px';
  tip.hidden=false;
  tip.textContent=date(bar.t)+'\n开 '+fmt(bar.o)+'  高 '+fmt(bar.h)+'\n低 '+fmt(bar.l)+'  收 '+fmt(bar.c)+'\n成交额 '+nfmt(bar.v)+(current()?.type==='ashare'?' CNY':' USDT');
  tip.style.left=Math.max(2,Math.min(rect.width-155,px+10))+'px';
  tip.style.top=Math.max(5,e.clientY-rect.top-60)+'px';
  if(hoveredTime!==bar.t){
    hoveredTime=bar.t;
    renderInsight(chartPlot.history,chartPlot.start+index,true);
  }
}
function hideSuggestions(){if(searchSuggestionsTimer){clearTimeout(searchSuggestionsTimer);searchSuggestionsTimer=null}
$('suggestions').hidden=true;
searchIndex=-1}
function scheduleSuggestionsHide(){
  if(searchSuggestionsTimer)clearTimeout(searchSuggestionsTimer);
  searchSuggestionsTimer=setTimeout(()=>{searchSuggestionsTimer=null;hideSuggestions()},5000);
}
function renderSelectedAssetPreview(item,status='已选择'){
  const box=$('selectedAssetPreview');box.replaceChildren();
  box.hidden=!item;
  if(!item)return;
  const icon=logoFor(item);icon.classList.add('selectedAssetLogo');
  const details=document.createElement('span');details.className='selectedAssetDetails';
  const name=document.createElement('strong');name.textContent=item.symbol;
  const subtitle=document.createElement('small');subtitle.textContent=(item.name||item.symbol)+' · '+marketLabel(item);
  details.append(name,subtitle);
  const state=document.createElement('span');state.className='selectedAssetState';state.textContent=status;
  box.append(icon,details,state);
  box.onclick=()=>openInfoForPreview(item);
  box.tabIndex=0;box.setAttribute('role','button');box.setAttribute('aria-label','查看 '+item.symbol+' 简介');
  box.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openInfoForPreview(item)}};
}
function clearAlreadyInGroupNotice(){
  if(alreadyInGroupTimer){clearTimeout(alreadyInGroupTimer);alreadyInGroupTimer=null}
  $('addForm').querySelector('.alreadyInGroupNotice')?.remove();
}
function showAlreadyInGroupNotice(groupId){
  clearAddSearch();
  renderSelectedAssetPreview(null);
  const notice=document.createElement('span');
  notice.className='alreadyInGroupNotice';
  notice.setAttribute('role','status');
  notice.textContent='已经在'+(groups.find(group=>group.id===groupId)?.name||'分组');
  $('addForm').append(notice);
  alreadyInGroupTimer=setTimeout(()=>{alreadyInGroupTimer=null;notice.remove()},2300);
}
function clearAddSearch(){
  clearAlreadyInGroupNotice();searchSerial++;searchChoice=null;searchResults=[];
  $('symbol').value='';$('addError').textContent='';hideSuggestions();
}
function recordSearch(query){
  if(searchPersistTimer)clearTimeout(searchPersistTimer);
  if(!accountUser||!query)return;
  searchPersistTimer=setTimeout(()=>{searchPersistTimer=null;
    api('/api/search?q='+encodeURIComponent(query)).catch(()=>{});
  },350);
}
function chooseSuggestion(item){searchSerial++;clearAlreadyInGroupNotice();
searchChoice={...item,enteredQuery:$('symbol').value.trim()};
$('addError').textContent='';
renderSelectedAssetPreview(item);
hideSuggestions()}
function renderSuggestions(){let box=$('suggestions');
box.replaceChildren();
if(!$('symbol').value.trim()){hideSuggestions();
return}box.hidden=false;scheduleSuggestionsHide();
if(!searchResults.length){let empty=document.createElement('div');
empty.className='emptyHint';
empty.textContent=!instrumentCatalog&&catalogLoading?'正在读取 OKX 合约列表…':'暂时没有可用的 OKX 合约候选';
box.append(empty);
return}searchResults.forEach((item,i)=>{let b=document.createElement('button');
b.type='button';
b.className='suggestion'+(i===searchIndex?' active':'');
b.setAttribute('role','option');
let icon=logoFor(item);
icon.classList.add('suggestLogo');
let name=document.createElement('span');
name.className='suggestName';
let strong=document.createElement('strong');
strong.textContent=item.symbol;
let small=document.createElement('small');
small.textContent=item.name;
name.append(strong,small);
let type=document.createElement('span');
type.className='suggestType';
type.textContent=item.type==='ashare'?'A股':'USDT 永续';
b.append(icon,name,type);
b.onclick=()=>chooseSuggestion(item);
box.append(b)})}
const normalizeSearch=value=>String(value||'').normalize('NFKC').toLocaleLowerCase().replace(/[\s/_-]+/g,'');
function searchTerms(item){
  const common={BTC:['比特币','Bitcoin'],ETH:['以太坊','Ethereum'],SOL:['索拉纳','Solana'],DOGE:['狗狗币','Dogecoin'],SH600519:['茅台','茅台酒','贵州茅台'],SZ002384:['东山','东山精密'],TRUMP:['特朗普','川普','特朗普币','川普币','Official Trump'],XAU:['黄金','Gold'],XAG:['白银','Silver']};
  const raw=[item.symbol,...(item.type==='ashare'?[item.code||item.symbol.slice(2)]:[item.symbol+'USDT',item.symbol+'USDTSWAP']),item.name,...(item.aliases||[]),...(common[item.symbol]||[])];
  const words=raw.flatMap(value=>String(value||'').split(/[\s/·()（）,，]+/));
  return [...new Set([...raw,...words].map(normalizeSearch).filter(Boolean))];
}
function editDistance(a,b){
  if(a===b)return 0;
  let previous=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
    const row=[i];
    for(let j=1;j<=b.length;j++)
      row[j]=Math.min(row[j-1]+1,previous[j]+1,previous[j-1]+(a[i-1]===b[j-1]?0:1));
    previous=row;
  }
  return previous[b.length];
}
function matchCatalog(query,persist=true){
  if(persist)recordSearch(query); // Mobile and desktop searches share first-visit server persistence.
  const needle=normalizeSearch(query);
  if(!needle||!Array.isArray(instrumentCatalog))return [];
  if(!catalogSearchIndex||catalogSearchIndex.length!==instrumentCatalog.length)
    catalogSearchIndex=instrumentCatalog.map(item=>({item,values:searchTerms(item)}));
  const direct=[],remaining=[];
  const terms=String(query).normalize('NFKC').toLowerCase().split(/\s+/).map(normalizeSearch).filter(Boolean);
  for(const row of catalogSearchIndex){
    const rank=normalizeSearch(row.item.symbol)===needle?-1:row.values.includes(needle)?0:
      row.values.some(value=>value.startsWith(needle))?1:
      row.values.some(value=>value.includes(needle))||terms.length>1&&terms.every(term=>row.values.some(value=>value.includes(term)))?2:3;
    if(rank<3){direct.push({...row,rank});continue}
    remaining.push(row);
  }
  direct.sort((a,b)=>a.rank-b.rank||a.item.symbol.localeCompare(b.item.symbol));
  if(direct.length)return direct.slice(0,20).map(row=>({...row.item,matchType:'direct'}));
  if(needle.length>32)return [];
  if(needle.length===1)return instrumentCatalog.slice(0,5).map(item=>({...item,matchType:'related'}));
  const near=[];
  for(const row of remaining){
    let score=Infinity;
    for(const value of row.values){
      if(value.length>32||Math.abs(value.length-needle.length)>Math.ceil(Math.max(value.length,needle.length)*.45))continue;
      let edits=editDistance(needle,value);
      for(let i=0;i<needle.length-1;i++){const swapped=needle.slice(0,i)+needle[i+1]+needle[i]+needle.slice(i+2);if(swapped===value)edits=Math.min(edits,1);}
      const fullScore=edits/Math.max(needle.length,value.length)+Math.abs(needle.length-value.length)*.015;
      score=Math.min(score,fullScore);
      if(/[\u3400-\u9fff]/.test(needle)&&value.length>needle.length){for(let i=0;i<=value.length-needle.length;i++)score=Math.min(score,editDistance(needle,value.slice(i,i+needle.length))/needle.length+.12);}
    }
    near.push({...row,score});
  }
  near.sort((a,b)=>a.score-b.score||a.item.symbol.localeCompare(b.item.symbol));
  const close=near.filter(row=>row.score<=(needle.length===2?.52:.45));
  const candidates=close.length?close:near.filter(row=>Number.isFinite(row.score)).slice(0,3);
  return candidates.slice(0,5).map(row=>({...row.item,matchType:close.length?'close':'related'}));
}
// Both mobile pickers use the same immediate catalogue matches.
let assetDiscoveryTimer=null,assetDiscoveryItems=new Map(),assetDiscoveryOwner='';
function recordDiscoveredAssets(items){
  rememberAssetLogos(items);
  if(!accountUser)return;
  if(assetDiscoveryOwner!==accountSpace){assetDiscoveryItems.clear();assetDiscoveryOwner=accountSpace}
  for(const item of items||[])if(item?.symbol&&['swap','ashare'].includes(item.type))assetDiscoveryItems.set(assetId(item),{type:item.type,symbol:item.symbol});
  if(assetDiscoveryTimer||!assetDiscoveryItems.size)return;
  const owner=accountSpace;
  assetDiscoveryTimer=setTimeout(async()=>{
    try{
      if(owner!==accountSpace)return;
      const items=[...assetDiscoveryItems.values()].slice(0,30);
      for(const item of items)assetDiscoveryItems.delete(assetId(item));
      if(accountUser&&items.length)await postApi('/api/asset-discovery',{items});
    }catch{}finally{
      assetDiscoveryTimer=null;
      if(assetDiscoveryOwner===accountSpace)recordDiscoveredAssets([]);else assetDiscoveryItems.clear();
    }
  },600);
}
function mobileAssetMatches(query){const matches=instrumentCatalog?matchCatalog(query,false):null;if(matches?.length)recordDiscoveredAssets(matches);return matches}
function bindMobileAssetSearch(input,search){
  input.maxLength=64;input.placeholder='输入代码或名称，自动匹配';
  // IME input events already contain the current text: show candidates while composing too.
  input.oninput=()=>search();
  input.oncompositionend=()=>search();
}
async function loadCatalog(){if(instrumentCatalog&&Date.now()-catalogFetchedAt<180000)return;if(catalogLoading)return catalogLoading;
catalogLoading=api('/api/catalog').then(data=>{if(!Array.isArray(data.items))throw Error('合约目录格式无效');
rememberAssetLogos(data.items);instrumentCatalog=enrichCatalog(data.items);catalogFetchedAt=Date.now();
catalogSearchIndex=null;
hydrateAssetNames();renderWatch();
try{publicMarketCache.setItem(CATALOG_STORE,JSON.stringify({t:Date.now(),items:data.items}))}catch{}
if($('symbol').value.trim())searchSymbols();if(petManagerGroup&&$('petOwnSearch')?.value.trim())searchPetAssets()}).catch(e=>{
if(!instrumentCatalog&&$('symbol').value.trim())$('addError').textContent='合约列表暂不可用：'+e.message
}).finally(()=>{catalogLoading=null});
return catalogLoading}
async function loadDailyHot(){
  if(!accountUser||hotLoading)return hotLoading;
  const owner=accountUser;
  hotLoading=api('/api/daily-hot').then(data=>{
    if(accountUser!==owner)return;
    if(!Array.isArray(data.items)||data.items.length!==20)throw Error('热门榜数量无效');
    const hot=data.items.filter(item=>item?.type==='swap'&&/^[A-Z0-9]{1,15}$/.test(item.symbol));
    if(hot.length!==20||new Set(hot.map(item=>item.symbol)).size!==20)throw Error('热门榜标的无效');
    const shown=petDeckGroup===HOT_GROUP_ID?deckMembers()[petDeckIndex]?.symbol:null;
    hotDay=data.day||'';hotUpdatedAt=Number(data.fetchedAt)||0;
    hotStale=data.stale===true;
    const before=assets.filter(a=>a.groupId===HOT_GROUP_ID).map(a=>a.symbol).join(',');
    const hadGroup=groups.some(group=>group.id===HOT_GROUP_ID);
    if(hadGroup&&before===hot.map(item=>item.symbol).join(',')){
      if(petDeckGroup===HOT_GROUP_ID)deckUpdateCount();
      renderWatch();return;
    }
    if(!hadGroup)groups.push({id:HOT_GROUP_ID,name:'热门'});
    assets=assets.filter(a=>a.groupId!==HOT_GROUP_ID);
    assets.push(...hot.map(item=>({type:'swap',symbol:item.symbol,name:item.name,
      groupId:HOT_GROUP_ID,pinned:false})));
    if(activeGroupId===HOT_GROUP_ID&&!assets.some(a=>a.groupId===HOT_GROUP_ID&&assetId(a)===selected)){
      selected=assetId(assets.find(a=>a.groupId===HOT_GROUP_ID));
      loadAsset();
    }
    if(petDeckGroup===HOT_GROUP_ID){
      const index=hot.findIndex(item=>item.symbol===shown);petDeckIndex=Math.max(0,index);
      deckTransition++;$('deckCard').dataset.busy='';$('deckCard').style.transform='';$('deckCard').style.opacity='';
      if(deckChartMoved.length&&index<0)closeDeckChart();
      if(!deckChartMoved.length)buildDeckCard();
    }
    renderWatch();connectOkx();pollWatchQuotes();
    if(!hadGroup||before!==hot.map(item=>item.symbol).join(','))save();
  }).catch(()=>{hotStale=true;if(activeGroupId===HOT_GROUP_ID)renderWatch()})
    .finally(()=>{hotLoading=null});
  return hotLoading;
}
async function searchSymbols(){let query=$('symbol').value.trim(),serial=++searchSerial;
if(!query){searchResults=[];
hideSuggestions();
return}if(instrumentCatalog){recordSearch(query);searchResults=matchCatalog(query);
searchIndex=-1;
renderSuggestions();
return}loadCatalog();
searchResults=[];
renderSuggestions();
try{let data=await api('/api/search?q='+encodeURIComponent(query));
if(serial!==searchSerial)return;
searchResults=Array.isArray(data.results)?data.results:[];
searchIndex=-1;
renderSuggestions()}catch(e){if(serial!==searchSerial)return;
searchResults=[];
$('addError').textContent='搜索暂不可用：'+e.message;
renderSuggestions()}}
async function addSelected(e){e.preventDefault();
let rawInput=$('symbol').value.trim(),input=rawInput.toUpperCase();
let item=searchChoice?.enteredQuery===rawInput?searchChoice:null;
if(!item&&instrumentCatalog)
  item=instrumentCatalog.find(x=>x.symbol===input||x.symbol+'USDT'===input)||
    searchResults[searchIndex>=0?searchIndex:0]||matchCatalog(input)[0];
if(!item){await loadCatalog();item=matchCatalog(input)[0]}
if(!item){try{let data=await api('/api/search?q='+encodeURIComponent(input));
  item=(data.results||[])[0]}catch{}}
if(!item){$('addError').textContent='OKX 合约目录暂不可用，请稍后重试';
return}let k=item.type+':'+item.symbol,groupId=$('addGroup').value||'main';
searchChoice={...item,enteredQuery:rawInput};
renderSelectedAssetPreview(item);
if(assets.some(a=>a.groupId===groupId&&assetId(a)===k)){showAlreadyInGroupNotice(groupId);
return}if(assets.filter(a=>a.groupId===groupId).length>=MAX_GROUP_ASSETS){$('addError').textContent=`每个分组最多 ${MAX_GROUP_ASSETS} 个标的`;
return}insertInGroup({type:item.type,symbol:item.symbol,name:item.name,groupId,pinned:false});
selected=k;
activeGroupId=groupId;
clearAddSearch();renderSelectedAssetPreview(null);
save();
applyReorderMode(false);
connectOkx();
loadAsset();
loadProfile(item)}
async function setup(){let a=current();
if(a)selected=assetId(a);
setupGroupScrollRail();
$('infoDialog').addEventListener('close',()=>{infoPreviewAsset=null});
$('colorScheme').value=scheme;
$('swing').value=String(swing);
$('showVolume').checked=toggles.volume!==false;
$('showLevels').checked=toggles.levels!==false;
$('showFib').checked=toggles.fib!==false;
$('showMA').checked=toggles.ma!==false;
for(let id of ['showVolume','showLevels','showFib','showMA'])$(id).onchange=()=>{toggles[id.slice(4).toLowerCase()]=$(id).checked;
save();
draw()};
$('colorScheme').onchange=()=>{scheme=$('colorScheme').value;
save();
updateHero();
draw();renderWatch()};
$('historyMore').onclick=()=>{const a=current();
if(a&&candles.length)extendHistory(loadSerial,a,tf,candles[0].t,
  Math.min(30000,candles.length+1800),7)};
$('swing').onchange=()=>{swing=Number($('swing').value);
save()};
$('target').onchange=()=>{let x=Number($('target').value);
if(selected){if(x>0)targets[selected]=x;
else delete targets[selected];
save()}};

document.querySelectorAll('#timeframes button').forEach(b=>{b.classList.toggle('active',b.dataset.tf===tf);
b.onclick=()=>{tf=b.dataset.tf;
document.querySelectorAll('#timeframes button').forEach(x=>x.classList.toggle('active',x===b));
save();
loadAsset()}});

$('addForm').onsubmit=addSelected;
$('mobileMoreButton').onclick=()=>openMobileMore();
$('mobileAddButton').onclick=()=>openMobileMore(true);
$('mobileMoreDialog').addEventListener('close',closeMobileMore);
$('watchPin').onclick=()=>{const a=findWatch(actionAssetId);
  if(a)moveWatchAsset(actionAssetId,!a.pinned);$('watchActionDialog').close()};
$('watchFirst').onclick=()=>{moveWatchAsset(actionAssetId,false,false);$('watchActionDialog').close()};
$('watchLast').onclick=()=>{moveWatchAsset(actionAssetId,false,true);$('watchActionDialog').close()};
$('watchDelete').onclick=()=>{if(findWatch(actionAssetId))removeWatchAsset(actionAssetId);
  $('watchActionDialog').close()};
$('toggleReorder').onclick=()=>applyReorderMode(!reorderMode);
function openGroupDialog(mode){
  const dialog=$('groupManageDialog'),creating=mode==='create';
  dialog.dataset.mode=mode;
  dialog.setAttribute('aria-label',creating?'新建分组':'管理分组');
  $('groupDialogTitle').textContent=creating?'新建分组':'管理分组';
  $('groupError').textContent='';
  if(creating){
    $('groupName').value='';$('groupSeedSearch').value='';groupSeedChosen.clear();
    groupSeedRemoteResults=[];groupSeedResults=[];groupSeedSearchSerial++;
    hideGroupSeedSuggestions();
    renderGroupSeedSelected();renderGroupSeedOptions();
  }else renderGroupManager();
  openDetailDialog(dialog,(window.MarketDevice?.isMobile?.()??window.innerWidth<=720)?null:(creating?$('groupName'):null));
}
petOpenGroupDialog=openGroupDialog;
$('groupManageButton').onclick=()=>openGroupDialog('manage');
$('groupCreateFromManage').onclick=()=>openGroupDialog('create');
$('groupSeedSearch').oninput=event=>{
  if(event.isComposing)return;
  renderGroupSeedOptions();
  searchGroupSeed();
};
$('groupSeedSearch').addEventListener('compositionend',()=>{
  renderGroupSeedOptions();searchGroupSeed();
});
$('groupSeedSearch').onfocus=()=>{
  if(!instrumentCatalog)loadCatalog().catch(()=>{});
  if($('groupSeedSearch').value.trim())searchGroupSeed();
};
$('groupSeedSearch').onkeydown=event=>{
  if(event.key==='Escape'){hideGroupSeedSuggestions();return}
  if(['ArrowDown','ArrowUp'].includes(event.key)&&!$('groupSeedSuggestions').hidden&&groupSeedResults.length){
    event.preventDefault();
    groupSeedSearchIndex=(groupSeedSearchIndex+(event.key==='ArrowDown'?1:-1)+groupSeedResults.length)%groupSeedResults.length;
    renderGroupSeedSuggestions();return;
  }
  if(event.key!=='Enter')return;
  event.preventDefault();
  if(!$('groupSeedSuggestions').hidden&&groupSeedResults.length){
    chooseGroupSeedSuggestion(groupSeedResults[groupSeedSearchIndex>=0?groupSeedSearchIndex:0]);return;
  }
  const first=$('groupSeedList').querySelector('.groupSeedOption input');
  if(first&&!first.checked){first.checked=true;first.dispatchEvent(new Event('change'))}
};
document.addEventListener('click',event=>{
  if(!event.target.closest('.groupSeedSearchWrap'))hideGroupSeedSuggestions();
});
$('symbol').oninput=event=>{clearAlreadyInGroupNotice();searchChoice=null;
searchResults=[];
hideSuggestions();
renderSelectedAssetPreview(null);
$('addError').textContent='';
$('symbol').dataset.composing=event.isComposing?'true':'false';
if(!event.isComposing)searchSymbols()};
$('symbol').addEventListener('compositionend',()=>{
  $('symbol').dataset.composing='false';searchSymbols()});
$('symbol').onkeydown=e=>{if(e.key==='Escape'){hideSuggestions();
return}if(!$('suggestions').hidden&&['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();
searchIndex=(searchIndex+(e.key==='ArrowDown'?1:-1)+searchResults.length)%Math.max(1,searchResults.length);
renderSuggestions()}else if(e.key==='Enter'&&!$('suggestions').hidden&&searchResults.length){e.preventDefault();
chooseSuggestion(searchResults[searchIndex>=0?searchIndex:0])}};
document.addEventListener('click',e=>{if(!e.target.closest('.searchWrap'))hideSuggestions()});

$('groupName').oninput=()=>$('groupError').textContent='';
$('groupForm').onsubmit=e=>{e.preventDefault();
let name=$('groupName').value.trim();
const nameError=groupNameError(name);
if(nameError){$('groupError').textContent=nameError;return}
if(groups.filter(group=>group.id!==HOT_GROUP_ID).length>=MAX_USER_GROUPS){$('groupError').textContent=`最多创建 ${MAX_USER_GROUPS} 个分组（含自选）`;
return}if(groupNameTaken(name,null)){$('groupError').textContent='分组名称已存在';
return}
const chosen=[...groupSeedChosen.values()];
if(!chosen.length){$('groupError').textContent='请至少选择一个标的';return}
if(chosen.length>MAX_GROUP_ASSETS){$('groupError').textContent=`每个分组最多 ${MAX_GROUP_ASSETS} 个标的`;return}
let id='g'+Date.now().toString(36),previousSelected=selected;
groups.push({id,name});
for(const asset of chosen)assets.push({...asset,groupId:id,pinned:false});
selected=assetId(chosen[0]);
activeGroupId=id;
$('groupName').value='';
$('groupSeedSearch').value='';groupSeedChosen.clear();
$('groupError').textContent='';
save();
renderGroupOptions();
$('addGroup').value=id;
renderWatch();
connectOkx();
for(const asset of chosen)queueProfile(asset);
if(selected!==previousSelected)loadAsset();
$('groupManageDialog').close()};
$('heroLogo').onclick=()=>{if(current())openInfoFor(selected)};
$('alertsButton').onclick=()=>openDetailDialog($('alertsDialog'));
document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>{
  const dialog=$(button.dataset.close);dialog.close();
  if((window.MarketDevice?.isMobile?.()??window.innerWidth<=720)&&dialog.id!=='alertsDialog'&&!(dialog.id==='infoDialog'&&!$('petDeck').hidden))returnToPetHome();
});
for(const dialog of document.querySelectorAll('.detailDialog'))dialog.onclick=e=>{if(e.target===dialog)dialog.close()};
$('reload').onclick=loadAsset;
const chartToolbar=document.querySelector('.hero > .toolbar');
const chartToolbarHome=document.createComment('chart toolbar position');
chartToolbar.before(chartToolbarHome);
$('chartExpand').onclick=()=>{
  if(!document.body.classList.contains('chartExpanded')){
    const strategy=$('strategyPanel'),style=getComputedStyle(strategy);
    const extra=strategy.getBoundingClientRect().height+
      parseFloat(style.marginTop||0)+parseFloat(style.marginBottom||0);
    $('chart').parentElement.style.setProperty('--expandedChartHeight',
      Math.round($('chart').parentElement.getBoundingClientRect().height+extra)+'px');
  }
  const expanded=document.body.classList.toggle('chartExpanded');
  if(expanded)document.querySelector('.chartStatusRow').prepend(chartToolbar);
  else chartToolbarHome.after(chartToolbar);
  $('chartExpand').setAttribute('aria-pressed',String(expanded));
  $('chartExpand').textContent=expanded?'⤡ 收起图表':'⤢ 放大图表';
  scheduleDraw();
};
$('chartLatest').onclick=resetChartView;
$('chart').onmousemove=chartHover;
$('chart').onmouseleave=()=>{
  $('chartTip').hidden=true;
  $('chartCrosshair').hidden=true;
};
const chartCanvas=$('chart');
const pointers=new Map();
let pinch=null,wheelRemainder=0,safariPinch=null;
const fraction=clientX=>{let rect=chartCanvas.getBoundingClientRect();
return Math.max(0,Math.min(1,(clientX-rect.left-chartPlot.left)/chartPlot.plotWidth))};
const setViewport=(base,nextCount,startFraction,endFraction)=>{let total=chartRows().length;
let next=chartViewport(total,base.count,base.offset,nextCount,startFraction,endFraction);
viewCount=next.count;viewOffset=next.offset;hoveredTime=null;
$('chartTip').hidden=true;$('chartCrosshair').hidden=true;scheduleDraw()};
chartCanvas.addEventListener('wheel',e=>{if(!chartPlot)return;
if(safariPinch){e.preventDefault();return}
if(e.ctrlKey){e.preventDefault();
let count=chartPlot.rows.length;
let change=Math.max(-40,Math.min(40,e.deltaY));
let next=Math.max(12,Math.min(160,Math.round(count*Math.exp(change*.012))));
if(next!==count)setViewport({count,offset:viewOffset},next,fraction(e.clientX),fraction(e.clientX));
return}
if(Math.abs(e.deltaX)>Math.abs(e.deltaY)*.8&&Math.abs(e.deltaX)>0){e.preventDefault();
let pixels=e.deltaX*(e.deltaMode===1?16:e.deltaMode===2?chartCanvas.clientWidth:1)+wheelRemainder;
let bars=Math.trunc(pixels/chartPlot.step);
wheelRemainder=pixels-bars*chartPlot.step;
if(bars){viewOffset=Math.max(0,Math.min(chartRows().length-chartPlot.rows.length,viewOffset-bars));
hoveredTime=null;$('chartTip').hidden=true;scheduleDraw()}}},{passive:false});
chartCanvas.addEventListener('pointerdown',e=>{if(!chartPlot)return;
pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY});
hoveredTime=null;$('chartCrosshair').hidden=true;
chartCanvas.setPointerCapture(e.pointerId);
if(pointers.size===1){drag={x:e.clientX,offset:viewOffset};pinch=null}
else if(pointers.size===2){let [a,b]=[...pointers.values()];
pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),count:chartPlot.rows.length,
offset:viewOffset,fraction:fraction((a.x+b.x)/2)};drag=null}});
chartCanvas.addEventListener('pointermove',e=>{if(!pointers.has(e.pointerId)||!chartPlot)return;
let previous=pointers.get(e.pointerId);
pointers.set(e.pointerId,{...previous,x:e.clientX,y:e.clientY});
if(pointers.size===2&&pinch){let [a,b]=[...pointers.values()];
let distance=Math.hypot(a.x-b.x,a.y-b.y);
let count=Math.abs(distance-pinch.distance)<8?pinch.count:
Math.max(12,Math.min(160,Math.round(pinch.count*pinch.distance/Math.max(1,distance))));
setViewport(pinch,count,pinch.fraction,fraction((a.x+b.x)/2));
return}
if(drag){viewOffset=Math.max(0,Math.min(chartRows().length-chartPlot.rows.length,
drag.offset+Math.round((e.clientX-drag.x)/chartPlot.step)));
$('chartTip').hidden=true;scheduleDraw()}});
function endPointer(e,cancelled=false){let previous=pointers.get(e.pointerId);
let tapped=!cancelled&&e.pointerType==='touch'&&pointers.size===1&&previous&&
Math.hypot(e.clientX-previous.startX,e.clientY-previous.startY)<8;
pointers.delete(e.pointerId);
if(pointers.size===1){let remaining=[...pointers.values()][0];
drag={x:remaining.x,offset:viewOffset};pinch=null}
else{drag=null;pinch=null}
if(tapped)chartHover(e)}
chartCanvas.addEventListener('pointerup',e=>endPointer(e));
chartCanvas.addEventListener('pointercancel',e=>endPointer(e,true));
chartCanvas.addEventListener('gesturestart',e=>{if(!chartPlot)return;
e.preventDefault();safariPinch={count:chartPlot.rows.length,offset:viewOffset,fraction:fraction(e.clientX)}});
chartCanvas.addEventListener('gesturechange',e=>{if(!safariPinch||!chartPlot)return;
e.preventDefault();let count=Math.max(12,Math.min(160,Math.round(safariPinch.count/Math.max(.1,e.scale))));
setViewport(safariPinch,count,safariPinch.fraction,fraction(e.clientX))});
chartCanvas.addEventListener('gestureend',()=>safariPinch=null);
new ResizeObserver(scheduleDraw).observe($('chart').parentElement);

$('notify').onclick=async()=>{if(!('Notification'in window)){$('notify').title='浏览器不支持通知';
return}let p=await Notification.requestPermission();
$('notify').textContent=p==='granted'?'通知已开启':'开启通知'};
if('Notification'in window&&Notification.permission==='granted')$('notify').textContent='通知已开启';

renderGroupOptions();
setupPetHome();
renderFeed();
await setupAccount();
// Account restoration starts its data requests after the stable entry is visible.
api('/api/status').then(()=>{if(!marketQuoteReady&&!marketFailureCount)updateMarketSignal({reachable:true})}).catch(()=>{marketFailureCount++;updateMarketSignal({cached:!!quotes[assetId(current()||{})]})});
window.addEventListener('offline',()=>updateMarketSignal());
setInterval(()=>{if(accountUser&&!document.hidden)pollQuote()},5000);
setInterval(()=>{if(accountUser&&!document.hidden)pollWatchQuotes()},15000);
setInterval(()=>{if(accountUser)refreshCandles()},5000);
setInterval(()=>{if(accountUser)refreshMinis()},300000);
setInterval(()=>{if(accountUser&&!document.hidden&&mobileChartVisible())loadNews()},300000);
setInterval(()=>{if(accountUser&&!document.hidden)loadDailyHot()},60000);
document.documentElement.dataset.pageHidden=String(document.hidden);
document.addEventListener('visibilitychange',()=>{document.documentElement.dataset.pageHidden=String(document.hidden);if(!document.hidden&&accountUser){pollQuote();
refreshCandles(true);
miniErrorUntil={};refreshMinis();pumpBackgroundRequests();
pollWatchQuotes();loadNews();loadDailyHot()}else if(accountUser)syncAccount()});
window.addEventListener('online',()=>{if(!accountUser)return;
  miniErrorUntil={};profileErrorUntil={};historyRetryAfter.clear();
  connectOkx();refreshCandles(true);pollQuote();pollWatchQuotes();
  refreshMinis();pumpBackgroundRequests();loadDailyHot();
});
window.addEventListener('pagehide',()=>{if(accountUser)syncAccount()});
window.addEventListener('resize',scheduleDraw)}
// ===== 宠物主屏（移动端新增；经典版完整保留，可互相切换） =====
const MAX_USER_GROUPS=5;
// 新版手机入口默认打开；经典版选择仍在当前浏览器中记住。
const PET_HOME_STORE='market_pet_home_v2';
let petHomeOn=true,petHomeBuilt=false,petDeckGroup=null,petDeckIndex=0,petDeckTimer=null,deckTransition=0;
try{petHomeOn=localStorage.getItem(PET_HOME_STORE)!=='0'}catch{}
let petLongTimer=null,petLongFired=false,petPressMoved=false,petPressStart=null;
// openGroupDialog 声明在 setup() 内部，宠物模块在 IIFE 顶层；setup 启动时把入口交给模块
let petOpenGroupDialog=null;
// 5 只专属宠物：径向渐变塑体积 + 高光，眨眼/漂浮交给 CSS；prefix 保证渐变 id 不冲突
function petArt(index,p){
  if(index===0)return `<svg class="petSvg" viewBox="0 0 120 120" aria-hidden="true"><defs>
<radialGradient id="${p}b" cx="36%" cy="26%" r="82%"><stop offset="0%" stop-color="#ffe1ec"/><stop offset="52%" stop-color="#ff9ec6"/><stop offset="100%" stop-color="#d95f96"/></radialGradient>
<radialGradient id="${p}t" cx="50%" cy="30%" r="75%"><stop offset="0%" stop-color="#fff5f9"/><stop offset="100%" stop-color="#ffc3d9"/></radialGradient></defs>
<g fill="#ff7fb2" stroke="#e2679d" stroke-width="1.4" stroke-linejoin="round">
<path d="M26 44q-13-9-17-4 6 8 15 9z"/><path d="M21 58q-14-3-17 2 8 6 17 3z"/><path d="M26 72q-12 7-14 13 10 1 17-8z"/>
<path d="M94 44q13-9 17-4-6 8-15 9z"/><path d="M99 58q14-3 17 2-8 6-17 3z"/><path d="M94 72q12 7 14 13-10 1-17-8z"/></g>
<ellipse cx="46" cy="101" rx="9" ry="5.5" fill="#e886ab"/><ellipse cx="74" cy="101" rx="9" ry="5.5" fill="#e886ab"/>
<ellipse cx="60" cy="64" rx="40" ry="38" fill="url(#${p}b)"/>
<ellipse cx="60" cy="80" rx="25" ry="17" fill="url(#${p}t)"/>
<ellipse cx="45" cy="38" rx="14" ry="9" fill="#fff" opacity=".28" transform="rotate(-18 45 38)"/>
<g class="petEye"><circle cx="47" cy="57" r="6.5" fill="#33202e"/><circle cx="49" cy="54.6" r="2.2" fill="#fff"/></g>
<g class="petEye"><circle cx="73" cy="57" r="6.5" fill="#33202e"/><circle cx="75" cy="54.6" r="2.2" fill="#fff"/></g>
<path d="M54 69q6 5 12 0" stroke="#a3406e" stroke-width="2.6" fill="none" stroke-linecap="round"/>
<circle cx="37" cy="66" r="4.5" fill="#ff7fb2" opacity=".55"/><circle cx="83" cy="66" r="4.5" fill="#ff7fb2" opacity=".55"/></svg>`;
if(index===1)return `<svg class="petSvg" viewBox="0 0 120 120" aria-hidden="true"><defs>
<radialGradient id="${p}b" cx="36%" cy="24%" r="85%"><stop offset="0%" stop-color="#ffdfb0"/><stop offset="55%" stop-color="#f5a34c"/><stop offset="100%" stop-color="#c96f22"/></radialGradient>
<radialGradient id="${p}t" cx="50%" cy="30%" r="75%"><stop offset="0%" stop-color="#fff7e8"/><stop offset="100%" stop-color="#ffd9a3"/></radialGradient></defs>
<path d="M94 92q24-2 19-24" stroke="#e08a30" stroke-width="10" fill="none" stroke-linecap="round"/>
<ellipse cx="44" cy="102" rx="10" ry="5.5" fill="#f0a54e"/><ellipse cx="76" cy="102" rx="10" ry="5.5" fill="#f0a54e"/>
<path d="M28 34 21 12q11 4 17 11z" fill="url(#${p}b)" stroke="#c96f22" stroke-width="1.6"/>
<path d="M92 34 99 12q-11 4-17 11z" fill="url(#${p}b)" stroke="#c96f22" stroke-width="1.6"/>
<path d="M30 30 27 19q5 2 8 6z" fill="#ffc9de"/><path d="M90 30 93 19q-5 2-8 6z" fill="#ffc9de"/>
<ellipse cx="60" cy="64" rx="42" ry="40" fill="url(#${p}b)"/>
<path d="M52 27q8-6 16 0M39 33q6-5 11-2M81 33q-6-5-11-2" stroke="#d97b26" stroke-width="4" fill="none" stroke-linecap="round"/>
<ellipse cx="60" cy="83" rx="26" ry="18" fill="url(#${p}t)"/>
<ellipse cx="44" cy="35" rx="13" ry="8" fill="#fff" opacity=".3" transform="rotate(-16 44 35)"/>
<g class="petEye"><ellipse cx="46" cy="58" rx="6" ry="7" fill="#3a2a1c"/><circle cx="48" cy="55.4" r="2" fill="#fff"/></g>
<g class="petEye"><ellipse cx="74" cy="58" rx="6" ry="7" fill="#3a2a1c"/><circle cx="76" cy="55.4" r="2" fill="#fff"/></g>
<path d="M57 67l3 3.4 3-3.4z" fill="#e2697f"/>
<path d="M60 71q0 4-5 4M60 71q0 4 5 4" stroke="#a35716" stroke-width="2" fill="none" stroke-linecap="round"/>
<circle cx="34" cy="67" r="4" fill="#ffb1c4" opacity=".6"/><circle cx="86" cy="67" r="4" fill="#ffb1c4" opacity=".6"/>
<path d="M18 61h13M20 69h11M102 61h-13M100 69h-11" stroke="#fff" stroke-width="1.6" opacity=".7" stroke-linecap="round"/></svg>`;
if(index===2)return `<svg class="petSvg" viewBox="0 0 120 120" aria-hidden="true"><defs>
<radialGradient id="${p}b" cx="36%" cy="22%" r="90%"><stop offset="0%" stop-color="#bcd8ff"/><stop offset="55%" stop-color="#5f83e8"/><stop offset="100%" stop-color="#33479e"/></radialGradient>
<radialGradient id="${p}t" cx="50%" cy="30%" r="75%"><stop offset="0%" stop-color="#eaf2ff"/><stop offset="100%" stop-color="#a9c2ef"/></radialGradient></defs>
<path d="M50 112v-9M56 113v-10M64 113v-10M70 112v-9" stroke="#f2b23c" stroke-width="4.4" stroke-linecap="round"/>
<path d="M30 30 23 11q10 5 15 13z" fill="url(#${p}b)"/><path d="M90 30 97 11q-10 5-15 13z" fill="url(#${p}b)"/>
<ellipse cx="60" cy="66" rx="41" ry="42" fill="url(#${p}b)"/>
<path d="M23 56q-7 23 9 35 5-18 3-35z" fill="#4360c4"/><path d="M97 56q7 23-9 35-5-18-3-35z" fill="#4360c4"/>
<ellipse cx="60" cy="83" rx="24" ry="20" fill="url(#${p}t)"/>
<path d="M42 78q18 8 36 0M42 86q18 8 36 0M47 94q13 6 26 0" stroke="#8fb0e8" stroke-width="2.4" fill="none" stroke-linecap="round"/>
<circle cx="45" cy="53" r="14" fill="#fff"/><circle cx="75" cy="53" r="14" fill="#fff"/>
<g class="petEye"><circle cx="46" cy="54" r="6.5" fill="#26314f"/><circle cx="48.4" cy="51.6" r="2.2" fill="#fff"/></g>
<g class="petEye"><circle cx="74" cy="54" r="6.5" fill="#26314f"/><circle cx="76.4" cy="51.6" r="2.2" fill="#fff"/></g>
<path d="M60 61l-5 7.5h10z" fill="#f2b23c"/>
<ellipse cx="44" cy="31" rx="12" ry="7" fill="#fff" opacity=".25" transform="rotate(-14 44 31)"/></svg>`;
if(index===3)return `<svg class="petSvg" viewBox="0 0 120 120" aria-hidden="true"><defs>
<radialGradient id="${p}b" cx="36%" cy="22%" r="88%"><stop offset="0%" stop-color="#d9f7c8"/><stop offset="55%" stop-color="#7ed07e"/><stop offset="100%" stop-color="#3f9a58"/></radialGradient>
<radialGradient id="${p}t" cx="50%" cy="30%" r="75%"><stop offset="0%" stop-color="#f4ffe9"/><stop offset="100%" stop-color="#c4ecb0"/></radialGradient></defs>
<path d="M95 88q21 4 17-19" stroke="#5cb46b" stroke-width="11" fill="none" stroke-linecap="round"/>
<ellipse cx="46" cy="103" rx="10" ry="5.5" fill="#4aa65c"/><ellipse cx="74" cy="103" rx="10" ry="5.5" fill="#4aa65c"/>
<path d="M42 24q6-14 13 0zM60 20q6-14 13 0zM78 26q6-13 13 0z" fill="#2e7d4f"/>
<ellipse cx="60" cy="64" rx="42" ry="40" fill="url(#${p}b)"/>
<ellipse cx="60" cy="77" rx="20" ry="13" fill="url(#${p}t)"/>
<circle cx="53" cy="74" r="2.2" fill="#3f7a4a"/><circle cx="67" cy="74" r="2.2" fill="#3f7a4a"/>
<path d="M52 82q8 5 16 0" stroke="#3f7a4a" stroke-width="2.4" fill="none" stroke-linecap="round"/>
<circle cx="33" cy="52" r="4" fill="#3f9a58" opacity=".7"/><circle cx="89" cy="58" r="3.6" fill="#3f9a58" opacity=".7"/><circle cx="82" cy="40" r="3" fill="#3f9a58" opacity=".7"/>
<ellipse cx="44" cy="32" rx="13" ry="8" fill="#fff" opacity=".28" transform="rotate(-14 44 32)"/>
<g class="petEye"><circle cx="46" cy="53" r="6.4" fill="#1f3b2a"/><circle cx="48" cy="50.8" r="2.2" fill="#fff"/></g>
<g class="petEye"><circle cx="74" cy="53" r="6.4" fill="#1f3b2a"/><circle cx="76" cy="50.8" r="2.2" fill="#fff"/></g>
<path d="M26 78q-7 4-3 9" stroke="#5cb46b" stroke-width="6" fill="none" stroke-linecap="round"/>
<path d="M94 78q7 4 3 9" stroke="#5cb46b" stroke-width="6" fill="none" stroke-linecap="round"/></svg>`;
return `<svg class="petSvg" viewBox="0 0 120 120" aria-hidden="true"><defs>
<radialGradient id="${p}b" cx="36%" cy="22%" r="85%"><stop offset="0%" stop-color="#efe6ff"/><stop offset="55%" stop-color="#b493ec"/><stop offset="100%" stop-color="#7a5bc4"/></radialGradient></defs>
<ellipse cx="60" cy="62" rx="52" ry="50" fill="#b493ec" opacity=".14"/>
<path d="M18 46q-7-2-7-9M102 46q7-2 7-9" stroke="#c9b2f2" stroke-width="3" fill="none" stroke-linecap="round"/>
<path d="M22 64a38 38 0 0 1 76 0v30q-7.6 9-15.2 0t-15.2 0t-15.2 0t-15.2 0t-15.2 0z" fill="url(#${p}b)"/>
<ellipse cx="45" cy="34" rx="13" ry="8" fill="#fff" opacity=".3" transform="rotate(-14 45 34)"/>
<g class="petEye"><ellipse cx="47" cy="58" rx="5.5" ry="7.5" fill="#392a5e"/><circle cx="49" cy="55.4" r="2" fill="#fff"/></g>
<g class="petEye"><ellipse cx="73" cy="58" rx="5.5" ry="7.5" fill="#392a5e"/><circle cx="75" cy="55.4" r="2" fill="#fff"/></g>
<ellipse cx="60" cy="74" rx="4.5" ry="6" fill="#392a5e"/>
<circle cx="35" cy="70" r="4.5" fill="#ff9ec6" opacity=".5"/><circle cx="85" cy="70" r="4.5" fill="#ff9ec6" opacity=".5"/>
<path d="M84 24l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#e6d9ff" opacity=".85"/>
<path d="M30 96l1.4 3.4 3.4 1.4-3.4 1.4-1.4 3.4-1.4-3.4-3.4-1.4 3.4-1.4z" fill="#e6d9ff" opacity=".6"/></svg>`;
}
function dockButton(act,label,icon){
  const b=document.createElement('button');
  b.type='button';b.className='petDockButton';b.dataset.act=act;
  b.setAttribute('aria-label',label);b.title=label;
  b.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>`;
  return b;
}
// Eight individual transparent illustrations; saved petKind numbers remain 0–7.
const SPACE_PETS=[
  {name:'太空兔宇航员',image:'space-rabbit-3d-v2.png'},
  {name:'星际机器人',image:'space-robot-3d-v2.png'},
  {name:'探测车宝宝',image:'space-rover-3d-v1.png'},
  {name:'陨石宝宝',image:'space-meteor-3d-v1.png'},
  {name:'彗星宝宝',image:'space-comet-3d-v1.png'},
  {name:'土星宝宝',image:'space-saturn-3d-v2.png'},
  {name:'水晶精灵',image:'space-crystal-3d-v1.png'},
  {name:'星云幽灵',image:'space-ghost-3d-v2.png'}
];
function spacePetMarkup(kind,key){
  return `<image href="${companionArtworkUrl(kind)}" x="0" y="0" width="160" height="160" preserveAspectRatio="xMidYMax meet"/>`;
}
function companionArtworkUrl(kind){const pet=SPACE_PETS[kind]||SPACE_PETS[0];return '/assets/icons/crypto/'+pet.image.replace('space-','space').replace(/-3d-v\d+/,'')+'?v=20261012-crystal43'}
function warmCompanionArtwork(){
  if(companionWarmScheduled||!(window.MarketDevice?.isMobile?.()??window.innerWidth<=720))return;companionWarmScheduled=true;
  let index=0;
  const next=()=>{
    if(document.documentElement.classList.contains('bootLoading')){setTimeout(next,500);return}
    if(index>=SPACE_PETS.length)return;
    const image=new Image();image.fetchPriority='low';image.decoding='async';image.onload=image.onerror=()=>{setTimeout(next,100)};image.src=companionArtworkUrl(index++);
  };
  if(window.requestIdleCallback)window.requestIdleCallback(next,{timeout:2000});else setTimeout(next,1200);
}
// 眼睛位置以原插画 160×160 坐标记录；表情覆盖层随人物变换，不新增图片。
const PET_FACE_PROFILES=[
 {eyes:[[69,73,10,10],[98,73,10,10]],skin:'#ece2d8',moods:['happy','curious']},
 {eyes:[[61,58,14,13],[106,69,14,13]],skin:'#eee4d3',moods:['focused','happy']},
 {eyes:[[67,35,11,12],[101,49,12,12]],skin:'#e4d7ae',moods:['focused','curious']},
 {eyes:[[60,69,12,13],[99,77,12,13]],skin:'#777380',moods:['happy','surprised']},
 {eyes:[[47,82,13,15],[85,94,14,15]],skin:'#ffc649',moods:['excited','focused']},
 {eyes:[[60,59,14,9],[108,68,14,9]],skin:'#ffcf8a',moods:['excited','serene']},
 {eyes:[[60,72,13,14],[103,80,14,15]],skin:'#bda0ee',moods:['excited','focused']},
 {eyes:[[107,63,13,14]],skin:'#e2cef3',moods:['wink','happy']}
];
function petExpressionMarkup(kind,key){
 const profile=PET_FACE_PROFILES[kind]||PET_FACE_PROFILES[0],stroke=kind===3?'#251f36':'#30233d';
 const lid=key+'lid';
 const defs='<defs><radialGradient id="'+lid+'"><stop offset="0" stop-color="'+profile.skin+'"/><stop offset=".72" stop-color="'+profile.skin+'"/><stop offset="1" stop-color="'+profile.skin+'" stop-opacity="0"/></radialGradient></defs>';
 const preserveEyes=kind===4||kind===6;
 const closed=preserveEyes?'':profile.eyes.map(([x,y,rx,ry])=>'<ellipse cx="'+x+'" cy="'+y+'" rx="'+(rx+5)+'" ry="'+(ry+5)+'" fill="url(#'+lid+')"/><path d="M '+(x-rx*.75)+' '+(y+1)+' Q '+x+' '+(y-7)+' '+(x+rx*.75)+' '+(y+1)+'" fill="none" stroke="'+stroke+'" stroke-width="2.6" stroke-linecap="round"/>').join('');
 const focused=profile.eyes.map(([x,y,rx,ry],index)=>{
   const clip=key+'eye'+index;
   if(preserveEyes)return '<defs><clipPath id="'+clip+'"><ellipse cx="'+x+'" cy="'+y+'" rx="'+rx+'" ry="'+ry+'"/></clipPath></defs><g clip-path="url(#'+clip+')"><ellipse cx="'+x+'" cy="'+y+'" rx="'+(rx*.85)+'" ry="'+(ry*.85)+'" fill="none" stroke="#e5f6ff" stroke-opacity=".65" stroke-width=".8"/></g>';
   return '<defs><clipPath id="'+clip+'"><ellipse cx="'+x+'" cy="'+y+'" rx="'+(rx*.83)+'" ry="'+(ry*.85)+'"/></clipPath></defs><g clip-path="url(#'+clip+')"><path d="M '+(x-rx)+' '+(y-ry-2)+' H '+(x+rx)+' V '+(y-2)+' Q '+x+' '+(y+2)+' '+(x-rx)+' '+(y-2)+' Z" fill="#17354c"/><path d="M '+(x-rx)+' '+(y-2)+' Q '+x+' '+(y+2)+' '+(x+rx)+' '+(y-2)+'" fill="none" stroke="#91e5ed" stroke-opacity=".7" stroke-width="1.2"/></g>';
 }).join('');
 const brows=profile.eyes.map(([x,y,rx,ry])=>'<path d="M '+(x-rx*.7)+' '+(y-ry-5)+' Q '+x+' '+(y-ry-11)+' '+(x+rx*.7)+' '+(y-ry-5)+'" fill="none" stroke="'+stroke+'" stroke-width="2" stroke-linecap="round"/>').join('');
 return defs+'<g class="petExpression" aria-hidden="true"><g class="petMoodHappy">'+closed+'</g><g class="petMoodFocused">'+focused+'</g><g class="petMoodCurious">'+brows+'</g><g class="petMoodSpark"><path d="m 126 30 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z M 31 47 1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5Z" fill="#fff3a9" stroke="#f4d279" stroke-width=".5"/></g><g class="petMoodQuestion"><text x="127" y="42" fill="#d8faff" stroke="#344f6d" stroke-width=".6" paint-order="stroke" font-size="23" font-weight="700">?</text></g><g class="petMoodSurprised"><text x="124" y="42" fill="#fff2b4" stroke="#655431" stroke-width=".6" paint-order="stroke" font-size="24" font-weight="700">!</text></g></g>';
}
const PET_ACTION_SCENES=['moon','console','sand','rock','starlight','orbit','crystal','nebula'];
function petActionSceneMarkup(kind,index){
 const key='petScene'+index,colors=[['#c1c6cf','#596170'],['#418391','#112d47'],['#e1b476','#8e5a35'],['#82757c','#352f42'],['#e7b46a','#564173'],['#abb2e2','#454f87'],['#a49fea','#4b437f'],['#aa8dd5','#463767']][kind]||['#c1c6cf','#596170'];
 const terrain=[
  '<g fill="#4e5563" stroke="#e4e8ed" stroke-opacity=".4"><ellipse cx="52" cy="61" rx="12" ry="4"/><ellipse cx="107" cy="69" rx="9" ry="3"/><ellipse cx="92" cy="51" rx="7" ry="2.5"/></g><path d="m33 74 11-2m78-14 9 1" stroke="#d8dbe0" stroke-opacity=".7"/>',
  '<g stroke="#82f3ec" stroke-width="1" opacity=".8"><path d="M26 65h24l10-10h23m-11 22h22l13-13h23M45 49h18m42 4h16"/><circle cx="83" cy="55" r="2"/><circle cx="72" cy="77" r="2"/></g>',
  '<g stroke="#684222" stroke-width="2" stroke-linecap="round" opacity=".75"><path d="m39 46 32 33m21-33 31 30" stroke-dasharray="2 3"/><path d="m44 44 32 33m22-33 31 30" stroke-dasharray="2 3"/></g><path d="M24 69q16-10 32-2m45-14q14-4 27 2" stroke="#f4d69f" stroke-width="1.5" fill="none"/>',
  '<path d="m28 63 22-4 14 10 16-13 13 7 24-10 15 8M65 78l7-9m32 8-11-14" stroke="#e5a96a" stroke-width="1.5" fill="none"/><path d="m42 51 10-7 8 8-5 6Z M114 69l7-7 9 6-4 7Z" fill="#534656" stroke="#998596"/>',
  '<g fill="#ffebad"><path d="m45 54 2-5 2 5 5 2-5 2-2 5-2-5-5-2Z m62 13 1.5-4 1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5Z"/><circle cx="86" cy="51" r="1.5"/></g><path d="M30 75q36-19 99-11" stroke="#ffd58a" stroke-width="2" opacity=".5" fill="none"/>',
  '<g fill="none" stroke="#d7d0ff"><ellipse class="petSceneOrbit" cx="80" cy="61" rx="57" ry="19"/><ellipse cx="80" cy="61" rx="43" ry="14" stroke-dasharray="5 5"/></g><circle cx="27" cy="68" r="3" fill="#fff0ab"/>',
  '<g stroke="#e7deff" stroke-width=".8"><path d="M38 68 44 47 55 59 52 74Z" fill="#a7b4ef"/><path d="m106 72 3-25 14 12-4 16Z" fill="#be9fe8"/><path d="m67 73 11-26 14 21-9 11Z" fill="#776dc3"/></g>',
  '<g class="petSceneMist" fill="none" stroke="#d6b9ff" stroke-opacity=".7" stroke-width="3"><path d="M24 64q21-13 45-1t65-1M35 75q23-9 42-1t42-2"/></g>'
 ][kind]||'';
 const dust=kind===0||kind===2?'<g class="petSceneDust" fill="'+(kind===2?'#e8c797':'#d6dce5')+'" opacity=".6"><ellipse cx="39" cy="65" rx="10" ry="3"/><ellipse cx="124" cy="66" rx="11" ry="3"/><circle cx="29" cy="59" r="2"/><circle cx="131" cy="58" r="1.5"/></g>':'';
 return `<svg viewBox="0 0 160 90" fill="none" aria-hidden="true"><defs><linearGradient id="${key}" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient></defs><ellipse cx="80" cy="65" rx="68" ry="23" fill="${colors[1]}"/><ellipse cx="80" cy="61" rx="68" ry="23" fill="url(#${key})" stroke="${colors[0]}" stroke-width="1.1"/>${terrain}${dust}</svg>`;
}
function renderPetArtwork(slot,kind){
  const island=slot.querySelector('.petIsland');
  if(island&&island.dataset.sceneKind!==String(kind)){
    let scene=island.querySelector('.petActionScene');if(!scene){scene=document.createElement('span');scene.className='petActionScene';scene.setAttribute('aria-hidden','true');island.append(scene)}
    scene.innerHTML=petActionSceneMarkup(kind,slot.dataset.index);island.dataset.sceneKind=String(kind);
  }
  const model=slot.querySelector('.petModel');if(!model||model.dataset.artKind===String(kind))return;
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.classList.add('petArtwork');svg.setAttribute('viewBox','0 0 160 160');svg.setAttribute('preserveAspectRatio','xMidYMax meet');svg.setAttribute('aria-hidden','true');
  svg.innerHTML=spacePetMarkup(kind,'space'+slot.dataset.index+'-')+petExpressionMarkup(kind,'expression'+slot.dataset.index+'-');model.replaceChildren(svg);model.dataset.artKind=String(kind);
}
// 八种伙伴各有两种随机全身动作；不更换图片，不启动逐帧 JS 循环。
const PET_RANDOM_ACTIONS=[
  [{name:'轻跳',duration:1100,poses:['translateY(2px) scale(1.05,.95)','translateY(-13px) scale(.98,1.03)','translateY(0) scale(1.04,.96)']},
   {name:'好奇歪头',duration:1500,poses:['rotate(-8deg)','rotate(6deg)','rotate(-3deg)']}],
  [{name:'左右扫描',duration:1800,poses:['rotateY(-28deg) rotate(-6deg)','rotateY(30deg) rotate(6deg)','rotateY(-8deg)']},
   {name:'机械点头',duration:1300,poses:['translateY(3px) rotateX(14deg)','translateY(-2px) rotateX(-8deg)','rotateX(6deg)']}],
  [{name:'短程巡游',duration:1900,poses:['translateX(-13px) rotate(-5deg)','translateX(14px) rotate(5deg)','translateX(-3px)']},
   {name:'越过小坡',duration:1500,poses:['rotate(-7deg) translateY(-3px)','rotate(6deg) translateY(-5px)','rotate(-2deg)']}],
  [{name:'陨石翻滚',duration:2100,poses:['rotate(-14deg)','rotate(18deg) translateY(-5px)','rotate(-6deg)']},
   {name:'失重弹浮',duration:1800,poses:['translateY(-9px) rotate(7deg)','translateY(-3px) rotate(-9deg)','translateY(-5px) rotate(3deg)']}],
  [{name:'彗星掠过',duration:1700,poses:['translate(-7px,4px) rotate(-9deg)','translate(11px,-10px) rotate(8deg)','translate(3px,-3px) rotate(2deg)']},
   {name:'弧线游动',duration:2100,poses:['translate(8px,-5px) rotate(10deg)','translate(-8px,-8px) rotate(-8deg)','translate(-3px,-2px)']}],
  [{name:'星环倾转',duration:2300,poses:['rotate(-11deg) rotateY(-15deg)','rotate(12deg) rotateY(16deg)','rotate(-4deg)']},
   {name:'轨道浮游',duration:2400,poses:['translate(5px,-7px) rotate(6deg)','translate(-6px,-3px) rotate(-7deg)','translate(2px,-2px)']}],
  [{name:'水晶折转',duration:1900,poses:['rotateY(-32deg) rotate(-6deg) scale(1.06)','rotateY(32deg) rotate(7deg) scale(1.1)','rotateY(-8deg) scale(1.01)']},
   {name:'悬浮蓄能',duration:2000,poses:['translateY(-4px) scale(.97)','translateY(-11px) scale(1.07)','translateY(-3px) scale(1.02)']}],
  [{name:'幽灵探身',duration:2200,poses:['translate(-7px,-5px) rotate(-7deg)','translate(8px,-9px) rotate(8deg)','translate(-2px,-3px)']},
   {name:'柔软伸展',duration:1800,poses:['scale(.94,1.06) translateY(-6px)','scale(1.06,.95) rotate(4deg)','scale(.98,1.02)']}]
];
function choosePetRandomAction(kind,lastName,random=Math.random){
  const choices=(PET_RANDOM_ACTIONS[kind]||PET_RANDOM_ACTIONS[0]).filter(action=>action.name!==lastName);
  return choices[Math.min(choices.length-1,Math.floor(random()*choices.length))];
}
function setupPetRandomActions(){
  if(setupPetRandomActions.started)return;setupPetRandomActions.started=true;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)'),previous=new WeakMap();
  let timer=null,animation=null,activeModel=null,activeSlot=null,lastSlot=null,quietUntil=0;
  function stop(){clearTimeout(timer);timer=null;animation?.cancel();animation=null;if(activeModel)delete activeModel.dataset.petMood;activeModel=null;if(activeSlot)delete activeSlot.dataset.actionScene;activeSlot=null}
  function visible(){return !document.hidden&&!reduced.matches&&petHomeOn&&!$('petHome')?.hidden
    &&!document.documentElement.classList.contains('bootLoading')&&(!$('petDeck')||$('petDeck').hidden)&&(!$('petManager')||$('petManager').hidden)
    &&!document.querySelector('dialog[open]')&&(window.MarketDevice?.isMobile?.()??window.innerWidth<=720)}
  function schedule(delay=2800+Math.random()*3000){
    clearTimeout(timer);if(document.hidden||reduced.matches)return;timer=setTimeout(play,delay);
  }
  function play(){
    timer=null;if(!visible()||Date.now()<quietUntil){schedule(1200);return}
    const slots=[...($('petStage')?.children||[])].filter(slot=>slot.dataset.groupId
      &&!slot.classList.contains('petHolding')&&!slot.classList.contains('petDragging'));
    const candidates=slots.filter(slot=>slot!==lastSlot),pool=candidates.length?candidates:slots;
    const slot=pool[Math.floor(Math.random()*pool.length)],model=slot?.querySelector('.petModel');
    if(!model?.animate){schedule();return}
    const kind=Number(slot.dataset.petKind),action=choosePetRandomAction(kind,previous.get(slot));
    previous.set(slot,action.name);lastSlot=slot;activeModel=model;activeSlot=slot;slot.dataset.actionScene=PET_ACTION_SCENES[kind]||'moon';
    model.dataset.petMood=PET_FACE_PROFILES[kind]?.moods[(PET_RANDOM_ACTIONS[kind]||PET_RANDOM_ACTIONS[0]).indexOf(action)]||'happy';
    const frames=['none',...action.poses,'none'].map(transform=>({transform:transform.replace(/(-?[\d.]+)px/g,(_,n)=>Number(n)*1.6+'px').replace(/(-?[\d.]+)deg/g,(_,n)=>Number(n)*1.3+'deg')}));
    const rig=slot.querySelector('.petRig')||model;
    const current=rig.animate(frames,{duration:action.duration*(.9+Math.random()*.2),easing:'ease-in-out',iterations:1,fill:'none'});
    animation=current;
    current.finished.catch(()=>{}).finally(()=>{if(animation===current){animation=null;delete model.dataset.petMood;delete slot.dataset.actionScene;activeModel=null;activeSlot=null;schedule()}});
  }
  const interrupt=()=>{quietUntil=Date.now()+3000;stop();schedule()};
  document.addEventListener('pointerdown',interrupt,{capture:true,passive:true});
  document.addEventListener('keydown',interrupt,{capture:true});
  document.addEventListener('visibilitychange',()=>{stop();if(!document.hidden)schedule(1200)});
  reduced.addEventListener?.('change',()=>{stop();if(!reduced.matches)schedule()});
  // 弹窗、翻牌或分组管理由点击触发，点击立即取消当前动作。
  window.addEventListener('pagehide',stop);
  schedule(1200);
}
function petVacancyMarkup(index){
  const key='vacancyHolo'+index;
  return `<svg class="petVacancyLight" viewBox="0 0 160 130" fill="none" aria-hidden="true">
   <defs>
    <linearGradient id="${key}Beam" x1="80" y1="0" x2="80" y2="104" gradientUnits="userSpaceOnUse"><stop stop-color="#49e8df" stop-opacity="0"/><stop offset=".45" stop-color="#4cefe9" stop-opacity=".06"/><stop offset="1" stop-color="#42efe5" stop-opacity=".35"/></linearGradient>
    <radialGradient id="${key}Core"><stop stop-color="#69fff0" stop-opacity=".6"/><stop offset=".62" stop-color="#2ee9df" stop-opacity=".3"/><stop offset="1" stop-color="#27d9d7" stop-opacity=".05"/></radialGradient>
    <filter id="${key}Glow" x="-30%" y="-50%" width="160%" height="200%"><feGaussianBlur stdDeviation="2.6"/></filter>
   </defs>
   <path class="petVacancyBeam" d="M 16 3 H 144 L 113 97 Q 80 110 47 97 Z" fill="url(#${key}Beam)"/>
   <g stroke="#43f6e9" filter="url(#${key}Glow)" opacity=".62"><ellipse cx="80" cy="99" rx="58" ry="23" stroke-width="5"/><ellipse cx="80" cy="96" rx="40" ry="16" stroke-width="3"/></g>
   <ellipse cx="80" cy="97" rx="43" ry="17" fill="url(#${key}Core)"/>
   <g stroke="#57fff0" stroke-linecap="butt">
    <ellipse cx="80" cy="101" rx="66" ry="26" pathLength="100" stroke-dasharray="19 5 13 6 17 8 24 8" stroke-dashoffset="4" stroke-width="4.5"/>
    <ellipse cx="80" cy="98" rx="57" ry="22" stroke-width="1.8" opacity=".9"/>
    <ellipse cx="80" cy="97" rx="49" ry="20" pathLength="100" stroke-dasharray="35 9 37 19" stroke-dashoffset="12" stroke-width="5" opacity=".92"/>
    <ellipse cx="80" cy="96" rx="39" ry="16" stroke-width="1.8"/>
    <ellipse cx="80" cy="96" rx="39" ry="16" pathLength="100" stroke-dasharray=".55 1.15" stroke-width="2.4" opacity=".75"/>
   </g>
  </svg>`;
}
const PET_LORE_TEXTS=[
 '月面的轻跳探险家，爱歪头观察新朋友。每一次出发，都带着满满好奇。',
 '沉稳的星际小助手，左右扫描、认真点头，用自己的节奏认识世界。',
 '热爱沙地巡游的小车，越过小坡、留下车辙，带你探索下一段旅程。',
 '来自远方的陨石伙伴，外表坚硬、笑容温暖，偶尔享受失重的小翻滚。',
 '拖着金蓝色尾光的彗星，沿弧线穿行，为旅途留下一点星光。',
 '总是笑眯眯的土星宝宝，带着自己的星环，悠然游过宁静轨道。',
 '折射紫色光芒的水晶精灵，在安静中蓄能，转身时闪出新的光彩。',
 '柔软又俏皮的星云幽灵，爱探身打招呼，也会悄悄送你一个眨眼。'
];
// Fictional companion world data, independent of account and market data.
const PET_WORLD_PROFILES=[
 {height:'1.65 m',weight:'42 kg',origin:'静海月面',role:'月面探险家',skill:'低重力跳跃',temper:'好奇 · 活泼',color:'#93dcd6'},
 {height:'2.4 m',weight:'380 kg',origin:'轨道维修站',role:'星际工程师',skill:'雷达扫描',temper:'专注 · 可靠',color:'#dcc590'},
 {height:'1.8 m',weight:'1.6 t',origin:'赤砂行星',role:'沙地巡游者',skill:'全地形探索',temper:'勇敢 · 热情',color:'#d5b586'},
 {height:'1.2 km',weight:'36 亿 t',origin:'小行星带',role:'星岩守护者',skill:'失重翻滚',temper:'温暖 · 坚定',color:'#a7b6c9'},
 {height:'8.6 km',weight:'120 亿 t',origin:'蓝金彗星带',role:'星光信使',skill:'弧线冲刺',temper:'灵巧 · 开朗',color:'#f2ce78'},
 {height:'12,000 km',weight:'4.8 × 10²⁴ kg',origin:'环星花园',role:'轨道漫游者',skill:'星环回旋',temper:'悠然 · 友善',color:'#e4c48e'},
 {height:'3.6 m',weight:'2.8 t',origin:'紫晶星窟',role:'光能收藏家',skill:'水晶共鸣',temper:'安静 · 敏锐',color:'#c5adee'},
 {height:'24 m',weight:'随星雾变化',origin:'薄雾星云',role:'星云旅伴',skill:'雾中漂浮',temper:'俏皮 · 温柔',color:'#afbfe9'}
];
function petLoreArtworkUrl(kind){
 return companionArtworkUrl(kind).replace('/space','/lore').replace(/\?.*$/,'?v=20261012-info-static89');
}
// Normalized cells keep every view at the same scale and reuse one decoded atlas.
const petTurntableLoads=new Map();
function disposePetWorldModel(dialog){
 dialog.roverGeneration=(dialog.roverGeneration||0)+1;
 dialog.roverViewer?.dispose();dialog.roverViewer=null;delete dialog.dataset.model;
}
function loadPetWorldVisual(dialog,kind){disposePetWorldModel(dialog);loadPetTurntable(dialog,kind)}
const PET_TURNTABLE_ROWS=[[0,230],[230,450],[450,623],[623,800],[0,214],[214,394],[394,592],[592,800]];
function petTurntableUrl(kind){return '/assets/icons/crypto/turn16'+(kind<4?'a':'b')+'.png?v=20261012-glass16-93'}
function loadPetTurntable(dialog,kind){
 const generation=dialog.roverGeneration,url=petTurntableUrl(kind);dialog.dataset.turntable='loading';
 const status=dialog.querySelector('.petWorldTurnStatus');if(status)status.textContent='正在准备旋转视图';
 let loading=petTurntableLoads.get(url);
 if(!loading){loading=new Promise((resolve,reject)=>{const image=new Image();image.decoding='async';image.onload=()=>{Promise.resolve(image.decode?.()).then(()=>resolve(url),reject)};image.onerror=()=>reject(new Error('turntable'));image.src=url});petTurntableLoads.set(url,loading);loading.catch(()=>petTurntableLoads.delete(url))}
 loading.then(()=>{
  if(Number(dialog.dataset.kind)!==kind||dialog.roverGeneration!==generation)return;
  const sprite=dialog.querySelector('.petWorldTurntable');sprite.style.backgroundImage='none';sprite.dataset&&(sprite.dataset.renderFrame='');
  dialog.dataset.turntable='ready';if(status)status.textContent=dialog.dataset.model==='error'?'已显示图片，点此重试':'';setPetWorldAngle(dialog,Number(dialog.dataset.viewAngle)||0);
 }).catch(()=>{if(Number(dialog.dataset.kind)!==kind||dialog.roverGeneration!==generation)return;dialog.dataset.turntable='error';if(status)status.textContent='旋转视图加载失败，点此重试'});
}
function setPetWorldAngle(dialog,angle){
 const yaw=Number.isFinite(Number(angle))?Number(angle):0;
 const turn=((yaw%360)+360)%360,frame=Math.round(turn/22.5)%16,kind=Number(dialog.dataset.kind)||0;
 dialog.dataset.viewAngle=String(yaw);dialog.dataset.viewFrame=String(frame);
 const sprite=dialog.querySelector('.petWorldTurntable');
 if(sprite){
  const renderKey='atlas16:'+kind;
  if(!sprite.dataset||sprite.dataset.renderFrame!==renderKey){
   if(sprite.dataset)sprite.dataset.renderFrame=renderKey;
   sprite.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><defs><clipPath id="petWorldViewClip"><rect width="200" height="200"/></clipPath></defs><g clip-path="url(#petWorldViewClip)"><image class="petWorldRoverFrame petWorldAtlasFrame" href="'+petTurntableUrl(kind)+'" x="-'+frame*200+'" y="-'+(kind%4)*200+'" width="3200" height="800"/></g></svg>';
  }
  sprite.querySelector?.('.petWorldRoverFrame')?.setAttribute('x',String(-frame*200));
 }
 dialog.style.setProperty('--world-light-x',(50-Math.sin(turn*Math.PI/180)*24).toFixed(2)+'%');
 dialog.style.setProperty('--world-reflection-x',(Math.sin(turn*Math.PI/180)*6).toFixed(2)+'px');
}
function setupPetWorldRotation(dialog){
 const display=dialog.querySelector('.petGlassCase');let press=null,frame=0,nextAngle=0;
 display.tabIndex=0;display.setAttribute('role','group');display.setAttribute('aria-label','圆柱培养舱，左右拖动或使用方向键旋转360度查看背面');
 const paint=()=>{frame=0;setPetWorldAngle(dialog,nextAngle)};
 const finish=event=>{
  if(!press||(event?.pointerId!=null&&event.pointerId!==press.id))return;const id=press.id;press=null;
  try{display.releasePointerCapture(id)}catch{}
  if(frame){cancelAnimationFrame(frame);paint()}
  display.classList.remove('petWorldTurning');
 };
 display.addEventListener('pointerdown',event=>{
  if(!event.isPrimary||event.button!==0||press)return;
  event.preventDefault?.();event.stopPropagation?.();
  press={id:event.pointerId,x:event.clientX,angle:Number(dialog.dataset.viewAngle)||0};
  try{display.setPointerCapture(event.pointerId)}catch{}
  display.classList.add('petWorldTurning');
 });
 display.addEventListener('pointermove',event=>{
  if(!press||press.id!==event.pointerId)return;
  event.preventDefault?.();event.stopPropagation?.();
  nextAngle=press.angle+(event.clientX-press.x)*1.2;
  if(!frame)frame=requestAnimationFrame(paint);
 });
 display.addEventListener('pointerup',finish);display.addEventListener('pointercancel',finish);display.addEventListener('lostpointercapture',finish);
 dialog.addEventListener('close',()=>finish());
 display.addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight','Home'].includes(event.key))return;
  event.preventDefault();setPetWorldAngle(dialog,event.key==='Home'?0:Number(dialog.dataset.viewAngle||0)+(event.key==='ArrowLeft'?-45:45));
 });
 const status=dialog.querySelector('.petWorldTurnStatus');if(status)status.onclick=()=>{if(dialog.dataset.turntable==='error')loadPetTurntable(dialog,Number(dialog.dataset.kind)||0)};
}
function openPetWorld(kind){
 const pet=SPACE_PETS[kind],profile=PET_WORLD_PROFILES[kind];if(!pet||!profile)return;
 let dialog=$('petWorldDialog');
 if(!dialog){
  dialog=document.createElement('dialog');dialog.id='petWorldDialog';dialog.className='detailDialog petWorldDialog';dialog.setAttribute('aria-label','伙伴世界');
  const head=document.createElement('header');head.className='mobilePageHeader';
  const back=document.createElement('button');back.type='button';back.className='mobilePageBack';back.setAttribute('aria-label','返回图鉴');back.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 5 8.5 12 15.5 19"/></svg>';back.onclick=()=>dialog.close();
  const title=document.createElement('strong');title.className='mobilePageTitle';title.textContent='伙伴世界';head.append(back,title);
  const body=document.createElement('section');body.className='petWorldBody';
  body.innerHTML='<div class="petWorldExhibit"><div class="petWorldStars" aria-hidden="true"></div><div class="petGlassCase"><div class="petWorldOrbit" aria-hidden="true"></div><div class="petGlassRoof"></div><div class="petGlassWall"></div><img class="petCylinderArtwork" src="/assets/icons/crypto/cryotank.png?v=20261012-cylinder90" alt="" aria-hidden="true" decoding="async"><div class="petWorldSubject"><div class="petWorldTurntable" aria-hidden="true"></div><img class="petWorldCharacter" width="320" height="320" alt="" draggable="false"></div><div class="petGlassFloor"></div><div class="petGlassHalo" aria-hidden="true"></div><div class="petGlassBase"><span>ORBIT · SANCTUARY</span></div><div class="petGlassReflection"></div></div><p class="petWorldPlaque"></p><button type="button" class="petWorldTurnStatus" aria-live="polite"></button></div><div class="petWorldInfo"><span class="petWorldEyebrow">ORBIT ARCHIVE</span><h2></h2><p class="petWorldStory"></p><dl class="petWorldStats"></dl><p class="petWorldFiction">星轨世界观 · 本体尺度设定，展舱为等比例缩影</p></div>';
  dialog.append(head,body);document.body.append(dialog);setupPetWorldRotation(dialog);
 }
 disposePetWorldModel(dialog);dialog.dataset.kind=String(kind);dialog.style.setProperty('--world-accent',profile.color);
 dialog.querySelector('.petWorldCharacter').src=companionArtworkUrl(kind);dialog.querySelector('.petWorldCharacter').alt=pet.name;
 dialog.querySelector('.petWorldPlaque').textContent=profile.role;setPetWorldAngle(dialog,0);
 dialog.querySelector('h2').textContent=pet.name;dialog.querySelector('.petWorldStory').textContent=PET_LORE_TEXTS[kind];
 const stats=dialog.querySelector('.petWorldStats');stats.replaceChildren();
 for(const [label,value] of [[kind===3?'本体高度':kind===4||kind===5?'本体直径':'身高',profile.height],['质量',profile.weight],['来自',profile.origin],['身份',profile.role],['专长',profile.skill],['性格',profile.temper]]){
  const cell=document.createElement('div'),term=document.createElement('dt'),description=document.createElement('dd');term.textContent=label;description.textContent=value;cell.append(term,description);stats.append(cell);
 }
 dialog.querySelector('.petWorldBody').scrollTop=0;openDetailDialog(dialog);loadPetWorldVisual(dialog,kind);
}
function openPetLore(){
 let dialog=$('petLoreDialog');
 if(dialog?.open)return;
 if(!dialog){
  dialog=document.createElement('dialog');dialog.id='petLoreDialog';dialog.className='detailDialog petLoreDialog';dialog.setAttribute('aria-label','星轨伙伴图鉴');
  const scroll=document.createElement('section');scroll.className='petLoreScroll';
  const intro=document.createElement('header');intro.className='petLoreIntro';intro.innerHTML='<span>ORBIT · 星际档案</span><h2>星轨伙伴图鉴</h2><p>展开这卷星际手札，认识陪你出发的伙伴。</p>';
  const grid=document.createElement('div');grid.className='petLoreGrid';
  SPACE_PETS.forEach((pet,kind)=>{
   const article=document.createElement('button');article.type='button';article.className='petLoreEntry';article.setAttribute('aria-label','查看'+pet.name+'档案');article.onclick=()=>openPetWorld(kind);
   const image=document.createElement('img');image.alt=pet.name;image.width=160;image.height=160;image.loading='lazy';image.decoding='async';image.fetchPriority='low';image.src=petLoreArtworkUrl(kind);
   const title=document.createElement('h3');title.textContent=pet.name;
   const text=document.createElement('p');text.textContent=PET_LORE_TEXTS[kind];article.append(image,title,text);grid.append(article);
  });
  const soon=document.createElement('article');soon.className='petLoreEntry petLoreSoon';soon.innerHTML='<span class="petLoreMystery" aria-hidden="true">✧</span><h3>新的伙伴 · 敬请期待</h3><p>更多神秘身影，等待在下一段星际旅程中与你相遇。</p>';grid.append(soon);
  const paper=document.createElement('div');paper.className='petLorePaper';paper.append(intro,grid);
  const viewport=document.createElement('div');viewport.className='petLoreViewport';viewport.tabIndex=0;viewport.setAttribute('role','region');viewport.setAttribute('aria-label','卷轴内容，上下滑动阅读');viewport.append(paper);
  for(const end of ['Top','Bottom']){
   const roller=document.createElement('div');roller.className='petLoreRoll petLoreRoll'+end;roller.setAttribute('aria-hidden','true');roller.innerHTML='<span class="petLoreRollGrain"></span>';scroll.append(roller);
  }
  scroll.append(viewport);
  let rollFrame=0;
  viewport.addEventListener('scroll',()=>{
   if(rollFrame)return;
   rollFrame=requestAnimationFrame(()=>{
    rollFrame=0;if(!dialog.open)return;
    scroll.style.setProperty('--paper-feed',(-viewport.scrollTop)+'px');
    scroll.style.setProperty('--roll-progress',String(viewport.scrollTop/Math.max(1,viewport.scrollHeight-viewport.clientHeight)));
   });
  },{passive:true});
  dialog.addEventListener('close',()=>{if(rollFrame)cancelAnimationFrame(rollFrame);rollFrame=0});
  dialog.append(scroll);document.body.append(dialog);
 }
 openDetailDialog(dialog);
}
function openPetHelp(){
  let dialog=$('petHelpDialog');
  if(!dialog){
    dialog=document.createElement('dialog');dialog.id='petHelpDialog';dialog.className='detailDialog petHelpDialog';dialog.setAttribute('aria-label','使用指南');
    const panel=document.createElement('section');panel.className='petHelpPanel';
    const head=document.createElement('header');head.className='mobilePageHeader';
    const title=document.createElement('strong');title.className='mobilePageTitle';title.textContent='使用指南';
    const close=document.createElement('button');close.type='button';close.className='mobilePageBack';close.setAttribute('aria-label','返回');close.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 5 8.5 12 15.5 19"/></svg>';close.onclick=()=>{if(window.MarketMobilePages?.back)window.MarketMobilePages.back();else returnToPetHome()};head.append(close,title);
    const intro=document.createElement('p');intro.className='petHelpIntro';intro.textContent='从一个伙伴开始，把关注的标的装进卡兜。';
    const list=document.createElement('ol');list.className='petHelpSteps';
    for(const [label,text] of [
      ['进入分组','单击伙伴看卡牌，双击管理分组。单击空位新建分组。'],
      ['添加标的','卡兜里点“＋”，搜索代码或名称，再点候选添加。'],
      ['浏览卡牌','左右滑动切换标的，下方数字显示卡牌进度。'],
      ['查看资料与图表','点 Logo 看资料，点走势图看 K 线并选择周期。'],
      ['整理卡兜','拖动调整顺序，拖出卡兜松手移除；松手前拖回可保留。'],
      ['阅读新闻','点“新闻”，搜索选择标的；空输入可浏览热门推荐。']
    ]){
      const item=document.createElement('li'),name=document.createElement('h3'),body=document.createElement('p');name.textContent=label;
      for(const part of text.split(/(双击|单击|左右滑动|拖动|松手|自动出现)/)){
        if(!part)continue;
        const fragment=document.createElement('span');fragment.textContent=part;
        if(/^(双击|单击|左右滑动|拖动|松手|自动出现)$/.test(part))fragment.className='petHelpAction '+(part==='单击'?'petHelpTap':part==='双击'?'petHelpDoubleTap':'petHelpMotion');
        body.append(fragment);
      }
      item.append(name,body);list.append(item);
    }
    panel.append(intro,list);dialog.append(head,panel);document.body.append(dialog);
  }
  openDetailDialog(dialog);
}
function installPetHelpEntry(newsButton){
  const button=document.createElement('button');button.id='petHomeHelp';button.className='petHomeHelp';button.type='button';button.setAttribute('aria-label','打开使用指南');
  button.innerHTML='<svg viewBox="0 0 40 40" aria-hidden="true"><circle class="petGuideHalo" cx="20" cy="20" r="17" fill="none" stroke="#a8dbe0" stroke-opacity=".35"/><circle cx="20" cy="20" r="13" fill="#162b39" stroke="#d6b579" stroke-width="1.4"/><path d="M20 5v3m0 24v3M5 20h3m24 0h3" stroke="#d6b579" stroke-width="1.4" stroke-linecap="round"/><g class="petGuideNeedle"><path d="m20 9 5 11-5 11-5-11Z" fill="#a4dce0"/><path d="m20 9 5 11h-10Z" fill="#eed2a0"/><circle cx="20" cy="20" r="2" fill="#f7e5bd"/></g><circle class="petGuideStar" cx="32" cy="8" r="2" fill="#c9ecea"/></svg><span>指南</span>';
  button.onclick=openPetHelp;newsButton.after(button);
}
function renderHomeAccountBadge(){
  const button=$('petAccountButton');if(!button)return;
  window.MarketWallet?.accountBadge(button,{url:companionArtworkUrl(accountAvatarKind),name:SPACE_PETS[accountAvatarKind]?.name||'星际伙伴',status:$('petStatus'),username:accountUser});
}
function installHomeUtilities(){
  if(!petHomeBuilt)return;
  window.MarketWallet?.install({root:$('petHome'),open:openDetailDialog,close:dialog=>window.MarketMobilePages?.closeLocalDialog?window.MarketMobilePages.closeLocalDialog(dialog):dialog.close(),getOwner:()=>accountSpace,getEntries:()=>walletHoldings,onSave:entries=>{walletHoldings=entries;save()}});
  renderHomeAccountBadge();
}
function buildPetHome(){
  petHomeBuilt=true;
  const root=$('petHome');
  root.replaceChildren();
  const head=document.createElement('header');head.className='petHead';
  head.innerHTML=`<button type="button" id="petLoreButton" class="petHeadBrand petBrandBadge" aria-label="打开星轨伙伴图鉴"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 74" width="224" height="296" role="img" aria-label="星轨宝石徽章">
 <defs>
  <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff5cf"/><stop offset=".22" stop-color="#dcaa51"/><stop offset=".42" stop-color="#fff1ae"/><stop offset=".68" stop-color="#a56a28"/><stop offset="1" stop-color="#ffdc86"/></linearGradient>
  <linearGradient id="stone" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#6c81b4"/><stop offset=".3" stop-color="#243e65"/><stop offset=".67" stop-color="#22274e"/><stop offset="1" stop-color="#141e33"/></linearGradient>
  <linearGradient id="letters" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="#f3ffff"/><stop offset=".19" stop-color="#b2fbff"/><stop offset=".43" stop-color="#55d8ef"/><stop offset=".57" stop-color="#d4c3ff"/><stop offset=".8" stop-color="#9587f4"/><stop offset="1" stop-color="#e6e5ff"/></linearGradient>
  <clipPath id="glyphs"><text x="28" y="32" text-anchor="middle" font-family="PingFang SC,Noto Sans CJK SC,Microsoft YaHei,sans-serif" font-size="19" font-weight="900">星</text><text x="28" y="54" text-anchor="middle" font-family="PingFang SC,Noto Sans CJK SC,Microsoft YaHei,sans-serif" font-size="19" font-weight="900">轨</text></clipPath>
 </defs>
 <path d="M28 3 51 13 48 51 28 70 8 51 5 13Z" fill="url(#gold)" stroke="#edc779" stroke-width=".7"/>
 <path d="M28 8 46 16 43 49 28 63 13 49 10 16Z" fill="url(#stone)" stroke="#ffe3a0" stroke-opacity=".65" stroke-width=".7"/>
 <path d="m10 16 18 9 18-9-3 33-15-8-15 8Z" fill="#5770b1" opacity=".16"/>
 <path d="M28 8v17L13 49l15-8 15 8-15 14" fill="#94c9e5" opacity=".1"/>
 <path d="m10 16 18 9 18-9M13 49l15-8 15 8M28 8v17m0 16v22" fill="none" stroke="#b8d8ee" stroke-opacity=".22" stroke-width=".6"/>
 <g font-family="PingFang SC,Noto Sans CJK SC,Microsoft YaHei,sans-serif" font-size="19" font-weight="900" text-anchor="middle" stroke-linejoin="round">
  <g fill="#6b3f1d" stroke="#6b3f1d" stroke-width="1.5" transform="translate(0 1.1)"><text x="28" y="32">星</text><text x="28" y="54">轨</text></g>
  <g fill="url(#letters)" stroke="url(#gold)" stroke-width=".9" paint-order="stroke fill"><text x="28" y="32">星</text><text x="28" y="54">轨</text></g>
 </g>
 <g clip-path="url(#glyphs)">
  <path d="M14 12 31 14 20 31Z M21 34 42 17 39 34Z M13 38 30 35 22 54Z M26 56 42 37 43 57Z" fill="#efffff" opacity=".48"/>
  <path d="M13 25 32 17 43 30 24 25Z M15 48 34 39 42 54 24 48Z" fill="#4675c7" opacity=".44"/>
  <path d="m14 26 29-9M16 49l26-9M22 17l9 17M23 39l8 18" stroke="#f3ffff" stroke-opacity=".55" stroke-width=".55"/>
 </g>
 <path d="m43 14 .8 2.7 2.7.8-2.7.8-.8 2.7-.8-2.7-2.7-.8 2.7-.8Z" fill="#e6ffff"/>
 <path d="m11 45 .5 1.6 1.6.5-1.6.5-.5 1.6-.5-1.6-1.6-.5 1.6-.5Z" fill="#e5dbff" opacity=".85"/>
</svg><strong class="petBrandText">星轨</strong></button>
    <div class="petHeadRight"><span class="petStatus warn" id="petStatus">连接中</span>
    <button class="petHomeHot" id="petHomeHot" type="button" aria-label="热门卡组"><svg class="petHotFlame" viewBox="0 0 36 44" aria-hidden="true"><path class="petFlameOuter" fill="#ff7339" d="M19 1c3 10 12 12 12 23 0 10-6 18-15 18S2 35 3 26c1-6 5-9 8-13-1 7 1 9 3 10C19 16 14 9 19 1Z"/><path fill="#ffb64b" d="M20 13c0 7 7 10 7 16 0 7-5 12-11 12S7 36 8 30c1-4 4-7 6-10-1 5 1 7 2 8 3-4 2-10 4-15Z"/><path fill="#fff0a4" d="M18 27c1 4 4 5 4 9 0 3-2 5-5 5s-5-2-5-5c0-3 3-5 3-7 0 3 1 4 2 4l1-6Z"/></svg><span>热门</span></button>
    <button class="petHeadAccount" id="petAccountButton" type="button">登录 / 注册</button></div>`;
  root.append(head);
  const stage=document.createElement('main');stage.className='petStage';stage.id='petStage';
  for(let i=0;i<MAX_USER_GROUPS;i++){
    const slot=document.createElement('button');
    slot.type='button';slot.className='petSlot empty';slot.dataset.index=String(i);
    slot.innerHTML=`<span class="petIsland" aria-hidden="true">${petVacancyMarkup(i)}</span>
      <span class="petActor" aria-hidden="true">
        <span class="petShadow"></span>
        <span class="petTilt"><span class="petFlipper"><span class="petFloat"><span class="petRig"><span class="petModel"></span></span></span></span></span>
      </span>
      <span class="petMeta"><span class="petLabelRow"><strong class="petName">—</strong><span class="petPocket" aria-hidden="true"><span class="petPocketCount"></span></span></span><small class="petCountText"></small></span>`;
    stage.append(slot);
  }
  root.append(stage);setupPetSlotSpacing(stage);
  $('petLoreButton').onclick=openPetLore;
  $('petHomeHot').onclick=()=>openPetDeck(HOT_GROUP_ID);
  $('petAccountButton').onclick=()=>$('accountButton').click();
  const newsButton=document.createElement('button');newsButton.id='petHomeNews';newsButton.type='button';newsButton.className='petHomeNews';newsButton.setAttribute('aria-label','新闻');
  newsButton.innerHTML='<img src="/assets/icons/crypto/newspaper.svg" alt="" aria-hidden="true"><span>新闻</span>';
  newsButton.onclick=openPetNews;$('petHomeHot').after(newsButton);
  const researchButton=document.createElement('button');researchButton.id='petHomeBacktest';researchButton.type='button';researchButton.className='petHomeBacktest';researchButton.setAttribute('aria-label','打开策略');
  researchButton.innerHTML='<svg viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="researchMetal" x2="1" y2="1"><stop stop-color="#edf9fc"/><stop offset=".45" stop-color="#85b6c7"/><stop offset="1" stop-color="#31586b"/></linearGradient></defs><rect x="5" y="7" width="38" height="28" rx="5" fill="url(#researchMetal)"/><rect x="8" y="10" width="32" height="21" rx="3" fill="#0b2433"/><path class="researchTrace" d="M11 25 17 21 22 24 28 16 36 13" fill="none" stroke="#74f1e4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 35h6v5h8v3H13v-3h8Z" fill="url(#researchMetal)"/><circle class="researchPower" cx="36" cy="33" r="1" fill="#89ffee"/></svg><span>策略</span>';
  researchButton.onclick=()=>{
    researchButton.classList.remove('touchPressed','touchReleased');researchButton.blur();
    let dialog=$('researchDialog');
    if(!dialog){
      dialog=document.createElement('dialog');dialog.id='researchDialog';dialog.className='mobileSheet researchDialog';dialog.setAttribute('aria-label','策略');
      const header=document.createElement('header');header.className='researchSheetHead';
      const back=document.createElement('button');back.type='button';back.id='researchClose';back.className='researchSheetBack';back.setAttribute('aria-label','返回主界面');back.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 5 8.5 12 15.5 19"/></svg>';
      back.onclick=()=>window.MarketMobilePages?.closeLocalDialog?window.MarketMobilePages.closeLocalDialog(dialog):dialog.close();
      const title=document.createElement('strong');title.textContent='策略';header.append(back,title);
      const host=document.createElement('div');host.className='researchFrameHost';dialog.append(header,host);document.body.append(dialog);
      window.addEventListener('message',event=>{const active=host.querySelector('iframe');if(!dialog.open||!active||event.source!==active.contentWindow||event.origin!==location.origin||event.data?.type!=='orbit-research-ready')return;active.classList.add('researchFrameReady');host.querySelector('.mobilePageLoading')?.remove();host.setAttribute('aria-busy','false')});
      dialog.addEventListener('close',()=>{if(dialog.open)return;host.replaceChildren();researchButton.blur();researchButton.classList.remove('touchPressed','touchReleased')});
      dialog.addEventListener('cancel',event=>{event.preventDefault();back.click()});
    }
    if(dialog.open)return;
    const frame=document.createElement('iframe');frame.title='策略内容';
    frame.addEventListener('load',()=>{if(frame.contentDocument?.documentElement.dataset.researchReady==='true'){frame.classList.add('researchFrameReady');frame.parentElement?.querySelector('.mobilePageLoading')?.remove();frame.parentElement?.setAttribute('aria-busy','false')}},{once:true});
    frame.src='/backtest/?embedded=1';
    const host=dialog.querySelector('.researchFrameHost');host.setAttribute('aria-busy','true');host.replaceChildren(createMobilePageLoading(),frame);openDetailDialog(dialog);
  };
  newsButton.after(researchButton);
  installPetHelpEntry(newsButton);
  installHomeUtilities();
  wirePetStage();
  buildDeckShell();
  setupPetRandomActions();
  renderPets();
  renderAccount();
}
function syncPetSlotSpacing(stage){
 const box=stage.getBoundingClientRect();if(!box.height||!box.width)return;
 const style=getComputedStyle(stage),available=box.height-parseFloat(style.paddingTop||0)-parseFloat(style.paddingBottom||0);
 const contentWidth=box.width-parseFloat(style.paddingLeft||0)-parseFloat(style.paddingRight||0),slotWidth=(contentWidth-16)/3;
 const actorSize=Math.min(slotWidth-4,Math.max(104,Math.min(160,box.width*.32)));
 const gap=16,rowHeight=Math.max(0,(available-gap)/2);
 // Bring the second row close to the first without reducing the larger artwork.
 const desiredDistance=actorSize*1.25+74;
 const lift=Math.min(160,Math.max(0,rowHeight+gap-desiredDistance),Math.max(0,rowHeight-actorSize-88));
 stage.style.setProperty('--pet-lower-lift',lift.toFixed(2)+'px');
}
function setupPetSlotSpacing(stage){
  let frame=0;
  const schedule=()=>{if(frame)return;frame=requestAnimationFrame(()=>{frame=0;syncPetSlotSpacing(stage)})};
  if(typeof ResizeObserver!=='undefined'){const observer=new ResizeObserver(schedule);observer.observe(stage)}
  window.addEventListener('resize',schedule,{passive:true});schedule();
}
function renderPets(){
  if(!petHomeBuilt)return;
  const stage=$('petStage');if(!stage)return;
  const slotGroups=petSlotGroups();
  for(let i=0;i<stage.children.length;i++){
    const slot=stage.children[i],g=slotGroups[i];
    slot.classList.toggle('empty',!g);
    slot.classList.toggle('active',!!g&&g.id===activeGroupId);
    slot.dataset.groupId=g?.id||'';slot.dataset.petKind=String(g?.petKind??i);
    if(g)renderPetArtwork(slot,g.petKind??i);
    const name=slot.querySelector('.petName'),countText=slot.querySelector('.petCountText'),
      pocket=slot.querySelector('.petPocketCount');
    if(g){
      const n=assets.filter(a=>a.groupId===g.id).length;
      name.textContent=g.petName||g.name;countText.textContent=n+' 个标的';
      pocket.textContent=n>99?'99+':String(n);
      slot.setAttribute('aria-label',`${g.name} 分组，包内 ${n}，单击查看，双击编辑`);
    }else{
      name.textContent='';countText.textContent='';pocket.textContent='';
      slot.setAttribute('aria-label','空位，单击新建分组');
    }
  }
}
function setPetHome(on){
  petHomeOn=on;
  try{localStorage.setItem(PET_HOME_STORE,on?'1':'0')}catch{}
  applyPetHomeVisibility();
}
function applyPetHomeVisibility(){
  if(!(window.MarketDevice?.isMobile?.()??window.innerWidth<=720)){for(const id of ['petNewsDialog','deckPeriodDialog'])if($(id)?.open)$(id).close()}
  syncAuthMascot();
  if((window.MarketDevice?.isMobile?.()??window.innerWidth<=720)&&!petHomeBuilt)buildPetHome();
  if(!petHomeBuilt)return;
  const active=petHomeOn&&(window.MarketDevice?.isMobile?.()??window.innerWidth<=720);
  document.body.classList.toggle('petHomeMode',active);
  $('petHome').hidden=!active;
  if(!active){closePetManager();closePetDeck();renderWatch()}
  else renderPets();
}
function tiltFollow(slot,e){
  const tilt=slot.querySelector('.petTilt');if(!tilt)return;
  const r=slot.getBoundingClientRect();
  const dx=(e.clientX-r.left)/r.width-.5,dy=(e.clientY-r.top)/r.height-.5;
  tilt.style.transition='transform .08s linear';
  tilt.style.transform=`rotateY(${(dx*24).toFixed(2)}deg) rotateX(${(-dy*24).toFixed(2)}deg)`;
}
function tiltReset(slot){
  const tilt=slot.querySelector('.petTilt');if(!tilt)return;
  tilt.style.transition='transform .6s cubic-bezier(.2,1.8,.35,1)';
  tilt.style.transform='rotateY(0deg) rotateX(0deg)';
}
function petFlip(slot){
  const flipper=slot.querySelector('.petFlipper'),pocket=slot.querySelector('.petPocket');
  if(flipper){flipper.classList.remove('petFlipAnim');void flipper.offsetWidth;flipper.classList.add('petFlipAnim')}
  if(pocket){pocket.classList.remove('petPocketBounce');void pocket.offsetWidth;pocket.classList.add('petPocketBounce')}
}
function restorePetDragArtwork(ghost){
  for(const expression of ghost.querySelectorAll('.petExpression'))expression.remove();
  for(const model of ghost.querySelectorAll('[data-pet-mood]'))delete model.dataset.petMood;
}
function wirePetStage(){
  const stage=$('petStage');let press=null,ignoreReleaseClick=false,tapTimer=null,pendingTap=null;
  const cancelTap=()=>{clearTimeout(tapTimer);tapTimer=null;pendingTap=null};
  document.addEventListener('pointerdown',()=>{ignoreReleaseClick=false},true);
  document.addEventListener('click',e=>{if(!ignoreReleaseClick)return;ignoreReleaseClick=false;if(e.detail>0){e.preventDefault();e.stopImmediatePropagation()}},true);
  const clear=()=>{
    if(press){press.ghost?.remove();press.actor.style.visibility='';try{stage.releasePointerCapture(press.id)}catch{}}
    for(const slot of stage.children)slot.classList.remove('petHolding','petDropTarget','petDragging');press=null;
  };
  stage.addEventListener('pointerdown',e=>{
    if(!e.isPrimary||e.button!==0)return;
    const slot=e.target.closest('.petSlot');if(!slot)return;
    if(pendingTap&&pendingTap!==slot.dataset.groupId)cancelTap();
    clear();press={id:e.pointerId,x:e.clientX,y:e.clientY,slot,actor:slot.querySelector('.petActor'),dragging:false,moved:false,target:slot};
    try{stage.setPointerCapture(e.pointerId)}catch{}
    if(slot.dataset.groupId)slot.classList.add('petHolding');
  });
  stage.addEventListener('pointermove',e=>{
    if(!press||press.id!==e.pointerId)return;
    const dx=e.clientX-press.x,dy=e.clientY-press.y;
    if(Math.hypot(dx,dy)>7)press.moved=true;
    if(!press.dragging&&press.moved&&press.slot.dataset.groupId){
      cancelTap();press.dragging=true;press.slot.classList.add('petDragging');
      const r=press.actor.getBoundingClientRect(),ghost=press.actor.cloneNode(true);ghost.classList.add('petDragGhost');ghost.dataset.petKind=press.slot.dataset.petKind;
      // 拖动副本挂到 body，直接移除表情层，确保始终是原始插画。
      restorePetDragArtwork(ghost);
      Object.assign(ghost.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});
      // A drag clone must have its own gradient IDs, including their URL references.
      const prefix='drag'+Date.now()+'-';ghost.innerHTML=ghost.innerHTML.replace(/space[0-4]-/g,prefix);
      document.body.append(ghost);press.ghost=ghost;press.actor.style.visibility='hidden';window.MarketPhysics?.sound('lift');
    }
    if(!press.dragging)return;if(e.cancelable)e.preventDefault();
    press.ghost.style.transform=`translate(${dx}px,${dy-10}px) rotate(${Math.max(-5,Math.min(5,dx/30))}deg) scale(1.04)`;
    const target=[...stage.children].find(slot=>{const r=slot.getBoundingClientRect();return e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom});
    for(const slot of stage.children)slot.classList.toggle('petDropTarget',slot===target&&slot!==press.slot);press.target=target||press.slot;
  },{passive:false});
  stage.addEventListener('pointerup',e=>{
    if(!press||press.id!==e.pointerId)return;const state=press;clear();ignoreReleaseClick=true;
    if(state.dragging){
      if(state.target!==state.slot)swapPetSlots(Number(state.slot.dataset.index),Number(state.target.dataset.index));
      else{window.MarketPhysics?.sound('return');if(!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)state.actor.animate?.([{transform:`translate(${e.clientX-state.x}px,${e.clientY-state.y-10}px) scale(1.04)`},{transform:'translate(0,0) scale(1.02)',offset:.75},{transform:'translate(0,0) scale(1,1)'}],{duration:280,easing:'cubic-bezier(.18,1.25,.3,1)'})}
      return;
    }
    if(state.moved)return;
    const group=state.slot.dataset.groupId;
    if(!group){cancelTap();createPetAt(Number(state.slot.dataset.index));return}
    if(pendingTap===group){cancelTap();openPetManager(group);return}
    cancelTap();pendingTap=group;
    tapTimer=setTimeout(()=>{cancelTap();if((window.MarketDevice?.isMobile?.()??window.innerWidth<=720)&&!$('petHome')?.hidden&&state.slot.dataset.groupId===group)openPetDeck(group)},300);
  });
  const cancel=()=>{cancelTap();clear()};
  stage.addEventListener('pointercancel',cancel);window.addEventListener('blur',cancel);window.addEventListener('resize',cancel);
  stage.addEventListener('contextmenu',e=>e.preventDefault());
  stage.addEventListener('keydown',e=>{
    const slot=e.target.closest('.petSlot');if(!slot)return;
    if(e.key==='F2'){e.preventDefault();cancelTap();if(slot.dataset.groupId)openPetManager(slot.dataset.groupId)}
    else if(e.key==='Enter'||e.key===' '){e.preventDefault();cancelTap();if(slot.dataset.groupId)openPetDeck(slot.dataset.groupId);else createPetAt(Number(slot.dataset.index))}
  });
}
function petSlotGroups(){
  const slots=Array(MAX_USER_GROUPS).fill(null),pending=[];
  for(const g of groups.filter(g=>g.id!==HOT_GROUP_ID&&(assets.some(a=>a.groupId===g.id)||Number.isInteger(g.petSlot))).slice(0,MAX_USER_GROUPS)){
    if(Number.isInteger(g.petSlot)&&g.petSlot>=0&&g.petSlot<MAX_USER_GROUPS&&!slots[g.petSlot])slots[g.petSlot]=g;
    else pending.push(g);
  }
  for(const g of pending){const index=slots.indexOf(null);g.petSlot=index;slots[index]=g}
  slots.forEach((g,i)=>{if(g&&!Number.isInteger(g.petKind))g.petKind=i});
  return slots;
}
function swapPetSlots(from,to){
  const slots=petSlotGroups(),a=slots[from],b=slots[to];if(!a||from===to)return;
  const stage=$('petStage'),source=stage.children[from],destination=stage.children[to];
  const start=source.getBoundingClientRect(),end=destination.getBoundingClientRect();
  a.petSlot=to;if(b)b.petSlot=from;save();renderPets();window.MarketPhysics?.sound('swap');
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  for(const [slot,dx,dy] of [[destination,start.left-end.left,start.top-end.top],[source,end.left-start.left,end.top-start.top]]){
    const actor=slot.querySelector('.petActor');if(!actor||slot.classList.contains('empty'))continue;
    actor.style.transform='';actor.animate?.([{transform:`translate(${dx}px,${dy}px) scale(1.08,.92)`},{transform:'translate(0,0) scale(.94,1.06)',offset:.72},{transform:'translate(0,0) scale(1,1)'}],{duration:430,easing:'cubic-bezier(.18,1.25,.3,1)'});
  }
}
function createPetAt(index){
  if(!accountUser){$('accountButton').click();return}
  if(!Number.isInteger(index)||index<0||index>=MAX_USER_GROUPS||petSlotGroups()[index])return;
  // 新建分组默认不预选宠物（petKind 为空），由用户自行选择；未选标的和宠物时创建按钮不可点。
  openPetManager(null,{id:'draft',name:'星际伙伴',petName:'星际伙伴',petSlot:index,petKind:null,assets:[],owner:accountUser});
}
let petManagerGroup=null,petDraft=null,petManagerOwner=null,petInsertBusy=false,petManagerSerial=0,petManagerSearchTimer=null,petSearchAbort=null,petHoldingsDragCancel=null,petManagerEpoch=0;
// 本次管理会话中新加入的标的：点一下可取消；会话之前已在组内的标的点一下不取消。
const petSessionAdds=new Set();
function currentPetPouch(){return petManagedAssets()}
function petManagedGroup(){return petDraft||groups.find(g=>g.id===petManagerGroup)}
function petManagedAssets(){return petDraft?petDraft.assets:assets.filter(a=>a.groupId===petManagerGroup)}
function closePetManager(){
  if($('petAssetSearchDialog')?.open)$('petAssetSearchDialog').close();
  petSearchAbort?.abort();petSearchAbort=null;
  petHoldingsDragCancel?.();petManagerGroup=null;petDraft=null;petManagerOwner=null;petManagerEpoch++;petManagerSerial++;clearTimeout(petManagerSearchTimer);petSessionAdds.clear();
  const view=$('petManager');if(view)view.hidden=true;document.body.classList.remove('petManagerOpen');
}
function commitPetDraft(){
  const draft=petDraft;if(!draft||!accountUser||draft.owner!==accountUser||!draft.assets.length||petSlotGroups()[draft.petSlot])return false;
  // 默认不预选宠物：未选择伙伴形象时不允许创建（与按钮禁用规则一致）。
  if(!Number.isInteger(draft.petKind)){setPetManagerNotice('请先选择一个伙伴形象');renderPetChoices();return false}
  if(!Number.isInteger(draft.petKind)||draft.petKind<0||draft.petKind>=SPACE_PETS.length||petKindInUse(draft.petKind,draft)){
    setPetManagerNotice('这个形象已被其他分组使用，请选择其他形象');renderPetChoices();return false;
  }
  const name=$('petOwnName').value.trim();if(!name){setPetManagerNotice('请输入伙伴名字');return false}
  // Reuse an empty legacy group (including the reserved desktop default) rather than exceeding the group quota.
  let group=groups.find(g=>g.id!==HOT_GROUP_ID&&!Number.isInteger(g.petSlot)&&!assets.some(a=>a.groupId===g.id));
  // 5 个分组的名字必须互不相同（与空分组自身同名是允许的，它会被直接复用）。
  if(groupNameTaken(name,group)){setPetManagerNotice('名字重复');return false}
  if(!group){if(groups.filter(g=>g.id!==HOT_GROUP_ID).length>=MAX_USER_GROUPS)return false;group={id:'gp'+Date.now().toString(36),name:name.slice(0,12)};groups.push(group)}
  Object.assign(group,{petName:name.slice(0,12),petSlot:draft.petSlot,petKind:draft.petKind});
  for(const a of draft.assets)assets.push({...a,groupId:group.id});
  save();closePetManager();renderGroupOptions();renderWatch();renderPets();connectOkx();
  for(const a of assets.filter(a=>a.groupId===group.id)){queueMini(a);queueProfile(a)}
  window.MarketTouch?.pulse('selection');return true;
}
function removePetGroup(id){
  if(!id||id===HOT_GROUP_ID)return;
  assets=assets.filter(a=>a.groupId!==id);
  // The desktop/account schema reserves main; hide its empty pet while preserving that schema.
  groups=groups.filter(g=>g.id!==id||g.id==='main');
  const main=groups.find(g=>g.id===id);if(main){delete main.petSlot;delete main.petKind;delete main.petName}
  if(activeGroupId===id){activeGroupId=assets.find(a=>a.groupId!==HOT_GROUP_ID)?.groupId||'main';selected=assets.find(a=>a.groupId===activeGroupId)?assetId(assets.find(a=>a.groupId===activeGroupId)):''}
  closePetManager();save();renderGroupOptions();renderWatch();renderPets();connectOkx();loadAsset();
}
function petKindInUse(kind,group){
  return petSlotGroups().some(pet=>pet&&pet.id!==group?.id&&pet.petKind===kind);
}
function renderPetChoices(){
  const box=$('petChoices'),group=petManagedGroup();if(!box||!group)return;box.replaceChildren();
  SPACE_PETS.forEach((pet,kind)=>{
    // 新建分组默认不预选宠物：petKind 为空时没有任何一个形象显示为已选。
    const selected=Number.isInteger(group.petKind)&&group.petKind===kind;
    const owner=petSlotGroups().find(p=>p&&p.id!==group.id&&p.petKind===kind);
    const used=!!owner&&!selected,ownerName=owner?.petName||owner?.name||'其他分组';
    const button=document.createElement('button');button.type='button';button.className='petChoice'+(used?' used':'');button.disabled=used;button.setAttribute('aria-pressed',String(selected));
    button.setAttribute('aria-label',pet.name+(selected?'，当前已选':used?'，由“'+ownerName+'”使用':'，可选择'));
    button.innerHTML='<span class="petCrystalCabinet"><span class="petCrystalCeiling"></span><svg viewBox="0 0 160 160" aria-hidden="true">'+spacePetMarkup(kind,'choice'+kind+'-')+'</svg><span class="petCrystalPedestal"></span></span><span class="petChoiceName">'+pet.name+'</span>';
    const status=document.createElement('span');status.className='petChoiceStatus '+(selected?'current':used?'occupied':'available');
    status.textContent=selected?'✓ 当前已选':used?'已使用 · '+ownerName:'选择此伙伴';status.title=status.textContent;button.append(status);
    button.onclick=()=>{
      if(group!==petManagedGroup())return;
      if(Number.isInteger(group.petKind)&&group.petKind===kind)return;
      if(petKindInUse(kind,group)){setPetManagerNotice('这个形象已被其他分组使用');renderPetChoices();return}
      group.petKind=kind;if(!petDraft){save();renderPets()}renderPetChoices();window.MarketTouch?.pulse('selection');
    };box.append(button);
  });
  appendComingSoonPets(box);
  // 选完宠物后同步创建按钮：标的和宠物都选好才可点。
  const confirm=$('petCreateConfirm');
  if(confirm&&petDraft)confirm.disabled=!(petDraft.assets&&petDraft.assets.length)||!Number.isInteger(group.petKind);
}

function openPetManager(id,draft=null,restore=false){
  const group=draft||groups.find(g=>g.id===id&&g.id!==HOT_GROUP_ID);if(!group||draft&&draft.owner!==accountUser)return;
  window.MarketMobilePages?.prepareDialog();
  if(!$('petManager')){
    const view=document.createElement('section');view.id='petManager';view.className='petManager';view.hidden=true;
    view.innerHTML='<header class="petManagerHead"><button class="petManagerBack" type="button" aria-label="返回"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15.5 5 8.5 12 15.5 19"/></svg></button><strong id="petManagerTitle"></strong></header><div class="petManagerBody"><button id="petCreateConfirm" type="button">创建分组</button><form id="petNameForm"><label for="petOwnName">伙伴名字</label><div class="petNameRow"><input id="petOwnName" maxlength="12" autocomplete="off"><button id="petNameSave" type="submit">保存</button></div></form><p id="petManagerMessage" role="status"></p><label class="petSearchLabel" for="petOwnSearch">添加标的</label><div class="petSearchField"><input id="petOwnSearch" type="search" placeholder="搜索代码或名称" autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false" enterkeyhint="search"><div id="petOwnResults" hidden></div></div><div id="petCardPouch" class="petCardPouch"><div class="petPouchHead"><strong>卡兜</strong><span id="petPouchCount"></span></div><div id="petPouchCards" class="petPouchCards"></div><div class="petPouchLip"></div></div><span id="petOwnCount" hidden></span><div id="petOwnHoldings" hidden></div><div id="petChoices" class="petChoices" aria-label="选择星际伙伴"></div><button id="petGroupDelete" type="button">删除分组</button></div>';
    document.body.append(view);view.querySelector('.petManagerBack').onclick=()=>{if(window.MarketMobilePages?.managerBack)window.MarketMobilePages.managerBack();else{closePetManager();closePetDeck()}};
    const pouchViewport=document.createElement('div');pouchViewport.className='petPouchViewport';
    const pouchList=$('petPouchCards');pouchList.before(pouchViewport);
    const pouchRail=document.createElement('div');pouchRail.id='petPouchScrollRail';pouchRail.className='petPouchScrollRail';pouchRail.tabIndex=0;pouchRail.setAttribute('role','scrollbar');pouchRail.setAttribute('aria-label','上下浏览卡兜');pouchRail.setAttribute('aria-controls','petPouchCards');pouchRail.setAttribute('aria-orientation','vertical');
    const pouchThumb=document.createElement('span');pouchThumb.id='petPouchScrollThumb';pouchThumb.className='petPouchScrollThumb';pouchThumb.setAttribute('aria-hidden','true');pouchRail.append(pouchThumb);pouchViewport.append(pouchList,pouchRail);setupPetPouchScrollRail();
    const searchDialog=document.createElement('dialog');searchDialog.id='petAssetSearchDialog';searchDialog.className='petAssetSearchDialog mobileSheet';searchDialog.setAttribute('aria-label','搜索添加标的');
    const searchHead=document.createElement('header'),searchTitle=document.createElement('label'),searchClose=document.createElement('button');
    searchTitle.htmlFor='petOwnSearch';searchTitle.textContent='搜索标的';searchClose.type='button';searchClose.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 5 8.5 12 15.5 19"/></svg>';searchClose.setAttribute('aria-label','返回分组');searchClose.onclick=()=>searchDialog.close();searchHead.append(searchClose,searchTitle);searchDialog.addEventListener('close',()=>{petSearchAbort?.abort();petSearchAbort=null;clearTimeout(petManagerSearchTimer);petManagerSerial++;$('petOwnSearch').value='';$('petOwnResults').replaceChildren();$('petOwnResults').hidden=true});
    view.querySelector('.petSearchLabel').remove();const searchField=view.querySelector('.petSearchField'),searchForm=document.createElement('form');searchForm.id='petAssetSearchForm';searchForm.append($('petOwnSearch'));searchForm.onsubmit=e=>{e.preventDefault();clearTimeout(petManagerSearchTimer);searchPetAssets()};searchField.prepend(searchForm);searchDialog.append(searchHead,searchField);document.body.append(searchDialog);
    view.addEventListener('touchstart',e=>{if(e.touches.length>1&&e.cancelable)e.preventDefault()},{passive:false});
    view.addEventListener('touchmove',e=>{if(e.touches.length>1&&e.cancelable)e.preventDefault()},{passive:false});
    view.addEventListener('gesturestart',e=>e.preventDefault());
    view.addEventListener('dblclick',e=>e.preventDefault());
    $('petNameForm').onsubmit=e=>{e.preventDefault();const g=petManagedGroup();if(!g)return;const name=$('petOwnName').value.trim();if(!name){setPetManagerNotice('请输入伙伴名字');return}if(groupNameTaken(name,g)){setPetManagerNotice('名字重复');return}g.petName=name.slice(0,12);if(!petDraft){if(g.id!=='main')g.name=g.petName;save();renderGroupOptions();renderPets()}$('petManagerTitle').textContent=g.petName;setPetManagerNotice('已保存')};
    $('petCreateConfirm').onclick=commitPetDraft;
    $('petGroupDelete').onclick=async()=>{const g=petManagedGroup(),serial=petManagerSerial;if(!g||petDraft)return;const approved=await confirmGroupAction('删除分组','确定删除“'+(g.petName||g.name)+'”和其中的 '+petManagedAssets().length+' 个标的？','删除分组',true);if(approved&&serial===petManagerSerial&&g===petManagedGroup())removePetGroup(g.id)};
    bindMobileAssetSearch($('petOwnSearch'),()=>{clearTimeout(petManagerSearchTimer);searchPetAssets()});
  }
  closePetManager();petDraft=draft;petManagerGroup=group.id;petManagerOwner=accountSpace;
  $('petManager').dataset.groupId=group.id;$('petManager').hidden=false;document.body.classList.add('petManagerOpen');
  $('petManagerTitle').textContent=draft?'新建分组':group.petName||group.name;$('petOwnName').value=group.petName||group.name;
  $('petNameSave').hidden=!!draft;$('petCreateConfirm').hidden=!draft;$('petGroupDelete').hidden=!!draft;
  $('petOwnSearch').value='';$('petOwnResults').replaceChildren();$('petManagerMessage').textContent=draft?'先选择至少一个标的':'';renderPetChoices();renderPetHoldings();
  $('petCardPouch').hidden=false;renderPetPouch();searchPetAssets();
}
function renderPetHoldings(){
  petHoldingsDragCancel?.();
  const box=$('petOwnHoldings');if(!box||!petManagerGroup)return;box.replaceChildren();
  const members=petManagedAssets();// 创建按钮：标的和宠物都选好才可点（默认不预选宠物，保持原有禁用样式）。
  if($('petCreateConfirm'))$('petCreateConfirm').disabled=!members.length||!!petDraft&&!Number.isInteger(petDraft.petKind);$('petOwnCount').textContent=members.length+' / '+MAX_GROUP_ASSETS;
  for(const a of members){
    const row=document.createElement('div');row.className='petOwnAsset';
    row.dataset.watchId=watchId(a);
    const label=document.createElement('strong');label.textContent=a.symbol;
    const remove=document.createElement('button');remove.type='button';remove.className='petOwnDelete';remove.textContent=petDraft?'取消选择':'删除';remove.setAttribute('aria-label','从当前宠物删除 '+a.symbol);
    const removeGroup=petManagerGroup,removeEpoch=petManagerEpoch,removeOwner=accountSpace;
    remove.onclick=()=>removePetPouchAsset(a,removeGroup,removeEpoch,removeOwner);

    const handle=document.createElement('button');handle.type='button';handle.className='petOwnDrag';
    handle.setAttribute('aria-label','按住拖动 '+a.symbol+' 调整顺序');
    handle.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14"/></svg>';
    handle.onpointerdown=e=>startPetHoldingsDrag(e,row,handle);
    handle.onkeydown=e=>{
      if(e.key!=='ArrowUp'&&e.key!=='ArrowDown')return;e.preventDefault();
      const rows=[...box.querySelectorAll('[data-watch-id]')],index=rows.indexOf(row);
      if(rows.length<2)return;
      if(e.key==='ArrowUp'){if(index===0)box.append(row);else rows[index-1].before(row)}
      else{if(index===rows.length-1)box.prepend(row);else rows[index+1].after(row)}
      persistPetHoldingsOrder(petManagerGroup);renderPetHoldings();renderPetPouch();
      [...box.querySelectorAll('[data-watch-id]')].find(item=>item.dataset.watchId===watchId(a))?.querySelector('.petOwnDrag').focus();
    };
    const actions=document.createElement('div');actions.className='petOwnActions';actions.append(handle,remove);
    row.append(logoFor(a),label,actions);box.append(row);
  }
  if(!members.length){const empty=document.createElement('p');empty.textContent='还没有标的，从上方搜索添加';empty.className='petOwnEmpty';box.append(empty)}
}
function persistPetHoldingsOrder(group,order=null){
  if(!group||group===HOT_GROUP_ID||group!==petManagerGroup)return;
  const members=petManagedAssets(),byId=new Map(members.map(a=>[watchId(a),a]));
  const ids=order||[...$('petOwnHoldings').querySelectorAll('[data-watch-id]')].map(row=>row.dataset.watchId);
  if(ids.length!==members.length||new Set(ids).size!==members.length||ids.some(id=>!byId.has(id)))return;
  if(petDraft){petDraft.assets=ids.map(id=>byId.get(id));return}
  let index=0;assets=assets.map(a=>a.groupId===group?byId.get(ids[index++]):a);
  save();renderWatch();window.MarketTouch?.pulse('selection');
}
function startPetHoldingsDrag(event,row,handle){
  if(!(window.MarketDevice?.isMobile?.()??window.innerWidth<=720)||!event.isPrimary||event.button!==0||petHoldingsDragCancel)return;
  const group=petManagerGroup,list=$('petOwnHoldings'),scroller=row.closest('.petManagerBody');
  if(list.querySelectorAll('[data-watch-id]').length<2)return;
  event.preventDefault();
  const origin=row.getBoundingClientRect(),next=row.nextSibling,placeholder=document.createElement('div');
  placeholder.className='petOwnPlaceholder';placeholder.style.height=origin.height+'px';row.before(placeholder);
  document.body.append(row);row.classList.add('petOwnDragging');
  Object.assign(row.style,{left:origin.left+'px',top:origin.top+'px',width:origin.width+'px'});
  let y=event.clientY,frame=0,finished=false;
  const place=()=>{
    const rows=[...list.querySelectorAll('[data-watch-id]')];
    const target=rows.find(item=>y<item.getBoundingClientRect().top+item.getBoundingClientRect().height/2);
    if(target)target.before(placeholder);else list.append(placeholder);
  };
  const scroll=()=>{
    const bounds=scroller.getBoundingClientRect(),edge=48;
    const speed=y<bounds.top+edge?-Math.min(12,(bounds.top+edge-y)/4):y>bounds.bottom-edge?Math.min(12,(y-bounds.bottom+edge)/4):0;
    if(speed){scroller.scrollTop+=speed;place()}frame=requestAnimationFrame(scroll);
  };
  const move=e=>{
    if(e.pointerId!==event.pointerId)return;if(e.cancelable)e.preventDefault();
    y=e.clientY;row.style.top=origin.top+y-event.clientY+'px';place();
  };
  const cleanup=(commit=false)=>{
    if(finished)return;finished=true;cancelAnimationFrame(frame);
    window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',cancel);window.removeEventListener('blur',cancel);
    try{handle.releasePointerCapture(event.pointerId)}catch{}
    if(commit)placeholder.replaceWith(row);
    else{placeholder.remove();if(next?.parentNode===list)list.insertBefore(row,next);else list.append(row)}
    row.removeAttribute('style');row.classList.remove('petOwnDragging');petHoldingsDragCancel=null;
    if(commit){
      // 松手后的合成点击不能落到重新排列的删除按钮上；下一次按下立即恢复正常点击。
      const release=()=>{document.removeEventListener('click',block,true);document.removeEventListener('pointerdown',release,true)};
      const block=e=>{if(e.detail>0){e.preventDefault();e.stopImmediatePropagation()}release()};
      document.addEventListener('click',block,true);document.addEventListener('pointerdown',release,true);setTimeout(release,350);
      if(group===petManagerGroup){persistPetHoldingsOrder(group);renderPetHoldings();renderPetPouch()}
    }
  };
  const finish=e=>{if(e.pointerId===event.pointerId)cleanup(true)};
  const cancel=e=>{if(!e||e.type==='blur'||e.pointerId===event.pointerId)cleanup(false)};
  petHoldingsDragCancel=()=>cleanup(false);
  try{handle.setPointerCapture(event.pointerId)}catch{}
  window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',cancel);window.addEventListener('blur',cancel);
  frame=requestAnimationFrame(scroll);
}
function renderPetPouch(){
  const list=$('petPouchCards');if(!list||!petManagerGroup)return;
  const scroll=list.scrollTop,pouch=currentPetPouch();list.replaceChildren();
  $('petPouchCount').textContent=pouch.length+' / '+MAX_GROUP_ASSETS;
  $('petCardPouch').classList.toggle('full',pouch.length>=MAX_GROUP_ASSETS);
  list.setAttribute('aria-label','卡兜内 '+pouch.length+' 个标的');
  for(const [index,asset] of pouch.entries()){
    const card=document.createElement('div');card.className='petPouchCard filled';card.dataset.symbol=asset.symbol;card.dataset.watchId=watchId(asset);card.dataset.depth='0';
    card.tabIndex=0;card.setAttribute('role','button');card.setAttribute('aria-label','第 '+(index+1)+' 张，'+asset.symbol+'，直接拖动调整顺序，向上拖出卡兜移除');
    const number=document.createElement('span');number.className='petPouchNumber';number.textContent=String(index+1);
    const symbol=document.createElement('span');symbol.className='petPouchSymbol';symbol.textContent=asset.symbol;
    card.append(number,logoFor(asset),symbol);card.onpointerdown=e=>beginPetPouchGesture(e,card);
    card.onkeydown=e=>{
      const members=petManagedAssets(),index=members.indexOf(asset);
      if(e.key==='Delete'){e.preventDefault();removePetPouchAsset(asset,petManagerGroup,petManagerEpoch,accountSpace);return}
      const offset=e.key==='ArrowLeft'?-1:e.key==='ArrowRight'?1:e.key==='ArrowUp'?-5:e.key==='ArrowDown'?5:0;
      if(!offset||index+offset<0||index+offset>=members.length)return;e.preventDefault();
      const order=members.map(watchId);[order[index],order[index+offset]]=[order[index+offset],order[index]];
      persistPetHoldingsOrder(petManagerGroup,order);renderPetHoldings();renderPetPouch();
    };
    list.append(card);
  }
  {
    const add=document.createElement('button');add.type='button';add.className='petPouchAdd';add.textContent='+';add.setAttribute('aria-label','搜索添加标的');
    add.onclick=openPetAssetSearch;list.append(add);
  }
  list.scrollTop=scroll;
  updatePetPouchScrollRail();requestAnimationFrame(updatePetPouchScrollRail);
}
function updatePetPouchScrollRail(){
  const list=$('petPouchCards'),rail=$('petPouchScrollRail'),thumb=$('petPouchScrollThumb');if(!list||!rail||!thumb)return;
  const overflow=Math.max(0,list.scrollHeight-list.clientHeight),track=Math.max(0,rail.clientHeight-8);
  const height=Math.min(track,Math.max(48,track*list.clientHeight/Math.max(1,list.scrollHeight))),travel=track-height;
  thumb.style.height=height+'px';thumb.style.transform=`translateY(${overflow?travel*Math.max(0,Math.min(overflow,list.scrollTop))/overflow:0}px)`;
  rail.classList.toggle('inactive',overflow<1);rail.setAttribute('aria-disabled',String(overflow<1));
  rail.setAttribute('aria-valuemin','0');rail.setAttribute('aria-valuemax',String(Math.round(overflow)));rail.setAttribute('aria-valuenow',String(Math.round(Math.max(0,Math.min(overflow,list.scrollTop)))));
}
function setupPetPouchScrollRail(){
  const list=$('petPouchCards'),rail=$('petPouchScrollRail'),thumb=$('petPouchScrollThumb');
  rail.addEventListener('pointerdown',event=>{
    if(!event.isPrimary||event.button!==0||petHoldingsDragCancel)return;
    const overflow=list.scrollHeight-list.clientHeight,travel=rail.clientHeight-8-thumb.offsetHeight;if(overflow<=0||travel<=0)return;
    event.preventDefault();event.stopPropagation();
    const bounds=thumb.getBoundingClientRect(),grab=event.clientY>=bounds.top&&event.clientY<=bounds.bottom?event.clientY-bounds.top:thumb.offsetHeight/2;
    const move=e=>{if(e.pointerId!==event.pointerId)return;if(e.cancelable)e.preventDefault();const top=e.clientY-rail.getBoundingClientRect().top-4-grab;list.scrollTop=(Math.max(0,Math.min(travel,top))/travel)*overflow;updatePetPouchScrollRail()};
    const stop=e=>{if(e&&e.type!=='blur'&&e.pointerId!==event.pointerId)return;window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',stop);window.removeEventListener('pointercancel',stop);window.removeEventListener('blur',stop);try{rail.releasePointerCapture(event.pointerId)}catch{}rail.classList.remove('dragging');petHoldingsDragCancel=null};
    petHoldingsDragCancel=stop;rail.classList.add('dragging');try{rail.setPointerCapture(event.pointerId)}catch{}
    window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',stop);window.addEventListener('pointercancel',stop);window.addEventListener('blur',stop);move(event);
  });
  rail.addEventListener('keydown',event=>{
    const delta={ArrowUp:-82,ArrowDown:82,PageUp:-list.clientHeight,PageDown:list.clientHeight}[event.key];
    if(delta===undefined&&event.key!=='Home'&&event.key!=='End')return;event.preventDefault();
    const max=Math.max(0,list.scrollHeight-list.clientHeight);list.scrollTop=event.key==='Home'?0:event.key==='End'?max:Math.max(0,Math.min(max,list.scrollTop+delta));updatePetPouchScrollRail();
  });
  list.addEventListener('scroll',updatePetPouchScrollRail,{passive:true});window.addEventListener('resize',updatePetPouchScrollRail,{passive:true});
  if(typeof ResizeObserver!=='undefined'){const observer=new ResizeObserver(updatePetPouchScrollRail);observer.observe(list);observer.observe(rail)}
}
function openPetAssetSearch(){
  const dialog=$('petAssetSearchDialog');if(!dialog||!petManagerGroup)return;
  petHoldingsDragCancel?.();clearTimeout(petManagerSearchTimer);petManagerSerial++;
  $('petOwnSearch').value='';$('petOwnResults').replaceChildren();$('petOwnResults').hidden=true;
  loadCatalog();
  window.MarketMobilePages?.prepareDialog();if(!dialog.open)dialog.showModal();
  $('petOwnSearch').focus({preventScroll:true});searchPetAssets();
}
function showPetNotice(message){
  if(!message)return;
  const host=$('petAssetSearchDialog')?.open?$('petAssetSearchDialog'):document.body;
  host.querySelectorAll('.petNoticePuff').forEach(node=>{
    const lift=(Number(node.dataset.noticeLift)||0)+Math.max(36,node.offsetHeight||36)+8;
    node.dataset.noticeLift=String(lift);
    node.style.top='calc(var(--mobile-viewport-top,0px) + env(safe-area-inset-top) + 96px - '+lift+'px)';
  });
  const puff=document.createElement('div');puff.className='petAlreadyPuff petNoticePuff';
  puff.setAttribute('role','status');puff.setAttribute('aria-live','polite');puff.textContent=message;
  host.append(puff);setTimeout(()=>puff.remove(),2400);
}
function setPetManagerNotice(message){
  $('petManagerMessage').textContent='';showPetNotice(message);
}
function showPetAlreadyAdded(row){
  const badge=row?.querySelector('.petSearchAdded');if(!badge)return;
  row.dataset.added='true';badge.textContent='已在自选中';badge.removeAttribute('aria-hidden');
}

function cardsOrder(){return [...$('petPouchCards').querySelectorAll('[data-watch-id]')].map(card=>card.dataset.watchId)}
async function removePetPouchAsset(asset,group,epoch,owner){
  if(group!==petManagerGroup||epoch!==petManagerEpoch||owner!==accountSpace)return;
  if(petDraft){petDraft.assets=petDraft.assets.filter(a=>a!==asset);renderPetHoldings();renderPetPouch();searchPetAssets();return}
  if(!assets.includes(asset))return;
  // 移除立即持久化；即使卡兜清空也保留分组、名字与伙伴形象。
  removeWatchAsset(watchId(asset));renderPetHoldings();renderPetPouch();renderPets();searchPetAssets();
}

function beginPetPouchGesture(event,card){
  startPetPouchDrag(event,card,card);
}
function startPetPouchDrag(event,card,handle){
  if(!event.isPrimary||event.button!==0||petHoldingsDragCancel||petInsertBusy)return;
  event.preventDefault();event.stopPropagation();
  const list=$('petPouchCards'),pouch=$('petCardPouch'),group=petManagerGroup,epoch=petManagerEpoch,owner=accountSpace,asset=petManagedAssets().find(a=>watchId(a)===card.dataset.watchId);
  if(!asset)return;
  const origin=card.getBoundingClientRect(),ghost=card.cloneNode(true);ghost.className='petPouchDragging';ghost.setAttribute('aria-hidden','true');
  Object.assign(ghost.style,{left:origin.left+'px',top:origin.top+'px',width:origin.width+'px',height:origin.height+'px'});document.body.append(ghost);card.classList.add('petPouchVacant');
  let x=event.clientX,y=event.clientY,moved=false,removing=false,valid=false,finished=false,frame=0;
  const place=()=>{
    const pouchBounds=pouch.getBoundingClientRect();
    removing=x<pouchBounds.left||x>pouchBounds.right||y<pouchBounds.top||y>pouchBounds.bottom;
    pouch.classList.toggle('removing',removing);ghost.classList.toggle('removing',removing);
    const bounds=list.getBoundingClientRect(),add=list.querySelector('.petPouchAdd'),r=add?.getBoundingClientRect();
    valid=!removing&&x>=bounds.left&&x<=bounds.right&&y>=bounds.top&&y<=bounds.bottom;
    if(!valid)return;
    if(r&&x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom){add.before(card);return}
    const target=[...list.querySelectorAll('[data-watch-id]')].filter(c=>c!==card).sort((a,b)=>{const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();return Math.hypot(x-ar.left-ar.width/2,y-ar.top-ar.height/2)-Math.hypot(x-br.left-br.width/2,y-br.top-br.height/2)})[0];
    if(!target)return;const t=target.getBoundingClientRect();
    if(x<t.left+t.width/2)target.before(card);else target.after(card);
    [...list.querySelectorAll('[data-watch-id]')].forEach((item,index)=>{const number=item.querySelector('.petPouchNumber');if(number)number.textContent=String(index+1)});
  };
  const scroll=()=>{const b=list.getBoundingClientRect();if(moved&&!removing){const speed=y<b.top+24?-8:y>b.bottom-24?8:0;if(speed){list.scrollTop+=speed;place()}}frame=requestAnimationFrame(scroll)};
  const move=e=>{if(e.pointerId!==event.pointerId)return;if(e.cancelable)e.preventDefault();x=e.clientX;y=e.clientY;if(Math.hypot(x-event.clientX,y-event.clientY)>6)moved=true;ghost.style.transform=`translate(${x-event.clientX}px,${y-event.clientY}px) rotate(${Math.max(-5,Math.min(5,(x-event.clientX)/20))}deg)`;if(moved)place()};
  const cleanup=commit=>{
    if(finished)return;finished=true;cancelAnimationFrame(frame);window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',cancel);window.removeEventListener('blur',cancel);
    try{handle.releasePointerCapture(event.pointerId)}catch{}ghost.remove();card.classList.remove('petPouchVacant');pouch.classList.remove('removing');petHoldingsDragCancel=null;
    const current=group===petManagerGroup&&epoch===petManagerEpoch&&owner===accountSpace;
    if(commit&&moved&&current){if(removing)removePetPouchAsset(asset,group,epoch,owner);else if(valid)persistPetHoldingsOrder(group,cardsOrder())}
    if(current){renderPetHoldings();renderPetPouch()}
  };
  const finish=e=>{if(e.pointerId===event.pointerId){if(Number.isFinite(e.clientX)&&Number.isFinite(e.clientY))move(e);cleanup(true)}},cancel=e=>{if(!e||e.type==='blur'||e.pointerId===event.pointerId)cleanup(false)};petHoldingsDragCancel=cancel;
  try{handle.setPointerCapture(event.pointerId)}catch{}
  window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',cancel);window.addEventListener('blur',cancel);frame=requestAnimationFrame(scroll);
}
async function insertPetCard(item,row){
  const group=petManagerGroup,owner=petManagerOwner,draft=petDraft,session=petManagerEpoch;
  if(petInsertBusy||!accountUser||owner!==accountSpace||(!draft&&!groups.some(g=>g.id===group)))return;
  if(petManagedAssets().some(a=>assetId(a)===assetId({type:item.type||'swap',symbol:item.symbol}))||petManagedAssets().length>=MAX_GROUP_ASSETS)return;
  petInsertBusy=true;row.disabled=true;
  const asset={type:item.type||'swap',symbol:item.symbol,name:item.name,groupId:group,pinned:false,cardColor:randomCardColor()};
  const start=row.getBoundingClientRect(),pouchBox=$('petPouchCards').getBoundingClientRect();
  const slot=$('petPouchCards').querySelector('.petPouchAdd');const target=slot?slot.getBoundingClientRect():{left:pouchBox.left,top:pouchBox.top};
  const flying=row.cloneNode(true);flying.className='petFlyingCard petSearchResultCard';flying.disabled=true;flying.setAttribute('aria-hidden','true');
  Object.assign(flying.style,{left:start.left+'px',top:start.top+'px',width:start.width+'px',height:start.height+'px'});document.body.append(flying);
  window.MarketPhysics?.sound('insert');
  try{
    if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches&&flying.animate){
      const animation=flying.animate([{transform:'translate(0,0) scale(1)',opacity:1},{transform:`translate(${target.left-start.left}px,${target.top-start.top}px) scale(.45) rotate(-7deg)`,opacity:.85}],{duration:300,easing:'cubic-bezier(.25,.8,.2,1)',fill:'forwards'});
      await animation.finished.catch(()=>{});
    }
    // Leaving/reopening a manager or changing account cannot commit a pending card.
    if(group!==petManagerGroup||owner!==accountSpace||!accountUser||draft!==petDraft||session!==petManagerEpoch)return;
    if(petManagedAssets().length>=MAX_GROUP_ASSETS||petManagedAssets().some(a=>assetId(a)===assetId({type:item.type||'swap',symbol:item.symbol})))return;
    if(draft)draft.assets.push(asset);
    else{assets.push(asset);deckColor(asset);save();renderWatch();connectOkx();queueMini(asset);queueProfile(asset)}
    petSessionAdds.add(assetId(asset));
    renderPetHoldings();renderPetPouch();row.remove();setPetManagerNotice(petManagedAssets().length>=MAX_GROUP_ASSETS?'当前分组已装满 50 个标的':'');
  }finally{flying.remove();petInsertBusy=false;if(row.isConnected)row.disabled=false;if(group===petManagerGroup&&owner===accountSpace)searchPetAssets()}
}
function petAssetRecommendations(){
  const unique=new Map();
  for(const item of [...assets.filter(a=>a.groupId===HOT_GROUP_ID),...newsRecommendedAssets()])if(!unique.has(item.symbol))unique.set(item.symbol,item);
  return [...unique.values()].slice(0,20);
}
async function searchPetAssets(){
  const query=$('petOwnSearch')?.value.trim(),group=petManagerGroup,owner=petManagerOwner,serial=++petManagerSerial,box=$('petOwnResults');
  petSearchAbort?.abort();petSearchAbort=null;
  if(!box)return;box.replaceChildren();box.hidden=true;if(!group||owner!==accountSpace)return;
  try{
    if(query&&!instrumentCatalog)loadCatalog();
    if(serial!==petManagerSerial||group!==petManagerGroup||owner!==accountSpace)return;
    let items=query?mobileAssetMatches(query):petAssetRecommendations();
    if(query&&items===null){
      const pending=document.createElement('p');pending.textContent='正在匹配…';box.append(pending);box.hidden=false;
      const controller=new AbortController();petSearchAbort=controller;
      items=(await api('/api/search?q='+encodeURIComponent(query),{signal:controller.signal,timeoutMs:5000,retries:0})).results||[];
      if(petSearchAbort===controller)petSearchAbort=null;
      if(owner!==accountSpace&&serial===petManagerSerial){box.replaceChildren();box.hidden=true;return}
      if(serial!==petManagerSerial||group!==petManagerGroup||owner!==accountSpace)return;
      box.replaceChildren();
    }
    if(!query){const heading=document.createElement('p');heading.textContent='热门推荐';box.append(heading)}
    if(serial!==petManagerSerial||group!==petManagerGroup||owner!==accountSpace)return;
    rememberAssetLogos(items);
    for(const item of items.slice(0,20)){
      if(!/^[A-Z0-9]{1,15}$/.test(item.symbol))continue;
      const row=document.createElement('button');row.type='button';row.className='petSearchResultCard';row.dataset.symbol=item.symbol;row.dataset.market=item.type||'swap';
      const label=document.createElement('span'),code=document.createElement('strong'),name=document.createElement('small');label.className='petSearchResultLabel';code.textContent=item.symbol;name.textContent=item.name||item.symbol;const market=document.createElement('small');market.className='petSearchMarket';market.textContent=item.type==='ashare'?'A股 · 人民币':'OKX · USDT 永续';label.append(code,name,market);
      const added=petManagedAssets().some(a=>assetId(a)===assetId({type:item.type||'swap',symbol:item.symbol}));
      const fresh=added&&petSessionAdds.has(assetId({type:item.type||'swap',symbol:item.symbol}));
      row.dataset.added=String(added);
      const badge=document.createElement('span');badge.className='petSearchAdded';badge.dataset.fresh=String(fresh);badge.textContent=added?(fresh?'点一下取消':'已在自选中'):'';
      if(!added)badge.setAttribute('aria-hidden','true');
      row.disabled=!added&&petManagedAssets().length>=MAX_GROUP_ASSETS;
      // Keep the keyboard from shifting the tapped row before its click arrives.
      row.onpointerdown=e=>{if(e.isPrimary&&e.button===0)e.preventDefault()};
      row.onclick=()=>{
        if(query)recordSearch(query);
        const existing=petManagedAssets().find(a=>assetId(a)===assetId({type:item.type||'swap',symbol:item.symbol}));
        if(existing){
          // 本次新加的标的点一下取消；之前已在组内的不支持点一下取消，仅提示。
          if(petSessionAdds.has(assetId({type:item.type||'swap',symbol:item.symbol}))){petSessionAdds.delete(assetId({type:item.type||'swap',symbol:item.symbol}));
            removePetPouchAsset(existing,petManagerGroup,petManagerEpoch,accountSpace);return}
          showPetAlreadyAdded(row);return;
        }
        insertPetCard(item,row);
      };row.append(logoFor({type:item.type||'swap',symbol:item.symbol},false,true),label,badge);box.append(row);
    }
    if(!box.children.length){const note=document.createElement('p');note.textContent='没有匹配的标的';box.append(note)}
    box.hidden=false;
  }catch{if(serial===petManagerSerial&&group===petManagerGroup&&owner===accountSpace){box.replaceChildren();box.hidden=true;setPetManagerNotice('搜索暂不可用，请重试')}}
}
function deckMembers(){
  // 手机管理列表与循环卡片使用同一顺序；桌面自选仍沿用自己的置顶显示。
  return assets.filter(a=>a.groupId===petDeckGroup);
}
function deckUpdateCount(){
  $('petDeck').dataset.index=String(petDeckIndex);
  if(petDeckGroup===HOT_GROUP_ID&&!$('petDeck').classList.contains('deckChartMode'))$('deckTitle').textContent='热门';
  deckNeighborReveal(0);
  const members=deckMembers();
  const stack=$('deckStack');if(stack){stack.hidden=members.length<2;for(const [i,edge] of [...stack.children].entries())edge.hidden=i>=Math.min(4,members.length-1)}
  $('deckCount').textContent=members.length?`${petDeckIndex+1} / ${members.length}`:'—';
  renderDeckNeighbors(members);
}
function renderDeckNeighbors(members){
  for(const [id,offset] of [['deckPrevious',-1],['deckNext',1]]){
    const layer=$(id);if(!layer)continue;
    layer.replaceChildren();layer.hidden=members.length<2;
    if(layer.hidden)continue;
    const index=(petDeckIndex+offset+members.length)%members.length;
    buildDeckCard(layer,index);
  }
}
function deckNeighborReveal(dx,settling=false){
  // The card core projects out on the exposed side as the face turns inward.
  const card=$('deckCard'),width=card?.clientWidth||window.innerWidth||372;
  // Project the slab thickness on the exposed side, mirrored with the Y rotation.
  const yaw=Math.max(-1,Math.min(1,dx/width))*26*Math.PI/180;
  card?.style?.setProperty('--deck-core-x',(-14*Math.sin(yaw)).toFixed(3)+'px');
  // The opaque front card supplies the mask: every uncovered pixel is readable immediately.
  for(const [id,sign] of [['deckPrevious',1],['deckNext',-1]]){
    const layer=$(id);if(!layer)continue;
    if(!settling)layer.classList.toggle('deckNeighborInactive',dx===0||Math.sign(dx)!==sign);
    const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const progress=Math.min(1,Math.abs(dx)/width);
    // 下一张由屏幕内侧沿 Z 轴靠近，滑动越多纵深越浅；交接时抵达正面位置。
    if(layer.style){
      layer.style.transition=(settling||card?.dataset?.busy)?'transform 300ms cubic-bezier(.22,.65,.25,1)':'none';
      layer.style.transform=`translate3d(0,0,${reduced?0:-140*(1-progress)}px)`;
    }
  }
}
function deckSlideTransform(dx){
  const width=$('deckCard')?.clientWidth||window.innerWidth||372;
  const progress=Math.min(1,Math.abs(dx)/width),lift=Math.sin(progress*Math.PI);
  const tilt=Math.max(-1,Math.min(1,dx/width));
  const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if(reduced)return `translate3d(${dx}px,0,0)`;
  return `translate3d(${dx}px,${-5*lift}px,${12*progress}px) rotateY(${26*tilt}deg) rotateZ(${2.5*tilt}deg)`;
}
const deckColorStore='market_card_colors_v1';let deckColors={};
try{deckColors=JSON.parse(localStorage.getItem(deckColorStore)||'{}')||{}}catch{}
function randomCardColor(){const used=new Set(assets.filter(x=>Number.isInteger(x.cardColor)).map(x=>x.cardColor));const options=Array.from({length:100},(_,i)=>i).filter(i=>!used.has(i));return (options.length?options:Array.from({length:100},(_,i)=>i))[Math.floor(Math.random()*(options.length||100))]}
const logoCardPalettes=new Map();
function cardColorSeed(symbol){let seed=2166136261;for(const ch of symbol)seed=Math.imul(seed^ch.charCodeAt(0),16777619);return seed>>>0}
function rgbCardTone(rgb){
  const [r,g,b]=rgb.map(v=>v/255),hi=Math.max(r,g,b),lo=Math.min(r,g,b),d=hi-lo,l=(hi+lo)/2;
  const h=!d?210:((hi===r?(g-b)/d+(g<b?6:0):hi===g?(b-r)/d+2:(r-g)/d+4)*60);
  return {h,s:d?100*d/(1-Math.abs(2*l-1)):0};
}
function sampleLogoCardPalette(image){
  try{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=32;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)return null;
    ctx.drawImage(image,0,0,32,32);const pixels=ctx.getImageData(0,0,32,32).data,bins=new Map();
    for(let i=0;i<pixels.length;i+=4){
      const rgb=[pixels[i],pixels[i+1],pixels[i+2]];
      if(pixels[i+3]<128||Math.max(...rgb)-Math.min(...rgb)<25)continue;
      const key=rgb.map(v=>Math.floor(v/32)).join(',');
      const bin=bins.get(key)||{rgb:[0,0,0],n:0};bin.n++;rgb.forEach((v,j)=>bin.rgb[j]+=v);bins.set(key,bin);
    }
    const colors=[...bins.values()].sort((a,b)=>b.n-a.n).map(bin=>bin.rgb.map(v=>v/bin.n));
    if(!colors.length)return [{h:210,s:12},{h:220,s:8}];
    const primary=colors[0],secondary=colors.find(rgb=>Math.hypot(...rgb.map((v,j)=>v-primary[j]))>85)||primary;
    return [rgbCardTone(primary),rgbCardTone(secondary)];
  }catch{return null} // 跨域图片不可取样时使用品牌兜底色，不阻塞显示。
}
function deckColor(a){
  const seed=cardColorSeed(a.symbol),url=typeof logoURLFor==='function'?logoURLFor(a):'';
  const known={BTC:[32,42],ETH:[225,258],SOL:[165,275],DOGE:[43,34],XRP:[210,220],TRUMP:[6,220],BNB:[45,34],USDT:[163,180]};
  const brand=known[a.symbol];
  const tones=logoCardPalettes.get(url)||(brand?brand.map(h=>({h,s:66})):[{h:210,s:18},{h:220,s:14}]);
  const shift=(seed%13)-6;
  return {h:(tones[0].h+shift+360)%360,s:Math.min(72,Math.max(12,tones[0].s*.8)),l:25+(seed%5),
    secondaryH:(tones[1].h+shift/2+360)%360,secondaryS:Math.min(66,Math.max(10,tones[1].s*.75)),mix:35+(seed%24)};
}
function applyDeckColor(frame,a){
  const color=deckColor(a);frame.style.setProperty('--hue',String(color.h));
  frame.style.setProperty('--card-saturation',color.s+'%');frame.style.setProperty('--card-lightness',color.l+'%');
  frame.style.setProperty('--card-secondary-hue',String(color.secondaryH));frame.style.setProperty('--card-secondary-saturation',color.secondaryS+'%');frame.style.setProperty('--card-color-mix',color.mix+'%');
}
function updateLogoCardPalette(url,image){
  if(!url||!image||logoCardPalettes.has(url))return;
  const palette=sampleLogoCardPalette(image);
  logoCardPalettes.set(url,palette);if(logoCardPalettes.size>128)logoCardPalettes.delete(logoCardPalettes.keys().next().value);
  if(!palette)return;
  for(const frame of document.querySelectorAll('.deckFrame[data-color-symbol]')){
    const asset={type:'swap',symbol:frame.dataset.colorSymbol};if(logoURLFor(asset)===url)applyDeckColor(frame,asset);
  }
}
// 卡面示意图只轻移最近一小段历史，不改变周期、分析或翻牌位置。
function wireDeckSparkGesture(wrap,canvas){
  let press=null,suppressUntil=0;
  wrap.onclick=e=>{if(Date.now()<suppressUntil){e.preventDefault();return}openDeckChart()};
  wrap.addEventListener('pointerdown',e=>{
    if(!e.isPrimary||e.button!==0)return;
    press={id:e.pointerId,x:e.clientX,y:e.clientY,offset:Number(canvas.dataset.sparkOffset)||0,axis:null,moved:false};
  });
  wrap.addEventListener('pointermove',e=>{
    if(!press||press.id!==e.pointerId)return;
    const dx=e.clientX-press.x,dy=e.clientY-press.y;
    if(Math.hypot(dx,dy)>8)press.moved=true;
    if(!press.axis&&press.moved){press.axis=Math.abs(dx)>Math.abs(dy)?'x':'y';if(press.axis==='x')try{wrap.setPointerCapture(e.pointerId)}catch{}}
    if(press.axis!=='x')return;
    if(e.cancelable)e.preventDefault();e.stopPropagation();
    const rows=canvas._sparkRows||[],count=Math.min(22,rows.length),max=Math.min(8,Math.max(0,rows.length-count));
    const offset=Math.max(0,Math.min(max,press.offset+dx/Math.max(1,(canvas.clientWidth||80)/Math.max(1,count))));
    canvas.dataset.sparkOffset=String(offset);miniChart(canvas,rows,offset);
  },{passive:false});
  const finish=(e,cancel=false)=>{
    if(!press||press.id!==e.pointerId)return;
    const tap=!cancel&&!press.moved&&Math.hypot(e.clientX-press.x,e.clientY-press.y)<=8;press=null;
    try{wrap.releasePointerCapture(e.pointerId)}catch{}
    suppressUntil=Date.now()+450;if(tap)openDeckChart();
  };
  wrap.addEventListener('pointerup',e=>finish(e));
  wrap.addEventListener('pointercancel',e=>finish(e,true));
  wrap.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openDeckChart()}};
}
function buildDeckCard(){
  const preview=arguments[0]||null,index=arguments[1]??petDeckIndex;
  if(!preview)deckUpdateCount();
  const card=preview||$('deckCard'),members=deckMembers();
  card.replaceChildren();
  if(!members.length){
    const empty=document.createElement('div');empty.className='deckEmpty';
    const strong=document.createElement('strong');strong.textContent='这个分组还没有标的';
    const btn=document.createElement('button');btn.type='button';btn.className='accent';btn.textContent='去添加标的';
    btn.onclick=deckAdd;
    empty.append(strong,btn);card.append(empty);return;
  }
  const a=members[index],k=assetId(a),q=quotes[k],p=profiles[k],cardPeriod=effectivePeriod(a,deckMobileTf);
  const pct=q&&q.base?(q.p/q.base-1)*100:null;
  const frame=document.createElement('div');frame.className='deckFrame';
  frame.dataset.colorSymbol=a.symbol;applyDeckColor(frame,a);
  if(typeof logoURLFor==='function'){const url=logoURLFor(a),record=readyLogoImages.get(url);if(record?.ready){updateLogoCardPalette(url,record.image);applyDeckColor(frame,a)}}
  const art=document.createElement('div');art.className='deckArt';
  const mark=document.createElement('span');mark.className='deckWatermark';mark.textContent=a.symbol;
  const logoBox=document.createElement('button');logoBox.className='deckLogo';logoBox.type='button';
  logoBox.setAttribute('aria-label','查看 '+a.symbol+' 简介');
  logoBox.onclick=()=>openInfoForPreview(a);
  logoBox.append(logoFor(a,true));
  const kindBadge=document.createElement('span');kindBadge.className='deckKindBadge';kindBadge.textContent=a.type==='ashare'?'A股':'永续';
  art.append(mark,logoBox,kindBadge);
  const title=document.createElement('div');title.className='deckTitleRow';
  const sym=document.createElement('strong');sym.textContent=a.symbol;
  const sub=document.createElement('span');sub.textContent=p?.name||a.name||(a.type==='ashare'?'A股':'OKX 永续合约');
  title.append(sym,sub);
  const body=document.createElement('div');body.className='deckBody';
  const priceRow=document.createElement('div');priceRow.className='deckPriceRow';
  const price=document.createElement('strong');price.className='deckPriceStrong';price.textContent=fmt(q?.p,a);
  const pctEl=document.createElement('span');pctEl.className='deckPct '+(pct==null?'':pct>=0?'up':'down');
  pctEl.textContent=pct==null?'—':(pct>0?'+':'')+pct.toFixed(2)+'%';
  priceRow.append(price,pctEl);
  // 迷你 K 线与分析共用所选周期。
  const sparkWrap=document.createElement('div');sparkWrap.className='deckSparkWrap';
  const spark=document.createElement('canvas');spark.className='deckSpark';spark.dataset.key=k;spark.dataset.period=cardPeriod;
  sparkWrap.append(spark);
  sparkWrap.setAttribute('role','button');sparkWrap.tabIndex=0;
  sparkWrap.setAttribute('aria-label','打开 '+a.symbol+' K 线');
  wireDeckSparkGesture(sparkWrap,spark);
  // 策略盈亏比（异步填充，先渲染骨架）
  const ratio=document.createElement('div');ratio.className='deckRatio pending';ratio.dataset.key=k;ratio.dataset.period=cardPeriod;
  const ratioHead=document.createElement('div');ratioHead.className='deckRatioHead';
  const ratioLabel=document.createElement('span');ratioLabel.textContent='方向概率';
  ratioHead.append(ratioLabel);
  const cardPeriods=document.createElement('nav');if(!preview)cardPeriods.id='deckCardPeriods';cardPeriods.className='deckPeriods deckCardPeriods';cardPeriods.setAttribute('aria-label','卡牌分析周期');
  const ratioRow=(cls,arrow,text)=>{const row=document.createElement('div');row.className='deckRatioRow '+cls;
    const lab=document.createElement('span');lab.className='deckRatioDir';lab.textContent=arrow+' '+text;
    const val=document.createElement('strong');val.className='deckRatioVal';val.textContent='—';
    const bar=document.createElement('span');bar.className='deckRatioBar';bar.setAttribute('role','img');bar.setAttribute('aria-label','盈亏比等待数据');
    const fill=document.createElement('i');bar.append(fill);
    // 第二行小字：该方向的止盈 / 止损参考价（与分析引擎 plans 一致）
    const prices=document.createElement('span');prices.className='deckRatioPrices';
    const gain=document.createElement('em');gain.className='deckRatioGain';gain.innerHTML='<small>止盈</small><b>暂时无法给出</b>';
    const loss=document.createElement('em');loss.className='deckRatioLoss';loss.innerHTML='<small>止损</small><b>暂时无法给出</b>';
    prices.append(gain,loss);
    row.append(lab,val,bar,prices);return row};
  const probabilities=document.createElement('div');probabilities.className='deckProbabilities';
  for(const [direction,label] of [['up','上行'],['flat','观望'],['down','下行']]){
    const item=document.createElement('div');item.className='deckProbability probabilityCard '+({up:'long',flat:'watch',down:'short'}[direction]);item.dataset.direction=direction;
    const name=document.createElement('span');name.textContent=label;
    const value=document.createElement('strong');value.textContent='—';
    const track=document.createElement('div');track.className='deckProbabilityTrack';track.setAttribute('aria-hidden','true');
    const column=document.createElement('i');column.className='deckProbabilityColumn';track.append(column);
    item.append(name,value,track);probabilities.append(item);
  }
  ratio.append(ratioHead,cardPeriods,probabilities,ratioRow('long','↑','上行'),ratioRow('short','↓','下行'));
  body.append(priceRow,sparkWrap,ratio);
  frame.append(art,title,body);
  card.append(frame);
  if(!preview)prioritizeAssetDisplay(a);else if(!profiles[k])queueProfile(a);
  renderDeckPeriods(preview?cardPeriods:null);if(!preview)resetDeckAnalysis();deckEnsureRatio(a,k);
}
// 手机卡面与展开图表共享按标的、周期缓存的 K 线及桌面分析算法。
const deckRatioCache={},deckRatioLoading=new Set(),deckRatioErrors={};
function resetDeckAnalysis(){
  const ratio=$('deckCard').querySelector('.deckRatio');if(!ratio)return;
  const period=effectivePeriod({type:ratio.dataset.key.split(':')[0]},deckMobileTf);ratio.dataset.period=period;ratio.classList.add('pending');
  deckApplyRatio(ratio.dataset.key,{period:period,ready:false});
  ratio.classList.add('pending');
  const canvas=$('deckCard').querySelector('.deckSpark');
  if(canvas){canvas.dataset.period=period;canvas.dataset.sparkOffset='0';canvas._sparkRows=[];canvas.classList.remove('ready');canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height)}
}
function deckLiveSparkRows(rows,k,period){
  const result=rows.map(row=>({...row})),last=result.at(-1),q=quotes[k];
  if(last&&last.confirmed!==true&&q?.p>0&&q.t>=last.t&&q.t<last.t+(tfMs[period]||0)){
    last.c=q.p;last.h=Math.max(last.h,q.p);last.l=Math.min(last.l,q.p);
  }
  return result;
}
function deckAnalysisPack(a,period,rows){
  const completed=rows.slice(0,completedCount(rows,period)),latest=rows.at(-1),last=completed.at(-1),q=quotes[assetId(a)];
  if(completed.length<35)return {period,ready:false,barCount:rows.length,sparkRows:rows.slice(-30)};
  const useQuote=q&&Number.isFinite(q.p)&&q.p>0&&q.t>0&&q.t>=latest.t;
  const entry=useQuote?q.p:latest.t>last.t?latest.c:last.c;
  const result=window.MarketStrategy.analyzeStrategy(completed.slice(-6000),entry);
  const call=window.MarketStrategy.tradeCall(result);
  return {period,ready:true,long:result.levels?.long,short:result.levels?.short,
    call:call.direction,probabilities:result.probabilities,samples:result.samples,
    support:result.levels?.support,resistance:result.levels?.resistance,
    plans:result.levels?.plans,callReason:call.reason,
    barCount:rows.length,sparkRows:rows.slice(-30)};
}
async function loadDeckBars(a,period){
  const cached=timeframeCache.get(assetId(a)+'|'+period);
  if(cached?.rows.length&&Date.now()-cached.fetchedAt<15000)return cached.rows;
  try{
    const data=await fetchTimeframe(a,period),rows=mergeBars(cached?.rows||[],validBars(data.candles));
    if(rows.length)rememberTimeframe(a,period,rows,data.stale?(cached?.fetchedAt||0):Date.now());
    return rows;
  }catch(error){if(cached?.rows.length)return cached.rows;throw error}
}
function deckEnsureRatio(a,k){
  const period=effectivePeriod(a,deckMobileTf),key=k+'|'+period,cache=deckRatioCache[key],cachedRows=timeframeCache.get(key)?.rows;
  if(cache&&Date.now()-cache.t<15000&&(!cachedRows||cachedRows.length===cache.barCount)){deckApplyRatio(k,cache);return}
  const cachedPack=cachedRows?.length?(cache?.period===period&&cache.barCount===cachedRows.length?cache:deckAnalysisPack(a,period,cachedRows)):null;
  if(cachedPack)deckApplyRatio(k,cachedPack);
  if(deckRatioLoading.has(key)||Date.now()<(deckRatioErrors[key]||0)||document.hidden||navigator.onLine===false)return;
  deckRatioLoading.add(key);
  (async()=>{
    const rows=await loadDeckBars(a,period),pack={...(rows===cachedRows&&cachedPack?cachedPack:deckAnalysisPack(a,period,rows)),t:Date.now()};
    deckRatioCache[key]=pack;delete deckRatioErrors[key];
    const keys=Object.keys(deckRatioCache);if(keys.length>40)delete deckRatioCache[keys[0]];
    deckApplyRatio(k,pack);
  })().catch(()=>{
    deckRatioErrors[key]=Date.now()+15000;
    for(const card of [$('deckCard'),$('deckPrevious'),$('deckNext')]){
      const ratio=card?.querySelector('.deckRatio');
      if(ratio?.dataset.key===k&&ratio.dataset.period===period){ratio.classList.remove('pending')}
    }
  }).finally(()=>deckRatioLoading.delete(key));
}
function deckPercentages(values){
  if(typeof window.MarketPhysics?.percentages==='function')return window.MarketPhysics.percentages(values);
  const rows=['up','flat','down'].map(key=>Number(values?.[key]));
  const sum=rows.reduce((a,b)=>a+b,0);
  if(rows.some(value=>!Number.isFinite(value)||value<0)||sum<=0)return null;
  const raw=rows.map(value=>value*100/sum),result=raw.map(Math.floor);
  const order=[0,1,2].sort((a,b)=>(raw[b]-result[b])-(raw[a]-result[a]));
  for(let i=0,n=100-result.reduce((a,b)=>a+b,0);i<n;i++)result[order[i%3]]++;
  return result;
}
function deckApplyRatio(k,pack){
  for(const card of [$('deckCard'),$('deckPrevious'),$('deckNext')]){
  const ratio=card?.querySelector('.deckRatio');
  if(!ratio||ratio.dataset.key!==k||ratio.dataset.period!==pack.period)continue;
  ratio.classList.remove('pending');
  ratio.querySelector('.deckRatioHead>span').textContent='方向概率 · '+deckPeriodName(pack.period);
  const percentages=deckPercentages(pack.probabilities);
  const winner=percentages?percentages.indexOf(Math.max(...percentages)):-1;
  let columnIndex=0;
  for(const item of ratio.querySelectorAll('.deckProbability')){
    const value=percentages?percentages[columnIndex]:null;
    item.querySelector('strong').textContent=Number.isFinite(value)?value+'%':'—';
    item.style.setProperty('--prob',Number.isFinite(value)?value+'%':'0%');
    item.classList.toggle('active',columnIndex===winner);item.classList.toggle('unknown',!percentages);columnIndex++;
  }
  const canvas=card.querySelector('.deckSpark');
  if(canvas&&pack.sparkRows?.length){if(canvas.dataset.period!==pack.period)canvas.dataset.sparkOffset='0';canvas.dataset.period=pack.period;canvas._sparkRows=deckLiveSparkRows(pack.sparkRows,k,pack.period);miniChart(canvas,canvas._sparkRows,Number(canvas.dataset.sparkOffset)||0);canvas.classList.add('ready')}
  const setRow=(cls,val,plan)=>{
    const row=ratio.querySelector('.deckRatioRow.'+cls);if(!row)return;
    const v=row.querySelector('.deckRatioVal'),bar=row.querySelector('.deckRatioBar'),fill=row.querySelector('.deckRatioBar i');
    const prices=row.querySelector('.deckRatioPrices');
    const valid=Number.isFinite(val)&&val>=0;
    row.classList.toggle('empty',!valid);
    if(valid){
      v.textContent=val.toFixed(2)+':1';
      // Reward : risk = R : 1, so the dividing point is R / (R + 1).
      fill.style.width=(val/(val+1)*100).toFixed(1)+'%';
      bar.setAttribute('aria-label','潜在盈利 '+val.toFixed(2)+'，潜在亏损 1');
    }else{v.textContent='—';fill.style.width='0%';bar.setAttribute('aria-label','盈亏比暂无数据')}
    // 止盈/止损价与分析页同一来源（levels.plans），无效风险门槛时显示占位说明。
    if(prices){
      const gain=prices.querySelector('.deckRatioGain'),loss=prices.querySelector('.deckRatioLoss');
      if(plan&&Number.isFinite(plan.target)&&Number.isFinite(plan.stop)){
        gain.innerHTML='<small>止盈</small><b>'+fmt(plan.target,{type:k.split(':')[0]})+'</b>';
        loss.innerHTML='<small>止损</small><b>'+fmt(plan.stop,{type:k.split(':')[0]})+'</b>';
        prices.classList.remove('none');
      }else{
        gain.innerHTML='<small>止盈</small><b>暂时无法给出</b>';
        loss.innerHTML='<small>止损</small><b>暂时无法给出</b>';
        prices.classList.add('none');
      }
    }
  };
  setRow('long',pack.long,pack.plans?.long);setRow('short',pack.short,pack.plans?.short);
  const badge=ratio.querySelector('.deckCallBadge');
  if(badge){badge.textContent=pack.call==='up'?'做多':pack.call==='down'?'做空':'观望';
    badge.className='deckCallBadge '+(pack.call==='up'?'up':pack.call==='down'?'down':'watch')}
  }
}

function updateDeckLive(){
  if($('petDeck').hidden||!petDeckGroup)return;
  const members=deckMembers();if(!members.length)return;
  for(const [id,offset] of [['deckCard',0],['deckPrevious',-1],['deckNext',1]]){
  const a=members[(petDeckIndex+offset+members.length)%members.length],card=$(id);if(!card)continue;
  const k=assetId(a),q=quotes[k];
  const price=card.querySelector('.deckPriceStrong'),pct=card.querySelector('.deckPct');
  if(price){const next=fmt(q?.p,a);if(price.textContent!==next){price.textContent=next;
    if(price.animate&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches)price.animate([{opacity:.55},{opacity:1}],{duration:380})}}
  if(pct){const ch=q&&q.base?(q.p/q.base-1)*100:null;
    pct.textContent=ch==null?'—':(ch>0?'+':'')+ch.toFixed(2)+'%';
    pct.className='deckPct '+(ch==null?'':ch>=0?'up':'down')}
  deckEnsureRatio(a,k);
  }
}
function flipDeck(dir){
  infoPreviewRequest++;
  const members=deckMembers(),card=$('deckCard');
  if(members.length<2){card.style.transform='';return}
  if(card.dataset.busy)return;
  card.dataset.busy='1';
  window.MarketPhysics?.sound('card');
  const transition=++deckTransition;
  deckNeighborReveal(-dir*window.innerWidth);
  card.style.transition='transform 420ms cubic-bezier(.28,.64,.3,1)';
  card.style.transform=deckSlideTransform(-dir*window.innerWidth);
  card.style.opacity='1';
  // 翻牌过半、肉眼已明确翻转时先同步进度数字，不等动画收尾。
  setTimeout(()=>{
    if(transition!==deckTransition||$('petDeck').hidden)return;
    const ahead=deckMembers();
    if(ahead.length)$('deckCount').textContent=`${(petDeckIndex+dir+ahead.length)%ahead.length+1} / ${ahead.length}`;
  },220);
  setTimeout(()=>{
    if(transition!==deckTransition||$('petDeck').hidden)return;
    const current=deckMembers();
    if(!current.length){card.dataset.busy='';buildDeckCard();return}
    petDeckIndex=(petDeckIndex+dir+current.length)%current.length;
    // The revealed card already occupies its final position; replace it in place.
    card.style.transition='none';card.style.transform=deckSlideTransform(0);
    buildDeckCard();card.dataset.busy='';
  },430);
}
// 复用原图表的绘制、周期与手势，只把对应节点临时放入手机卡组。
const deckChartMoved=[];
let deckDesktopTf=null;

const DECK_PERIODS_STORE='market_mobile_periods_v2';
const DECK_DEFAULT_PERIODS=['15m','1h','4h','1d'];
const DECK_PERIOD_OPTIONS=[['1m','1分'],['5m','5分'],['15m','15分'],['1h','1小时'],['2h','2小时'],['4h','4小时'],['6h','6小时'],['1d','1日'],['2d','2日'],['1w','周'],['1M','月']];
function sortDeckPeriods(periods){return [...periods].sort((a,b)=>DECK_PERIOD_OPTIONS.findIndex(([id])=>id===a)-DECK_PERIOD_OPTIONS.findIndex(([id])=>id===b))}
let deckPeriodSlots=[...DECK_DEFAULT_PERIODS],deckMobileTf='15m',deckReplaceSlot=3;
try{const saved=JSON.parse(localStorage.getItem(DECK_PERIODS_STORE)||'null');
  if(Array.isArray(saved)&&saved.length===4&&new Set(saved).size===4&&saved.every(p=>DECK_PERIOD_OPTIONS.some(([id])=>id===p)))deckPeriodSlots=sortDeckPeriods(saved);
}catch{}
if(!deckPeriodSlots.includes(deckMobileTf))deckMobileTf=deckPeriodSlots[0];
function deckPeriodName(period){return DECK_PERIOD_OPTIONS.find(([id])=>id===period)?.[1]||period}
function chooseDeckPeriod(period){
  if(deckMembers()[petDeckIndex]?.type==='ashare'&&!ASHARE_PERIODS.has(period))return;
  deckMobileTf=period;
  renderDeckPeriods();resetDeckAnalysis();
  if(typeof renderDeckNeighbors==='function')renderDeckNeighbors(deckMembers());
  const a=deckMembers()[petDeckIndex];if(a)deckEnsureRatio(a,assetId(a));
  if(deckChartMoved.length){tf=period;loadAsset()}
}
function replaceDeckPeriod(period){
  if(deckMembers()[petDeckIndex]?.type==='ashare'){chooseDeckPeriod(period);return}
  if(!deckPeriodSlots.includes(period))deckPeriodSlots[deckReplaceSlot]=period;
  deckPeriodSlots=sortDeckPeriods(deckPeriodSlots);
  deckReplaceSlot=deckPeriodSlots.indexOf(period);
  try{localStorage.setItem(DECK_PERIODS_STORE,JSON.stringify(deckPeriodSlots))}catch{}
  chooseDeckPeriod(period);
}
function renderDeckPeriods(previewNav=null){
  for(const nav of previewNav?[previewNav]:[$('deckPeriods'),$('deckCardPeriods')]){
  if(!nav)continue;nav.replaceChildren();
  const key=nav.closest?.('.deckRatio')?.dataset.key;const a=key?{type:key.split(':')[0]}:deckMembers()[petDeckIndex];
  deckSlotsFor(a).forEach((period,index)=>{const button=document.createElement('button');button.type='button';button.textContent=deckPeriodName(period);
    button.classList.toggle('active',period===effectivePeriod(a,deckMobileTf));button.setAttribute('aria-pressed',String(period===effectivePeriod(a,deckMobileTf)));
    button.onclick=()=>{deckReplaceSlot=index;chooseDeckPeriod(period)};nav.append(button)});
  const more=document.createElement('button');more.type='button';more.textContent='更多';more.setAttribute('aria-haspopup','dialog');more.onclick=openDeckPeriodDialog;nav.append(more);
  }
}
function openDeckPeriodDialog(){
  let dialog=$('deckPeriodDialog');
  if(!dialog){dialog=document.createElement('dialog');dialog.id='deckPeriodDialog';dialog.className='mobileSheet';dialog.setAttribute('aria-label','K 线周期');document.body.append(dialog)}
  dialog.replaceChildren();
  const head=document.createElement('div');head.className='mobileSheetHead';
  const title=document.createElement('strong');title.textContent='周期';
  const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','关闭周期选择');close.onclick=()=>dialog.close();head.append(title,close);dialog.append(head);
  const slots=document.createElement('div');slots.className='deckPeriodSlots';slots.setAttribute('aria-label','替换的常用周期');
  deckSlotsFor(deckMembers()[petDeckIndex]).forEach((period,index)=>{const button=document.createElement('button');button.type='button';button.textContent=deckPeriodName(period);
    button.classList.toggle('active',index===deckReplaceSlot);button.setAttribute('aria-pressed',String(index===deckReplaceSlot));
    button.onclick=()=>{deckReplaceSlot=index;openDeckPeriodDialog()};slots.append(button)});dialog.append(slots);
  const grid=document.createElement('div');grid.className='deckPeriodOptions';
  for(const [period,label] of DECK_PERIOD_OPTIONS){if(deckMembers()[petDeckIndex]?.type==='ashare'&&!ASHARE_PERIODS.has(period))continue;const button=document.createElement('button');button.type='button';button.textContent=label;
    button.classList.toggle('active',period===deckMobileTf);
    button.onclick=()=>{replaceDeckPeriod(period);dialog.close()};grid.append(button)}
  dialog.append(grid);openDetailDialog(dialog);
}
let petNewsSerial=0,petNewsAsset=null,petNewsSearchSerial=0,petNewsSearchTimer=null;
const NEWS_RECOMMENDED_SYMBOLS=[
  'BTC','ETH','SOL','XRP','DOGE',
  'NVDA','AAPL','TSLA','MSFT','AMZN',
  'META','GOOGL','AMD','TSM','MU',
  'SOXL','SOXS','AVAX','LINK','QQQ'
];
function newsRecommendedAssets(){
  return NEWS_RECOMMENDED_SYMBOLS.map(symbol=>
    instrumentCatalog?.find(item=>item.symbol===symbol)||
    {type:'swap',symbol,name:STOCK_NAMES[symbol]?.[0]||symbol});
}
function createMobilePageLoading(){const node=document.createElement('div');node.className='mobilePageLoading';node.setAttribute('role','status');node.setAttribute('aria-live','polite');const icon=document.createElement('span');icon.className='mobileLoadingRing';icon.setAttribute('aria-hidden','true');const text=document.createElement('span');text.textContent='正在加载';node.append(icon,text);return node}
function renderPetNews(rows,note=''){
  const list=$('petNewsList');list.replaceChildren();
  if(!rows?.length&&note==='正在加载'){list.append(createMobilePageLoading());return}
  const valid=Array.isArray(rows)?rows.filter(item=>{try{return item.headline&&new URL(item.url).protocol==='https:'}catch{return false}}).slice(0,25):[];
  if(!valid.length){const p=document.createElement('p');p.className='petNewsEmpty';p.textContent=note||'暂无相关新闻';list.append(p);return}
  valid.forEach((item,index)=>{
    const meta=[item.source,Number(item.datetime)?date(Number(item.datetime)*1000):''].filter(Boolean).join(' · ');
    const summaryText=item.summary?new DOMParser().parseFromString(String(item.summary),'text/html').body.textContent.trim().slice(0,380):'';
    const article=window.MarketNewsPaper.create(item,{index,meta,summaryText});
    if(article){article.classList.add('petNewsItem');list.append(article)}
  });
}
async function openPetNews(){
  if(!(window.MarketDevice?.isMobile?.()??window.innerWidth<=720))return;
  let dialog=$('petNewsDialog');
  if(!dialog){dialog=document.createElement('dialog');dialog.id='petNewsDialog';dialog.className='mobileSheet petNewsDialog';dialog.setAttribute('aria-label','相关新闻');
    dialog.innerHTML='<header class="mobileSheetHead petNewsHead"><button id="petNewsBack" type="button" aria-label="返回"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 5 8.5 12 15.5 19"/></svg></button><strong id="petNewsTitle">新闻</strong><button id="petNewsSearchButton" type="button" aria-label="选择新闻标的"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg></button></header><section id="petNewsPicker" class="petNewsPicker" hidden><form id="petNewsSearchForm"><input id="petNewsSearchInput" type="search" placeholder="搜索代码或名称" aria-label="搜索新闻标的" autocomplete="off"></form><div id="petNewsChoices" class="petNewsChoices"></div></section><div id="petNewsList" class="petNewsList"></div>';
    document.body.append(dialog);
    $('petNewsBack').onclick=()=>{
      if(window.MarketMobilePages?.back)window.MarketMobilePages.back();else returnToPetHome();
    };
    $('petNewsSearchButton').onclick=()=>{
      $('petNewsPicker').hidden=false;$('petNewsList').hidden=true;
      $('petNewsTitle').textContent='选择标的';$('petNewsSearchButton').hidden=true;
      $('petNewsSearchInput').value='';searchPetNewsAssets();$('petNewsSearchInput').focus({preventScroll:true});
      if(!instrumentCatalog)loadCatalog().then(()=>searchPetNewsAssets()).catch(()=>{});
    };
    $('petNewsSearchForm').onsubmit=e=>{e.preventDefault();searchPetNewsAssets()};
    bindMobileAssetSearch($('petNewsSearchInput'),()=>{clearTimeout(petNewsSearchTimer);searchPetNewsAssets()});
    dialog.addEventListener('close',()=>{petNewsSearchSerial++;petNewsSerial++;clearTimeout(petNewsSearchTimer)});
  }
  openDetailDialog(dialog);await loadPetNews(petNewsAsset||current());
}
function hidePetNewsPicker(){
  petNewsSearchSerial++;clearTimeout(petNewsSearchTimer);
  $('petNewsPicker').hidden=true;$('petNewsList').hidden=false;$('petNewsSearchButton').hidden=false;
  $('petNewsTitle').textContent=petNewsAsset?'新闻 · '+petNewsAsset.symbol:'新闻';
}
async function searchPetNewsAssets(){
  const query=$('petNewsSearchInput').value.trim(),serial=++petNewsSearchSerial,box=$('petNewsChoices');
  box.replaceChildren();
  try{
    const matches=new Map();
    if(!query){
      // 空搜索：展示推荐标的，不限于已持有
      for(const a of newsRecommendedAssets())matches.set(assetId(a),a);
      // 如果目录已加载，补充几个热门币
      if(instrumentCatalog){
        for(const s of ['BTC','ETH','SOL']){const item=instrumentCatalog.find(i=>i.symbol===s);if(item)matches.set(assetId(item),item)}
      }
    }else{
      // 有搜索：和桌面端一致，统一用 matchCatalog 模糊匹配（含编辑距离、中文别名）
      if(!instrumentCatalog){
        try{await loadCatalog()}catch{}
      }
      if(instrumentCatalog){
        for(const a of mobileAssetMatches(query))matches.set(assetId(a),a);
      }else{
        // 目录仍不可用时用服务端兜底
        const found=(await api('/api/search?q='+encodeURIComponent(query))).results||[];
        if(serial!==petNewsSearchSerial||$('petNewsPicker').hidden||!$('petNewsDialog').open)return;
        for(const a of found)matches.set(assetId(a),a);
      }
    }
    if(serial!==petNewsSearchSerial||$('petNewsPicker').hidden||!$('petNewsDialog').open)return;
    if(!query||[...matches.values()].some(a=>a.matchType==='close'||a.matchType==='related')){
      const heading=document.createElement('p');heading.className='petNewsChoiceHeading';heading.textContent=query?'可能想找':'热门推荐';box.append(heading);
    }
    for(const a of [...matches.values()].slice(0,30)){
      const button=document.createElement('button');button.type='button';button.className='petNewsChoice';
      const label=document.createElement('span'),symbol=document.createElement('strong'),name=document.createElement('small');
      symbol.textContent=a.symbol;name.textContent=a.name||profiles[assetId(a)]?.name||(a.type==='ashare'?'A股':'USDT 永续');label.append(symbol,name);
      button.append(logoFor(a),label);button.onclick=()=>{if(query)recordSearch(query);loadPetNews({type:a.type,symbol:a.symbol,name:a.name})};box.append(button);
    }
    if(!box.querySelector('.petNewsChoice')){
      const empty=document.createElement('p');empty.className='petNewsEmpty';empty.textContent=query?'没有找到匹配的标的':'暂无推荐标的';box.append(empty)}
  }catch{
    if(serial!==petNewsSearchSerial||$('petNewsPicker').hidden)return;
    const note=document.createElement('p');note.className='petNewsEmpty';note.textContent='搜索暂不可用，请稍后重试';box.replaceChildren(note);
  }
}
async function loadPetNews(a){
  petNewsAsset=a;hidePetNewsPicker();
  const dialog=$('petNewsDialog'),serial=++petNewsSerial;
  $('petNewsTitle').textContent=a?'新闻 · '+a.symbol:'新闻';
  if(!a){renderPetNews(null,'先选择一个标的');return}
  const key=assetId(a),cached=newsPreviewCache.get(key);renderPetNews(cached,'正在加载');
  try{const rows=await fetchAssetNews(a);if(serial!==petNewsSerial||!dialog.open)return;
    newsPreviewCache.set(key,rows);renderPetNews(rows);
  }catch{if(serial===petNewsSerial&&dialog.open)renderPetNews(cached,'新闻暂不可用')}
}
function openDeckChart(){
  if(deckChartMoved.length||$('deckCard').dataset.busy)return;
  const a=deckMembers()[petDeckIndex];if(!a||!(window.MarketDevice?.isMobile?.()??window.innerWidth<=720))return;
  const view=$('deckChartView');
  const body=$('deckCard').querySelector('.deckBody');if(!body)return;
  const ratio=body.querySelector('.deckRatio');if(ratio)ratio.before(view);else body.append(view);
  view.prepend($('deckPeriods'));$('deckPeriods').hidden=false;
  renderDeckMa();
  if(!deckChartMoved.length){
    const hero=document.querySelector('.hero');
    for(const selector of ['.chartBox','.insightDisclosure','.legend']){
      const node=hero.querySelector(selector);if(!node)continue;
      const marker=document.createComment('deckChartReturn');node.before(marker);
      deckChartMoved.push([marker,node]);view.append(node);
    }
  }
  view.hidden=false;
  $('petDeck').classList.add('deckChartMode');
  $('deckTitle').textContent=a.symbol+' · K 线';
  $('deckClose').setAttribute('aria-label','返回当前卡片');
  deckDesktopTf=tf;
  selectAsset(assetId(a),petDeckGroup);
  tf=deckMobileTf;renderDeckPeriods();loadAsset();
  requestAnimationFrame(()=>{scheduleDraw();draw()});
}
function closeDeckChart(){
  if(!deckChartMoved.length)return;
  for(const [marker,node] of deckChartMoved)marker.replaceWith(node);
  deckChartMoved.length=0;
  if(deckDesktopTf){tf=deckDesktopTf;deckDesktopTf=null;loadAsset()}
  $('deckPeriods').hidden=true;
  if($('deckPeriodDialog')?.open)$('deckPeriodDialog').close();
  $('deckChartView').hidden=true;$('petDeck').append($('deckChartView'));
  $('petDeck').classList.remove('deckChartMode');
  $('deckTitle').textContent=groups.find(g=>g.id===petDeckGroup)?.name||'卡组';
  $('deckClose').setAttribute('aria-label','返回主屏');
  scheduleDraw();
}
function deckAdd(){
  const group=petDeckGroup||activeGroupId;
  if(group&&group!==HOT_GROUP_ID)openPetManager(group);
}
function openPetDeck(groupId,index=0){
  if(groupId===HOT_GROUP_ID)loadDailyHot();
  if(!$('petDeck').firstChild)buildDeckShell();
  const g=groups.find(x=>x.id===groupId);if(!g)return;
  petDeckGroup=groupId;petDeckIndex=Math.max(0,Math.min(index,deckMembers().length-1));$('petDeck').dataset.groupId=groupId;$('petDeck').dataset.index=String(petDeckIndex);
  $('deckTitle').textContent=g.name;
  const card=$('deckCard');card.dataset.busy='';card.style.transform='';card.style.opacity='';
  $('petDeck').hidden=false;
  document.body.classList.add('petDeckOpen');
  buildDeckCard();
  // 前后卡牌共享动画时钟，交接时保持同一浮动位置。
  requestAnimationFrame(()=>{
    const stage=$('deckStage');if(!stage||$('petDeck').hidden)return;
    const started=document.timeline?.currentTime;
    if(started==null)return;
    for(const node of stage.querySelectorAll('.deckCard,.deckNeighbor'))
      for(const animation of node.getAnimations?.()||[])
        if(animation.animationName==='deckQuietSway')animation.startTime=started;
  });
  for(const offset of [-1,0,1]){const members=deckMembers();if(!members.length)break;const a=members[(petDeckIndex+offset+members.length)%members.length];queueMini(a);if(!profiles[assetId(a)])queueProfile(a)}
  if(petDeckTimer)clearInterval(petDeckTimer);
  petDeckTimer=setInterval(()=>{if(!$('petDeck').hidden)updateDeckLive()},3000);
}
function closePetDeck(){
  infoPreviewRequest++;
  closeDeckChart();
  deckTransition++;
  deckNeighborReveal(0);
  $('petDeck').hidden=true;petDeckGroup=null;
  document.body.classList.remove('petDeckOpen');
  if(petDeckTimer){clearInterval(petDeckTimer);petDeckTimer=null}
}
function wireDeckStage(){
  const stage=$('deckStage');let drag=null;
  stage.addEventListener('pointerdown',e=>{
    if(deckChartMoved.length)return;
    if(e.target.closest('button,a,[role="button"]')||$('deckCard').dataset.busy||!e.isPrimary)return;
    const started=performance.now();
    drag={id:e.pointerId,x:e.clientX,y:e.clientY,t:started,dx:0,axis:null,samples:[{x:0,t:started}]};
  });
  stage.addEventListener('pointermove',e=>{
    if(!drag||e.pointerId!==drag.id)return;
    const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
    if(!drag.axis&&Math.hypot(dx,dy)>8){
      drag.axis=Math.abs(dx)>Math.abs(dy)?'x':'y';
      if(drag.axis==='x')try{stage.setPointerCapture(e.pointerId)}catch{}
    }
    const stamp=performance.now();drag.samples.push({x:dx,t:stamp});
    while(drag.samples.length>1&&drag.samples[0].t<stamp-120)drag.samples.shift();
    if(drag.axis!=='x')return;
    drag.dx=dx;
    $('deckCard').classList.add('deckDragging');
    const card=$('deckCard');card.style.transition='none';
    const resisted=dx*.82;card.style.transform=deckSlideTransform(resisted);deckNeighborReveal(resisted);
  });
  const reset=()=>{const card=$('deckCard'),transition=++deckTransition;card.dataset.busy='1';card.style.transition='transform 360ms cubic-bezier(.22,.72,.25,1)';card.style.transform=deckSlideTransform(0);deckNeighborReveal(0,true);setTimeout(()=>{if(transition===deckTransition){deckNeighborReveal(0);card.dataset.busy=''}},370)};
  stage.addEventListener('pointerup',e=>{
    if(!drag||e.pointerId!==drag.id)return;
    const d=drag;drag=null;$('deckCard').classList.remove('deckDragging');
    const released=performance.now(),first=d.samples[0],last=d.samples.at(-1);
    const velocity=(last.x-first.x)/Math.max(1,last.t-first.t);
    const previous=d.samples.at(-2)||first;
    const threshold=Math.min(138,Math.max(84,stage.clientWidth*.32));
    const flickDistance=Math.min(64,Math.max(44,stage.clientWidth*.16));
    const flick=Math.abs(d.dx)>=flickDistance&&Math.abs(velocity)>=.65&&
      Math.sign(velocity)===Math.sign(d.dx)&&Math.sign(last.x-previous.x)===Math.sign(d.dx)&&released-last.t<=80;
    if(d.axis==='x'&&(Math.abs(d.dx)>threshold||flick))flipDeck(d.dx<0?1:-1);
    else reset();
  });
  stage.addEventListener('pointercancel',()=>{drag=null;$('deckCard').classList.remove('deckDragging');reset()});
}
function buildDeckShell(){
  const deck=$('petDeck');
  deck.replaceChildren();
  const head=document.createElement('header');head.className='deckHead';
  head.innerHTML=`<button class="deckBack" id="deckClose" type="button" aria-label="返回主屏"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15.5 5 8.5 12 15.5 19"/></svg></button>
    <div class="deckHeadTitle"><strong id="deckTitle">卡组</strong></div>
`;
  deck.append(head);
  const stage=document.createElement('main');stage.className='deckStage';stage.id='deckStage';
  const stack=document.createElement('div');stack.id='deckStack';stack.className='deckStack';stack.setAttribute('aria-hidden','true');
  for(let i=0;i<4;i++){const edge=document.createElement('i');stack.append(edge)}stage.append(stack);
  for(const id of ['deckPrevious','deckNext']){
    const layer=document.createElement('div');layer.id=id;layer.className='deckNeighbor '+(id==='deckPrevious'?'previous':'next');
    layer.setAttribute('aria-hidden','true');layer.inert=true;stage.append(layer);
  }
  const card=document.createElement('div');card.className='deckCard';card.id='deckCard';
  stage.append(card);
  const count=document.createElement('span');count.className='deckCount';count.id='deckCount';count.textContent='—';count.setAttribute('aria-live','polite');stage.append(count);
  deck.append(stage);
  const chartView=document.createElement('section');chartView.id='deckChartView';chartView.className='deckChartView';chartView.hidden=true;
  chartView.setAttribute('aria-label','当前标的 K 线');deck.append(chartView);
  const periods=document.createElement('nav');periods.id='deckPeriods';periods.className='deckPeriods';periods.hidden=true;periods.setAttribute('aria-label','K 线周期');chartView.append(periods);
  $('deckClose').onclick=()=>{if(window.MarketMobilePages?.deckBack)window.MarketMobilePages.deckBack();else if($('petDeck').classList.contains('deckChartMode'))closeDeckChart();else closePetDeck()};
  wireDeckStage();
}
function returnToPetHome(){
  for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
  closePetDeck();setPetHome(true);
}
function syncMobileReturnButtons(){
  for(const button of document.querySelectorAll('[data-close]')){
    if(button.dataset.close==='alertsDialog')continue;
    if(!button.dataset.desktopLabel)button.dataset.desktopLabel=button.getAttribute('aria-label')||'关闭';
    button.setAttribute('aria-label',(window.MarketDevice?.isMobile?.()??window.innerWidth<=720)?'返回':button.dataset.desktopLabel);
  }
}
function setupPetHome(){
  window.MarketMobilePages?.setActions({goHome:returnToPetHome,openDeck:openPetDeck,closeDeck:closePetDeck,openChart:openDeckChart,closeChart:closeDeckChart,openManager:openPetManager,managerDraft:()=>petDraft,openSearch:()=>{const source=petDeckGroup||activeGroupId;openPetManager(source===HOT_GROUP_ID?'main':source);openPetAssetSearch()},closeManager:closePetManager});
  const classicBack=document.createElement('button');
  classicBack.type='button';classicBack.className='mobileClassicBack';classicBack.setAttribute('aria-label','返回');
  classicBack.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15.5 5 8.5 12 15.5 19"/></svg>';
  classicBack.onclick=returnToPetHome;document.querySelector('.mast').prepend(classicBack);
  syncMobileReturnButtons();window.addEventListener('resize',syncMobileReturnButtons);
  $('petHomeEntry').onclick=()=>{$('mobileMoreDialog').close();setPetHome(true)};
  window.addEventListener('resize',applyPetHomeVisibility);
  const syncMobileViewport=()=>{
    const view=window.MarketDevice?.viewport?.()||window.visualViewport;
    const height=view?.height||window.innerHeight;
    const typing=document.activeElement?.matches?.('input,textarea,select,[contenteditable="true"]');
    if((window.MarketDevice?.isPhone?.()??false)&&typing){
      // 键盘弹出只覆盖页面：键盘动画是逐帧收缩的，一收缩就冻结，任何元素都不动
      if(height<(syncMobileViewport.fullHeight||0))return;
      syncMobileViewport.fullHeight=height;
    }else syncMobileViewport.fullHeight=height;
    document.documentElement.style.setProperty('--mobile-viewport-height',height+'px');
    document.documentElement.style.setProperty('--mobile-viewport-top',(view?.offsetTop||0)+'px');
  };
  window.visualViewport?.addEventListener('resize',syncMobileViewport);
  window.visualViewport?.addEventListener('scroll',syncMobileViewport);
  window.addEventListener('resize',syncMobileViewport);syncMobileViewport();
  applyPetHomeVisibility();
}
// 手机键盘只覆盖页面：登录面板与人物插画保持原位，不再做键盘避让
function syncAuthInputLayout(){
  const dialog=$('authDialog');
  if(dialog?.classList.contains('authInputActive'))dialog.classList.remove('authInputActive');
}
// 登录页吉祥物只属于手机模式；手机旋转不改变设备模式。
function syncAuthMascot(){
  const authPanel=document.querySelector('.authPanel');
  if(!authPanel)return;
  const existing=authPanel.querySelector('.authMascot');
  if((window.MarketDevice?.isMobile?.()??window.innerWidth<=720)){
    if(!existing){
      const mascot=document.createElement('div');
      mascot.className='authMascot';mascot.setAttribute('aria-hidden','true');
      mascot.innerHTML='<span class="petModel"></span>';
      authPanel.prepend(mascot)}
    let saved={};try{const parsed=JSON.parse(localStorage.getItem('market_login_pets_v1')||'{}');if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))saved=parsed}catch{}
    const username=String(accountUser||$('authUsername')?.value||'').trim().toLowerCase();
    const kind=accountUser?accountAvatarKind:authMode==='register'?registrationPetKind:(saved[username]??0);
    if(accountUser)try{localStorage.setItem('market_login_pets_v1',JSON.stringify(Object.fromEntries([...Object.entries(saved).filter(([key])=>key!==username),[username,kind]].slice(-32))))}catch{}
    const mascot=authPanel.querySelector('.authMascot'),url=companionArtworkUrl(Number.isInteger(kind)&&kind>=0&&kind<8?kind:0);
    mascot.dataset.requestedImage=url;
    prepareLogoImage(url).promise.then(image=>{if(image&&mascot.isConnected&&mascot.dataset.requestedImage===url)mascot.style.setProperty('--auth-pet-image',`url("${url}")`)});
  }else{if(existing)existing.remove();if($('authPetPicker'))$('authPetPicker').hidden=true}
}
setup();

})();
