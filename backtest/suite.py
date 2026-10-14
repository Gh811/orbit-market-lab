"""One selected strategy; the server owns the complete BTC/ETH research plan."""
import json
import threading
from pathlib import Path
from .config import PRESETS,options
from .validation import validated_record,validated_published_record,configuration_hash,rules_hash
from .server import load,calculate,INTERVALS

_PUBLICATION_LOCK=threading.Lock()
def update_validated_record(result):
    keys=('strategy','symbol','tf','strategyHash','configurationHash','plan','testFrom','to','summary','config')
    snapshot={key:result[key] for key in keys}
    path=Path(__file__).parent/'validated-evaluations.json'
    with _PUBLICATION_LOCK:
        rows=json.loads(path.read_text()) if path.exists() else []
        rows=[r for r in rows if (r.get('strategy'),r.get('symbol'),r.get('tf'))!=(snapshot['strategy'],snapshot['symbol'],snapshot['tf'])]
        rows.append(snapshot);temp=path.with_suffix('.tmp');temp.write_text(json.dumps(rows,ensure_ascii=False,indent=2));temp.replace(path)

def active_strategies():
    file=Path(__file__).parent/'validated-evaluations.json'
    data=json.loads(file.read_text()) if file.exists() else []
    names={s['value']:s for s in PRESETS['strategies']}
    result=[]
    for r in data:
        if not validated_published_record(r):continue
        base=names[r['strategy']]
        result.append({**base,'value':r['strategy']+':'+r['symbol']+':'+r['tf'],'label':r['symbol']+' · '+base['label']+' · '+r['tf'],'symbol':r['symbol'],'tf':r['tf']})
    return result

def run_suite(strategy):
    if ':' in strategy:
        base,symbol,tf=strategy.split(':')
        if symbol not in PRESETS['symbols'] or tf not in {'2h','4h','6h','1d'}:raise ValueError('策略方案无效')
        _,_,opts,_=options({'symbol':symbol,'tf':tf,'strategy':base,'capital':10000})
        before=rules_hash();result=calculate(symbol,tf,opts)
        if rules_hash()!=before:raise ValueError('策略规则已更新，请重新验证')
        plan={'symbols':[symbol],'tf':tf,'capital':10000}
        result.update(strategy=base,plan=plan,configurationHash=configuration_hash(base,plan))
        update_validated_record(result)
        return {'strategy':strategy,'plan':{'symbols':[symbol],'tf':tf,'capital':10000},'results':[result],'qualified':result['summary']['eligibility']=='pass'}
    plan=PRESETS['suite'];tf=plan['tf'];rows=[[b for b in load(symbol,tf) if b.get('confirmed') is True] for symbol in plan['symbols']]
    if any(len(r)<=PRESETS['fixed']['warmup'] for r in rows):raise ValueError('预设方案历史不足')
    common=max(r[PRESETS['fixed']['warmup']]['t'] for r in rows)
    results=[]
    for symbol in plan['symbols']:
        _,_,opts,_=options({'symbol':symbol,'tf':tf,'strategy':strategy,'capital':plan['capital'],'period':'all'})
        opts['testStart']=common;results.append(calculate(symbol,tf,opts))
    return {'strategy':strategy,'plan':plan,'configurationHash':configuration_hash(strategy),'results':results,'qualified':all(r['summary']['eligibility']=='pass' for r in results)}
