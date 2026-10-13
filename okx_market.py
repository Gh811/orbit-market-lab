"""Public OKX USDT perpetual instruments, quotes and candlesticks."""

import json
import math
import re
import ssl
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

BASE = "https://www.okx.com/api/v5"
SNAPSHOT = Path(__file__).resolve().parent / "assets" / "okx_instruments.json"
BARS = {"1m": "1m", "5m": "5m", "15m": "15m", "1h": "1H",
        "2h": "2H", "4h": "4H", "6h": "6H", "1d": "1D",
        "2d": "2D", "1w": "1W", "1M": "1M"}
NAMES = {
    "BTC": "Bitcoin", "ETH": "Ethereum", "SOL": "Solana", "XRP": "XRP",
    "DOGE": "Dogecoin", "ADA": "Cardano", "LTC": "Litecoin", "AVAX": "Avalanche",
    "LINK": "Chainlink", "DOT": "Polkadot", "BNB": "BNB", "ZEC": "Zcash",
    "STRK": "Starknet",
    "AAPL": "Apple", "NVDA": "NVIDIA", "SNDK": "Sandisk", "MU": "Micron",
    "SOXL": "Direxion Semiconductor Bull 3X ETF",
    "SOXS": "Direxion Semiconductor Bear 3X ETF",
    "TSLA": "Tesla", "CRCL": "Circle", "MRVL": "Marvell",
    "NKE": "Nike", "WDC": "Western Digital", "XAU": "黄金",
    "SAMSUNG": "Samsung Electronics 三星电子",
    "SKHYNIX": "SK hynix SK海力士",
    "QQQ": "Invesco QQQ 纳斯达克100 ETF",
    "CXMT": "长鑫存储", "ZHONGJI": "中际旭创", "ZHIPU": "智谱", "XIAOMI": "小米集团",
}
ALIASES = {
    "BTC": ("比特币",), "ETH": ("以太坊",), "SOL": ("索拉纳",),
    "AAPL": ("苹果", "苹果公司"), "NVDA": ("英伟达", "辉达", "显卡", "AI芯片"),
    "TSLA": ("特斯拉", "电动车"), "SNDK": ("闪迪", "存储"),
    "MU": ("美光", "内存", "存储", "DRAM"),
    "SOXL": ("半导体三倍", "半导体3倍", "半导体ETF", "半导体三倍做多"),
    "SOXS": ("半导体三倍做空", "半导体三倍看跌", "半导体反向ETF"),
    "CRCL": ("Circle", "圆圈公司", "USDC发行商"),
    "MRVL": ("迈威尔", "美满电子", "网络芯片"),
    "NKE": ("耐克", "运动鞋", "运动服"),
    "WDC": ("西部数据", "硬盘", "数据存储"),
    "XAU": ("黄金", "金价", "gold"),
    "SAMSUNG": ("三星", "三星电子", "Samsung", "半导体", "韩国"),
    "SKHYNIX": ("海力士", "SK海力士", "SK Hynix", "存储", "内存", "HBM", "半导体", "韩国"),
    "QQQ": ("纳指", "纳斯达克100", "纳指100", "Invesco", "指数基金", "ETF"),
    "CXMT": ("长鑫存储", "长鑫科技", "DRAM"),
    "ZHONGJI": ("中际旭创", "光模块", "300308"),
    "ZHIPU": ("智谱", "GLM", "02513"),
    "XIAOMI": ("小米", "小米集团", "01810"),
}


def search_item(symbol, row):
    return {"type": "swap", "symbol": symbol, "name": NAMES.get(symbol, symbol),
            "aliases": list(ALIASES.get(symbol, ())), "exchange": "OKX · USDT 永续",
            "instId": row["instId"], "category": row.get("instCategory", "")}


def match_rank(item, query):
    needle = query.casefold().strip()
    values = [item["symbol"], item["symbol"] + "USDT", item["name"],
              *item.get("aliases", ())]
    normalized = [value.casefold() for value in values]
    if needle in normalized:
        return 0
    if any(value.startswith(needle) for value in normalized):
        return 1
    if any(needle in value for value in normalized):
        return 2
    return None


def request(path, **params):
    url = BASE + path + ("?" + urlencode(params) if params else "")
    req = Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; MarketDeskLocal/3.0)",
                                "Accept": "application/json"})
    system_ca = Path("/etc/ssl/cert.pem")
    context = ssl.create_default_context(cafile=str(system_ca) if system_ca.is_file() else None)
    with urlopen(req, timeout=12, context=context) as response:
        body = json.load(response)
    if not isinstance(body, dict) or body.get("code") != "0":
        raise ValueError("OKX 返回行情错误：" + str(body.get("msg", "未知错误"))[:100])
    return body.get("data", [])


def instrument_snapshot():
    try:
        data = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return {symbol: row for symbol, row in data.items()
                    if re.fullmatch(r"[A-Z0-9]{1,15}", symbol)
                    and isinstance(row, dict)
                    and row.get("instId") == f"{symbol}-USDT-SWAP"}
    except (OSError, ValueError, TypeError):
        pass
    return {}


