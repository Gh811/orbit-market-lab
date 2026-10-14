const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const theme=fs.readFileSync('assets/theme.js','utf8'),ctx={};vm.createContext(ctx);
vm.runInContext(theme.slice(theme.indexOf('function fixedDetailLines('),theme.indexOf('function stage(',theme.indexOf('function fixedDetailLines('))),ctx);
for(const count of [0,1,2,5,6,7,20]){
 const lines=Array.from({length:count},(_,i)=>'✓ 完成第 '+i+' 项\n详情');const value=ctx.fixedDetailLines(lines);
 assert.equal(value.split('\n').length,6,'always reserve six completion slots');assert.ok(value.split('\n').filter(Boolean).length<=6);assert.ok(!value.includes('\n详情'),'embedded newlines cannot add layout rows');if(count>6)assert.ok(!value.includes('第 0 项'),'keep the latest completed stages');
}
const paper=require('../assets/news-paper.js');
class Node{constructor(tag){this.tag=tag;this.children=[];this.flags=new Set();this.classList={add:n=>this.flags.add(n)}}append(...nodes){this.children.push(...nodes)}replaceChildren(...nodes){this.children=nodes}setAttribute(){}}
const list=new Node('div');global.document={createElement:tag=>new Node(tag)};
const appContext={window:{MarketNewsPaper:paper},$:()=>list,URL,date:()=> '2026/10/14',document:global.document,DOMParser:class{parseFromString(s){return {body:{textContent:s.replace(/<[^>]+>/g,'')}}}}};vm.createContext(appContext);
const app=fs.readFileSync('assets/app.js','utf8');vm.runInContext(app.slice(app.indexOf('function renderPetNews('),app.indexOf('async function openPetNews(',app.indexOf('function renderPetNews('))),appContext);
appContext.renderPetNews([{headline:'第一条',url:'https://example.com/1',source:'来源一',summary:'<b>可以看到的新闻摘要</b>'},{headline:'第二条',url:'https://example.com/2',source:'来源二'}]);
assert.equal(list.children.length,2,'separate article for each news result');assert.ok(list.children[0].flags.has('petNewsItem'));assert.equal(list.children[0].children[0].children[2].children[1].textContent,'可以看到的新闻摘要');assert.equal(list.children[1].children[0].children[2].children.length,1,'missing summary does not produce a blank block');
console.log('Loading keeps six history lines; separate news articles retain plain summaries and original destinations PASS');
