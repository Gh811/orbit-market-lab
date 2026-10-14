"""Server-owned choices: clients cannot edit risk, costs or strategy parameters."""
import json
from pathlib import Path
from datetime import datetime,timezone
PRESETS=json.loads((Path(__file__).parent/'presets.json').read_text())
STRATEGIES={s['value']:s for s in PRESETS['strategies']}
TIMEFRAMES={t['value'] for t in PRESETS['timeframes']}
def options(body):
    if not isinstance(body,dict) or set(body)-{'symbol','tf','strategy','capital','period'}:raise ValueError('只能使用提供的选项，风险、手续费和滑点不可修改')
    symbol=body.get('symbol','BTC');tf=body.get('tf','4h');strategy=body.get('strategy','macroRide');period=body.get('period','all')
    try:capital=int(body.get('capital',10000))
    except (TypeError,ValueError,OverflowError):raise ValueError('初始资金选项无效')
    if isinstance(body.get('capital'),bool) or str(body.get('capital',10000))!=str(capital):raise ValueError('初始资金选项无效')
    if symbol not in PRESETS['symbols'] or tf not in TIMEFRAMES or strategy not in STRATEGIES or capital not in PRESETS['capitals'] or period not in {p['value'] for p in PRESETS['periods']}:raise ValueError('请选择提供的标的、周期、策略、资金和区间')
    opts={**PRESETS['fixed'],'capital':capital,'strategy':strategy,'maxHold':STRATEGIES[strategy]['maxHold']}
    if period!='all':opts['testStart']=int(datetime(int(period),1,1,tzinfo=timezone.utc).timestamp()*1000)
    return symbol,tf,opts,period
