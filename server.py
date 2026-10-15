#!/usr/bin/env python3
"""Local-only OKX perpetual dashboard; an optional news token stays in memory."""
import getpass
import hashlib
import hmac
import html
from email.utils import parsedate_to_datetime
from http.cookies import SimpleCookie
import json
import os
import re
import ssl
import sys
import threading
import time
import xml.etree.ElementTree as ET
from accounts import AccountStore, SESSION_SECONDS, StateConflict
from asset_data_pipeline import AssetDataPipeline
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, unquote, urlencode, urlsplit
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from backtest import jobs as research_jobs

import okx_market
from release_tools import version_html, release_identity
import ashare_market
from asset_brand import company_icon
from market_store import MarketStore

ROOT = Path(__file__).resolve().parent
LOGO_CACHE_DIR = Path(os.environ.get("MARKET_LOGO_CACHE_DIR",str(ROOT / ".asset_logo_cache")))
ACCOUNT_DB = Path(os.environ.get("MARKET_ACCOUNT_DB", str(ROOT / ".market_accounts.sqlite3")))
MARKET_DB = Path(os.environ.get("MARKET_DATA_DB", str(ROOT / ".market_data.sqlite3")))
MARKET_STORE = None
MARKET_STORE_LOCK = threading.Lock()
ACCOUNT_STORE = None
ACCOUNT_LOCK = threading.Lock()
LOGIN_FAILURES = {}
PORT = int(os.environ.get("MARKET_PORT", "8000"))
PUBLIC_HOST = os.environ.get("MARKET_PUBLIC_HOST", "").strip().lower()
ALLOWED_HOSTS = {"localhost", "127.0.0.1"}
if PUBLIC_HOST:
    ALLOWED_HOSTS.add(PUBLIC_HOST)
TOKEN = os.environ.get("FINNHUB_API_KEY", "").strip()
if not TOKEN and sys.stdin.isatty():
    TOKEN = getpass.getpass("Finnhub API Key（可选，仅用于新闻及部分资料；直接回车也可使用 OKX 行情）：").strip()

TIMEFRAMES = {
    "1m": ("1", 60, 240), "5m": ("5", 300, 240),
    "15m": ("15", 900, 240), "1h": ("60", 3600, 240),
    "4h": ("60", 14400, 240),
    "6h": ("60", 21600, 240), "1d": ("D", 86400, 240),
    "1w": ("W", 86400, 300),
}
CACHE = {}
CACHE_LOCK = threading.RLock()
CACHE_KEY_LOCKS = {}
MAX_CACHE_ENTRIES = 256
initial_catalog = okx_market.instrument_snapshot()
if initial_catalog:
    CACHE[("okx", "instruments")] = (time.monotonic(), initial_catalog)
CRYPTO_NAMES = {"BTC": "Bitcoin", "ETH": "Ethereum", "SOL": "Solana", "XRP": "XRP",
                "DOGE": "Dogecoin", "ADA": "Cardano", "LTC": "Litecoin", "AVAX": "Avalanche",
                "LINK": "Chainlink", "DOT": "Polkadot", "BNB": "BNB", "USDC": "USD Coin",
                "ZEC": "Zcash"}
STOCK_LINKED_SYMBOLS = {"AAPL", "NVDA", "SOXL", "SOXS", "SNDK", "MU", "CRCL", "MRVL", "TSLA", "QQQ", "SAMSUNG", "SKHYNIX", "NKE", "WDC", "OPENAI", "ANTHROPIC", "INTC"}
BRAND_LOGOS = {"ZHONGJI": ("/assets/icons/brand/zhongji.png", "中际旭创官网"),
               "XIAOMI": ("/assets/icons/brand/xiaomi.png", "小米官网"),
               "SKHYNIX": ("/assets/icons/brand/skhynix.png", "SK hynix 官网"),
               "SAMSUNG": ("/assets/icons/brand/samsung.png", "Samsung 官网"),
               "QQQ": ("/assets/icons/brand/qqq.svg", "Invesco 发行商官网"),
               "NKE": ("/assets/icons/brand/nike.svg", "Nike 品牌图形 · Simple Icons"),
               "WDC": ("/assets/icons/brand/wdc.svg", "Western Digital 官网"),
               "GOOGL": ("/assets/icons/brand/google.png", "Google 官方品牌素材"),
               "GOOG": ("/assets/icons/brand/google.png", "Google 官方品牌素材"),
               "TSLA": ("/assets/icons/brand/tesla.svg", "Tesla 品牌图形 · Simple Icons"),
               "ANTHROPIC": ("/assets/icons/brand/anthropic.png", "Anthropic 官网图标"),
               "INTC": ("/assets/icons/brand/intel.png", "Intel 官网图标"),
               "OPENAI": ("/assets/icons/brand/openai.svg", "OPENAI 代码文字标识 · 非官方 Logo"),
               "XAU": ("/assets/icons/brand/gold.svg", "黄金商品示意图 · 非品牌 Logo")}
CURATED_COIN_LOGOS = {"DOGE": ("/assets/icons/crypto/doge.png", "Dogecoin 官网")}
# A股没有 OKX 图标链路，这里只放人工核对过的公司官网标识；新增前必须先核验图片确为该公司标识。
ASHARE_BRAND_LOGOS = {"SZ301308": ("/assets/icons/brand/sz301308.png", "江波龙官网 · 公司标识"),
                     "SZ000651": ("/assets/icons/brand/sz000651.png", "格力电器官网 · 公司标识"),
                     "SH600362": ("/assets/icons/brand/sh600362.png", "江西铜业官网 · 公司标识"),
                     "SH600519": ("/assets/icons/brand/sh600519.png", "贵州茅台官网 · 公司标识"),
                      "SZ002384": ("/assets/icons/brand/sz002384.png", "东山精密官网 · 公司标识")}
SUMMARIES = {
    ("stock", "CXMT"): ("长鑫存储专注于 DRAM 存储芯片的设计、研发、生产和销售，产品应用于移动终端、电脑、服务器等领域。", "长鑫存储官网", "https://www.cxmt.com/"),
    ("stock", "META"): ("Meta 经营 Facebook、Instagram、WhatsApp 等社交与通信产品，并研发人工智能、虚拟现实和增强现实技术。", "Meta 官网", "https://about.meta.com/"),
    ("stock", "ARM"): ("Arm 提供处理器架构、芯片设计知识产权及计算平台，相关技术应用于手机、数据中心和嵌入式设备。", "Arm 官网", "https://www.arm.com/company"),
    ("stock", "ZHONGJI"): ("中际旭创研发和制造高速光模块及光互连产品，服务云计算、数据中心与 AI 算力基础设施。", "中际旭创官网", "https://www.zj-innolight.com/cn"),
    ("stock", "ZHIPU"): ("智谱研发 GLM 系列大模型，并提供面向开发者和企业的模型与智能体服务。", "智谱官网", "https://www.zhipuai.cn/zh/about"),
    ("stock", "XIAOMI"): ("小米集团经营智能手机、智能硬件、汽车及相关互联网服务。", "小米官网", "https://www.mi.com/"),
    ("stock", "SOXL"): ("SOXL 对应 Direxion 每日半导体看涨 3 倍 ETF，目标为单日跟踪半导体指数的三倍表现。", "Direxion", "https://www.direxion.com/product/daily-semiconductor-bull-bear-3x-etfs"),
    ("stock", "AAPL"): ("Apple 设计和销售 iPhone、Mac 等设备，并提供操作系统、应用商店及数字服务。", "Apple", "https://www.apple.com/"),
    ("stock", "NVDA"): ("NVIDIA 开发图形处理器、加速计算平台及 AI 软件，应用于数据中心、图形与多种行业。", "NVIDIA", "https://www.nvidia.com/en-us/about-nvidia/"),
    ("stock", "SNDK"): ("Sandisk 专注于 NAND 闪存、固态硬盘和其他存储产品，服务个人与企业用户。", "Sandisk", "https://www.sandisk.com/company/about-us"),
    ("stock", "MU"): ("Micron 制造 DRAM、NAND 等内存和存储产品，应用于数据中心、终端设备与汽车。", "Micron", "https://www.micron.com/"),
    ("stock", "MRVL"): ("Marvell 开发数据基础设施半导体，产品涉及数据中心计算、网络连接和存储。", "Marvell 官网", "https://www.marvell.com/company.html"),
    ("stock", "NKE"): ("Nike 设计、销售运动鞋、服装、装备和配饰，旗下还包括 Converse。", "NIKE, Inc.", "https://investors.nike.com/company-information/who-we-are"),
    ("stock", "WDC"): ("WD（Western Digital）主要开发和提供硬盘（HDD）及大规模数据存储技术，面向数据中心、云服务商和企业。闪存业务已于 2025 年分拆为独立的 Sandisk。", "WD 官网 · 2026 年品牌说明", "https://blog.westerndigital.com/wd-ai-infrastructure-brand-launch/"),
    ("stock", "GOOGL"): ("Alphabet 是 Google 的母公司，业务包括搜索、广告、YouTube、Android 和 Google Cloud。", "Alphabet", "https://abc.xyz/investor/"),
    ("stock", "GOOG"): ("Alphabet 是 Google 的母公司，业务包括搜索、广告、YouTube、Android 和 Google Cloud。", "Alphabet", "https://abc.xyz/investor/"),
    ("stock", "TSLA"): ("Tesla 制造电动车、储能产品与能源系统，并开发相关软件。", "Tesla", "https://www.tesla.com/about"),
    ("stock", "OPENAI"): ("OpenAI 研发 GPT 系列大语言模型与生成式 AI 产品，包括 ChatGPT、开发者 API 与图像生成服务。", "OpenAI 官网", "https://openai.com/about/"),
    ("stock", "ANTHROPIC"): ("Anthropic 研发 Claude 系列大语言模型，提供对话助手、编程与 API 服务，并专注 AI 安全研究。", "Anthropic 官网", "https://www.anthropic.com/company"),
    ("stock", "INTC"): ("Intel 开发和制造处理器及其他半导体产品。", "Intel", "https://www.intel.com/content/www/us/en/company-overview/company-overview.html"),
    ("commodity", "XAU"): ("黄金是一种贵金属，广泛用于首饰、电子技术、投资及央行储备。", "世界黄金协会", "https://www.gold.org/about-gold/gold-demand"),
    ("commodity", "XAG"): ("XAG 代表白银，是一种贵金属与重要的工业金属，广泛用于首饰、电子、光伏、投资及工业制造。", "世界白银协会", "https://www.silverinstitute.org/"),
    ("stock", "SKHYNIX"): ("SK 海力士生产 DRAM、NAND 和 HBM 等存储半导体。", "SK hynix", "https://ssd.skhynix.com/about_us/"),
    ("stock", "SAMSUNG"): ("三星电子经营消费电子与半导体业务，包括智能手机、电视、DRAM、NAND 和芯片代工。", "Samsung Electronics", "https://www.samsung.com/global/ir/ir-resources/our-business/"),
    ("stock", "QQQ"): ("Invesco QQQ 是追踪纳斯达克 100 指数的交易所交易基金。", "Invesco", "https://www.invesco.com/us/en/solutions/invesco-qqq.html"),
    ("stock", "SPY"): ("SPY 是道富环球（State Street）发行的 SPDR 标普 500 ETF 信托，追踪标普 500 指数表现，是全球规模最大、流动性最好的股票 ETF 之一。", "SPDR 官网", "https://www.ssga.com/us/en/intermediary/etfs/spdr-sp-500-etf-trust-spy"),
    ("stock", "SNXX"): ("SNXX 是 Tradr 2X Long SNDK Daily ETF，目标为单日提供 Sandisk（SNDK）股价两倍（200%）的杠杆表现。", "Tradr ETFs 官网", "https://www.tradretfs.com/snxx"),
    ("stock", "SOXS"): ("SOXS 是 Direxion 每日半导体看跌 3 倍 ETF，目标为单日提供半导体指数三倍反向（做空）表现。", "Direxion 官网", "https://www.direxion.com/product/daily-semiconductor-bull-bear-3x-etfs"),
    ("stock", "MSTR"): ("MicroStrategy（微策略，现品牌 Strategy）是一家美国商业智能软件公司，也是全球持有比特币最多的上市公司，其股票常被视为比特币的高杠杆代理。", "Strategy 官网", "https://www.strategy.com/"),
    ("crypto", "A"): ("Vaulta（代币代码 A）由 EOS 网络更名转型而来，定位面向 Web3 银行与金融基础设施的 Layer 1 公链；A 是其原生代币，用于网络资源、质押与治理。", "Vaulta 官网", "https://vaulta.com/"),
    ("commodity", "BZ"): ("BZ 代表布伦特原油（Brent Crude），是国际原油定价的主要基准之一，广泛用于欧洲、非洲及中东原油的定价参考。", "OKX 商品资料", "https://www.okx.com/price/brent-crude-oil-bz"),
    ("crypto", "BTC"): ("比特币由中本聪提出，是通过点对点网络运行的数字货币；BTC 是该网络的原生资产。", "Bitcoin.org", "https://bitcoin.org/en/"),
    ("crypto", "ETH"): ("以太坊是支持智能合约的区块链网络；ETH 是其原生资产，用于支付网络交易费用。", "Ethereum.org", "https://ethereum.org/developers/docs/intro-to-ethereum/"),
    ("crypto", "ZEC"): ("Zcash 是重视交易隐私的数字货币；它同时支持透明交易和采用零知识证明的屏蔽交易。", "Zcash", "https://z.cash/learn/is-zcash-traceable/"),
    ("stock", "AVGO"): ("Broadcom 提供半导体与基础设施软件，覆盖网络、存储、宽带和无线通信，并在收购 VMware 后扩展企业软件业务。", "Broadcom 官网", "https://www.broadcom.com/company"),
    ("stock", "AMD"): ("AMD 设计 CPU、GPU 与自适应计算芯片，服务于数据中心、个人电脑和游戏终端。", "AMD 官网", "https://www.amd.com/en/corporate/about-amd.html"),
    ("stock", "AMZN"): ("Amazon 经营电商与物流业务，并通过 AWS 提供云计算服务，同时涉足数字流媒体与广告。", "Amazon 官网", "https://www.aboutamazon.com/"),
    ("stock", "DELL"): ("Dell Technologies 销售 PC、服务器、存储与网络设备，覆盖消费与企业 IT 市场。", "Dell Technologies", "https://investors.delltechnologies.com/"),
    ("stock", "KORU"): ("KORU 是 Direxion 每日韩国股票看涨 3 倍 ETF，追求韩国市场大盘股单日三倍表现。", "Direxion", "https://www.direxion.com/product/daily-korea-bull-bear-3x-etfs"),
    ("stock", "LITE"): ("Lumentum 提供光通信器件与激光器，应用于数据中心互联、电信网络和工业制造。", "Lumentum 官网", "https://www.lumentum.com/en/about-us"),
    ("stock", "MSFT"): ("Microsoft 开发 Windows、Office 与 Azure 云服务，并经营游戏、搜索与广告等业务。", "Microsoft 官网", "https://www.microsoft.com/en-us/about"),
    ("stock", "ORCL"): ("Oracle 提供数据库、企业应用与云基础设施服务（OCI）。", "Oracle 官网", "https://www.oracle.com/corporate/"),
    ("stock", "TSM"): ("台积电（TSMC）是全球最大的晶圆代工企业，为芯片设计公司制造先进制程晶圆。", "TSMC 官网", "https://www.tsmc.com/english/about"),
    ("stock", "SPCX"): ("SpaceX（太空探索技术公司）是美国航天企业，由埃隆·马斯克创立，业务涵盖猎鹰系列火箭发射、龙飞船载人航天、星链卫星互联网，并正在研发星舰重型运载系统。", "SpaceX 官网", "https://www.spacex.com/"),
    ("crypto", "BNB"): ("BNB 是 BNB Chain 生态的原生资产，由币安发行，用于支付链上交易费用并参与生态治理。", "Binance", "https://www.binance.com/en/bnb"),
    ("crypto", "SOL"): ("Solana 是主打高吞吐量的智能合约区块链；SOL 是其原生资产，用于支付交易费用与质押。", "Solana 官网", "https://solana.com/"),
    ("crypto", "SUI"): ("Sui 是采用 Move 语言的高性能 Layer 1 区块链；SUI 是其原生资产，用于支付 Gas 与质押。", "Sui 官网", "https://sui.io/"),
    ("crypto", "PEPE"): ("Pepe 是基于以太坊的 MEME 代币，以 Pepe the Frog 形象为主题，无官方实用功能宣称。", "Pepe 官网", "https://www.pepe.vip/"),
    ("crypto", "BABY"): ("Babylon 是比特币质押协议，BABY 是其原生资产，用于质押与网络治理。", "Babylon 官网", "https://babylonlabs.io/"),
    ("crypto", "HYPE"): ("Hyperliquid 是去中心化永续合约交易所，其 L1 链承载链上订单簿与撮合；HYPE 是网络原生代币，用于质押与治理。", "Hyperliquid 官网", "https://www.hyperliquid.xyz/"),
    ("crypto", "OKB"): ("OKB 是欧易 OKX 发行的平台代币，可用于手续费抵扣与生态服务，并通过回购销毁减少流通量。", "OKX 官网", "https://www.okx.com/okb"),
    ("crypto", "WLD"): ("Worldcoin（现称 World）由 Sam Altman 等发起，通过虹膜扫描设备 Orb 发放 WLD，目标是为全球每个人提供数字身份；WLD 同时用于支付与治理。", "World 官网", "https://www.world.org/"),
    ("crypto", "ARB"): ("Arbitrum 是以太坊上的 Layer 2 扩容方案，采用 Optimistic Rollup 降低交易费用并提升吞吐量；ARB 是其治理代币。", "Arbitrum 官网", "https://arbitrum.io/"),
    ("crypto", "STX"): ("Stacks 是构建在比特币之上的智能合约与应用层，让比特币网络可承载去中心化应用；STX 是其原生代币，用于质押与支付网络费用。", "Stacks 官网", "https://www.stacks.co/"),
    ("crypto", "PUMP"): ("Pump.fun 是 Solana 链上的 Meme 代币发行与交易平台，用户可以低成本创建并交易 Meme 代币；PUMP 是其平台代币，用于生态激励与平台功能。", "Pump.fun 官网", "https://pump.fun/"),
    ("crypto", "DOS"): ("DAPPOS 是面向 Web3 的意图执行网络：用户只需设定目标（如资金收益、跨链操作），由网络中的执行者自动完成链上操作；DOS 是其生态代币。", "DAPPOS 官网", "https://dappos.com/"),
    ("crypto", "STRK"): ("Starknet 是以太坊上的 Layer 2 扩容网络，采用 zk-STARK 零知识证明提升吞吐量并降低手续费；STRK 是其治理与费用代币。", "Starknet 官网", "https://www.starknet.io/"),
    ("crypto", "MAGIC"): ("MAGIC 是 Treasure 生态的原生代币。Treasure 是构建在 Arbitrum 上的 Web3 游戏与 NFT 生态，MAGIC 用于交易、铸造与生态激励。", "Treasure 官网", "https://treasure.lol/"),
    ("crypto", "ALLO"): ("Allora 是去中心化的 AI 网络，通过聚合多个机器学习模型的预测来提供更准确的推理结果；ALLO 是其生态代币，用于质押、治理与网络激励。", "Allora 官网", "https://allora.network/"),
    ("crypto", "CHIP"): ("USD.AI 是面向 AI 基础设施的去中心化借贷协议：GPU 运营方可将硬件作为抵押进行借贷，协议发行由稳定币足额抵押的合成美元 USDai；CHIP 是其治理代币，用于投票决定硬件准入、利率档位等协议参数。", "USD.AI 官网", "https://usd.ai/"),
    ("crypto", "GLM"): ("Golem 是一个开源的去中心化算力市场，把计算任务拆分后交由网络中设备的闲置算力（含 GPU）完成，用户以 GLM 代币换取算力，服务于 AI 等计算需求。", "Golem 官网", "https://golem.network/"),
    ("crypto", "NEAR"): ("NEAR Protocol 是主打高性能与 AI 原生的 Layer 1 区块链，采用分片扩容、可读账户名与链抽象设计；NEAR 是其原生代币，用于支付手续费、质押与治理。", "NEAR 官网", "https://near.org/"),
    ("crypto", "AI"): ("Artificial Inu（AI）是在 Robinhood Chain 上发行的 ERC-20 社区代币，主要通过与代币化的 NVDA 股票代币组成链上流动性池进行交易；交易手续费按币种分别进入社区金库或用于销毁与锁仓。", "CoinGecko 项目资料", "https://artificialinu.com"),
    ("crypto", "TRUMP"): ("TRUMP（川普币）是围绕特朗普形象建立的 Meme 代币，最初发行于 Solana 网络。官网设有持币社区与活动榜单，最大供应量为 10 亿枚，按三年计划释放。", "Official Trump 官网", "https://www.gettrumpmemes.com/"),
}


