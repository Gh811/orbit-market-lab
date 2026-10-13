"""Public mainland equity data. Symbols include venue; no synthetic swap aliases."""
import json, math, re, ssl, threading, time, subprocess
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo
ROOT=Path(__file__).resolve().parent
SNAPSHOT=ROOT/'data/ashare_catalog.json'
CNY=ZoneInfo('Asia/Shanghai')
SYMBOL=re.compile(r'(?:SH6\d{5}|SZ[03]\d{5}|BJ(?:(?:43|83|87)\d{4}|920\d{3}))\Z')
PERIODS={'1m':1,'5m':5,'15m':15,'1h':60,'1d':101,'1w':102,'1M':103}
SOURCE='东方财富 · A股现货'
_LOCK=threading.Lock();_CATALOG=None

def is_symbol(symbol):return isinstance(symbol,str) and bool(SYMBOL.fullmatch(symbol))
def secid(symbol):
    if not is_symbol(symbol):raise ValueError('A股代码无效')
    return ('1.' if symbol.startswith('SH') else '0.')+symbol[2:]
def request(host,path,**params):
    if host not in ('82.push2.eastmoney.com','push2.eastmoney.com','push2his.eastmoney.com'):raise ValueError('invalid provider')
    url='https://'+host+path+'?'+urlencode(params)
    error=None
    for attempt in range(3):
        try:
            result=subprocess.run(['curl','--silent','--show-error','--fail','--max-time','12','--user-agent','Mozilla/5.0','--referer','https://quote.eastmoney.com/',url],capture_output=True,text=True,timeout=14,check=True)
            body=json.loads(result.stdout);break
        except (subprocess.SubprocessError,OSError,ValueError) as exc:
            error=exc
            if attempt==2:raise ValueError('A股公开数据源连接暂不可用') from error
            time.sleep(.5*(attempt+1))
    if not isinstance(body,dict) or body.get('rc',0)!=0 or not isinstance(body.get('data'),dict):raise ValueError('A股数据源暂不可用')
    return body['data']
def catalog_item(row):
    code=str(row.get('f12',''));market=row.get('f13');name=str(row.get('f14','')).strip()
    venue='SH' if market==1 and code.startswith('6') else 'SZ' if market==0 and code.startswith(('0','3')) else 'BJ' if market==0 and code.startswith(('43','83','87','920')) else ''
    symbol=venue+code
    if not is_symbol(symbol) or not name or len(name)>40:return None
    exchange={'SH':'上海证券交易所','SZ':'深圳证券交易所','BJ':'北京证券交易所'}[venue]
    return {'type':'ashare','symbol':symbol,'code':code,'name':name,'aliases':[code,name], 'exchange':exchange,'category':'ashare','currency':'CNY'}
def catalog():
    global _CATALOG
    with _LOCK:
        if _CATALOG is None:
            try:payload=json.loads(SNAPSHOT.read_text());_CATALOG={x['symbol']:x for x in payload['items'] if x.get('type')=='ashare' and is_symbol(x.get('symbol'))}
            except (OSError,ValueError,KeyError,TypeError):_CATALOG={}
        return dict(_CATALOG)
def refresh_catalog():
    global _CATALOG
    params=dict(pz=100,po=1,np=1,ut='bd1d9ddb04089700cf9c27f6f7426281',fltt=2,invt=2,fid='f12',fs='m:0 t:6,m:0 t:80,m:1 t:2,m:1 t:23,m:0 t:81 s:2048',fields='f12,f13,f14')
    first=request('82.push2.eastmoney.com','/api/qt/clist/get',pn=1,**params);total=int(first.get('total',0))
    if not 1000<=total<=10000:raise ValueError('A股目录范围异常')
    rows=list(first.get('diff',[]))
    def page(number):return request('82.push2.eastmoney.com','/api/qt/clist/get',pn=number,**params).get('diff',[])
    with ThreadPoolExecutor(max_workers=2) as pool:
        for batch in pool.map(page,range(2,math.ceil(total/100)+1)):rows.extend(batch)
    items={x['symbol']:x for x in (catalog_item(r) for r in rows) if x}
    if len(items)<total*.95:raise ValueError('A股目录不完整，保留已有目录')
    SNAPSHOT.parent.mkdir(parents=True,exist_ok=True)
    payload={'source':SOURCE,'fetchedAt':time.time(),'items':sorted(items.values(),key=lambda x:x['symbol'])}
    temporary=SNAPSHOT.with_suffix('.tmp');temporary.write_text(json.dumps(payload,ensure_ascii=False,separators=(',',':')));temporary.replace(SNAPSHOT)
    with _LOCK:_CATALOG=items
    return len(items)
