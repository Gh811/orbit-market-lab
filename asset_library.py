"""Resumable public metadata acquisition; historical bars are handled separately."""
import json
import time
from concurrent.futures import ThreadPoolExecutor
from market_store import MarketStore


def prefill(store, items, fetch_profile, fetch_logo, *, limit=0, workers=2, progress=None, retry_incomplete=False, include_missing_logos=False, metadata_only=False, logos_only=False):
    items=list(items)
    store.save_asset_catalog(items)
    with store._db() as db:
        db.execute('CREATE TABLE IF NOT EXISTS library_prefill(kind TEXT,symbol TEXT,attempted_at REAL,next_retry REAL,complete INTEGER,PRIMARY KEY(kind,symbol))')
        attempts={(kind,symbol):(retry,complete) for kind,symbol,retry,complete in db.execute('SELECT kind,symbol,next_retry,complete FROM library_prefill')}
    manifest=store.logo_manifest() if include_missing_logos or logos_only else {}
    incomplete_saved=set()
    if retry_incomplete:
        with store._db() as db:
            for key,payload in db.execute('SELECT key,payload FROM responses'):
                try:
                    parts=json.loads(key);value=json.loads(payload)
                    if not store.profile_complete(value):
                        if len(parts)==3 and parts[:2]==['ashare','info-v4']:incomplete_saved.add(('ashare',parts[2]))
                        elif len(parts)==3 and parts[0]=='info':incomplete_saved.add((parts[1],parts[2]))
                except (TypeError,ValueError):continue
    pending=[item for item in items if item.get('type') in ('ashare','swap') and (attempts.get((item['type'],item['symbol']),(0,0))[0]<=time.time() or retry_incomplete and (not attempts.get((item['type'],item['symbol']),(0,0))[1] or (item['type'],item['symbol']) in incomplete_saved) or include_missing_logos and item['symbol'] not in manifest)]
    if logos_only:pending=[item for item in pending if item['symbol'] not in manifest]
    if limit:pending=pending[:limit]
    counts={'catalog':len(items),'queued':len(pending),'processed':0,'complete':0,'partial':0,'logosSaved':0,'logosMissing':0}
    def fetch(item):
        kind,symbol=item['type'],item['symbol'];key=MarketStore.key('ashare','info-v4',symbol) if kind=='ashare' else MarketStore.key('info',kind,symbol)
        record=store.read(key);info=record[0] if record else None
        fetch_error=''
        try:
            if not logos_only and (not store.profile_complete(info) or info.get('identityVersion',2)!=2 or time.time()-record[1]>=30*86400):
                value=fetch_profile(kind,symbol)
                if value.get('type')!=kind or value.get('symbol')!=symbol:raise ValueError('profile identity mismatch')
                if not value.get('incomplete'):store.write(key,value);info=value
            if logos_only and not info:
                website=store.website(kind,symbol)
                if website:info={'type':kind,'symbol':symbol,'name':item.get('name',symbol),'website':website,'incomplete':True}
            if info and not metadata_only:fetch_logo(kind,symbol,info)
        except Exception as error:fetch_error=type(error).__name__
        complete=store.profile_complete(info)
        with store._db() as db:
            db.execute('CREATE TABLE IF NOT EXISTS library_failures(kind TEXT,symbol TEXT,component TEXT,error TEXT,attempted_at REAL,PRIMARY KEY(kind,symbol,component))')
            if fetch_error:
                db.execute('INSERT INTO library_failures VALUES(?,?,?,?,?) ON CONFLICT(kind,symbol,component) DO UPDATE SET error=excluded.error,attempted_at=excluded.attempted_at',(kind,symbol,'logo' if logos_only else 'profile',fetch_error,time.time()))
            elif complete and not logos_only:db.execute('DELETE FROM library_failures WHERE kind=? AND symbol=? AND component=?',(kind,symbol,'profile'))
            db.execute('INSERT INTO library_prefill VALUES(?,?,?,?,?) ON CONFLICT(kind,symbol) DO UPDATE SET attempted_at=excluded.attempted_at,next_retry=excluded.next_retry,complete=excluded.complete',(kind,symbol,time.time(),time.time()+(30*86400 if complete else 86400),int(complete)))
        return complete,bool(store.logo(symbol))
    # Small worker count keeps the UI and real-time market requests responsive.
    with ThreadPoolExecutor(max_workers=max(1,min(12 if logos_only else 6,workers))) as pool:
        for complete,has_logo in pool.map(fetch,pending):
            counts['processed']+=1;counts['complete' if complete else 'partial']+=1
            counts['logosSaved' if has_logo else 'logosMissing']+=1
            if progress:progress(dict(counts))
    return counts