def summary_record(kind, symbol):
    """DB 收录的标的资料优先，内置 SUMMARIES 作为兜底。"""
    try:
        record = market_store().summary(kind, symbol)
    except (OSError, ValueError):
        record = None
    if record:
        return record
    return SUMMARIES.get((kind, symbol))


def invalidate_info_cache(symbol):
    """摘要文案变更后清掉 /api/info 的响应缓存（进程内 + DB），避免继续返回旧文案。"""
    for kind in ("swap", "stock", "crypto"):
        parts = ("info", kind, symbol)
        try:
            market_store().invalidate_response(MarketStore.key(*parts))
        except (OSError, ValueError):
            pass
        with CACHE_LOCK:
            CACHE.pop(parts, None)
            CACHE_KEY_LOCKS.pop(parts, None)


WIKI_SUMMARY_URL = "https://en.wikipedia.org/api/rest_v1/page/summary/"
COINGECKO_COIN_URL = "https://api.coingecko.com/api/v3/coins/"
SENTENCE_ABBREVIATIONS = {"inc", "ltd", "corp", "co", "llc", "plc", "sa", "nv", "se",
                          "gmbh", "srl", "kk", "kg", "pty", "spa", "bv", "as"}


def first_sentence(text):
    """取纯文本首句，跳过 Inc. / Ltd. / .com 这类句点缩写。"""
    cleaned = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", str(text or ""))).strip()
    cleaned = re.sub(r"\s+([.,;:!?])", r"\1", cleaned)
    cleaned = re.sub(r"(?<=[\u4e00-\u9fff\u3040-\u30ff])\s+(?=[\u4e00-\u9fff\u3040-\u30ff])",
                     "", cleaned)
    sentence = cleaned
    for match in re.finditer(r"\.\s+|[。！？]\s*", cleaned):
        if match.group()[0] in "。！？":
            sentence = cleaned[:match.end()].strip()
            break
        previous = cleaned[:match.start()].rsplit(None, 1)
        token = re.sub(r"[^a-z]", "", previous[-1].lower()) if previous else ""
        if previous and (token in SENTENCE_ABBREVIATIONS
                         or previous[-1].lower().endswith((".com", ".org", ".net", ".io"))):
            continue
        sentence = cleaned[:match.end()].strip()
        break
    if len(sentence) > 220:
        sentence = sentence[:220].rsplit(None, 1)[0] + " …"
    return sentence


def _wikipedia_page(company_name):
    """英文维基公司词条校验：只接受标准词条，且词条名需与公司名首词吻合。"""
    name = str(company_name or "").strip()
    if len(name) < 2:
        return None
    short = re.sub(r"\s+(Inc|Corp|Ltd|LLC|PLC|Co|Company|Group|Holdings?)\.?$",
                   "", name, flags=re.IGNORECASE).strip()
    candidates = [name] + ([short] if short != name and len(short) >= 2 else [])
    key = re.sub(r"[^a-z0-9]", "", name.split()[0].lower())
    for title in candidates:
        try:
            data = remote_json(WIKI_SUMMARY_URL + quote(title), timeout=6)
        except (HTTPError, URLError, TimeoutError, ValueError, OSError):
            continue
        if not isinstance(data, dict) or data.get("type") != "standard":
            continue
        page_title = str(data.get("title") or "")
        if len(key) >= 4 and key not in re.sub(r"[^a-z0-9]", "", page_title.lower()):
            continue
        sentence = first_sentence(str(data.get("extract") or ""))
        if not profile_identity_matches(name, page_title, sentence):
            continue
        if len(sentence) < 30:
            continue
        return sentence, page_title
    return None


def wikipedia_intro(company_name):
    record = _wikipedia_page(company_name)
    if not record:
        return None
    sentence, page_title = record
    return sentence, "自动生成 · 维基百科", "https://en.wikipedia.org/wiki/" + quote(page_title.replace(" ", "_"))


ZH_WIKI_API = "https://en.wikipedia.org/w/api.php"
ZH_WIKI_SUMMARY_URL = "https://zh.wikipedia.org/api/rest_v1/page/summary/"


def _zh_intro_from_en_page(page_title):
    """已有英文标准词条时，经语言链接取中文词条首句；找不到返回 None。"""
    params = urlencode({"action": "query", "prop": "langlinks", "lllang": "zh",
                        "titles": page_title, "format": "json", "redirects": "1"})
    try:
        data = remote_json(ZH_WIKI_API + "?" + params, timeout=6)
        pages = ((data.get("query") or {}).get("pages") or {}) if isinstance(data, dict) else {}
        zh_title = next((ll.get("*") for page in pages.values() if isinstance(page, dict)
                         for ll in page.get("langlinks", []) if isinstance(ll, dict)
                         and ll.get("*")), None)
        if not zh_title:
            return None
        zh = remote_json(ZH_WIKI_SUMMARY_URL + quote(zh_title), timeout=6,
                         extra_headers={"Accept-Language": "zh-cn"})
    except (HTTPError, URLError, TimeoutError, ValueError, OSError):
        return None
    if not isinstance(zh, dict) or zh.get("type") != "standard":
        return None
    sentence = first_sentence(str(zh.get("extract") or ""))
    if len(sentence) < 12:
        return None
    page_url = str((zh.get("content_urls") or {}).get("desktop", {}).get("page") or "")
    if urlsplit(page_url).hostname not in {"zh.wikipedia.org", "zh.m.wikipedia.org"}:
        page_url = "https://zh.wikipedia.org/wiki/" + quote(zh_title.replace(" ", "_"))
    return sentence, "自动生成 · 维基百科", page_url


def chinese_wikipedia_intro(company_name):
    """经英文词条的语言链接找中文维基词条，返回中文首句；找不到就返回 None。"""
    record = _wikipedia_page(company_name)
    if not record:
        return None
    return _zh_intro_from_en_page(record[1])


def profile_identity_matches(query, title, description=""):
    """Require the full normalized name or an explicit exact ticker, never a fuzzy hit."""
    text = str(query or "").strip()
    name = okx_market.NAMES.get(text.upper(), text)
    def normalized(value):
        value = re.sub(r"\((?:company|corporation|cryptocurrency|token)\)", "", str(value), flags=re.I)
        value = re.sub(r"\b(?:incorporated|inc|corporation|corp|limited|ltd|llc|plc|holdings?|company|cryptocurrency)\b\.?", "", value, flags=re.I)
        return re.sub(r"[^a-z0-9\u4e00-\u9fff]", "", value.casefold())
    wanted, found = normalized(name), normalized(title)
    if len(wanted) >= 2 and wanted == found:
        return True
    # A bare ticker is usable only when the candidate explicitly identifies it.
    return bool(re.fullmatch(r"[A-Z0-9]{2,15}", text) and
                re.search(r"(?<![A-Za-z0-9])" + re.escape(text) + r"(?![A-Za-z0-9])",
                          str(description)))


def wikipedia_search_intro(query):
    """目录查不到的标的：维基全文搜索候选词条，逐个尝试中文（再英文）首句。"""
    text = str(query or "").strip()
    if len(text) < 2:
        return None
    params = urlencode({"action": "query", "list": "search", "srsearch": text,
                        "srlimit": "4", "format": "json"})
    try:
        data = remote_json(ZH_WIKI_API + "?" + params, timeout=6)
    except (HTTPError, URLError, TimeoutError, ValueError, OSError):
        return None
    hits = [str(hit.get("title")) for hit in ((data.get("query") or {}).get("search") or [])
            if isinstance(hit, dict) and hit.get("title")]
    for title in hits:
        record = _wikipedia_page(title)
        if not record:
            continue
        sentence, page_title = record
        if not profile_identity_matches(text, page_title, sentence):
            continue
        zh = _zh_intro_from_en_page(page_title)
        if zh:
            return zh
        return sentence, "自动生成 · 维基百科", \
            "https://en.wikipedia.org/wiki/" + quote(page_title.replace(" ", "_"))
    return None