def instruments():
    result = {}
    try:
        rows = request("/public/instruments", instType="SWAP")
    except (HTTPError, URLError, TimeoutError, ValueError):
        snapshot = instrument_snapshot()
        if snapshot:
            return snapshot
        raise
    for row in rows:
        inst_id = row.get("instId", "")
        match = re.fullmatch(r"([A-Z0-9]{1,15})-USDT-SWAP", inst_id)
        if match and row.get("state") == "live":
            result[match.group(1)] = {key: row.get(key, "") for key in
                                      ("instId", "state", "instCategory", "tickSz", "ctVal")}
    if result:
        try:
            temporary = SNAPSHOT.with_suffix(".tmp")
            temporary.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")),
                                 encoding="utf-8")
            temporary.replace(SNAPSHOT)
        except OSError:
            pass
    return result or instrument_snapshot()


def search(query, catalog):
    results = [(rank, item) for symbol, row in catalog.items()
               if (rank := match_rank(item := search_item(symbol, row), query)) is not None]
    return [item for _, item in sorted(results, key=lambda pair: (pair[0], pair[1]["symbol"]))[:14]]


def search_catalog(catalog):
    return [search_item(symbol, row)
            for symbol, row in sorted(catalog.items())]


def daily_hot(catalog, per_category=10):
    """Rank live stock-linked and crypto swaps by estimated 24h USDT turnover."""
    ranked = {"1": [], "3": []}
    for row in request("/market/tickers", instType="SWAP"):
        inst_id = row.get("instId", "")
        if not inst_id.endswith("-USDT-SWAP"):
            continue
        symbol = inst_id[:-10]
        instrument = catalog.get(symbol)
        category = str(instrument.get("instCategory", "")) if instrument else ""
        if category not in ranked:
            continue
        try:
            last = float(row["last"])
            base_volume = float(row["volCcy24h"])
            turnover = last * base_volume
            stamp = int(row["ts"])
        except (KeyError, TypeError, ValueError, OverflowError):
            continue
        if not all(map(math.isfinite, (last, base_volume, turnover))) or turnover <= 0 or stamp <= 0:
            continue
        ranked[category].append({**search_item(symbol, instrument),
                                 "turnover24h": round(turnover, 2), "tickerTime": stamp})
    for category in ranked:
        ranked[category].sort(key=lambda item: (-item["turnover24h"], item["symbol"]))
    if len(ranked["1"]) < per_category or len(ranked["3"]) < per_category:
        raise ValueError("OKX 热门榜数据不足")
    return sorted(ranked["1"][:per_category] + ranked["3"][:per_category],
                  key=lambda item: (-item["turnover24h"], item["symbol"]))


def normalize_candles(rows):
    candles = []
    for row in rows:
        try:
            if len(row) < 9:
                continue
            stamp, op, high, low, close = int(row[0]), *map(float, row[1:5])
            volume = float(row[7])  # Quote-currency turnover (USDT), not contract count.
            if (all(math.isfinite(value) for value in (op, high, low, close, volume))
                    and low > 0 and low <= min(op, close) <= max(op, close) <= high
                    and volume >= 0):
                candles.append({"t": stamp, "o": op, "h": high, "l": low,
                                "c": close, "v": volume, "confirmed": row[8] == "1"})
        except (TypeError, ValueError):
            continue
    return sorted({bar["t"]: bar for bar in candles}.values(), key=lambda bar: bar["t"])


def candles(symbol, tf, before_ms=None):
    if tf not in BARS:
        raise ValueError("时间周期无效")
    params = {"instId": f"{symbol}-USDT-SWAP", "bar": BARS[tf], "limit": "300"}
    if before_ms is not None:
        params["after"] = str(before_ms)
    path = "/market/history-candles" if before_ms is not None else "/market/candles"
    result = normalize_candles(request(path, **params))
    return [bar for bar in result if bar["t"] < before_ms] if before_ms is not None else result


def quote(symbol):
    rows = request("/market/ticker", instId=f"{symbol}-USDT-SWAP")
    if not rows:
        raise ValueError("OKX 暂无该合约报价")
    row = rows[0]
    return {"c": float(row["last"]), "t": int(row["ts"]) / 1000,
            "pc": float(row.get("open24h") or 0), "instId": row["instId"]}


def quotes(symbols):
    wanted = set(symbols)
    result = {}
    for row in request("/market/tickers", instType="SWAP"):
        inst_id = row.get("instId", "")
        if not inst_id.endswith("-USDT-SWAP"):
            continue
        symbol = inst_id[:-10]
        if symbol in wanted:
            try:
                result[symbol] = {"c": float(row["last"]), "t": int(row["ts"]) / 1000,
                                  "pc": float(row.get("open24h") or 0)}
            except (TypeError, ValueError):
                continue
    return result
