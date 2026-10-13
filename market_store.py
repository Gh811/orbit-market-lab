"""Persistent public market data store, separate from account state."""

import json
import re
import sqlite3
import threading
import time
from pathlib import Path


class MarketStore:
    def __init__(self, path):
        self.path = Path(path)
        self._locks = [threading.Lock() for _ in range(64)]
        self._guard = threading.Lock()
        self._hot = {}
        self._retry_after = {}
        self._pending = set()
        self._refresh_slots = threading.BoundedSemaphore(4)
        self._init()

    def _db(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.execute("PRAGMA busy_timeout=10000")
        return db

    def _init(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._db() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("CREATE TABLE IF NOT EXISTS responses ("
                       "key TEXT PRIMARY KEY, payload TEXT NOT NULL, fetched_at REAL NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS candles ("
                       "symbol TEXT NOT NULL, tf TEXT NOT NULL, t INTEGER NOT NULL, "
                       "payload TEXT NOT NULL, PRIMARY KEY(symbol, tf, t))")
            db.execute("CREATE INDEX IF NOT EXISTS candles_recent ON candles(symbol, tf, t DESC)")
            db.execute("CREATE TABLE IF NOT EXISTS logos ("
                       "symbol TEXT PRIMARY KEY, category TEXT NOT NULL, mime TEXT NOT NULL, "
                       "image BLOB NOT NULL, source TEXT NOT NULL, remote_url TEXT NOT NULL, "
                       "saved_at REAL NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS asset_summaries ("
                       "kind TEXT NOT NULL, symbol TEXT NOT NULL, summary TEXT NOT NULL, "
                       "source TEXT NOT NULL, url TEXT NOT NULL, "
                       "updated_at REAL NOT NULL, PRIMARY KEY(kind, symbol))")
            db.execute("CREATE TABLE IF NOT EXISTS asset_websites ("
                       "kind TEXT NOT NULL, symbol TEXT NOT NULL, website TEXT NOT NULL, "
                       "source TEXT NOT NULL, updated_at REAL NOT NULL, "
                       "PRIMARY KEY(kind, symbol))")
            db.execute("CREATE TABLE IF NOT EXISTS instruments ("
                       "symbol TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at REAL NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS searches ("
                       "query TEXT PRIMARY KEY, results TEXT NOT NULL, searched_at REAL NOT NULL, "
                       "count INTEGER NOT NULL DEFAULT 1)")
            db.execute("CREATE TABLE IF NOT EXISTS daily_hot ("
                       "day TEXT PRIMARY KEY, payload TEXT NOT NULL, fetched_at REAL NOT NULL)")

    @staticmethod
    def key(*parts):
        return json.dumps(parts, separators=(",", ":"), ensure_ascii=True)

    def read(self, key):
        with self._db() as db:
            row = db.execute("SELECT payload, fetched_at FROM responses WHERE key=?", (key,)).fetchone()
        if row is None:
            return None
        try:
            return json.loads(row[0]), row[1]
        except (ValueError, TypeError):
            return None

    def write(self, key, value, *, symbol=None, tf=None, fetched_at=None):
        stamp = time.time() if fetched_at is None else fetched_at
        payload = json.dumps(value, separators=(",", ":"), ensure_ascii=False)
        with self._db() as db:
            db.execute("INSERT INTO responses(key,payload,fetched_at) VALUES(?,?,?) "
                       "ON CONFLICT(key) DO UPDATE SET payload=excluded.payload, "
                       "fetched_at=excluded.fetched_at", (key, payload, stamp))
            if symbol and tf and isinstance(value, list):
                rows = [(symbol, tf, bar["t"], json.dumps(bar, separators=(",", ":")))
                        for bar in value if isinstance(bar, dict) and isinstance(bar.get("t"), int)]
                db.executemany("INSERT INTO candles(symbol,tf,t,payload) VALUES(?,?,?,?) "
                               "ON CONFLICT(symbol,tf,t) DO UPDATE SET payload=excluded.payload", rows)

    def invalidate_response(self, key):
        """删除某条响应缓存，使其下次请求重新生成（摘要文案变更后使用）。"""
        with self._db() as db:
            db.execute("DELETE FROM responses WHERE key=?", (key,))
        self._retry_after.pop(key, None)

    def save_instruments(self, catalog):
        stamp = time.time()
        rows = [(symbol, json.dumps(row, separators=(",", ":"), ensure_ascii=False), stamp)
                for symbol, row in catalog.items()
                if re.fullmatch(r"[A-Z0-9]{1,15}", symbol) and isinstance(row, dict)
                and row.get("instId") == f"{symbol}-USDT-SWAP"]
        with self._db() as db:
            db.executemany("INSERT INTO instruments(symbol,payload,updated_at) VALUES(?,?,?) "
                           "ON CONFLICT(symbol) DO UPDATE SET payload=excluded.payload, "
                           "updated_at=excluded.updated_at", rows)

    def save_search(self, query, results):
        if not isinstance(query, str) or not 1 <= len(query) <= 32:
            raise ValueError("invalid search query")
        matches = [row for row in results[:14] if isinstance(row, dict)
                   and isinstance(row.get("symbol"), str)
                   and re.fullmatch(r"[A-Z0-9]{1,15}", row["symbol"])]
        with self._db() as db:
            db.execute("INSERT INTO searches(query,results,searched_at,count) VALUES(?,?,?,1) "
                       "ON CONFLICT(query) DO UPDATE SET results=excluded.results, "
                       "searched_at=excluded.searched_at,count=count+1",
                       (query, json.dumps(matches, ensure_ascii=False), time.time()))

    def daily_hot(self, day=None):
        with self._db() as db:
            row = db.execute("SELECT day,payload,fetched_at FROM daily_hot " +
                             ("WHERE day=? " if day else "") + "ORDER BY day DESC LIMIT 1",
                             (day,) if day else ()).fetchone()
        return {"day": row[0], "items": json.loads(row[1]), "fetchedAt": row[2]} if row else None

    def save_daily_hot(self, day, items):
        with self._db() as db:
            db.execute("INSERT INTO daily_hot(day,payload,fetched_at) VALUES(?,?,?) "
                       "ON CONFLICT(day) DO UPDATE SET payload=excluded.payload, "
                       "fetched_at=excluded.fetched_at",
                       (day, json.dumps(items, ensure_ascii=False, separators=(",", ":")), time.time()))

    def recent_candles(self, symbol, tf, *, before=None, limit=300):
        query = "SELECT payload FROM candles WHERE symbol=? AND tf=?"
        params = [symbol, tf]
        if before is not None:
            query += " AND t<?"
            params.append(before)
        query += " ORDER BY t DESC LIMIT ?"
        params.append(limit)
        with self._db() as db:
            rows = db.execute(query, params).fetchall()
        return [json.loads(row[0]) for row in reversed(rows)]

    @staticmethod
    def logo_mime(payload):
        if not isinstance(payload, bytes) or not 50 <= len(payload) <= 262144:
            return None
        if payload.startswith(b"\x89PNG\r\n\x1a\n"):
            return "image/png"
        if payload.startswith(b"\xff\xd8\xff"):
            return "image/jpeg"
        if payload.startswith(b"RIFF") and payload[8:12] == b"WEBP":
            return "image/webp"
        return None

    def save_logo(self, symbol, category, payload, source, *, remote_url="", saved_at=None,
                  overwrite=True):
        if not re.fullmatch(r"[A-Z0-9]{1,15}", symbol):
            raise ValueError("invalid logo symbol")
        mime = self.logo_mime(payload)
        if not mime:
            raise ValueError("invalid logo image")
        statement = ("INSERT INTO logos(symbol,category,mime,image,source,remote_url,saved_at) "
                     "VALUES(?,?,?,?,?,?,?)")
        if overwrite:
            statement += (" ON CONFLICT(symbol) DO UPDATE SET category=excluded.category, "
                          "mime=excluded.mime, image=excluded.image, source=excluded.source, "
                          "remote_url=excluded.remote_url, saved_at=excluded.saved_at")
        else:
            statement += " ON CONFLICT(symbol) DO NOTHING"
        with self._db() as db:
            db.execute(statement, (symbol, str(category), mime, payload, str(source)[:256],
                                   str(remote_url)[:1000], time.time() if saved_at is None else saved_at))

    def logo(self, symbol, category=None):
        with self._db() as db:
            row = db.execute("SELECT category,mime,image,source,remote_url,saved_at "
                             "FROM logos WHERE symbol=?", (symbol,)).fetchone()
        if row is None or (category is not None and row[0] != str(category)):
            return None
        return {"category": row[0], "mime": row[1], "image": row[2], "source": row[3],
                "remote_url": row[4], "saved_at": row[5]}

    def summary(self, kind, symbol):
        with self._db() as db:
            row = db.execute("SELECT summary, source, url FROM asset_summaries "
                             "WHERE kind=? AND symbol=?", (str(kind), str(symbol).upper())).fetchone()
        if row is None:
            return None
        return row[0], row[1], row[2]

    def save_summary(self, kind, symbol, summary, source="", url="", *, overwrite=True):
        statement = ("INSERT INTO asset_summaries(kind,symbol,summary,source,url,updated_at) "
                     "VALUES(?,?,?,?,?,?)")
        if overwrite:
            statement += (" ON CONFLICT(kind,symbol) DO UPDATE SET summary=excluded.summary, "
                          "source=excluded.source, url=excluded.url, updated_at=excluded.updated_at")
        else:
            statement += " ON CONFLICT(kind,symbol) DO NOTHING"
        with self._db() as db:
            db.execute(statement, (str(kind), str(symbol).upper(), str(summary), str(source)[:256],
                                   str(url)[:1000], time.time()))

    def all_summaries(self):
        with self._db() as db:
            rows = db.execute("SELECT kind, symbol, summary, source, url FROM asset_summaries").fetchall()
        return {(row[0], row[1]): (row[2], row[3], row[4]) for row in rows}

    def website(self, kind, symbol):
        with self._db() as db:
            row = db.execute("SELECT website FROM asset_websites WHERE kind=? AND symbol=?",
                             (str(kind), str(symbol).upper())).fetchone()
        return row[0] if row else ""

    def save_website(self, kind, symbol, website, source="", *, overwrite=False):
        if not str(website).startswith("https://"):
            raise ValueError("website must use https")
        statement = ("INSERT INTO asset_websites(kind,symbol,website,source,updated_at) "
                     "VALUES(?,?,?,?,?)")
        if overwrite:
            statement += (" ON CONFLICT(kind,symbol) DO UPDATE SET "
                          "website=excluded.website,source=excluded.source,updated_at=excluded.updated_at")
        else:
            statement += " ON CONFLICT(kind,symbol) DO NOTHING"
        with self._db() as db:
            db.execute(statement, (str(kind), str(symbol).upper(), str(website)[:1000],
                                   str(source)[:256], time.time()))

    def import_legacy_logos(self, directory):
        """Copy valid old image+metadata pairs without replacing newer DB records."""
        imported = 0
        for meta_file in Path(directory).glob("*.json"):
            if not re.fullmatch(r"[A-Z0-9]{1,15}", meta_file.stem):
                continue
            try:
                meta = json.loads(meta_file.read_text(encoding="utf-8"))
                extension = meta.get("extension")
                if extension not in ("png", "jpg", "webp"):
                    continue
                payload = meta_file.with_suffix("." + extension).read_bytes()
                if self.logo_mime(payload) != {"png": "image/png", "jpg": "image/jpeg",
                                               "webp": "image/webp"}[extension]:
                    continue
                self.save_logo(meta_file.stem, meta.get("category", ""), payload,
                               meta.get("source", ""), remote_url=meta.get("remoteUrl", ""),
                               saved_at=float(meta.get("savedAt", 0)), overwrite=False)
                imported += 1
            except (OSError, ValueError, TypeError, json.JSONDecodeError):
                continue
        return imported

    def get_or_refresh(self, key, ttl, fetch, *, symbol=None, tf=None, hot=False,
                       background=False):
        if hot:
            with self._guard:
                self._hot[key] = (time.time(), ttl, fetch, symbol, tf)
        record = self.read(key)
        if record and time.time() - record[1] < ttl:
            return record[0], False
        if record and time.time() < self._retry_after.get(key, 0):
            return record[0], True
        # Return saved data without making a phone wait for an upstream timeout.
        # Use the same locked synchronous path in the worker; only four updates
        # can run at once, and repeated requests for a key share one worker.
        if record and record[0] and background:
            with self._guard:
                if key not in self._pending and self._refresh_slots.acquire(blocking=False):
                    self._pending.add(key)
                    def refresh():
                        try:
                            self.get_or_refresh(key, ttl, fetch, symbol=symbol, tf=tf)
                        except (OSError, TimeoutError, ValueError):
                            pass
                        finally:
                            with self._guard:
                                self._pending.discard(key)
                            self._refresh_slots.release()
                    threading.Thread(target=refresh, daemon=True).start()
            return record[0], True
        lock = self._locks[hash(key) % len(self._locks)]
        with lock:
            record = self.read(key)
            if record and time.time() - record[1] < ttl:
                return record[0], False
            if record and time.time() < self._retry_after.get(key, 0):
                return record[0], True
            try:
                value = fetch()
                # Empty upstream responses must not erase useful cached candles.
                if isinstance(value, list) and not value and record and record[0]:
                    self._retry_after[key] = time.time() + 30
                    return record[0], True
                self.write(key, value, symbol=symbol, tf=tf)
                self._retry_after.pop(key, None)
                return value, False
            except (OSError, TimeoutError, ValueError):
                if record:
                    self._retry_after[key] = time.time() + 30
                    return record[0], True
                raise

    def refresh_hot(self, *, max_items=12, active_seconds=1800):
        now = time.time()
        with self._guard:
            self._hot = {key: item for key, item in self._hot.items()
                         if now - item[0] < active_seconds}
            items = sorted(self._hot.items(), key=lambda item: item[1][0], reverse=True)[:max_items]
        for key, (_, ttl, fetch, symbol, tf) in items:
            try:
                self.get_or_refresh(key, ttl, fetch, symbol=symbol, tf=tf)
            except (OSError, TimeoutError, ValueError):
                pass

    def save_asset_catalog(self, items):
        rows=[];stamp=time.time()
        for item in items:
            if isinstance(item,dict) and item.get('type') in ('swap','ashare') and isinstance(item.get('name'),str) and bool(item['name'].strip()) and re.fullmatch(r'[A-Z0-9]{1,15}',str(item.get('symbol',''))):
                rows.append((item['type'],item['symbol'],json.dumps(item,ensure_ascii=False,separators=(',',':')),stamp))
        with self._db() as db:
            db.execute('CREATE TABLE IF NOT EXISTS asset_catalog(kind TEXT NOT NULL,symbol TEXT NOT NULL,payload TEXT NOT NULL,updated_at REAL NOT NULL,PRIMARY KEY(kind,symbol))')
            db.executemany('INSERT INTO asset_catalog VALUES(?,?,?,?) ON CONFLICT(kind,symbol) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at',rows)

    def track_assets(self, items, *, followed=False):
        stamp=time.time();rows=[]
        for item in items:
            if isinstance(item,dict) and item.get('type') in ('swap','ashare') and re.fullmatch(r'[A-Z0-9]{1,15}',str(item.get('symbol',''))):
                rows.append((item['type'],item['symbol'],int(followed),stamp,0))
        with self._db() as db:
            db.execute('CREATE TABLE IF NOT EXISTS tracked_assets(kind TEXT NOT NULL,symbol TEXT NOT NULL,followed INTEGER NOT NULL,seen_at REAL NOT NULL,next_refresh REAL NOT NULL,PRIMARY KEY(kind,symbol))')
            db.executemany('INSERT INTO tracked_assets VALUES(?,?,?,?,?) ON CONFLICT(kind,symbol) DO UPDATE SET followed=MAX(tracked_assets.followed,excluded.followed),seen_at=excluded.seen_at,next_refresh=CASE WHEN excluded.followed>tracked_assets.followed THEN 0 ELSE tracked_assets.next_refresh END',rows)

    def due_assets(self, limit=12):
        with self._db() as db:
            exists=db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tracked_assets'").fetchone()
            if not exists:return []
            rows=db.execute('SELECT kind,symbol,followed FROM tracked_assets WHERE next_refresh<=? ORDER BY followed DESC,next_refresh ASC,seen_at DESC LIMIT ?',(time.time(),max(1,min(32,limit)))).fetchall()
        return [{'type':kind,'symbol':symbol,'_priority':bool(followed)} for kind,symbol,followed in rows]

    def finish_asset_refresh(self, kind, symbol):
        with self._db() as db:
            exists=db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tracked_assets'").fetchone()
            if exists:db.execute('UPDATE tracked_assets SET next_refresh=? + CASE WHEN followed=1 THEN 900 ELSE 86400 END WHERE kind=? AND symbol=?',(time.time(),kind,symbol))
