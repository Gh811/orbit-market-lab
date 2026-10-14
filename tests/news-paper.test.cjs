const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
class Node{
 constructor(tag){this.tag=tag;this.children=[];this.attributes={};this.flags=new Set();this.classList={add:flag=>this.flags.add(flag)}}
 append(...nodes){this.children.push(...nodes)}setAttribute(name,value){this.attributes[name]=value}
}
const context={window:{},document:{createElement:tag=>new Node(tag)},URL};vm.createContext(context);vm.runInContext(fs.readFileSync('assets/news-paper.js','utf8'),context);
const create=context.window.MarketNewsPaper.create;
const item={headline:'原始新闻标题：公司公布新进展',source:'原始来源',url:'https://news.example.com/original?id=42',summary:'移动端原来没有展示的摘要'};
const paper=create(item,{index:2,meta:'原始来源 · 2026/10/14'}),link=paper.children[0];
assert.equal(link.href,item.url);assert.equal(link.target,'_blank');assert.equal(link.rel,'noopener noreferrer');assert.equal(link.attributes['aria-label'],item.headline);
assert.equal(link.children[1].textContent,'原始来源 · 2026/10/14');assert.equal(link.children[2].children[0].textContent,item.headline);assert.equal(link.children[2].children.length,1,'mobile previews preserve existing fields without adding an excerpt');assert.equal(link.children.length,3,'paper links have no separate action/footer or arrow');
const withExcerpt=create(item,{summaryText:'已有的摘要文字'});assert.equal(withExcerpt.children[0].children[2].children[1].textContent,'已有的摘要文字');
assert.equal(create({...item,url:'javascript:alert(1)'}),null);assert.equal(create({...item,url:'http://news.example.com'}),null);assert.equal(create({...item,url:'/relative'}),null);
const plain=create({...item,headline:'<img src=x onerror=alert(1)>'});assert.equal(plain.children[0].children[2].children[0].textContent,'<img src=x onerror=alert(1)>');assert.equal(plain.children[0].children[2].children[0].children.length,0,'untrusted headline stays plain text');
console.log('Paper news: original headline/source/URL and external navigation preserved, mobile fields unchanged, standalone excerpt retained, unsafe links and markup excluded PASS');
