// Shared paper preview; original headlines and destinations are preserved.
((root,factory)=>{const paper=factory();if(typeof module==='object'&&module.exports)module.exports=paper;else root.MarketNewsPaper=paper})(typeof window==='object'?window:globalThis,()=>{
  'use strict';
  function create(item,{index=0,meta='',summaryText=''}={}){
    let destination;try{destination=new URL(item?.url);if(destination.protocol!=='https:')return null}catch{return null}
    if(!item?.headline)return null;
    const article=document.createElement('article');article.className='orbitNewsPaper';
    const link=document.createElement('a');link.className='newsPaperLink';link.href=item.url;link.target='_blank';link.rel='noopener noreferrer';link.setAttribute('aria-label',item.headline);link.title=item.headline;
    const masthead=document.createElement('header');masthead.className='newsPaperMasthead';
    const name=document.createElement('strong');name.textContent='星轨剪报';
    const mark=document.createElement('span');mark.textContent='ORBIT · NEWS';masthead.append(name,mark);
    const metadata=document.createElement('small');metadata.className='newsPaperMeta';metadata.textContent=meta;
    const content=document.createElement('div');content.className='newsPaperContent';
    const title=document.createElement('h2');title.className='newsPaperHeadline';title.textContent=item.headline;
    if(String(item.headline).length>80)article.classList.add('newsPaperDense');
    content.append(title);
    if(summaryText){const summary=document.createElement('p');summary.className='newsPaperExcerpt';summary.textContent=summaryText;content.append(summary);article.classList.add('newsPaperHasExcerpt')}
    link.append(masthead,metadata,content);article.append(link);return article;
  }
  return {create};
});