def _chinese_intro_retry(name, attempts=2):
    """中文简介取一次可能是代理抖动，重试一次再判定没有中文来源。"""
    for _ in range(attempts):
        record = chinese_wikipedia_intro(name)
        if record:
            return record
    return None


def _chinese_search_intro(query, attempts=2):
    """维基全文搜索兜底，只接受中文结果；返回 None 表示没有中文来源或网络不可用。"""
    for _ in range(attempts):
        record = wikipedia_search_intro(query)
        if record:
            return record if has_chinese(record[0]) else None
    return None


CJK_PATTERN = re.compile(r"[\u4e00-\u9fff]")
EN_AUTO_SOURCES = {"自动生成 · 维基百科", "自动生成 · CoinGecko"}
STOCK_WEBSITES = {
    "SOXS": "https://www.direxion.com/product/daily-semiconductor-bull-bear-3x-etfs",
    "SOXL": "https://www.direxion.com/product/daily-semiconductor-bull-bear-3x-etfs",
    "CXMT": "https://www.cxmt.com/",
    "META": "https://about.meta.com/",
    "ARM": "https://www.arm.com/",
    "KO": "https://www.coca-colacompany.com/",
    "NBIS": "https://nebius.com/",
    "NFLX": "https://about.netflix.com/",
    "ZHONGJI": "https://www.zj-innolight.com/cn",
    "ZHIPU": "https://www.zhipuai.cn/zh/about",
    "XIAOMI": "https://www.mi.com/",
}


def has_chinese(text):
    return bool(CJK_PATTERN.search(str(text or "")))


def _en_wiki_title(url):
    parts = urlsplit(str(url or ""))
    if parts.hostname not in {"en.wikipedia.org", "en.m.wikipedia.org"}:
        return None
    path = parts.path
    if not path.startswith("/wiki/"):
        return None
    return unquote(path[len("/wiki/"):]).replace("_", " ")


def chinese_upgrade(kind, symbol):
    """英文自动摘要的中文自愈升级：找到中文来源就替换；人工与内置内容不触碰。"""
    row = summary_record(kind, symbol)
    if not row or row[1] not in EN_AUTO_SOURCES or has_chinese(row[0]):
        return None
    candidates = []
    title = _en_wiki_title(row[2])
    if title:
        candidates.append(title)
        short = re.sub(r",?\s+(Inc|Corp|Ltd|LLC|PLC|Co|Company|Group|Holdings?)\.?$",
                       "", title, flags=re.IGNORECASE).strip()
        if short and short.lower() != title.lower():
            candidates.append(short)
    record = None
    for candidate in candidates:
        record = _zh_intro_from_en_page(candidate)
        if record:
            break
    if not record and kind == "crypto":
        # 加密币只按 CoinGecko 的真实项目名查，避免裸代码命中人物词条（如 TRX→孙宇晨）
        try:
            name = str((coin_identity(symbol) or {}).get("name") or "")
        except (HTTPError, URLError, TimeoutError, ValueError, OSError):
            name = ""
        if name:
            record = (_chinese_intro_retry(name)
                      or _chinese_search_intro(name + " cryptocurrency"))
    if not record and kind == "stock":
        name = okx_market.NAMES.get(symbol) or symbol
        record = chinese_wikipedia_intro(name) or _chinese_search_intro(name)
    if not record:
        return None
    try:
        market_store().save_summary(kind, symbol, *record, overwrite=True)
    except (OSError, ValueError):
        return None
    invalidate_info_cache(symbol)
    return record


def coingecko_intro(identified):
    """CoinGecko 币种详情首句；无简介时用类别兜底。"""
    coin_id = str(identified.get("id") or "")
    if not re.fullmatch(r"[a-z0-9-]{1,80}", coin_id):
        return None
    params = urlencode({"localization": "true", "tickers": "false",
                        "market_data": "false", "community_data": "false",
                        "developer_data": "false", "sparkline": "false"})
    try:
        data = remote_json(COINGECKO_COIN_URL + quote(coin_id) + "?" + params, timeout=6)
    except (HTTPError, URLError, TimeoutError, ValueError, OSError):
        return None
    if not isinstance(data, dict):
        return None
    page_url = "https://www.coingecko.com/en/coins/" + coin_id
    sentence = first_sentence(str((data.get("description") or {}).get("zh") or ""))
    if len(sentence) >= 12 and has_chinese(sentence):
        return sentence, "自动生成 · CoinGecko", page_url
    return None


def auto_generated_summary(kind, symbol, identified):
    """未收录标的首次出现时自动生成一句话简介；写库后人工修改优先，不再自动变更。"""
    try:
        name = identified.get("name", "")
        if kind == "stock":
            record = _chinese_intro_retry(name) or _chinese_search_intro(name)
        elif kind == "crypto":
            record = (_chinese_intro_retry(name)
                      or _chinese_search_intro((name + " cryptocurrency").strip())
                      or coingecko_intro(identified))
        else:
            record = None
    except (HTTPError, URLError, TimeoutError, ValueError, OSError):
        return None
    if not record or not has_chinese(record[0]):
        return None
    try:
        market_store().save_summary(kind, symbol, *record, overwrite=False)
    except (OSError, ValueError):
        pass
    else:
        invalidate_info_cache(symbol)
    return record


def summary_for(kind, symbol, profile=None):
    record = summary_record(kind, symbol)
    if record:
        summary, source, url = record
        return {"summary": summary, "summarySource": source, "summaryUrl": url}
    if kind == "stock":
        industry = profile.get("finnhubIndustry") if isinstance(profile, dict) else None
        site = profile.get("weburl") if isinstance(profile, dict) else ""
        if urlsplit(site or "").scheme != "https":
            site = ""
        if industry:
            return {"summary": f"Finnhub 将这家公司归入 {industry} 行业。具体业务可通过公司官网进一步了解。",
                    "summarySource": "Finnhub 行业分类", "summaryUrl": site}
        return {"summary": "这家公司的业务简介暂未收录，可通过公司官网进一步了解。",
                "summarySource": "", "summaryUrl": site}
    return {"summary": f"{symbol} 在 Coinbase Exchange 提供 USD 交易对。项目背景尚未收录。",
            "summarySource": "Coinbase 交易对", "summaryUrl": ""}


def remote_json(url, token=False, timeout=12, extra_headers=None):
    headers = {"User-Agent": "MarketDeskLocal/2.0", "Accept": "application/json"}
    if token:
        headers["X-Finnhub-Token"] = TOKEN
    if extra_headers:
        headers.update(extra_headers)
    req = Request(url, headers=headers)
    system_ca = Path("/etc/ssl/cert.pem")
    context = ssl.create_default_context(cafile=str(system_ca) if system_ca.is_file() else None)
    with urlopen(req, timeout=timeout, context=context) as response:
        return json.load(response)


def public_news(symbol):
    """A small, cached RSS fallback when no news API key is configured."""
    name = okx_market.NAMES.get(symbol, symbol)
    searches = [
        (f'{symbol} {name} stock OR crypto when:3d', 'en-US', 'US', 'US:en'),
        ('Trump financial markets stocks crypto when:3d', 'en-US', 'US', 'US:en'),
        ('财经 美股 加密货币 特朗普 when:3d', 'zh-CN', 'CN', 'CN:zh-Hans'),
    ]

    if ashare_market.is_symbol(symbol):
        item=ashare_market.catalog().get(symbol,{})
        name=item.get('name',symbol[2:])
        searches=[(f'"{name}" 股票 when:7d','zh-CN','CN','CN:zh-Hans'),(f'"{name}" "{symbol[2:]}" 财报 when:30d','zh-CN','CN','CN:zh-Hans')]

    def fetch_one(args):
        query, lang, region, edition = args
        url = 'https://news.google.com/rss/search?' + urlencode({
            'q': query, 'hl': lang, 'gl': region, 'ceid': edition})
        req = Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Accept': 'application/rss+xml'})
        ca = Path('/etc/ssl/cert.pem')
        context = ssl.create_default_context(cafile=str(ca) if ca.is_file() else None)
        with urlopen(req, timeout=7, context=context) as response:
            root = ET.fromstring(response.read(400000))
        items = []
        for item in root.findall('./channel/item')[:12]:
            headline = html.unescape(item.findtext('title') or '').strip()[:240]
            link = (item.findtext('link') or '').strip()
            source = (item.findtext('source') or 'Google News').strip()[:80]
            if (not headline or urlsplit(link).hostname != 'news.google.com'
                    or 'Stock Price Today | Quotes & News' in headline):
                continue
            try:
                stamp = int(parsedate_to_datetime(item.findtext('pubDate') or '').timestamp())
            except (ValueError, TypeError):
                stamp = 0
            items.append({'headline': headline, 'url': link, 'source': source,
                          'datetime': stamp, 'summary': ''})
        return items[:9]

    rows, seen = [], set()
    with ThreadPoolExecutor(max_workers=3) as pool:
        for result in pool.map(lambda args: safe_news_fetch(fetch_one, args), searches):
            for item in result:
                if item['url'] not in seen:
                    rows.append(item)
                    seen.add(item['url'])
    return rows[:25]


def safe_news_fetch(fetch, args):
    try:
        return fetch(args)
    except (HTTPError, URLError, TimeoutError, ET.ParseError, ValueError):
        return []


def company_metadata(symbol):
    """Accept a directory result only when its listed ticker is an exact match."""
    results = remote_json("https://www.allinvestview.com/api/logo-search/?" +
                          urlencode({"q": symbol}), timeout=5)
    matches = [row for row in results.get("results", []) if isinstance(row, dict)
               and str(row.get("symbol", "")).upper() == symbol]
    if len(matches) != 1:
        return {}
    row = matches[0]
    host = (urlsplit(str(row.get("website") or "")).hostname or "").lower()
    host = host.removeprefix("www.")
    if not re.fullmatch(r"[a-z0-9-]+(?:\.[a-z0-9-]+)+", host):
        return {}
    name = str(row.get("name") or "").strip()[:100]
    if not name:
        return {}
    return {"name": name, "domain": host, "website": "https://" + host,
            "exchange": str(row.get("exchange") or "")[:24]}


def stock_identity(symbol):
    try:
        company = company_metadata(symbol)
        if company:
            return company
    except (HTTPError, URLError, TimeoutError, ValueError):
        pass
    result = remote_json("https://api.loadlogo.com/ticker/" + symbol, timeout=5)
    if not isinstance(result, dict) or str(result.get("symbol", "")).upper() != symbol:
        return {}
    domain = str(result.get("domain") or "").lower()
    name = str(result.get("name") or "").strip()[:100]
    if not re.fullmatch(r"[a-z0-9-]+(?:\.[a-z0-9-]+)+", domain) or not name:
        return {}
    return {"name": name, "domain": domain, "website": "https://" + domain,
            "exchange": str(result.get("exchange") or "")[:24], "provider": "LoadLogo"}


def coin_metadata(symbol):
    """Use the leader of an exact-ticker search only when ambiguity is low."""
    results = remote_json("https://api.coingecko.com/api/v3/search?" +
                          urlencode({"query": symbol}), timeout=5)
    coins = [row for row in results.get("coins", []) if isinstance(row, dict)
             and str(row.get("symbol", "")).upper() == symbol]
    ranked = sorted(coins, key=lambda row: row.get("market_cap_rank")
                    if isinstance(row.get("market_cap_rank"), int) else 10**9)
    clear_leader = len(ranked) == 1 or (len(ranked) > 1
        and isinstance(ranked[0].get("market_cap_rank"), int)
        and ranked[0]["market_cap_rank"] <= 500
        and (not isinstance(ranked[1].get("market_cap_rank"), int)
             or ranked[1]["market_cap_rank"] >= 5 * ranked[0]["market_cap_rank"]))
    return ranked[0] if ranked and clear_leader else {"ambiguous": True} if ranked else {}


def coin_identity(symbol):
    try:
        match = coin_metadata(symbol)
        if match.get("ambiguous"):
            return {}
        if match:
            return match
    except (HTTPError, URLError, TimeoutError, ValueError):
        pass
    result = remote_json("https://api.loadlogo.com/crypto/" + symbol, timeout=5)
    if isinstance(result, dict) and str(result.get("symbol", "")).upper() == symbol:
        name = str(result.get("name") or "").strip()[:100]
        if name and name.upper() != symbol:
            return {"symbol": symbol, "name": name,
                    "logo": "https://img.loadlogo.com/crypto/" + symbol.lower() +
                            "?fallback=404&format=png&size=128", "provider": "LoadLogo"}
    return {}


def saved_logo(symbol, category):
    record = market_store().logo(symbol, category)
    return ({"url": f"/api/logo-image?symbol={symbol}", "source": record["source"]}
            if record else None)


def refresh_saved_logo(symbol, category):
    """Recheck verified remote artwork at most once every 30 days."""
    record = market_store().logo(symbol, category)
    if not record or time.time() - record["saved_at"] < 30 * 86400:
        return
    url = record["remote_url"]
    if not url:
        return
    try:
        store_logo(symbol, category, url, record["source"])
    except (OSError, ValueError, TypeError, HTTPError, URLError, TimeoutError):
        pass


def store_logo(symbol, category, url, source):
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname not in {
        "cdn.tickerlogos.com", "coin-images.coingecko.com", "assets.coingecko.com",
        "img.loadlogo.com", "www.okx.com"}:
        return None
    req = Request(url, headers={"User-Agent": "MarketDeskLocal/3.0", "Accept": "image/*"})
    system_ca = Path("/etc/ssl/cert.pem")
    context = ssl.create_default_context(cafile=str(system_ca) if system_ca.is_file() else None)
    with urlopen(req, timeout=6, context=context) as response:
        payload = response.read(262145)
    if len(payload) > 262144 or len(payload) < 50:
        return None
    if not MarketStore.logo_mime(payload):
        return None
    market_store().save_logo(symbol, category, payload, source, remote_url=url)
    return {"url": f"/api/logo-image?symbol={symbol}", "source": source}


