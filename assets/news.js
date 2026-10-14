const params=new URLSearchParams(location.search);
const symbol=(params.get('symbol')||'').toUpperCase();
const kind=params.get('type')==='ashare'||/^(?:SH|SZ|BJ)\d{6}$/.test(symbol)?'ashare':'swap';
const validSymbol=/^[A-Z0-9]{1,15}$/.test(symbol);
const subtitle=document.getElementById('newsSubtitle');
const notice=document.getElementById('newsNotice');
const cards=document.getElementById('newsCards');
if(validSymbol)subtitle.textContent=symbol+' · 相关市场动态';
else subtitle.textContent='选择标的后可查看对应动态';

async function loadNews(){
  cards.replaceChildren();
  if(!validSymbol){notice.textContent='请先返回看盘页选择标的。';return}
  notice.textContent='正在获取 '+symbol+' 的新闻…';
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),12000);
  try{
    const response=await fetch('/api/news?type='+kind+'&symbol='+encodeURIComponent(symbol),{signal:controller.signal});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||'新闻暂不可用');
    const rows=Array.isArray(data)?data.filter(item=>{
      try{return item.headline&&new URL(item.url).protocol==='https:'}catch{return false}
    }).slice(0,25):[];
    if(!rows.length){notice.textContent='目前没有找到 '+symbol+' 的相关新闻。';return}
    notice.textContent='共 '+rows.length+' 条 · '+new Date().toLocaleString('zh-CN')+' 更新';
    rows.forEach((item,index)=>{
      const when=Number(item.datetime)?new Date(Number(item.datetime)*1000).toLocaleString('zh-CN'):'';
      const meta=[item.source,when].filter(Boolean).join(' · ');
      const summaryText=item.summary?new DOMParser().parseFromString(String(item.summary),'text/html').body.textContent.trim().slice(0,380):'';
      const article=window.MarketNewsPaper.create(item,{index,meta,summaryText});
      if(article){article.classList.add('newsCard');cards.append(article)}
    });
  }catch(error){notice.textContent=error.name==='AbortError'?'新闻请求超时，请稍后重试。':'新闻暂不可用：'+error.message}
  finally{clearTimeout(timer)}
}
document.getElementById('newsRefresh').addEventListener('click',loadNews);
loadNews();
