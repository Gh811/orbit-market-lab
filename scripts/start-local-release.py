#!/usr/bin/env python3
"""Start a frozen local build with independent account and public-data paths."""
import argparse,json,os,re,signal,subprocess,sys,time,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from release_tools import build_snapshot
parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8001);parser.add_argument('--replace-pid',type=int);parser.add_argument('--public-host');args=parser.parse_args()
preserved={}
snapshot=build_snapshot(ROOT);runtime=ROOT/'.local-data/runtime';runtime.mkdir(parents=True,exist_ok=True);catalogs=ROOT/'.local-data/catalogs';catalogs.mkdir(parents=True,exist_ok=True)
for source,target in [(ROOT/'data/ashare_catalog.json',catalogs/'ashare_catalog.json'),(ROOT/'assets/okx_instruments.json',catalogs/'okx_instruments.json')]:
 if not target.exists():shutil.copyfile(source,target)
if args.replace_pid:
 command=subprocess.check_output(['ps','-p',str(args.replace_pid),'-o','command='],text=True)
 if str(ROOT) not in command or 'server.py' not in command:raise SystemExit('Refusing to replace a process outside this application')
 previous=subprocess.check_output(['ps','eww','-p',str(args.replace_pid),'-o','command='],text=True)
 for name in ('MARKET_PUBLIC_HOST','FINNHUB_API_KEY'):
  match=re.search(r'(?:^|\s)'+name+r'=([^\s]*)',previous)
  if match:preserved[name]=match.group(1)
 os.kill(args.replace_pid,signal.SIGTERM)
 for _ in range(30):
  try:os.kill(args.replace_pid,0);time.sleep(.1)
  except ProcessLookupError:break
state=runtime/f'server-{args.port}.json';logpath=runtime/f'server-{args.port}.log';env={**os.environ,**preserved,'MARKET_PORT':str(args.port),'MARKET_ACCOUNT_DB':str(ROOT/'.market_accounts.sqlite3'),'MARKET_DATA_DB':str(ROOT/'.market_data.sqlite3'),'MARKET_ASHARE_SNAPSHOT':str(catalogs/'ashare_catalog.json'),'MARKET_INSTRUMENT_SNAPSHOT':str(catalogs/'okx_instruments.json'),'MARKET_LOGO_CACHE_DIR':str(ROOT/'.asset_logo_cache')}
if args.public_host:
 if not re.fullmatch(r'[a-z0-9.-]+',args.public_host):raise SystemExit('Invalid public host')
 env['MARKET_PUBLIC_HOST']=args.public_host
with logpath.open('ab') as log:
 process=subprocess.Popen([sys.executable,str(snapshot/'server.py')],cwd=snapshot,env=env,stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
info={'pid':process.pid,'port':args.port,'snapshot':str(snapshot),'log':str(logpath)};state.write_text(json.dumps(info,indent=2));print(json.dumps(info))
