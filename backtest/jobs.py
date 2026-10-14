"""Bounded, owner-scoped local research jobs; no market data downloads or orders."""
import threading,time,uuid,json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from .config import PRESETS
from .suite import active_strategies,run_suite
ROOT=Path(__file__).resolve().parent
LOCK=threading.Lock();JOBS={};POOL=ThreadPoolExecutor(max_workers=2,thread_name_prefix='research')
class BusyError(ValueError):pass

def catalog():
    file=ROOT/'published-evaluations.json';records=json.loads(file.read_text()) if file.exists() else []
    from .server import connect
    with connect() as db:
        counts=db.execute("SELECT symbol,count(*),sum(json_extract(payload,'$.confirmed')=1) FROM candles WHERE symbol IN ('BTC','ETH') GROUP BY symbol").fetchall()
    return {'strategies':active_strategies(),'plan':PRESETS['suite'],'fixed':PRESETS['fixed'],'threshold':PRESETS['threshold'],'withdrawn':sum(r['summary']['eligibility']!='pass' for r in records),'evaluated':len(records),'counts':[{'symbol':s,'stored':n,'confirmed':closed} for s,n,closed in counts]}

def submit(owner,body):
    if not isinstance(body,dict) or set(body)!={'strategy'}:raise ValueError('只需要选择策略，其他参数由服务器确定')
    strategy=body['strategy']
    if strategy not in {s['value'] for s in active_strategies()}:raise ValueError('此策略未达标，已从可选列表撤下')
    now=time.time()
    with LOCK:
        for key,job in list(JOBS.items()):
            if job['status']!='running' and now-job['created']>1800:del JOBS[key]
        active=[j for j in JOBS.values() if j['status']=='running']
        if len(active)>=2 or any(j['owner']==owner for j in active):raise BusyError('已有回测正在计算，请稍后再试')
        if len(JOBS)>=32:
            finished=sorted((key for key,j in JOBS.items() if j['status']!='running'),key=lambda key:JOBS[key]['created'])
            if finished:del JOBS[finished[0]]
        key=uuid.uuid4().hex;JOBS[key]={'owner':owner,'created':now,'status':'running'}
    def work():
        try:
            result=run_suite(strategy)
            with LOCK:JOBS[key].update(status='complete',result=result)
        except Exception as exc:
            with LOCK:JOBS[key].update(status='failed',error=str(exc)[:300])
    POOL.submit(work)
    return {'id':key,'status':'running'}

def status(owner,key):
    with LOCK:
        job=JOBS.get(key)
        if not job or job['owner']!=owner:return None
        return {k:v for k,v in job.items() if k not in ('owner','created')}
