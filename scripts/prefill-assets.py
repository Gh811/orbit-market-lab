#!/usr/bin/env python3
"""Run once across the catalogue. Existing complete profiles resume without refetching."""
import argparse,json,sys,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server,ashare_market,okx_market
from asset_library import prefill
parser=argparse.ArgumentParser();parser.add_argument('--limit',type=int,default=0);parser.add_argument('--workers',type=int,default=2);parser.add_argument('--batch-profiles',action='store_true');parser.add_argument('--retry-incomplete',action='store_true');parser.add_argument('--include-missing-logos',action='store_true');parser.add_argument('--metadata-only',action='store_true');parser.add_argument('--logos-only',action='store_true');args=parser.parse_args()
store=server.market_store();contracts=okx_market.instrument_snapshot()
stocks=list(ashare_market.catalog().values());swaps=okx_market.search_catalog(contracts)
priority={'SZ301308':0,'SZ000651':1,'SH600519':2,'SZ002384':3,'SH600362':4,'BTC':5,'ETH':6,'TRUMP':7}
with store._db() as db:
 try:followed={s for s, in db.execute('SELECT symbol FROM tracked_assets WHERE followed=1')}
 except Exception:followed=set()
items=sorted(stocks+swaps,key=lambda row:(priority.get(row['symbol'],8 if row['symbol'] in followed else 9),row['symbol']))
def fetch_profile(kind,symbol):return server.verified_ashare_profile(symbol) if kind=='ashare' else server.verified_asset_info(kind,symbol)
def fetch_logo(kind,symbol,info):
 result=server.resolve_ashare_logo(symbol,info) if kind=='ashare' else server.resolve_logo(symbol,contracts)
 url=(result or {}).get('url','')
 if url.startswith('/assets/icons/'):
  path=(server.ROOT/url.lstrip('/')).resolve()
  if path.is_relative_to(server.ROOT/'assets/icons') and path.is_file():
   payload=path.read_bytes()
   if store.logo_mime(payload):store.save_logo(symbol,'ashare' if kind=='ashare' else str(contracts[symbol].get('instCategory','')),payload,result.get('source',''))
 return result
status=server.ROOT/('.asset_metadata_status.json' if args.metadata_only else '.asset_prefill_status.json')
def progress(counts):
 payload={**counts,'updatedAt':int(time.time()*1000),'state':'running','pid':__import__('os').getpid(),'phase':'logos' if args.logos_only else 'metadata' if args.metadata_only else 'profiles-and-logos'};temporary=status.with_name(status.name+'.'+str(__import__('os').getpid())+'.tmp');temporary.write_text(json.dumps(payload,ensure_ascii=False));temporary.replace(status)
 if counts['processed']%10==0:print(json.dumps(payload,ensure_ascii=False),flush=True)
if args.batch_profiles:
 missing=[]
 for item in stocks:
  record=store.read(store.key('ashare','info-v4',item['symbol']))
  if not record or not store.profile_complete(record[0]) or not record[0].get('website'):missing.append(item['symbol'])
 print('Batch company metadata candidates:',len(missing),flush=True)
 companies=ashare_market.batch_company_profiles(missing)
 for symbol,company in companies.items():
  row=ashare_market.info(symbol,company=company)
  if not row.get('incomplete'):
   row['updatedAt']=int(time.time()*1000)
   store.write(store.key('ashare','info-v4',symbol),row)
   store.save_summary('ashare',symbol,row['summary'],row.get('source',''),row.get('website',''))
   if row.get('website'):store.save_website('ashare',symbol,row['website'],row.get('source',''),overwrite=True)
 print('Batch exact company profiles saved:',len(companies),flush=True)
try:
 result=prefill(store,items,fetch_profile,fetch_logo,limit=args.limit,workers=args.workers,progress=progress,retry_incomplete=args.retry_incomplete,include_missing_logos=args.include_missing_logos,metadata_only=args.metadata_only,logos_only=args.logos_only)
 progress(result)
 payload=json.loads(status.read_text());payload['state']='finished';status.write_text(json.dumps(payload,ensure_ascii=False))
 print(json.dumps(payload,ensure_ascii=False),flush=True)
except Exception as error:
 payload={'state':'failed','updatedAt':int(time.time()*1000),'error':type(error).__name__}
 status.write_text(json.dumps(payload,ensure_ascii=False));raise