def search(query,limit=14):
    q=query.strip().casefold();matches=[]
    for item in catalog().values():
        values=[item['symbol'],item['code'],item['name'],*item.get('aliases',[])];values=[v.casefold() for v in values]
        rank=0 if q in values else 1 if any(v.startswith(q) for v in values) else 2 if any(q in v for v in values) else None
        if rank is not None:matches.append((rank,item))
    return [x for _,x in sorted(matches,key=lambda pair:(pair[0],pair[1]['symbol']))[:limit]]
def quote(symbol):
    row=request('push2.eastmoney.com','/api/qt/stock/get',secid=secid(symbol),fltt=2,invt=2,fields='f43,f44,f45,f46,f57,f58,f59,f60,f86,f124')
    if str(row.get('f57'))!=symbol[2:]:raise ValueError('A股行情身份不匹配')
    try:price=float(row['f43']);previous=float(row['f60']);stamp=int(row.get('f86') or row.get('f124') or 0)
    except (ValueError,TypeError,KeyError):raise ValueError('A股当前无有效报价')
    if not math.isfinite(price) or not math.isfinite(previous) or price<=0 or previous<=0 or stamp<=0:raise ValueError('A股当前无有效报价')
    return {'c':price,'pc':previous,'t':stamp,'currency':'CNY','source':SOURCE}
def normalize_bars(lines,tf,now=None):
    if tf not in PERIODS:raise ValueError('A股请选择 1分、5分、15分、1小时、日、周或月')
    clock=now or datetime.now(CNY);bars=[];interval=PERIODS[tf]*60000 if PERIODS[tf]<100 else 0
    for line in lines:
        fields=line.split(',')
        try:
            stamp=datetime.fromisoformat(fields[0]).replace(tzinfo=CNY)
            if interval:stamp-=timedelta(milliseconds=interval)
            else:stamp=stamp.replace(hour=9,minute=30)
            op,close,high,low=map(float,fields[1:5]);amount=float(fields[6]);t=int(stamp.timestamp()*1000)
            if not all(math.isfinite(n) for n in (op,close,high,low,amount)) or min(op,close,low)<=0 or high<max(op,close) or low>min(op,close) or amount<0:continue
            if interval:closed=t+interval<=int(clock.timestamp()*1000)
            elif tf=='1d':closed=stamp.date()<clock.date() or (stamp.date()==clock.date() and clock.hour>=15)
            elif tf=='1w':closed=(stamp.date()+timedelta(days=4-stamp.weekday()))<clock.date() or (clock.weekday()==4 and clock.hour>=15)
            else:
                next_month=(stamp.replace(day=28)+timedelta(days=4)).replace(day=1)
                closed=next_month.date()<=clock.date()
            bars.append({'t':t,'o':op,'h':high,'l':low,'c':close,'v':amount,'confirmed':closed})
        except (ValueError,IndexError,TypeError):continue
    return sorted({b['t']:b for b in bars}.values(),key=lambda b:b['t'])
def candles(symbol,tf,before=None):
    if tf not in PERIODS:raise ValueError('A股不使用加密货币的 2小时、4小时或6小时周期，请选择日线或1小时')
    end=datetime.fromtimestamp(before/1000,CNY).strftime('%Y%m%d') if before else '20500101'
    row=request('push2his.eastmoney.com','/api/qt/stock/kline/get',secid=secid(symbol),klt=PERIODS[tf],fqt=0,beg='19900101',end=end,lmt=1000,fields1='f1,f2,f3,f4,f5,f6',fields2='f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',ut='7eea3edcaed734bea9cbfc24409ed989')
    if str(row.get('code'))!=symbol[2:]:raise ValueError('A股K线身份不匹配')
    bars=normalize_bars(row.get('klines',[]),tf)
    return [b for b in bars if before is None or b['t']<before][-1000:]
