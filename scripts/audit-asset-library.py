#!/usr/bin/env python3
"""Read-only component audit of the persistent public library."""
import argparse,json,re,sqlite3,sys
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
import server
parser=argparse.ArgumentParser();parser.add_argument('--database',type=Path,default=ROOT/'.market_data.sqlite3');parser.add_argument('--output',type=Path,default=ROOT/'artifacts/asset-library-audit-latest.json');args=parser.parse_args()
def local(path):
 if not isinstance(path,str) or not path.startswith('/assets/icons/'):return False
 file=(ROOT/path.split('?')[0].lstrip('/')).resolve();return file.is_relative_to(ROOT/'assets/icons') and file.is_file()
with sqlite3.connect(args.database.resolve().as_uri()+'?mode=ro',uri=True) as db:
 db.execute('BEGIN')
 items={(kind,symbol):json.loads(payload) for kind,symbol,payload in db.execute('SELECT kind,symbol,payload FROM asset_catalog')}
 profiles={}
 for key,payload in db.execute('SELECT key,payload FROM responses'):
  try:
   key=json.loads(key);profile=json.loads(payload)
   ident=('ashare',key[2]) if len(key)==3 and key[:2]==['ashare','info-v4'] else (key[1],key[2]) if len(key)==3 and key[0]=='info' and key[1] in ('ashare','swap') else None
   if ident and isinstance(profile,dict) and (profile.get('type'),profile.get('symbol'))==ident:profiles[ident]=profile
  except (ValueError,TypeError):continue
 logos={symbol:category for symbol,category in db.execute('SELECT symbol,category FROM logos WHERE length(image)>=50')}
 sites={(kind,symbol):site for kind,symbol,site in db.execute('SELECT kind,symbol,website FROM asset_websites')}
 attempts={(kind,symbol) for kind,symbol in db.execute('SELECT kind,symbol FROM library_prefill')}
 stats={};by_type={};missing=[]
 for (kind,symbol),item in items.items():
  p=profiles.get((kind,symbol),{});summary=str(p.get('summary') or '').strip()
  good=bool(summary) and not p.get('incomplete') and not re.search(r'正在补全|暂未收录|暂无简介|正在读取',summary)
  if kind=='swap':good=good and p.get('pair')==symbol+'-USDT-SWAP' and p.get('base')==symbol and p.get('quote')=='USDT' and p.get('identityVersion')==2
  elif kind=='ashare':good=good and p.get('pair')==symbol and p.get('quote')=='CNY'
  stored_logo=symbol in logos and (kind!='ashare' or logos[symbol]=='ashare')
  available_logo=stored_logo or local(p.get('logo'))
  if kind=='ashare':available_logo=available_logo or local(server.ASHARE_BRAND_LOGOS.get(symbol,('',))[0])
  else:available_logo=available_logo or local('/assets/icons/okx/'+symbol.lower()+'.png') or local(server.BRAND_LOGOS.get(symbol,('',))[0]) or local(server.CURATED_COIN_LOGOS.get(symbol,('',))[0]) or local('/assets/icons/crypto/'+symbol.lower()+'.png') or local('/assets/icons/crypto/'+symbol.lower()+'.svg')
  site=p.get('website') or sites.get((kind,symbol)) or sites.get((p.get('category'),symbol));has_site=bool(site and str(site).startswith('https://'))
  flags={'total':1,'profileComplete':int(good),'fullComplete':int(good and available_logo and has_site),'portableComplete':int(good and stored_logo and has_site),'missingAny':int(not(good and available_logo and has_site)),'missingProfile':int(not good),'missingLogo':int(not available_logo),'missingWebsite':int(not has_site),'attempted':int((kind,symbol) in attempts)}
  group=by_type.setdefault(kind,{key:0 for key in flags})
  for key,value in flags.items():stats[key]=stats.get(key,0)+value;group[key]+=value
  if not(good and available_logo and has_site):missing.append({'type':kind,'symbol':symbol,'name':item.get('name',symbol),'missing':[key for key,ok in [('profile',good),('logo',available_logo),('website',has_site)] if not ok]})
 report={'checkedAt':datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds'),'definition':'完整 = 身份匹配且简介完整 + 官网 + 可用图标；portableComplete 要求图标字节已入数据库','totals':stats,'byType':by_type,'missing':missing}
args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps({key:value for key,value in report.items() if key!='missing'},ensure_ascii=False,indent=2));print('report:',args.output.resolve())
