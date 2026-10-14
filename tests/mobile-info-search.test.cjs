const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('assets/app.js','utf8');
function fn(name){const start=source.indexOf('function '+name+'(');let depth=0;for(let i=source.indexOf('{',start);i<source.length;i++){if(source[i]==='{')depth++;if(source[i]==='}'&&!--depth)return source.slice(start,i+1)}}
const c={instrumentCatalog:[...JSON.parse(fs.readFileSync('data/ashare_catalog.json')).items,{type:'swap',symbol:'BTC',name:'Bitcoin'},{type:'swap',symbol:'TRUMP',name:'Official Trump'}],catalogSearchIndex:null,recordSearch(){}};
vm.createContext(c);vm.runInContext(source.slice(source.indexOf('const normalizeSearch='),source.indexOf('function searchTerms('))+['searchTerms','editDistance','matchCatalog','briefAssetSummary'].map(fn).join('\n'),c);
for(const [query,symbol]of [['川扑','TRUMP'],['茅太','SH600519'],['东山精蜜','SZ002384'],['贵州茅抬','SH600519'],['btcc','BTC'],['BCT','BTC'],['600519','SH600519']])assert(c.matchCatalog(query).some(a=>a.symbol===symbol),query);
assert(c.matchCatalog('不存在的错误字').length>0,'show real candidate titles instead of a blank list');
const long='这家公司主要提供'+ '金融市场、银行业务、证券服务、资产管理及企业服务，'.repeat(5)+'并开展相关研究。';assert(!c.briefAssetSummary(long).includes('补全'));assert.equal(c.briefAssetSummary(long),long);
console.log('PASS: typo/transposition/prefix matches use real catalogue assets; verified long summaries remain visible');