def resolve_ashare_logo(symbol, profile=None):
    """Use exact-company artwork; background discovery may populate the database."""
    entry = ASHARE_BRAND_LOGOS.get(symbol)
    if entry and (ROOT / entry[0].lstrip("/")).is_file():
        payload=(ROOT / entry[0].lstrip("/")).read_bytes()
        market_store().save_logo(symbol,"ashare",payload,entry[1])
        return {"url": entry[0], "source": entry[1]}
    existing = market_store().logo(symbol,"ashare")
    if existing and time.time()-existing["saved_at"]<30*86400:
        return {"url":f"/api/logo-image?symbol={symbol}","source":existing["source"]}
    if profile and profile.get("type")=="ashare" and profile.get("symbol")==symbol and profile.get("website"):
        try:
            found=company_icon(profile["website"])
            if found:
                payload,url=found
                source=profile.get("name",symbol)+" · 公司官网图标"
                market_store().save_logo(symbol,"ashare",payload,source,remote_url=url)
                return {"url":f"/api/logo-image?symbol={symbol}","source":source}
        except (OSError,ValueError):pass
    return {"url":f"/api/logo-image?symbol={symbol}","source":existing["source"]} if existing else {"url":"","source":"无可核实的匹配图标"}


def resolve_logo(symbol, catalog):
    """Return only a source matched to the exact OKX underlying symbol."""
    if symbol in CURATED_COIN_LOGOS:
        path, source = CURATED_COIN_LOGOS[symbol]
        if (ROOT / path.lstrip("/")).is_file():
            return {"url": path, "source": source}
    if symbol in BRAND_LOGOS:
        path, source = BRAND_LOGOS[symbol]
        if (ROOT / path.lstrip("/")).is_file():
            return {"url": path, "source": source}
    official = ROOT / "assets" / "icons" / "okx" / f"{symbol.lower()}.png"
    if official.is_file():
        return {"url": f"/assets/icons/okx/{symbol.lower()}.png", "source": "OKX 页面"}
    category = str(catalog[symbol].get("instCategory", ""))
    existing = saved_logo(symbol, category)
    if existing:
        refresh_saved_logo(symbol, category)
        return existing
    deferred = None
    if category == "3":
        try:
            company = cached(("company", symbol), 86400, lambda: stock_identity(symbol))
        except (HTTPError, URLError, TimeoutError, ValueError, OSError):
            company = {}
        if company:
            provider = company.get("provider")
            remote_url = ("https://img.loadlogo.com/ticker/" + symbol +
                          "?fallback=404&format=png&size=128" if provider == "LoadLogo"
                          else "https://cdn.tickerlogos.com/" + company["domain"])
            source = ("LoadLogo" if provider == "LoadLogo" else "AllInvestView") + " · " + company["name"]
            try:
                logo = store_logo(symbol, category, remote_url, source)
                if logo:
                    return logo
            except (HTTPError, URLError, TimeoutError, OSError):
                pass
            deferred = {"url": remote_url, "source": source}
    if category == "1":
        try:
            coin = cached(("coin", symbol), 86400, lambda: coin_identity(symbol))
        except (HTTPError, URLError, TimeoutError, ValueError, OSError):
            coin = {}
        if coin:
            url = str(coin.get("large") or coin.get("thumb") or coin.get("logo") or "")
            parsed = urlsplit(url)
            if parsed.scheme == "https" and parsed.hostname in ("coin-images.coingecko.com", "assets.coingecko.com", "img.loadlogo.com"):
                source = ("LoadLogo" if coin.get("provider") == "LoadLogo" else "CoinGecko") + " · " + str(coin.get("name") or symbol)
                try:
                    logo = store_logo(symbol, category, url, source)
                    if logo:
                        return logo
                except (HTTPError, URLError, TimeoutError, OSError):
                    pass
                deferred = {"url": url, "source": source}
    okx_icon = ("https://www.okx.com/cdn/oksupport/asset/currency/icon/"
                + symbol.lower() + ".png")
    try:
        logo = store_logo(symbol, category, okx_icon, "OKX · " + symbol)
        if logo:
            return logo
    except (HTTPError, URLError, TimeoutError, OSError):
        pass
    if deferred:
        return deferred
    return {"url": "", "source": "无可核实的匹配图标"}


def cached(key, seconds, fn):
    now = time.monotonic()
    with CACHE_LOCK:
        old = CACHE.get(key)
        ttl = min(seconds,30) if key[0] in ("coin","company") and old and (not old[1] or old[1].get("ambiguous")) else seconds
        if old and now - old[0] < ttl:
            return old[1]
        key_lock = CACHE_KEY_LOCKS.setdefault(key, threading.Lock())
    with key_lock:
        with CACHE_LOCK:
            old = CACHE.get(key)
            ttl = min(seconds,30) if key[0] in ("coin","company") and old and (not old[1] or old[1].get("ambiguous")) else seconds
            if old and time.monotonic() - old[0] < ttl:
                return old[1]
        value = fn()
        with CACHE_LOCK:
            if len(CACHE) >= MAX_CACHE_ENTRIES:
                oldest = min(CACHE, key=lambda item: CACHE[item][0])
                del CACHE[oldest]
                CACHE_KEY_LOCKS.pop(oldest, None)
            CACHE[key] = (time.monotonic(), value)
        return value


def market_store():
    global MARKET_STORE
    if MARKET_STORE is None:
        with MARKET_STORE_LOCK:
            if MARKET_STORE is None:
                store = MarketStore(MARKET_DB)
                store.import_legacy_logos(LOGO_CACHE_DIR)
                seed_builtin_summaries(store)
                MARKET_STORE = store
    return MARKET_STORE


def seed_builtin_summaries(store):
    """内置 SUMMARIES 作为初始资料入库；已入库（含手工改过的）记录不覆盖。"""
    try:
        existing = store.all_summaries()
        for (kind, symbol), record in SUMMARIES.items():
            current = existing.get((kind, symbol))
            if current and kind == "commodity" and symbol == "XAU" and \
                    current[0].startswith("XAU 代表黄金。") and current[1] == "OKX 合约分类":
                store.save_summary(kind, symbol, *record, overwrite=True)
                store.invalidate_response(MarketStore.key("info", "swap", symbol))
            elif current and current[1] in EN_AUTO_SOURCES and kind == "stock":
                store.save_summary(kind, symbol, *record, overwrite=True)
                store.invalidate_response(MarketStore.key("info", "swap", symbol))
            elif not current:
                store.save_summary(kind, symbol, *record, overwrite=False)
                store.invalidate_response(MarketStore.key("info", "swap", symbol))
            if kind == "stock" and record[1] not in EN_AUTO_SOURCES and \
                    urlsplit(record[2]).scheme == "https" and \
                    not (urlsplit(record[2]).hostname or "").endswith("wikipedia.org"):
                store.save_website("stock", symbol, record[2], "内置官网", overwrite=False)
                store.invalidate_response(MarketStore.key("info", "swap", symbol))
        for symbol, url in STOCK_WEBSITES.items():
            store.save_website("stock", symbol, url, "核实官网", overwrite=True)
            store.invalidate_response(MarketStore.key("info", "swap", symbol))
        with store._db() as db:
            db.execute("DELETE FROM asset_summaries WHERE source IN (?,?) AND "
                       "summary NOT GLOB '*[一-龥]*'", tuple(EN_AUTO_SOURCES))
    except (OSError, ValueError):
        pass


def stored_market_data(parts, ttl, fetch, *, symbol=None, tf=None, hot=False, background=False):
    return market_store().get_or_refresh(MarketStore.key(*parts), ttl, fetch,
                                         symbol=symbol, tf=tf, hot=hot, background=background)


DAILY_HOT_LOCK = threading.Lock()
DAILY_HOT_RETRY = {}
DAILY_HOT_REFRESH_SECONDS = 4 * 60 * 60


def valid_daily_hot(record):
    if not isinstance(record, dict):
        return False
    items = record.get("items")
    if not isinstance(items, list) or len(items) != 20:
        return False
    if any(not isinstance(item, dict) or item.get("type") != "swap"
           or not re.fullmatch(r"[A-Z0-9]{1,15}", str(item.get("symbol", ""))) for item in items):
        return False
    return (len({item["symbol"] for item in items}) == 20
            and sum(str(item.get("category")) == "1" for item in items) == 10
            and sum(str(item.get("category")) == "3" for item in items) == 10)


def daily_hot_record(today=None):
    """One validated snapshot, refreshed every four hours, shared by all clients."""
    today = today or datetime.now(ZoneInfo("Asia/Shanghai")).date().isoformat()
    with DAILY_HOT_LOCK:
        store = market_store()
        record = store.daily_hot(today)
        expired = (not valid_daily_hot(record)
                   or time.time() - record.get("fetchedAt", 0) >= DAILY_HOT_REFRESH_SECONDS)
        if expired and time.monotonic() >= DAILY_HOT_RETRY.get(today, 0):
            try:
                catalog = cached(("okx", "instruments"), 600, okx_market.instruments)
                items = okx_market.daily_hot(catalog)
                if not valid_daily_hot({"items": items}):
                    raise ValueError("热门榜必须包含 10 个加密币和 10 个股票相关合约")
                store.save_instruments({item["symbol"]: catalog[item["symbol"]] for item in items})
                store.save_daily_hot(today, items)
                record = store.daily_hot(today)
                DAILY_HOT_RETRY.clear()
            except (HTTPError, URLError, TimeoutError, ValueError, OSError):
                DAILY_HOT_RETRY.clear()
                DAILY_HOT_RETRY[today] = time.monotonic() + 60
        if not valid_daily_hot(record):
            record = store.daily_hot()
        if not valid_daily_hot(record):
            raise ValueError("热门榜暂不可用")
        return {**record, "stale": (record["day"] != today
                                   or time.time() - record.get("fetchedAt", 0) >= DAILY_HOT_REFRESH_SECONDS),
                "basis": "OKX 24h 成交量 × 最新价（约 USDT）"}


def refresh_equity_directory():
    while True:
        try:
            if not ashare_market.SNAPSHOT.exists() or time.time()-ashare_market.SNAPSHOT.stat().st_mtime>=86400:
                ashare_market.refresh_catalog()
                market_store().save_asset_catalog(ashare_market.catalog().values())
        except (OSError, ValueError):
            pass
        time.sleep(3600)


def refresh_daily_hot():
    while True:
        try:
            daily_hot_record()
        except (OSError, ValueError):
            pass
        time.sleep(60)


def refresh_active_market_data():
    while True:
        time.sleep(15)
        try:
            market_store().refresh_hot()
            due=market_store().due_assets()
            ASSET_BRAND_PIPELINE.submit(due)
            ASSET_DATA_PIPELINE.submit(due)
        except (OSError, ValueError):
            pass


def public_asset_info(info):
    """Expose profile content without the internal summary provenance fields."""
    visible = {key: value for key, value in info.items()
               if key not in ("summarySource", "summaryUrl")}
    summary = str(visible.get("summary") or "")
    if re.search(r"这里展示的是|当前展示的是|不是实物黄金|不是证券交易所股票现货报价|不能把同代码加密代币|不是名为.*的加密代币", summary):
        symbol = str(visible.get("symbol") or "")
        name = str(visible.get("name") or symbol)
        visible["summary"] = (SUMMARIES[("commodity", "XAU")][0] if symbol == "XAU" else
                              f"{name} 的中文简介正在补全。")
    return visible


def official_trump_info(kind="swap"):
    return {"type":kind,"symbol":"TRUMP","name":"Official Trump（特朗普币）",
            "category":"crypto","pair":"TRUMP-USDT-SWAP" if kind=="swap" else "TRUMP-USD",
            "base":"TRUMP","quote":"USDT" if kind=="swap" else "USD","exchange":"OKX" if kind=="swap" else "—",
            "status":"—","tickSize":"—","contractValue":"—",
            "network":"Solana / TRON","maxSupply":"10 亿枚","summaryVersion":3,
            "summary":SUMMARIES[("crypto", "TRUMP")][0],
            "website":"https://gettrumpmemes.com/","summaryUrl":"https://gettrumpmemes.com/",
            "summarySource":"Official Trump 官网","source":"Official Trump 官网 · 项目资料"}


