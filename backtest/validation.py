"""Only evaluations of the current frozen rules and plan can qualify a preset."""
import hashlib,json,math
from pathlib import Path
from .config import PRESETS
ROOT=Path(__file__).parent

def rules_hash():
    return hashlib.sha256((ROOT.parent/'assets/strategy.js').read_bytes()+(ROOT/'strategies.cjs').read_bytes()+(ROOT/'engine.cjs').read_bytes()+(ROOT/'pyramid.cjs').read_bytes()).hexdigest()

def configuration_hash(strategy,plan=None):
    preset=next((s for s in PRESETS['strategies'] if s['value']==strategy),None)
    payload={'fixed':PRESETS['fixed'],'plan':plan if plan is not None else PRESETS['suite'],'strategy':preset,'threshold':PRESETS['threshold']}
    return hashlib.sha256(json.dumps(payload,sort_keys=True,separators=(',',':')).encode()).hexdigest()

def validated_record(record):
    if not isinstance(record,dict) or record.get('qualified') is not True:return False
    name=record.get('strategy')
    if name not in {s['value'] for s in PRESETS['strategies']}:return False
    if record.get('configurationHash')!=configuration_hash(name) or record.get('plan')!=PRESETS['suite']:return False
    results=record.get('results',[])
    if not isinstance(results,list) or any(not isinstance(r,dict) for r in results) or len(results)!=len(PRESETS['suite']['symbols']) or {r.get('symbol') for r in results}!=set(PRESETS['suite']['symbols']):return False
    expected=rules_hash()
    for result in results:
        if result.get('strategyHash')!=expected or result.get('tf')!=PRESETS['suite']['tf']:return False
        summary=result.get('summary',{})
        if summary.get('eligibility')!='pass' or summary.get('completeYears',0)<3 or summary.get('trades',0)<1:return False
        for key in ('annualizedReturn','averageYearlyReturn'):
            value=summary.get(key)
            if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or value<PRESETS['threshold']:return False
    return True

def validated_published_record(record):
    if not isinstance(record,dict):return False
    name,symbol,tf=record.get('strategy'),record.get('symbol'),record.get('tf')
    if name not in {s['value'] for s in PRESETS['strategies']} or symbol not in PRESETS['symbols'] or tf not in {t['value'] for t in PRESETS['timeframes']}:return False
    plan={'symbols':[symbol],'tf':tf,'capital':10000}
    if record.get('configurationHash')!=configuration_hash(name,plan) or record.get('plan')!=plan or record.get('strategyHash')!=rules_hash():return False
    summary=record.get('summary',{});annual=summary.get('annualizedReturn')
    return (summary.get('eligibility')=='pass' and summary.get('completeYears',0)>=1 and summary.get('trades',0)>0 and type(annual) in (int,float) and math.isfinite(annual) and annual>=PRESETS['threshold'])
