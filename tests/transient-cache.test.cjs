const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{createPublicCache}=require('../assets/data.js');
const source=fs.readFileSync('assets/app.js','utf8');class Storage{constructor(){this.rows=new Map()}get length(){return this.rows.size}key(i){return [...this.rows.keys()][i]??null}getItem(k){return this.rows.get(k)??null}setItem(k,v){this.rows.set(k,v)}removeItem(k){this.rows.delete(k)}}
const disk=new Storage(),session=new Storage(),events={};disk.setItem('account','keep');let cleared=0;
const c={localStorage:disk,sessionStorage:session,candleSessionTimer:1,clearTimeout(){},window:{MarketData:{createPublicCache,clearTransientCache(){cleared++}},addEventListener:(name,callback)=>events[name]=callback}};
vm.createContext(c);vm.runInContext(source.slice(source.indexOf('let pageCacheClosed='),source.indexOf("const PROFILE_CACHE="))+'\nglobalThis.cache=publicMarketCache;',c);
c.cache.setItem('market_profiles_v29',JSON.stringify({'ashare:SZ000651':{summary:'真实资料'}}));events.pagehide({persisted:true});assert.equal(cleared,0);
events.pagehide({persisted:false});assert.equal(cleared,1);assert.match(createPublicCache(disk,new Storage()).getItem('market_profiles_v29'),/真实资料/);assert.equal(disk.getItem('account'),'keep');assert.equal(vm.runInContext('pageCacheClosed',c),true);
console.log('Page close PASS: request memory released, public on-phone records retained, private account state untouched, closed page tracked');