def asset_info(kind, symbol):
    if symbol == "TRUMP" and kind in ("swap", "crypto"):
        return official_trump_info(kind)
    if kind == "swap":
        instrument = cached(("okx", "instruments"), 600, okx_market.instruments).get(symbol)
        if not instrument:
            raise ValueError("OKX 没有此 USDT 永续合约")
        category = str(instrument.get("instCategory", ""))
        kind_by_category = {"1": "crypto", "3": "stock", "4": "commodity", "5": "forex", "6": "bond"}
        asset_kind = kind_by_category.get(category, "unknown")
        summary = summary_record(asset_kind, symbol)
        identified = {}
        if summary and summary[1] in EN_AUTO_SOURCES and asset_kind in ("stock", "crypto"):
            # Old automatically matched summaries are not proof of identity.
            # Revalidate against an exact provider identity before displaying them.
            try:
                identified = cached(("company" if asset_kind == "stock" else "coin", symbol),
                                    86400, lambda: stock_identity(symbol) if asset_kind == "stock" else coin_identity(symbol))
                verified = auto_generated_summary(asset_kind, symbol, identified) if identified else None
                current = market_store().summary(asset_kind, symbol)
                if current and current[1] not in EN_AUTO_SOURCES:
                    summary = current  # Preserve a manual correction made meanwhile.
                elif verified:
                    market_store().save_summary(asset_kind, symbol, *verified, overwrite=True)
                    summary = verified
                else:
                    summary = None
            except (HTTPError, URLError, TimeoutError, OSError, ValueError):
                summary = None
        company_site = (STOCK_WEBSITES.get(symbol) or market_store().website("stock", symbol)) if asset_kind == "stock" else ""
        if asset_kind == "stock" and not company_site:
            company_site = STOCK_WEBSITES.get(symbol, "")
            if company_site:
                market_store().save_website("stock", symbol, company_site, "核实官网")
        if asset_kind == "stock" and not company_site and summary and urlsplit(summary[2]).scheme=="https":
            company_site=summary[2]
        if asset_kind == "stock" and not company_site:
            try:
                identified = cached(("company", symbol), 86400,
                                    lambda: stock_identity(symbol))
            except (HTTPError, URLError, TimeoutError, ValueError):
                pass
            company_site = identified.get("website", "")
            if company_site:
                market_store().save_website("stock", symbol, company_site,
                                            identified.get("provider") or "公司目录")
        if not summary and asset_kind == "crypto":
            try:
                identified = cached(("coin", symbol), 86400,
                                    lambda: coin_identity(symbol))
            except (HTTPError, URLError, TimeoutError, ValueError):
                pass
        if not summary and asset_kind in ("stock", "crypto") and identified:
            generated = auto_generated_summary(asset_kind, symbol, identified)
            if generated:
                summary = generated
        if not summary and asset_kind == "stock":
            searched = _chinese_search_intro(okx_market.NAMES.get(symbol) or symbol)
            if searched and has_chinese(searched[0]):
                try:
                    market_store().save_summary("stock", symbol, *searched, overwrite=False)
                except (OSError, ValueError):
                    pass
                else:
                    invalidate_info_cache(symbol)
                summary = searched
        display_name = okx_market.NAMES.get(symbol) or identified.get("name") or symbol
        if summary:
            description = summary[0]
        elif asset_kind == "stock":
            description = f"{display_name} 的中文业务简介正在补全。"
        elif asset_kind == "commodity":
            description = f"{display_name} 的中文商品简介正在补全。"
        elif asset_kind == "crypto" and identified:
            description = f"{identified.get('name', symbol)} 的中文项目简介正在补全。"
        else:
            description = f"{display_name} 的中文简介正在补全。"
        official_icon = ROOT / "assets" / "icons" / "okx" / f"{symbol.lower()}.png"
        brand_logo = BRAND_LOGOS.get(symbol)
        brand_icon = ROOT / "assets" / "icons" / "crypto" / "spcx.svg" if symbol == "SPCX" else None
        coin_id = str(identified.get("id") or "") if asset_kind == "crypto" else ""
        metadata_url = ("https://www.coingecko.com/en/coins/" + coin_id
                        if re.fullmatch(r"[a-z0-9-]{1,80}", coin_id) else "")
        return {"type": kind, "symbol": symbol, "name": display_name,
                "logo": f"/assets/icons/okx/{symbol.lower()}.png" if official_icon.is_file() else brand_logo[0] if brand_logo else f"/assets/icons/crypto/{symbol.lower()}.svg" if brand_icon and brand_icon.is_file() else "",
                "logoSource": "OKX 页面" if official_icon.is_file() else brand_logo[1] if brand_logo else "公司品牌" if brand_icon and brand_icon.is_file() else "未核实", "pair": instrument["instId"], "exchange": "OKX",
                "status": instrument.get("state", "—"), "base": symbol, "quote": "USDT",
                "tickSize": instrument.get("tickSz", "—"), "contractValue": instrument.get("ctVal", "—"),
                "source": "OKX 永续合约资料", "category": asset_kind, "summary": description,
                "website": company_site,
                "summarySource": summary[1] if summary else ("LoadLogo" if identified.get("provider") == "LoadLogo" else "AllInvestView 公司目录") if identified and asset_kind == "stock" else ("LoadLogo" if identified.get("provider") == "LoadLogo" else "CoinGecko 币种资料") if identified and asset_kind == "crypto" else "",
                "summaryUrl": summary[2] if summary else company_site or metadata_url}
    if kind == "stock":
        if not TOKEN:
            raise ValueError("公司资料需要 Finnhub API Key")
        profile = remote_json("https://finnhub.io/api/v1/stock/profile2?" + urlencode({"symbol": symbol}), True)
        if not isinstance(profile, dict):
            profile = {}
        logo = profile.get("logo", "") if isinstance(profile, dict) else ""
        parsed = urlsplit(logo)
        if parsed.scheme != "https" or parsed.hostname not in ("static.finnhub.io", "static2.finnhub.io"):
            logo = ""
        site = profile.get("weburl", "") if isinstance(profile, dict) else ""
        if urlsplit(site).scheme != "https":
            site = ""
        return {"type": kind, "symbol": symbol, "name": profile.get("name") or symbol,
                "logo": logo, "website": site, "exchange": profile.get("exchange") or "—",
                "country": profile.get("country") or "—", "currency": profile.get("currency") or "—",
                "industry": profile.get("finnhubIndustry") or "—", "ipo": profile.get("ipo") or "—",
                "marketCap": profile.get("marketCapitalization"), "source": "Finnhub 公司资料",
                **summary_for(kind, symbol, profile)}
    product = remote_json(f"https://api.exchange.coinbase.com/products/{symbol}-USD")
    return {"type": kind, "symbol": symbol, "name": CRYPTO_NAMES.get(symbol, symbol),
            "logo": f"/assets/icons/crypto/{symbol.lower()}.svg" if (ROOT / "assets" / "icons" / "crypto" / f"{symbol.lower()}.svg").is_file() else "",
            "exchange": "Coinbase Exchange", "pair": product.get("id", symbol + "-USD"),
            "status": product.get("status", "—"), "base": product.get("base_currency", symbol),
            "quote": product.get("quote_currency", "USD"),
            "minFunds": product.get("min_market_funds", "—"), "source": "Coinbase 交易对资料",
            **summary_for(kind, symbol)}


def verified_asset_info(kind, symbol):
    info = asset_info(kind, symbol)
    validate_asset_info(info, kind, symbol)
    info["incomplete"] = not bool(str(info.get("summary") or "").strip()) or bool(
        re.search(r"正在补全|暂未收录|暂无简介", str(info.get("summary") or "")))
    info["identityVersion"] = 2
    info["updatedAt"] = int(time.time() * 1000)
    return info


def validate_asset_info(info, kind, symbol):
    if not isinstance(info, dict) or info.get("type") != kind or info.get("symbol") != symbol:
        raise ValueError("标的资料身份不匹配")
    if kind == "swap" and (info.get("pair") != symbol + "-USDT-SWAP" or
                           info.get("base") != symbol or info.get("quote") != "USDT"):
        raise ValueError("标的资料交易对不匹配")


def asset_profile(kind, symbol):
    if symbol == "TRUMP" and kind in ("swap", "crypto"):
        info=verified_asset_info(kind,symbol)
        market_store().write(MarketStore.key("info",kind,symbol),info)
        market_store().save_summary("crypto",symbol,info["summary"],info["source"],info["website"])
        return info, False
    store = market_store()
    key = MarketStore.key("info", kind, symbol)
    previous = store.read(key)
    if previous:
        try:
            validate_asset_info(previous[0], kind, symbol)
            if previous[0].get("identityVersion") != 2:
                raise ValueError("旧资料需要重新核对身份")
        except ValueError:
            store.invalidate_response(key)
            previous = None
    incomplete = previous and (previous[0].get("incomplete") or
        re.search(r"正在补全|暂未收录|暂无简介", str(previous[0].get("summary") or "")))
    return stored_market_data(("info", kind, symbol), 30 if incomplete else 30*86400,
                              lambda: verified_asset_info(kind, symbol), hot=True, background=True)


def verified_ashare_profile(symbol):
    row=ashare_market.info(symbol)
    if row.get("type")!="ashare" or row.get("symbol")!=symbol or row.get("pair")!=symbol or row.get("quote")!="CNY":
        raise ValueError("股票资料身份不匹配")
    if row.get("incomplete"):
        old=market_store().read(MarketStore.key("ashare","info-v4",symbol))
        if old and old[0].get("type")=="ashare" and old[0].get("symbol")==symbol and not old[0].get("incomplete") and old[0].get("summary"):
            raise ValueError("保留已经核实的公司资料，稍后重试来源")
    row["updatedAt"]=int(time.time()*1000)
    if not row.get("incomplete"):
        market_store().save_summary("ashare",symbol,row["summary"],row.get("source",""),row.get("website",""))
        if row.get("website"):market_store().save_website("ashare",symbol,row["website"],row.get("source",""),overwrite=True)
    return row


def ashare_profile(symbol):
    previous=market_store().read(MarketStore.key("ashare","info-v4",symbol))
    curated=ashare_market.CURATED_COMPANIES.get(symbol)
    if curated and previous and previous[0].get("summary")!=curated["summary"]:
        row=verified_ashare_profile(symbol)
        market_store().write(MarketStore.key("ashare","info-v4",symbol),row)
        return row,False
    ttl=30 if previous and not market_store().profile_complete(previous[0]) else 30*86400
    return stored_market_data(("ashare","info-v4",symbol),ttl,lambda:verified_ashare_profile(symbol),background=True)


def warm_asset_brand(symbol):
    if not ashare_market.is_symbol(symbol):
        # Branding has its own workers: quote/history latency cannot block discovery.
        try:
            catalog=cached(("okx","instruments"),600,okx_market.instruments)
            if symbol not in catalog:return
            logo=resolve_logo(symbol,catalog)
            url=logo.get("url","")
            local=ROOT/url.lstrip("/") if url.startswith("/assets/") else None
            if local and local.is_file():
                market_store().save_logo(symbol,str(catalog[symbol].get("instCategory","")),local.read_bytes(),logo.get("source",""))
            asset_profile("swap",symbol)
        except (OSError,ValueError):pass
        return
    # Single-flight independent from slow quotes/history; repeated searches share the work.
    def fetch():
        try:
            info,_=ashare_profile(symbol)
            if info.get("type")!="ashare" or info.get("symbol")!=symbol:raise ValueError("股票资料身份不匹配")
            if not info.get("incomplete") and info.get("summary"):
                market_store().save_summary("ashare",symbol,info["summary"],info.get("source",""),info.get("website",""))
            if info.get("website"):market_store().save_website("ashare",symbol,info["website"],info.get("source",""),overwrite=True)
            return resolve_ashare_logo(symbol,info)
        except (OSError,ValueError):return None
    return cached(("ashare","brand-refresh",str(market_store().path),symbol),30,fetch)


def ashare_logo_status(symbol):
    # A cached image always wins over any earlier negative lookup or refresh cooldown.
    entry=ASHARE_BRAND_LOGOS.get(symbol)
    if entry:return {"url":entry[0],"source":entry[1]}
    existing=market_store().logo(symbol,"ashare")
    if existing:return {"url":f"/api/logo-image?symbol={symbol}","source":existing["source"]}
    ASSET_BRAND_PIPELINE.submit([{"type":"ashare","symbol":symbol}],priority=True)
    return {"url":"","source":"公司图标正在获取","pending":True,"retryAfter":2}


def swap_logo_status(symbol,catalog):
    category=str(catalog[symbol].get("instCategory",""))
    for entry in (CURATED_COIN_LOGOS.get(symbol),BRAND_LOGOS.get(symbol)):
        if entry and (ROOT/entry[0].lstrip("/")).is_file():
            return {"url":entry[0],"source":entry[1]}
    official=ROOT/"assets"/"icons"/"okx"/f"{symbol.lower()}.png"
    if official.is_file():return {"url":f"/assets/icons/okx/{symbol.lower()}.png","source":"OKX 页面"}
    existing=saved_logo(symbol,category)
    if existing:return existing
    ASSET_BRAND_PIPELINE.submit([{"type":"swap","symbol":symbol}],priority=True)
    return {"url":"","source":"标的图标正在获取","pending":True,"retryAfter":2}


def attach_cached_logos(items):
    manifest=market_store().logo_manifest()
    return [{**item,"logo":manifest[item["symbol"]]["url"],"logoSource":manifest[item["symbol"]]["source"]} if item["symbol"] in manifest else item for item in items]


def warm_asset_data(symbol):
    if ashare_market.is_symbol(symbol):
        warm_asset_brand(symbol)
        try: stored_market_data(("ashare","quote",symbol),15,lambda:ashare_market.quote(symbol))
        except (OSError,ValueError):pass
        try: stored_market_data(("ashare", "candles", symbol, "1d"), 30, lambda: ashare_market.candles(symbol, "1d"), symbol=symbol, tf="1d")
        except (OSError, ValueError): pass
        saved=market_store().read(MarketStore.key("ashare","info-v4",symbol))
        complete=bool(saved and not saved[0].get("incomplete") and saved[0].get("summary"))
        market_store().finish_asset_refresh("ashare", symbol,complete=complete)
        return
    # Persist each successful component independently, even when the other fails.
    try:
        asset_profile("swap", symbol)
    except (HTTPError, URLError, TimeoutError, OSError, ValueError):
        pass
    try:
        catalog=cached(("okx","instruments"),600,okx_market.instruments)
        if symbol in catalog:
            logo=resolve_logo(symbol,catalog)
            url=logo.get("url","")
            local=ROOT/url.lstrip("/") if url.startswith("/assets/") else None
            if local and local.is_file():market_store().save_logo(symbol,str(catalog[symbol].get("instCategory","")),local.read_bytes(),logo.get("source",""))
    except (HTTPError,URLError,TimeoutError,OSError,ValueError):pass
    try:
        stored_market_data(("okx", "candles", symbol, "1d"), 30,
                           lambda: okx_market.candles(symbol, "1d"), symbol=symbol, tf="1d")
    except (HTTPError, URLError, TimeoutError, OSError, ValueError):
        pass


    market_store().finish_asset_refresh("swap", symbol)


def register_discovered(items, followed=False):
    market_store().save_asset_catalog(items)
    market_store().track_assets(items, followed=followed)
    ASSET_BRAND_PIPELINE.submit(items,priority=followed)
    if followed: ASSET_DATA_PIPELINE.submit(items, priority=True)
    else: ASSET_DATA_PIPELINE.submit(items)


def combined_catalog():
    try: contracts=cached(("okx", "instruments"), 600, okx_market.instruments)
    except (OSError, ValueError): contracts=okx_market.instrument_snapshot()
    market_store().save_instruments(contracts)
    items=okx_market.search_catalog(contracts)+list(ashare_market.catalog().values())
    market_store().save_asset_catalog(items)
    return attach_cached_logos(items)