CURATED_COMPANIES={
 'SH600519':{'summary':'贵州茅台主营茅台酒及酱香系列酒的生产与销售，核心业务是白酒酿造与品牌经营，产品通过直销和经销渠道销售。','website':'https://www.moutai.com.cn/','source':'贵州茅台股份公司官网'},
 'SZ002384':{'summary':'东山精密提供电子电路、光模块、精密组件及光电显示模组，产品包括柔性电路板和印制电路板，应用于消费电子、通信和汽车等行业。','website':'https://cn.dsbj.com/','source':'东山精密官网'}
}
F10='https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/PageAjax'
def company_profile(symbol):
    """东方财富 F10 公司概况；只接受证券代码与上市市场都精确匹配的结果，宁缺勿错。"""
    if not is_symbol(symbol):raise ValueError('A股代码无效')
    body=None
    for attempt in range(2):
        try:
            result=subprocess.run(['curl','--silent','--show-error','--fail','--max-time','12','--user-agent','Mozilla/5.0','--referer','https://emweb.securities.eastmoney.com/',F10+'?'+urlencode({'code':symbol})],capture_output=True,text=True,timeout=14,check=True)
            body=json.loads(result.stdout);break
        except (subprocess.SubprocessError,OSError,ValueError):
            if attempt==1:return None
            time.sleep(.5)
    rows=body.get('jbzl') if isinstance(body,dict) else None
    row=rows[0] if isinstance(rows,list) and rows and isinstance(rows[0],dict) else None
    if not row:return None
    if str(row.get('SECURITY_CODE',''))!=symbol[2:] or str(row.get('SECUCODE',''))!=symbol[2:]+'.'+symbol[:2]:return None
    name=str(row.get('SECURITY_NAME_ABBR','')).strip()
    if not name or len(name)>40:return None
    website=str(row.get('ORG_WEB','')).strip().lower()
    website='https://'+website if re.fullmatch(r'[a-z0-9.-]+\.[a-z]{2,}(?:/.*)?',website) else ''
    return {'name':name,'industry':str(row.get('EM2016','')).strip()[:40],'profile':str(row.get('ORG_PROFILE','')),'website':website}
def _clip_profile(text,limit=200):
    text=re.sub(r'\s+','',str(text or '')).replace(',','，').replace('(','（').replace(')','）')
    if len(text)<=limit:return text
    cut=text[:limit];stop=cut.rfind('。')
    return cut[:stop+1] if stop>=limit//2 else cut.rstrip('，')+'…'
def describe(symbol,item,profile):
    curated=CURATED_COMPANIES.get(symbol)
    if curated:return curated['summary']
    text=re.sub(r'\s+','',str((profile or {}).get('profile','')))
    sentences=[part+'。' for part in re.split(r'[。！？]',text) if part]
    business=[part for part in sentences if re.search(r'主营|主要业务|业务涵盖|业务包括|主要产品|提供|专注|从事|研发|生产|销售',part)]
    if business:
        # Business comes first; exchange and share type already have their own fields.
        summary=business[0]
        if summary.startswith('公司'):summary=item['name']+summary[2:]
        elif item['name'] not in summary:summary=item['name']+'：'+summary
        return _clip_profile(summary,80)
    if text:return _clip_profile(text,80)
    industry=(profile or {}).get('industry','')
    return item['name']+'主要涉及'+industry+'领域，业务简介正在补全。' if industry else item['name']+'的业务简介正在补全。'

def info(symbol):
    item=catalog().get(symbol)
    if not item:raise ValueError('A股目录尚无此股票')
    curated=CURATED_COMPANIES.get(symbol)
    profile=None if curated else company_profile(symbol)
    return {'type':'ashare','symbol':symbol,'name':item['name'],'pair':symbol,'base':symbol[2:],'quote':'CNY','exchange':item['exchange'],'category':'stock','status':'A股现货','tickSize':'—','contractValue':'不适用','summary':describe(symbol,item,profile),'website':curated['website'] if curated else (profile or {}).get('website',''),'currency':'CNY','incomplete':not bool(curated or (profile and profile.get('profile'))),'source':SOURCE+(' · '+curated['source'] if curated else '')}
