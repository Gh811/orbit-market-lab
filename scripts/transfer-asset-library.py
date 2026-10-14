#!/usr/bin/env python3
import argparse,json,sys
from pathlib import Path
from datetime import datetime
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from library_transfer import export_library,import_library
parser=argparse.ArgumentParser(description='公开标的资料库导出/导入，不含用户账户及 K 线历史')
parser.add_argument('mode',choices=['export','import']);parser.add_argument('--database',type=Path,default=ROOT/'.market_data.sqlite3');parser.add_argument('--snapshot',type=Path)
args=parser.parse_args()
if args.mode=='import' and args.snapshot is None:parser.error('导入必须指定 --snapshot')
path=args.snapshot or ROOT/'.local-data'/('asset-library-'+datetime.now().strftime('%Y%m%d-%H%M%S')+'.sqlite3')
counts=export_library(args.database,path) if args.mode=='export' else import_library(path,args.database)
print(json.dumps({'mode':args.mode,'snapshot':str(path.resolve()),'tables':counts},ensure_ascii=False))