def combined_search(query):
    try: contracts=cached(("okx", "instruments"), 600, okx_market.instruments)
    except (OSError, ValueError): contracts=okx_market.instrument_snapshot()
    market_store().save_instruments(contracts)
    rows=okx_market.search(query, contracts)+ashare_market.search(query)
    def rank(row):
        values=[str(row.get(k,"")) for k in ("symbol","code","name")]+row.get("aliases",[])
        q=query.casefold();values=[v.casefold() for v in values]
        return 0 if q in values else 1 if any(v.startswith(q) for v in values) else 2
    return attach_cached_logos(sorted(rows,key=lambda r:(rank(r),r["symbol"]))[:14])


ASSET_BRAND_PIPELINE = AssetDataPipeline(warm_asset_brand,workers=2,capacity=64)
ASSET_DATA_PIPELINE = AssetDataPipeline(warm_asset_data)


def normalize_coinbase(rows):
    result = []
    for row in rows if isinstance(rows, list) else []:
        if len(row) >= 6:
            t, low, high, op, close, volume = row[:6]
            result.append({"t": int(t) * 1000, "o": float(op), "h": float(high),
                           "l": float(low), "c": float(close), "v": float(volume)})
    return sorted(result, key=lambda x: x["t"])


def normalize_finnhub(data):
    if not isinstance(data, dict) or data.get("s") != "ok":
        return []
    keys = ("t", "o", "h", "l", "c", "v")
    return [{"t": int(data["t"][i]) * 1000, **{k: float(data[k][i]) for k in keys[1:]}}
            for i in range(len(data.get("t", [])))]


def aggregate_session(rows, size, timezone):
    """Build intraday bars without carrying a session across market close."""
    groups = {}
    zone = ZoneInfo(timezone)
    for row in rows:
        day = datetime.fromtimestamp(row["t"] / 1000, zone).date()
        groups.setdefault(day, []).append(row)
    result = []
    for day_rows in groups.values():
        for index in range(0, len(day_rows), size):
            chunk = day_rows[index:index + size]
            result.append({"t": chunk[0]["t"], "o": chunk[0]["o"],
                           "h": max(item["h"] for item in chunk),
                           "l": min(item["l"] for item in chunk),
                           "c": chunk[-1]["c"],
                           "v": sum(item["v"] for item in chunk)})
    return result


def yahoo_candles(symbol, tf, limit=240):
    """Read Yahoo Finance's public chart response as a fallback; it is not a stable API contract."""
    intervals = {"1m": ("1m", "5d"), "5m": ("5m", "1mo"),
                 "15m": ("15m", "1mo"), "1h": ("60m", "3mo"),
                 "4h": ("60m", "6mo"),
                 "6h": ("60m", "6mo"), "1d": ("1d", "1y"),
                 "1w": ("1wk", "5y")}
    interval, span = intervals[tf]
    params = urlencode({"interval": interval, "range": span})
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?{params}"
    # Yahoo rejects generic API user agents on some connections.
    req = Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; MarketDeskLocal/2.0)",
                                "Accept": "application/json"})
    ca = Path("/etc/ssl/cert.pem")
    with urlopen(req, timeout=12, context=ssl.create_default_context(cafile=str(ca) if ca.is_file() else None)) as response:
        data = json.load(response)
    result = (data.get("chart", {}).get("result") or [None])[0]
    if not result:
        return []
    quote = result.get("indicators", {}).get("quote", [{}])[0]
    rows = []
    for i, stamp in enumerate(result.get("timestamp", [])):
        try:
            op, high, low, close, volume = (quote[k][i] for k in ("open", "high", "low", "close", "volume"))
            if None in (op, high, low, close):
                continue
            rows.append({"t": int(stamp) * 1000, "o": float(op), "h": float(high),
                         "l": float(low), "c": float(close), "v": float(volume or 0)})
        except (IndexError, KeyError, TypeError, ValueError):
            continue
    if tf in ("4h", "6h"):
        tzname = result.get("meta", {}).get("exchangeTimezoneName", "America/New_York")
        try:
            ZoneInfo(tzname)
        except (KeyError, ValueError):
            tzname = "America/New_York"
        rows = aggregate_session(rows, 4 if tf == "4h" else 6, tzname)
    return rows[-limit:]


def history_candles(kind, symbol, tf, before_ms):
    """Return older bars; this endpoint is cached separately from the live chart tail."""
    before = before_ms // 1000
    if kind == "crypto":
        source_seconds = 3600 if tf == "4h" else 86400 if tf == "1w" else TIMEFRAMES[tf][1]
        pages = 5 if tf == "4h" else 9 if tf == "1w" else 3
        page_size = 240

        def fetch_page(page):
            end = before - page * page_size * source_seconds
            start = end - page_size * source_seconds
            params = urlencode({"granularity": source_seconds,
                                "start": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(start)),
                                "end": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(end))})
            url = f"https://api.exchange.coinbase.com/products/{symbol}-USD/candles?{params}"
            return normalize_coinbase(remote_json(url))

        chunks = []
        with ThreadPoolExecutor(max_workers=3) as pool:
            futures = [pool.submit(fetch_page, page) for page in range(pages)]
            for future in as_completed(futures):
                try:
                    chunks.extend(future.result())
                except (HTTPError, URLError, TimeoutError, ValueError):
                    continue
        source = sorted({row["t"]: row for row in chunks if row["t"] < before_ms}.values(),
                        key=lambda row: row["t"])
        if tf == "4h":
            buckets = {}
            for row in source:
                stamp = (row["t"] // 14400000) * 14400000
                if stamp not in buckets:
                    buckets[stamp] = {**row, "t": stamp}
                else:
                    bar = buckets[stamp]
                    bar["h"] = max(bar["h"], row["h"])
                    bar["l"] = min(bar["l"], row["l"])
                    bar["c"] = row["c"]
                    bar["v"] += row["v"]
            source = list(buckets.values())
        elif tf == "1w":
            buckets = {}
            for row in source:
                stamp = ((row["t"] // 1000 + 3 * 86400) // (7 * 86400)) * 7 * 86400000 - 3 * 86400000
                if stamp not in buckets:
                    buckets[stamp] = {**row, "t": stamp}
                else:
                    bar = buckets[stamp]
                    bar["h"] = max(bar["h"], row["h"])
                    bar["l"] = min(bar["l"], row["l"])
                    bar["c"] = row["c"]
                    bar["v"] += row["v"]
            source = list(buckets.values())
        return [row for row in source if row["t"] < before_ms][-1000:]

    if not TOKEN:
        raise ValueError("股票历史数据需要在启动服务时输入 Finnhub API Key")
    resolution = "60" if tf in ("4h", "6h") else TIMEFRAMES[tf][0]
    lookback_days = {"1m": 7, "5m": 30, "15m": 65, "1h": 180,
                     "4h": 450, "6h": 450, "1d": 1800, "1w": 3600}[tf]
    params = urlencode({"symbol": symbol, "resolution": resolution,
                        "from": before - lookback_days * 86400, "to": before - 1})
    try:
        rows = normalize_finnhub(remote_json("https://finnhub.io/api/v1/stock/candle?" + params, True))
        if tf in ("4h", "6h"):
            rows = aggregate_session(rows, 4 if tf == "4h" else 6, "America/New_York")
    except HTTPError as exc:
        if exc.code not in (403, 429):
            raise
        rows = yahoo_candles(symbol, tf, 1600)
    if not rows:
        rows = yahoo_candles(symbol, tf, 1600)
    return [row for row in rows if row["t"] < before_ms][-1000:]


def candles(kind, symbol, tf):
    resolution, seconds, count = TIMEFRAMES[tf]
    now = int(time.time())
    if kind == "crypto":
        if tf == "4h":
            hours = []
            for end in (now - 720 * 3600, now - 480 * 3600,
                        now - 240 * 3600, now):
                start = end - 240 * 3600
                params = urlencode({"granularity": 3600,
                                    "start": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(start)),
                                    "end": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(end))})
                hours.extend(normalize_coinbase(remote_json(
                    f"https://api.exchange.coinbase.com/products/{symbol}-USD/candles?{params}")))
            buckets = {}
            for row in sorted({item["t"]: item for item in hours}.values(), key=lambda item: item["t"]):
                bucket = (row["t"] // 14400000) * 14400000
                if bucket not in buckets:
                    buckets[bucket] = {**row, "t": bucket}
                else:
                    bar = buckets[bucket]
                    bar["h"] = max(bar["h"], row["h"])
                    bar["l"] = min(bar["l"], row["l"])
                    bar["c"] = row["c"]
                    bar["v"] += row["v"]
            return list(buckets.values())[-240:]
        if tf == "1w":
            # Fetch daily bars in two bounded requests, then aggregate by UTC week.
            parts = []
            for end in (now - 750 * 86400, now - 600 * 86400,
                        now - 450 * 86400, now - 300 * 86400,
                        now - 150 * 86400, now):
                start = end - 150 * 86400
                params = urlencode({"granularity": 86400, "start": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(start)),
                                    "end": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(end))})
                parts += normalize_coinbase(remote_json(f"https://api.exchange.coinbase.com/products/{symbol}-USD/candles?{params}"))
            days = {x["t"]: x for x in parts}
            weeks = {}
            for x in sorted(days.values(), key=lambda y: y["t"]):
                week = int((x["t"] // 1000 + 3 * 86400) // (7 * 86400))
                week_start = week * 7 * 86400000 - 3 * 86400000
                if week not in weeks:
                    weeks[week] = {**x, "t": week_start}
                else:
                    w = weeks[week]; w["h"] = max(w["h"], x["h"]); w["l"] = min(w["l"], x["l"])
                    w["c"] = x["c"]; w["v"] += x["v"]
            return list(weeks.values())[-100:]
        end = now + seconds
        start = end - min(count, 290) * seconds
        params = urlencode({"granularity": seconds, "start": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(start)),
                            "end": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(end))})
        return normalize_coinbase(remote_json(f"https://api.exchange.coinbase.com/products/{symbol}-USD/candles?{params}"))
    if not TOKEN:
        raise ValueError("股票行情需要在启动服务时输入 Finnhub API Key")
    if tf in ("4h", "6h"):
        resolution = "60"; count = 240
    stock_lookback = {"1m": 7, "5m": 14, "15m": 30, "1h": 65,
                      "4h": 250, "6h": 120, "1d": 480, "1w": 1300}
    lookback = stock_lookback[tf] * 86400
    params = urlencode({"symbol": symbol, "resolution": resolution, "from": now - lookback, "to": now})
    rows = normalize_finnhub(remote_json("https://finnhub.io/api/v1/stock/candle?" + params, True))
    if tf in ("4h", "6h"):
        rows = aggregate_session(rows, 4 if tf == "4h" else 6, "America/New_York")
    return rows[-count:]


def accounts():
    global ACCOUNT_STORE
    if ACCOUNT_STORE is None:
        with ACCOUNT_LOCK:
            if ACCOUNT_STORE is None:
                ACCOUNT_STORE = AccountStore(ACCOUNT_DB)
    return ACCOUNT_STORE


