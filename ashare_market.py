"""Public mainland equity data. Symbols include venue; no synthetic swap aliases."""
import json, math, re, ssl, threading, time, subprocess, os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo
ROOT=Path(__file__).resolve().parent
_RUNTIME_SNAPSHOT=ROOT/'.local-data/catalogs/ashare_catalog.json'
SNAPSHOT=Path(os.environ.get('MARKET_ASHARE_SNAPSHOT',str(_RUNTIME_SNAPSHOT if _RUNTIME_SNAPSHOT.exists() else ROOT/'data/ashare_catalog.json')))
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
 'SZ301308':{'summary':'江波龙研发、设计和销售半导体存储产品，涵盖嵌入式存储、固态硬盘、移动存储及内存条，旗下拥有 FORESEE 和 Lexar 品牌。','website':'https://cn.longsys.com/','source':'江波龙官网'},
 'SZ000651':{'summary':'格力电器研发、生产和销售空调、冰箱、洗衣机及其他家用和商用设备，并提供暖通、智能楼宇及工业制造相关产品与解决方案。','website':'https://gree.com/','source':'格力电器官网'},
 'SH600362':{'summary':'江西铜业主营铜的采选、冶炼与加工，并生产黄金、白银等有色及贵金属产品。','website':'https://www.jxcc.com/','source':'江西铜业官网'},
 'SH600519':{'summary':'贵州茅台主营茅台酒及茅台酱香系列酒的生产与销售。','website':'https://www.moutai.com.cn/','source':'贵州茅台股份公司官网'},
 'SZ002384':{'summary':'东山精密主要生产柔性电路板、印制电路板及精密组件，服务消费电子、通信和汽车等行业。','website':'https://cn.dsbj.com/','source':'东山精密官网'}
}
F10='https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/PageAjax'
def parse_company_row(symbol,row):
    if not is_symbol(symbol) or not isinstance(row,dict):return None
    if str(row.get('SECURITY_CODE',''))!=symbol[2:] or str(row.get('SECUCODE',''))!=symbol[2:]+'.'+symbol[:2]:return None
    name=str(row.get('SECURITY_NAME_ABBR','')).strip()
    if not name or len(name)>40:return None
    raw_site=re.split(r'[,，;；\s]',str(row.get('ORG_WEB','')).strip())[0].lower()
    raw_site=re.sub(r'^https?://','',raw_site).rstrip('/')
    website='https://'+raw_site if re.fullmatch(r'[a-z0-9.-]+\.[a-z]{2,}(?:/.*)?',raw_site) else ''
    # Prefer the actual business field over the data-center's editorial short review.
    profile=str(row.get('ORG_PROFIE') or row.get('ORG_PROFILE') or row.get('BUSINESS_SCOPE') or '').strip()
    if not profile:profile=str(row.get('MAIN_BUSINESS') or '').strip()
    if not profile:return None
    return {'name':name,'industry':str(row.get('EM2016','')).strip()[:40],'profile':profile,'website':website,'companyName':str(row.get('ORG_NAME','')).strip()[:100],'business':str(row.get('MAIN_BUSINESS') or '').strip()}

def company_profile(symbol):
    """东方财富 F10 公司概况；只接受证券代码与上市市场都精确匹配的结果，宁缺勿错。"""
    if not is_symbol(symbol):raise ValueError('A股代码无效')
    sources=[
        ('https://datacenter.eastmoney.com/securities/api/data/v1/get',
         {'reportName':'RPT_F10_ORG_BASICINFO','columns':'ALL','filter':f'(SECUCODE="{symbol[2:]}.{symbol[:2]}")','pageSize':1,'pageNumber':1}),
        (F10,{'code':symbol})]
    for endpoint,params in sources:
        try:
            result=subprocess.run(['curl','--silent','--show-error','--fail','--max-time','8','--user-agent','Mozilla/5.0','--referer','https://emweb.securities.eastmoney.com/',endpoint+'?'+urlencode(params)],capture_output=True,text=True,timeout=10,check=True)
            body=json.loads(result.stdout)
        except (subprocess.SubprocessError,OSError,ValueError):
            continue
        rows=(body.get('result') or {}).get('data') or body.get('jbzl') if isinstance(body,dict) else None
        row=rows[0] if isinstance(rows,list) and rows and isinstance(rows[0],dict) else None
        if not row:continue
        profile=parse_company_row(symbol,row)
        if profile:return profile
    return None
