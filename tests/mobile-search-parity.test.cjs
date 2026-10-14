const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const s=fs.readFileSync(require('node:path').join(__dirname,'../assets/app.js'),'utf8');
class Node{constructor(){this.children=[];this.dataset={};this.hidden=false}replaceChildren(...items){this.children=items}append(...items){this.children.push(...items)}querySelector(selector){return this.children.find(n=>'.'+n.className===selector)}setAttribute(name,value){this[name]=value}removeAttribute(name){delete this[name]}}
const groupInput={value:''},newsInput={value:''},groupResults=new Node(),newsResults=new Node();
const nodes={petOwnSearch:groupInput,petOwnResults:groupResults,petNewsSearchInput:newsInput,petNewsChoices:newsResults,petNewsPicker:{hidden:false},petNewsDialog:{open:true}};
let requests=0;
const c={document:{createElement:()=>new Node()},$:id=>nodes[id],petManagerGroup:'existing-group',petManagerOwner:'alice',accountSpace:'alice',accountUser:null,petManagerSerial:0,petSearchAbort:null,petNewsSearchSerial:0,AbortController,MAX_GROUP_ASSETS:50,HOT_GROUP_ID:'hot',assets:[],profiles:{},catalogSearchIndex:null,instrumentCatalog:[{type:'swap',symbol:'BTC',name:'Bitcoin',aliases:['比特币']},{type:'swap',symbol:'ETH',name:'Ethereum',aliases:['以太坊']},{type:'swap',symbol:'AAPL',name:'Apple',aliases:['苹果']}],assetId:a=>'swap:'+a.symbol,recordSearch(){},petManagedAssets:()=>[],logoFor:()=>new Node(),rememberAssetLogos(){},newsRecommendedAssets:()=>[],api:async()=>{requests++;throw Error('local search should not request network')},loadCatalog:async()=>{},insertPetCard(){},showPetAlreadyAdded(){},setPetManagerNotice(){}};
vm.createContext(c);
vm.runInContext(s.slice(s.indexOf('const normalizeSearch='),s.indexOf('async function loadCatalog(){')),c);
vm.runInContext(s.slice(s.indexOf('function petAssetRecommendations(){'),s.indexOf('function deckMembers(){')),c);
vm.runInContext(s.slice(s.indexOf('async function searchPetNewsAssets(){'),s.indexOf('async function loadPetNews(')),c);
const symbols=box=>box.children.filter(n=>n.tagName==='BUTTON'||n.type==='button').map(n=>n.children[1].children[0].textContent);
c.bindMobileAssetSearch(groupInput,c.searchPetAssets);c.bindMobileAssetSearch(newsInput,c.searchPetNewsAssets);
for(const [prefix,expected] of [['b','BTC'],['bt','BTC'],['a','AAPL'],['苹','AAPL'],['以','ETH'],['比特','BTC']]){
 groupInput.value=newsInput.value=prefix;groupInput.oninput({isComposing:true});newsInput.oninput({isComposing:true});
 assert.equal(symbols(groupResults)[0],expected,'group puts prefix match first during input without submit: '+prefix);
 assert.equal(symbols(newsResults)[0],expected,'news puts prefix match first during input without submit: '+prefix);assert.deepEqual(symbols(groupResults),symbols(newsResults));
}
assert.equal(requests,0,'partial input stays local');
(async()=>{for(const query of ['btc','BTC/USDT','比特','Apple','苹果','以太坊','BTCC','zzzzzz']){groupInput.value=newsInput.value=query;await c.searchPetAssets();await c.searchPetNewsAssets();assert.deepEqual(symbols(groupResults),symbols(newsResults),'same ordered candidates for '+query)}assert.equal(requests,0);console.log('Mobile search parity: existing group and news render identical code, pair, Chinese, name, typo and no-match candidates without network PASS')})().catch(error=>{console.error(error);process.exitCode=1});