class Handler(BaseHTTPRequestHandler):
    def handle(self):
        # A phone can cancel a request when navigating or losing connectivity.
        # This ends only that connection; do not emit a server-error traceback.
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            self.close_connection = True

    def log_message(self, format, *args):
        # Do not log token-bearing upstream headers or URL values.
        print("[market]", self.address_string(), format % args)

    def respond(self, code, body, mime="application/json; charset=utf-8", cookie=None, cache_seconds=0):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
        etag=None
        if code==200 and cache_seconds and isinstance(body,bytes) and not cookie:
            etag='"'+hashlib.blake2b(data,digest_size=16).hexdigest()+'"'
            matches={value.strip().removeprefix('W/') for value in self.headers.get('If-None-Match','').split(',')}
            if etag in matches or '*' in matches:code=304
        self.send_response(code)
        self.send_header("Content-Type", mime)
        if code!=304:self.send_header("Content-Length", str(len(data)))
        if etag:self.send_header("ETag",etag)
        requested_revision = parse_qs(urlsplit(self.path).query).get("v", [""])[0]
        exact_revision = hashlib.sha256(data).hexdigest()[:16] if cache_seconds else ""
        cache_policy = (f"private, max-age={cache_seconds}, immutable" if requested_revision == exact_revision else "private, no-cache") if cache_seconds else "no-store"
        self.send_header("Cache-Control", cache_policy)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN" if urlsplit(self.path).path in ("/backtest/", "/backtest/index.html") else "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; connect-src 'self' wss://ws.okx.com:8443 wss://ws.okx.com; style-src 'self'; script-src 'self'; img-src 'self' data: blob: https://*.finnhub.io https://coin-images.coingecko.com https://assets.coingecko.com https://cdn.tickerlogos.com https://img.loadlogo.com; base-uri 'none'; form-action 'self'")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        if code!=304:self.wfile.write(data)

    def session_token(self):
        jar = SimpleCookie()
        try:
            jar.load(self.headers.get("Cookie", ""))
            return jar["star_session"].value if "star_session" in jar else ""
        except Exception:
            return ""

    def auth_cookie(self, token="", clear=False):
        secure = "; Secure" if self.headers.get("X-Forwarded-Proto", "").lower() == "https" else ""
        return (f"star_session={token}; Path=/; HttpOnly; SameSite=Lax; "
                f"Max-Age={0 if clear else SESSION_SECONDS}{secure}")

    def do_POST(self):
        if self.headers.get("Host", "").split(":")[0].lower() not in ALLOWED_HOSTS:
            return self.respond(403, {"error": "只允许本机访问"})
        path = urlsplit(self.path).path
        if path not in ("/api/auth/register", "/api/auth/login", "/api/auth/logout", "/api/auth/password", "/api/auth/avatar", "/api/user/state", "/api/asset-discovery", "/api/backtest/jobs"):
            return self.respond(404, {"error": "未找到"})
        if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
            return self.respond(415, {"error": "请发送 JSON 数据"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 0 or length > (131072 if path == "/api/user/state" else 32768):
                return self.respond(413, {"error": "请求内容过大"})
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise ValueError("请求内容无效")
        except (ValueError, json.JSONDecodeError):
            return self.respond(400, {"error": "请求内容无效"})
        token = self.session_token()
        if path == "/api/backtest/jobs":
            user = accounts().session(token)
            if not user:return self.respond(401, {"error": "请先登录"})
            try:return self.respond(202, research_jobs.submit(user["id"], body))
            except research_jobs.BusyError as exc:return self.respond(429, {"error": str(exc)})
            except (ValueError, TypeError, OverflowError):return self.respond(400, {"error": "回测参数无效"})
        if path == "/api/auth/logout":
            accounts().logout(token)
            return self.respond(200, {"ok": True}, cookie=self.auth_cookie(clear=True))
        if path == "/api/auth/avatar":
            user = accounts().session(token)
            if not user:
                return self.respond(401, {"error": "请先登录"})
            try:
                updated = accounts().change_avatar(user["id"], body.get("avatarKind"))
            except ValueError as exc:
                return self.respond(400, {"error": str(exc)})
            return self.respond(200, {key: updated[key] for key in ("avatarKind", "avatarChangedDay", "avatarCanChange")})
        if path == "/api/auth/password":
            user = accounts().session(token)
            if not user:
                return self.respond(401, {"error": "请先登录"})
            key = f"password:{user['id']}"
            with ACCOUNT_LOCK:
                failures = [stamp for stamp in LOGIN_FAILURES.get(key, []) if time.time() - stamp < 900]
                LOGIN_FAILURES[key] = failures
                if len(failures) >= 8:
                    return self.respond(429, {"error": "尝试次数过多，请 15 分钟后重试"})
            try:
                accounts().change_password(user["id"], body.get("currentPassword"), body.get("newPassword"), token)
            except ValueError as exc:
                if str(exc) == "当前密码不正确":
                    with ACCOUNT_LOCK:
                        LOGIN_FAILURES.setdefault(key, []).append(time.time())
                return self.respond(400, {"error": str(exc)})
            with ACCOUNT_LOCK:
                LOGIN_FAILURES.pop(key, None)
            return self.respond(200, {"ok": True})
        if path == "/api/asset-discovery":
            if not accounts().session(token):return self.respond(401,{"error":"请先登录"})
            requested=body.get("items")
            if not isinstance(requested,list) or len(requested)>30:return self.respond(400,{"error":"标的列表无效"})
            with CACHE_LOCK:contracts=CACHE.get(("okx","instruments"),(0,{}))[1]
            contracts=contracts or okx_market.instrument_snapshot()
            stocks=ashare_market.catalog();items={}
            for item in requested:
                if not isinstance(item,dict):continue
                kind=item.get("type");symbol=item.get("symbol")
                if not isinstance(symbol,str):continue
                if kind=="ashare" and symbol in stocks:items[(kind,symbol)]=stocks[symbol]
                elif kind=="swap" and symbol in contracts:items[(kind,symbol)]={"type":"swap","symbol":symbol,"name":okx_market.NAMES.get(symbol,symbol)}
            register_discovered(list(items.values()))
            return self.respond(202,{"queued":len(items)})
        if path == "/api/user/state":
            user = accounts().session(token)
            if not user:
                return self.respond(401, {"error": "请先登录"})
            try:
                state = accounts().save_state(user["id"], body)
                register_discovered(state.get("assets", []), followed=True)
            except StateConflict:
                latest = accounts().session(token)
                return self.respond(409, {"error": "自选已在另一页面更新", "state": latest["state"],
                                          "stateUpdated": latest["stateUpdated"]})
            except ValueError as exc:
                return self.respond(400, {"error": str(exc)})
            return self.respond(200, {"state": state, "stateUpdated": accounts().session(token)["stateUpdated"]})
        username, password = body.get("username"), body.get("password")
        if path == "/api/auth/login":
            key = str(username).casefold()[:32]
            with ACCOUNT_LOCK:
                failures = [stamp for stamp in LOGIN_FAILURES.get(key, []) if time.time() - stamp < 900]
                LOGIN_FAILURES[key] = failures
                if len(failures) >= 8:
                    return self.respond(429, {"error": "尝试次数过多，请 15 分钟后重试"})
            try:
                user, new_token = accounts().login(username, password)
            except ValueError:
                with ACCOUNT_LOCK:
                    LOGIN_FAILURES.setdefault(key, []).append(time.time())
                return self.respond(401, {"error": "用户名或密码不正确"})
            with ACCOUNT_LOCK:
                LOGIN_FAILURES.pop(key, None)
        else:
            try:
                user, new_token = accounts().register(username, password, body.get("avatarKind", 0))
            except ValueError as exc:
                return self.respond(400, {"error": str(exc)})
        return self.respond(200, {key: user[key] for key in ("username", "userId", "spaceId", "state", "stateUpdated", "avatarKind", "avatarChangedDay", "avatarCanChange")},
                            cookie=self.auth_cookie(new_token))

    def do_GET(self):
        if self.headers.get("Host", "").split(":")[0].lower() not in ALLOWED_HOSTS:
            return self.respond(403, {"error": "只允许本机访问"})
        path = urlsplit(self.path)
        if path.path in ("/", "/index.html", "/news.html"):
            page_ids = parse_qs(path.query, keep_blank_values=True).get("space")
            if page_ids is not None:
                user = accounts().session(self.session_token())
                if (len(page_ids) != 1 or not user or
                        not hmac.compare_digest(page_ids[0], user["spaceId"])):
                    message = ('<!doctype html><html lang="zh-CN"><meta charset="utf-8">'
                               '<title>页面已失效</title><body style="background:#0b1824;color:#e8f4f5;'
                               'font:16px sans-serif;padding:3rem"><h1>此页面 ID 已失效</h1>'
                               '<p>请返回星轨重新登录，系统会生成新的页面 ID。</p>'
                               '<a style="color:#eac06e" href="/">返回星轨</a></body></html>')
                    return self.respond(410, message.encode("utf-8"), "text/html; charset=utf-8")
        if path.path in ("/downloads/orbit.apk", "/downloads/orbit.apk.sha256"):
            apk=Path(os.environ.get("MARKET_APK_FILE",str(ROOT/".local-data/android/orbit.apk")))
            if not apk.is_file():return self.respond(404,{"error":"安卓包暂未发布"})
            if path.path.endswith(".sha256"):
                return self.respond(200,(hashlib.sha256(apk.read_bytes()).hexdigest()+"  orbit.apk\n").encode(),"text/plain; charset=utf-8")
            return self.respond(200,apk.read_bytes(),"application/vnd.android.package-archive")
        if path.path in ("/download","/download.html"):
            return self.respond(200,version_html((ROOT/"download.html").read_bytes(),ROOT,"/download.html"),"text/html; charset=utf-8")
        research_files = {"/backtest/": ("index.html", "text/html"), "/backtest/index.html": ("index.html", "text/html"), "/backtest/app.js": ("app.js", "text/javascript"), "/backtest/style.css": ("style.css", "text/css")}
        if path.path in research_files:
            name, mime = research_files[path.path]
            return self.respond(200, version_html((ROOT / "backtest" / name).read_bytes(), ROOT, "/backtest/") if mime == "text/html" else (ROOT / "backtest" / name).read_bytes(), mime + "; charset=utf-8")
        if path.path in ("/", "/index.html", "/news.html", "/assets/styles.css", "/assets/theme.js", "/assets/insight.js", "/assets/strategy.js", "/assets/gesture.js", "/assets/audit.js", "/assets/app.js", "/assets/news.js", "/assets/touch.js"):
            name = "index.html" if path.path == "/" else path.path.lstrip("/")
            mime = {"html": "text/html", "css": "text/css", "js": "text/javascript"}[name.rsplit(".", 1)[-1]] + "; charset=utf-8"
            return self.respond(200, version_html((ROOT / name).read_bytes(), ROOT, path.path) if name.endswith(".html") else (ROOT / name).read_bytes(), mime, cache_seconds=(31536000 if "v" in parse_qs(path.query) else 3600) if name.startswith("assets/") else 0)
        if path.path in {
            "/assets/pets/space-rabbit-3d-v2.png", "/assets/pets/space-robot-3d-v2.png",
            "/assets/pets/space-saturn-3d-v2.png", "/assets/pets/space-ghost-3d-v2.png",
            "/assets/pets/space-rabbit-3d-v1.png", "/assets/pets/space-robot-3d-v1.png",
            "/assets/pets/space-rover-3d-v1.png", "/assets/pets/space-meteor-3d-v1.png",
            "/assets/pets/space-comet-3d-v1.png", "/assets/pets/space-saturn-3d-v1.png",
            "/assets/pets/space-crystal-3d-v1.png", "/assets/pets/space-ghost-3d-v1.png",
        }:
            asset = ROOT / path.path.lstrip("/")
            if asset.is_file():
                return self.respond(200, asset.read_bytes(), "image/png", cache_seconds=86400)
        if path.path == "/assets/pets/mascots-3d-v1.png":
            return self.respond(200, (ROOT / "assets/pets/mascots-3d-v1.png").read_bytes(), "image/png", cache_seconds=86400)
        if path.path in ("/assets/data.js", "/assets/news-paper.js", "/assets/news-paper.css", "/assets/mobile-pages.js", "/assets/mobile-pages.css", "/assets/wallet.js", "/assets/wallet.css", "/assets/client-update.js", "/assets/download.css", "/assets/pets/personal-navigator-v1.png"):
            asset = ROOT / path.path.lstrip("/")
            if asset.is_file():
                mime = {".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png"}[asset.suffix]
                return self.respond(200, asset.read_bytes(), mime, cache_seconds=31536000 if "v" in parse_qs(path.query) else 3600)
        if path.path == "/assets/icon.svg":
            return self.respond(200, (ROOT / "assets/icon.svg").read_bytes(), "image/svg+xml", cache_seconds=86400)
        if path.path in ("/assets/icon.png", "/favicon.ico"):
            return self.respond(200, (ROOT / "assets/icon.png").read_bytes(), "image/png", cache_seconds=86400)
        if path.path == "/assets/site.webmanifest":
            return self.respond(200, (ROOT / "assets/site.webmanifest").read_bytes(), "application/manifest+json; charset=utf-8", cache_seconds=86400)
        if re.fullmatch(r"/assets/icons/crypto/[a-z0-9]{2,12}\.(?:svg|png)", path.path):
            icon = ROOT / path.path.lstrip("/")
            if icon.is_file():
                return self.respond(200, icon.read_bytes(), "image/png" if icon.suffix == ".png" else "image/svg+xml", cache_seconds=86400)
        if re.fullmatch(r"/assets/icons/okx/[a-z0-9]{2,12}\.png", path.path):
            icon = ROOT / path.path.lstrip("/")
            if icon.is_file():
                return self.respond(200, icon.read_bytes(), "image/png", cache_seconds=86400)
        if path.path in {entry[0] for entry in (*BRAND_LOGOS.values(), *ASHARE_BRAND_LOGOS.values())}:
            icon = ROOT / path.path.lstrip("/")
            if icon.is_file():
                return self.respond(200, icon.read_bytes(), "image/svg+xml" if icon.suffix == ".svg" else "image/png", cache_seconds=86400)
        if path.path == "/api/status":
            return self.respond(200, {"marketReady": True, "market": "OKX", "newsReady": True,
                                      "release": release_identity(ROOT), "serverTime": int(time.time() * 1000)})
        if path.path == "/api/auth/session":
            user = accounts().session(self.session_token())
            return self.respond(200, {"username": user["username"], "state": user["state"],
                                      "spaceId": user["spaceId"], "userId": user["userId"],
                                      "stateUpdated": user["stateUpdated"], "avatarKind": user["avatarKind"],
                                      "avatarChangedDay": user["avatarChangedDay"], "avatarCanChange": user["avatarCanChange"]} if user
                                else {"username": None, "state": None})
        if path.path.startswith("/api/") and path.path != "/api/status" and not accounts().session(self.session_token()):
            return self.respond(401, {"error": "请先登录"})
        if path.path == "/api/backtest/catalog":
            try:return self.respond(200, research_jobs.catalog())
            except Exception:return self.respond(503, {"error": "本地行情目录暂不可用"})
        if re.fullmatch(r"/api/backtest/jobs/[a-f0-9]{32}", path.path):
            user = accounts().session(self.session_token())
            job = research_jobs.status(user["id"], path.path.rsplit("/", 1)[-1])
            return self.respond(200, job) if job else self.respond(404, {"error": "回测记录不存在或已过期"})
        if path.path == "/api/search":
            query = parse_qs(path.query).get("q", [""])[0].strip()
            if not re.fullmatch(r"[\w .-]{1,32}", query, re.UNICODE):
                return self.respond(400, {"error": "搜索内容无效"})
            try:
                results = combined_search(query)
                market_store().save_search(query, results)
                register_discovered(results)
                return self.respond(200, {"results": results})
            except (HTTPError, URLError, TimeoutError, ValueError):
                return self.respond(502, {"error": "OKX 合约列表暂不可用"})
        if path.path == "/api/catalog":
            try:
                return self.respond(200, {"items": combined_catalog(), "updatedAt": int(time.time()*1000)})
            except (HTTPError, URLError, TimeoutError, ValueError):
                return self.respond(502, {"error": "OKX 合约列表暂不可用"})
        if path.path == "/api/daily-hot":
            try:
                return self.respond(200, daily_hot_record())
            except (OSError, ValueError):
                return self.respond(502, {"error": "热门榜暂不可用"})
        if path.path == "/api/logo":
            symbol = parse_qs(path.query).get("symbol", [""])[0].upper()
            if not re.fullmatch(r"[A-Z0-9]{1,15}", symbol):
                return self.respond(400, {"error": "标的代码无效"})
            if ashare_market.is_symbol(symbol):
                if symbol not in ashare_market.catalog():
                    return self.respond(404, {"error": "A股目录尚无此股票"})
                try:
                    result = ashare_logo_status(symbol)
                except (OSError, ValueError):
                    result = {"url": "", "source": "图标来源暂不可用"}
                return self.respond(200, result)
            catalog = cached(("okx", "instruments"), 600, okx_market.instruments)
            if symbol not in catalog:
                return self.respond(404, {"error": "OKX 没有此合约"})
            try:
                result = swap_logo_status(symbol, catalog)
            except (HTTPError, URLError, TimeoutError, ValueError):
                result = {"url": "", "source": "图标来源暂不可用"}
            return self.respond(200, result)
        if path.path == "/api/logo-image":
            symbol = parse_qs(path.query).get("symbol", [""])[0].upper()
            if not re.fullmatch(r"[A-Z0-9]{1,15}", symbol):
                return self.respond(400, {"error": "标的代码无效"})
            record = market_store().logo(symbol)
            if record:
                return self.respond(200, record["image"], record["mime"], cache_seconds=86400)
            if ashare_market.is_symbol(symbol):
                if symbol not in ashare_market.catalog():
                    return self.respond(404, {"error": "A股目录尚无此股票"})
                record = market_store().logo(symbol, "ashare")
                if not record:
                    return self.respond(404, {"error": "图标未缓存"})
                return self.respond(200, record["image"], record["mime"], cache_seconds=86400)
            catalog = cached(("okx", "instruments"), 600, okx_market.instruments)
            if symbol not in catalog:
                return self.respond(404, {"error": "OKX 没有此合约"})
            category = str(catalog[symbol].get("instCategory", ""))
            record = market_store().logo(symbol, category)
            if not record:
                return self.respond(404, {"error": "图标未缓存"})
            return self.respond(200, record["image"], record["mime"], cache_seconds=86400)
        if path.path == "/api/quotes":
            raw = parse_qs(path.query).get("symbols", [""])[0].upper()
            symbols = raw.split(",")
            if not symbols or len(symbols) > 30 or any(not re.fullmatch(r"[A-Z0-9]{1,15}", s) for s in symbols):
                return self.respond(400, {"error": "自选代码无效"})
            try:
                contracts=[x for x in symbols if not ashare_market.is_symbol(x)]
                rows = {}
                if contracts:
                    try:
                        batch, stale = stored_market_data(("okx", "tickers", tuple(sorted(contracts))), 3,
                                                         lambda: okx_market.quotes(contracts), background=True)
                        rows = {key: {**value, "stale": stale} for key, value in batch.items()}
                        if not stale:
                            for key, value in batch.items():
                                market_store().write(MarketStore.key("okx", "quote", key), value)
                    except (HTTPError, URLError, TimeoutError, ValueError):
                        for key in contracts:
                            saved = market_store().read(MarketStore.key("okx", "quote", key))
                            if saved:
                                rows[key] = {**saved[0], "stale": True}
                for stock in (x for x in symbols if ashare_market.is_symbol(x)):
                    try: rows={**rows,stock:cached(("ashare","quote",stock),15,lambda stock=stock:ashare_market.quote(stock))}
                    except (OSError, ValueError): pass
                return self.respond(200, {"quotes": {s: rows[s] for s in symbols if s in rows}})
            except (HTTPError, URLError, TimeoutError, ValueError):
                return self.respond(502, {"error": "OKX 批量报价暂不可用"})
        if not path.path.startswith("/api/"):
            return self.respond(404, {"error": "未找到"})
        q = parse_qs(path.query)
        symbol = q.get("symbol", [""])[0].upper()
        kind = q.get("type", [""])[0]
        tf = q.get("tf", ["1d"])[0]
        if kind == "ashare":
            if not ashare_market.is_symbol(symbol) or symbol not in ashare_market.catalog():
                return self.respond(400, {"error":"请选择目录中真实的沪深北 A股"})
            try:
                if path.path == "/api/quote":
                    row,stale=stored_market_data(("ashare","quote",symbol),15,lambda:ashare_market.quote(symbol),background=True)
                    return self.respond(200,{**row,"stale":stale})
                if path.path == "/api/info":
                    row,stale=ashare_profile(symbol)
                    return self.respond(200,{**row,"stale":stale})
                if path.path in ("/api/candles","/api/history"):
                    if tf not in ashare_market.PERIODS:return self.respond(400,{"error":"此周期不适用于 A股，请选择1小时或日线"})
                    before=None
                    if path.path.endswith('history'):
                        text=q.get('before',[''])[0]
                        if not re.fullmatch(r'\d{13}',text):return self.respond(400,{"error":"历史范围无效"})
                        before=int(text)
                        if not 946684800000<=before<=int(time.time()*1000)+86400000:return self.respond(400,{"error":"历史范围无效"})
                    key=("ashare","history",symbol,tf,before) if before else ("ashare","candles",symbol,tf)
                    rows,stale=stored_market_data(key,21600 if before else 30,lambda:ashare_market.candles(symbol,tf,before),symbol=symbol,tf=tf,background=not bool(before))
                    if not before:
                        stored=market_store().recent_candles(symbol,tf,limit=1000)
                        if stored:rows=stored
                    return self.respond(200,{"candles":rows,"source":"东方财富 · A股现货 · 人民币成交额 · 不复权","currency":"CNY","stale":stale})
                if path.path == "/api/news":return self.respond(200,cached(("ashare","news",symbol),600,lambda:public_news(symbol)))
                return self.respond(404,{"error":"接口不存在"})
            except (OSError, ValueError) as exc:return self.respond(502,{"error":str(exc)[:180]})
        if not re.fullmatch(r"[A-Z0-9]{1,15}", symbol) or kind != "swap":
            return self.respond(400, {"error": "请使用 OKX USDT 永续合约代码"})
        if path.path == "/api/info":
            try:
                info,stale=asset_profile(kind,symbol)
                return self.respond(200, {**public_asset_info(info), "stale": stale})
            except (HTTPError,URLError,TimeoutError,OSError,ValueError):
                return self.respond(502,{"error":"标的资料暂不可用"})
        try:
            if kind == "swap":
                catalog = cached(("okx", "instruments"), 600, okx_market.instruments)
                if symbol not in catalog:
                    return self.respond(404, {"error": "OKX 没有此 USDT 永续合约"})
                if path.path == "/api/history":
                    before_text = q.get("before", [""])[0]
                    if tf not in okx_market.BARS or not re.fullmatch(r"\d{13}", before_text):
                        return self.respond(400, {"error": "历史范围无效"})
                    before_ms = int(before_text)
                    if before_ms < 946684800000 or before_ms > int(time.time() * 1000) + 86400000:
                        return self.respond(400, {"error": "历史范围无效"})
                    rows, stale = stored_market_data(
                        ("okx", "history", symbol, tf, before_ms), 21600,
                        lambda: okx_market.candles(symbol, tf, before_ms), symbol=symbol, tf=tf)
                    return self.respond(200, {"candles": rows, "source": "OKX · USDT 永续历史",
                                              "stale": stale})
                if path.path == "/api/candles":
                    if tf not in okx_market.BARS:
                        return self.respond(400, {"error": "时间周期无效"})
                    ttl = 5 if tf in ("1m", "5m", "15m") else 15 if tf in ("1h", "2h", "4h", "6h") else 30
                    rows, stale = stored_market_data(
                        ("okx", "candles", symbol, tf), ttl,
                        lambda: okx_market.candles(symbol, tf), symbol=symbol, tf=tf, hot=True,
                        background=True)
                    stored_rows = market_store().recent_candles(symbol, tf, limit=900)
                    if stored_rows:
                        rows = stored_rows
                    return self.respond(200, {"candles": rows, "source": "OKX · USDT 永续 · 成交额 USDT",
                                              "stale": stale,
                                              "refreshing": MarketStore.key("okx", "candles", symbol, tf)
                                              in market_store()._pending})
                if path.path == "/api/quote":
                    row, stale = stored_market_data(("okx", "quote", symbol), 3, lambda: okx_market.quote(symbol), background=True)
                    return self.respond(200, {**row, "stale": stale})
                if path.path == "/api/info":
                    info, stale = asset_profile(kind, symbol)
                    return self.respond(200, {**public_asset_info(info), "stale": stale})
                if path.path == "/api/news":
                    if not TOKEN:
                        return self.respond(200, cached(("public_news", symbol), 600,
                                                        lambda: public_news(symbol)))
                    kind = "stock" if symbol in STOCK_LINKED_SYMBOLS else "crypto"
            if path.path == "/api/news":
                if not TOKEN:
                    return self.respond(200, cached(("public_news", symbol), 600,
                                                    lambda: public_news(symbol)))
                if kind == "stock" or (kind == "swap" and symbol in STOCK_LINKED_SYMBOLS):
                    today = time.strftime("%Y-%m-%d", time.gmtime())
                    yesterday = time.strftime("%Y-%m-%d", time.gmtime(time.time() - 86400))
                    params = urlencode({"symbol": symbol, "from": yesterday, "to": today})
                    url = "https://finnhub.io/api/v1/company-news?" + params
                else:
                    url = "https://finnhub.io/api/v1/news?category=crypto"
                rows = cached(("news", kind, symbol), 300, lambda: remote_json(url, True))
                if kind == "swap" and symbol not in STOCK_LINKED_SYMBOLS and isinstance(rows, list):
                    aliases = {"BTC": ("bitcoin", "btc"), "ETH": ("ethereum", "ether", "eth")}
                    words = aliases.get(symbol, (symbol.lower(),))
                    rows = [x for x in rows if any(w in (x.get("headline", "") + " " + x.get("summary", "")).lower() for w in words)]
                return self.respond(200, rows[:25] if isinstance(rows, list) else [])
            return self.respond(404, {"error": "未找到"})
        except HTTPError as exc:
            message = "上游服务拒绝请求（HTTP %s）" % exc.code
            if exc.code == 403 and kind == "stock":
                message += "；请检查 Finnhub 账户是否有 K 线历史数据权限"
            return self.respond(502, {"error": message})
        except (URLError, TimeoutError):
            return self.respond(502, {"error": "行情服务暂时不可用"})
        except ValueError as exc:
            return self.respond(400, {"error": str(exc)})


GENERIC_INTROS = {
    "加密货币是一种使用密码学原理来确保交易安全及控制交易单位创造的交易介质。",
}


def _exact_intro(kind, symbol):
    """只走精确匹配来源：CoinGecko 项目页或维基条目名精确对应的中文首句。

    刻意不使用全文搜索兜底，避免标的代码命中无关词条（例如把 AAOI 匹配成某位律师）。
    """
    if kind == "crypto":
        try:
            identified = coin_identity(symbol) or {}
        except (HTTPError, URLError, TimeoutError, ValueError, OSError):
            identified = {}
        record = coingecko_intro(identified) if identified else None
        name = str(identified.get("name") or "")
        if not record and name:
            record = _chinese_intro_retry(name)
    else:
        try:
            identified = stock_identity(symbol) or {}
        except (HTTPError, URLError, TimeoutError, ValueError, OSError):
            identified = {}
        name = str(identified.get("name") or "").strip() or okx_market.NAMES.get(symbol, "")
        record = _chinese_intro_retry(name) if name else None
    if not record or not has_chinese(record[0]) or record[0].strip() in GENERIC_INTROS:
        return None
    return record


def backfill_summaries(*, limit=None, pause=0.1):
    """为库中缺少中文简介的标的各补一次（只用精确来源，只存正确结果，人工内容不覆盖）。"""
    store = market_store()
    try:
        catalog = cached(("okx", "instruments"), 0, okx_market.instruments)
    except (HTTPError, URLError, TimeoutError, ValueError):
        print("OKX 合约列表暂不可用，稍后重试", flush=True)
        return
    kind_by_category = {"1": "crypto", "3": "stock", "4": "commodity", "5": "forex", "6": "bond"}
    kinds = {symbol: kind_by_category.get(str(row.get("instCategory", "")), "unknown")
             for symbol, row in catalog.items()}
    pending = [s for s in sorted(catalog)
               if kinds[s] in ("stock", "crypto") and store.summary(kinds[s], s) is None]
    if limit:
        pending = pending[:limit]
    print(f"待补全 {len(pending)} 个标的", flush=True)
    filled = 0
    for index, symbol in enumerate(pending, 1):
        record = _exact_intro(kinds[symbol], symbol)
        if record:
            try:
                store.save_summary(kinds[symbol], symbol, *record, overwrite=False)
            except (OSError, ValueError):
                record = None
            else:
                invalidate_info_cache(symbol)
        if record:
            filled += 1
        print(f"  [{index}/{len(pending)}] {symbol}: {'已补' if record else '无精确中文来源'}", flush=True)
        if pause:
            time.sleep(pause)
    print(f"完成：本次新增中文简介 {filled} 个", flush=True)


def backfill_logos(*, limit=None, pause=0.1):
    """为库中缺少图标的标的各补一次（复用 resolve_logo 精确匹配链，成功即入库）。"""
    store = market_store()
    try:
        catalog = cached(("okx", "instruments"), 0, okx_market.instruments)
    except (HTTPError, URLError, TimeoutError, ValueError):
        print("OKX 合约列表暂不可用，稍后重试", flush=True)
        return
    pending = []
    for symbol in sorted(catalog):
        if symbol in BRAND_LOGOS or symbol in CURATED_COIN_LOGOS:
            continue
        if (ROOT / "assets" / "icons" / "okx" / (symbol.lower() + ".png")).is_file():
            continue
        category = str(catalog[symbol].get("instCategory", ""))
        if store.logo(symbol, category) is None:
            pending.append(symbol)
    if limit:
        pending = pending[:limit]
    print(f"待补全图标 {len(pending)} 个标的", flush=True)
    filled = 0
    for index, symbol in enumerate(pending, 1):
        stored = False
        try:
            resolve_logo(symbol, catalog)
            category = str(catalog[symbol].get("instCategory", ""))
            stored = store.logo(symbol, category) is not None
        except (HTTPError, URLError, TimeoutError, ValueError, OSError):
            pass
        if stored:
            filled += 1
            with CACHE_LOCK:
                CACHE.pop(("logo", symbol), None)
                CACHE_KEY_LOCKS.pop(("logo", symbol), None)
        print(f"  [{index}/{len(pending)}] {symbol}: {'已补' if stored else '无可靠匹配'}", flush=True)
        if pause:
            time.sleep(pause)
    print(f"完成：本次新增图标 {filled} 个", flush=True)


if __name__ == "__main__":
    if "--backfill-summaries" in sys.argv:
        cap = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
        backfill_summaries(limit=cap)
        raise SystemExit
    if "--backfill-logos" in sys.argv:
        cap = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
        backfill_logos(limit=cap)
        raise SystemExit
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=refresh_active_market_data, daemon=True).start()
    threading.Thread(target=refresh_daily_hot, daemon=True).start()
    threading.Thread(target=refresh_equity_directory, daemon=True).start()
    threading.Thread(target=lambda: cached(("okx", "instruments"), 0,
                                          okx_market.instruments), daemon=True).start()
    print(f"星轨：http://localhost:{PORT}/ （OKX 行情已就绪；新闻 Key {'已加载' if TOKEN else '未加载'}）", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
