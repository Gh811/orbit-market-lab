"""Independent read-only backtest service. Does not import or restart the main server."""
import json, os, re, sqlite3, subprocess, shutil, hashlib,sys
from pathlib import Path
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlsplit, parse_qs
ROOT=Path(__file__).resolve().parent
if str(ROOT.parent) not in sys.path:sys.path.insert(0,str(ROOT.parent))
DB=Path(os.environ.get('MARKET_DATA_DB',ROOT.parent/'.market_data.sqlite3')).resolve()
INTERVALS={'1m':60000,'5m':300000,'15m':900000,'1h':3600000,'2h':7200000,'4h':14400000,'6h':21600000,'1d':86400000,'2d':172800000,'1w':604800000}
def connect():
    return sqlite3.connect(DB.as_uri()+'?mode=ro',uri=True,timeout=10)
def load(symbol,tf,limit=20000):
    if not re.fullmatch(r'[A-Z0-9]{1,24}',symbol) or tf not in INTERVALS:raise ValueError('标的或周期无效')
    with connect() as db:
        rows=db.execute('SELECT payload FROM candles WHERE symbol=? AND tf=? ORDER BY t DESC LIMIT ?',(symbol,tf,limit)).fetchall()
    return [json.loads(row[0]) for row in reversed(rows)]
def calculate(symbol,tf,opts):
    opts={**opts,'interval':INTERVALS[tf]}
    rows=[b for b in load(symbol,tf) if b.get('t',0)<1798761600000]
    if opts.get('testStart') is not None:
        first=next((i for i,b in enumerate(rows) if b.get('t',0)>=opts['testStart']),len(rows))
        rows=rows[max(0,first-opts.get('lookback',1200)):]

    result=subprocess.run([shutil.which('node') or 'node',str(ROOT/('pyramid.cjs' if opts.get('strategy','').startswith('pyramid') else 'engine.cjs'))],input=json.dumps({'rows':rows,'options':opts}),text=True,capture_output=True,timeout=120)
    if result.returncode:raise ValueError(result.stderr[:300])
    return {'symbol':symbol,'tf':tf,'strategyHash':hashlib.sha256((ROOT.parent/'assets/strategy.js').read_bytes()+(ROOT/'strategies.cjs').read_bytes()+(ROOT/'engine.cjs').read_bytes()+(ROOT/'pyramid.cjs').read_bytes()).hexdigest(),**json.loads(result.stdout)}
class Handler(BaseHTTPRequestHandler):
    def send(self,status,data,mime='application/json; charset=utf-8'):
        body=json.dumps(data,ensure_ascii=False).encode() if not isinstance(data,bytes) else data
        self.send_response(status);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(body)
    def do_GET(self):
        url=urlsplit(self.path)
        try:
            files={'/':('index.html','text/html'),'/app.js':('app.js','text/javascript'),'/style.css':('style.css','text/css')}
            if url.path.startswith('/backtest/'):
                url=url._replace(path='/' + url.path.removeprefix('/backtest/'))
            if url.path in files:
                name,mime=files[url.path];return self.send(200,(ROOT/name).read_bytes(),mime+'; charset=utf-8')
            if url.path=='/assets/icons/crypto/crystalbg.png':
                return self.send(200,(ROOT.parent/'assets/icons/crypto/crystalbg.png').read_bytes(),'image/png')
            if url.path=='/api/catalog':
                from backtest.jobs import catalog
                return self.send(200,catalog())
            if url.path=='/api/run':
                q=parse_qs(url.query)
                from backtest.suite import active_strategies,run_suite
                if set(q)!={'strategy'} or len(q['strategy'])!=1:raise ValueError('只需要选择策略，其他参数由服务器确定')
                strategy=q['strategy'][0]
                if strategy not in {s['value'] for s in active_strategies()}:raise ValueError('策略未达标，已撤下')
                return self.send(200,run_suite(strategy))
            return self.send(404,{'error':'页面不存在'})
        except (ValueError,sqlite3.Error,subprocess.TimeoutExpired) as e:self.send(400,{'error':str(e)[:300]})
if __name__=='__main__':
    port=int(os.environ.get('BACKTEST_PORT','8130'));print(f'策略回测：http://127.0.0.1:{port}/',flush=True)
    ThreadingHTTPServer(('127.0.0.1',port),Handler).serve_forever()