def batch_company_profiles(symbols, *, batch_size=100):
    """Fetch exact-venue identities in small batches; partial failures stay explicit."""
    symbols=list(dict.fromkeys(symbol for symbol in symbols if is_symbol(symbol)))
    found={}
    endpoint='https://datacenter.eastmoney.com/securities/api/data/v1/get'
    for offset in range(0,len(symbols),batch_size):
        batch=symbols[offset:offset+batch_size]
        identities={symbol[2:]+'.'+symbol[:2]:symbol for symbol in batch}
        params={'reportName':'RPT_F10_ORG_BASICINFO','columns':'SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,ORG_NAME,ORG_WEB,ORG_PROFIE,ORG_PROFILE,MAIN_BUSINESS',
                'pageSize':batch_size,'pageNumber':1,'filter':'(SECUCODE in ('+','.join('"'+value+'"' for value in identities)+'))'}
        try:
            result=subprocess.run(['curl','--silent','--show-error','--fail','--max-time','15','--user-agent','Mozilla/5.0',endpoint+'?'+urlencode(params)],capture_output=True,text=True,timeout=18,check=True)
            response=json.loads(result.stdout)
            rows=(response.get('result') or {}).get('data') or []
            for row in rows:
                symbol=identities.get(row.get('SECUCODE')) if isinstance(row,dict) else None
                profile=parse_company_row(symbol,row) if symbol else None
                if profile:found[symbol]=profile
        except (OSError,ValueError,subprocess.SubprocessError):continue
    return found

def _clip_profile(text,limit=70):
    """Retain whole short sentences or the primary business clause, never a character slice."""
    text=re.sub(r'\s+','',str(text or '')).replace(',','，').replace('(','（').replace(')','）')
    sentences=re.findall(r'[^。！？]+[。！？]|[^。！？]+$',text)
    result='';count=0
    for sentence in sentences:
        if sentence.endswith(('…','...')) or len(result)+len(sentence.rstrip('。！？'))+1>limit:break
        result+=sentence if sentence.endswith(('。','！','？')) else sentence+'。'
        count+=1
        if count==2:break
    if result:return result
    clause=re.split(r'[，；。！？]',text)[0]
    if len(clause)+1<=limit and not clause.endswith(('：','、','…')) and re.search(r'主营|主要业务|提供|专注|从事|生产|销售|研发',clause):return clause+'。'
    if sentences and text.endswith(('。','！','？')) and len(sentences[0])<=800:return sentences[0]
    if len(clause)<=800 and not clause.endswith(('：','、','…','...')) and re.search(r'主营|主要业务|提供|专注|从事|生产|销售|研发',clause):return clause+'。'
    return '业务简介正在补全。'
def describe(symbol,item,profile):
    curated=CURATED_COMPANIES.get(symbol)
    if curated:return curated['summary']
    main=re.sub(r'\s+','',str((profile or {}).get('business') or '')).replace(',','，')
    if main:
        if ';' in main or '；' in main:
            clauses=[re.sub(r'^[（(][一二三四五六七八九十\d]+[）)]','',part).strip() for part in re.split(r'[;；]',main) if part.strip()]
            chosen=[]
            for part in clauses:
                if len(item['name']+'主营'+'、'.join(chosen+[part])+'等业务。')>70:break
                chosen.append(part)
                if len(chosen)==3:break
            if chosen:return item['name']+'主营'+'、'.join(chosen)+('等业务。' if len(chosen)<len(clauses) else '。')
        main=re.sub(r'^(?:公司的?|本公司的?)(?=主营|主要)','',main)
        lead=item['name']+('主要' if re.match(r'生产|研发|制造|销售|提供|经营|从事',main) else '主营')
        return _clip_profile(lead+main)
    text=re.sub(r'\s+','',str((profile or {}).get('profile','')))
    sentences=[part+'。' for part in re.split(r'[。！？]',text) if part]
    business=[part for part in sentences if re.search(r'主营|主要业务|业务涵盖|业务包括|主要产品|从事',part)]
    if not business:business=[part for part in sentences if re.search(r'提供|专注|研发|生产|销售',part)]
    if business:
        # Business comes first; exchange and share type already have their own fields.
        summary=business[0]
        if summary.startswith('公司'):summary=item['name']+summary[2:]
        elif item['name'] not in summary:summary=item['name']+'：'+summary
        return _clip_profile(summary)
    if text:return _clip_profile(text)
    industry=(profile or {}).get('industry','')
    return item['name']+'主要涉及'+industry+'领域，业务简介正在补全。' if industry else item['name']+'的业务简介正在补全。'

def info(symbol, company=None):
    item=catalog().get(symbol)
    if not item:raise ValueError('A股目录尚无此股票')
    curated=CURATED_COMPANIES.get(symbol)
    profile=None if curated else company if company is not None else company_profile(symbol)
    summary=describe(symbol,item,profile)
    return {'type':'ashare','symbol':symbol,'name':item['name'],'pair':symbol,'base':symbol[2:],'quote':'CNY','exchange':item['exchange'],'category':'stock','companyName':(profile or {}).get('companyName',''),'industry':(profile or {}).get('industry',''),'status':'A股现货','tickSize':'—','contractValue':'不适用','summary':summary,'website':curated['website'] if curated else (profile or {}).get('website',''),'currency':'CNY','incomplete':not bool(curated or (profile and profile.get('profile'))) or '正在补全' in summary,'source':SOURCE+(' · '+curated['source'] if curated else '')}
