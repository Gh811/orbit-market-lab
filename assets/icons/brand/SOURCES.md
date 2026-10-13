# 公司品牌图标来源

| 代码 | 图标 | 来源 |
| --- | --- | --- |
| SPCX | SpaceX 图形标志 | [Simple Icons 的 SpaceX 图标](https://github.com/simple-icons/simple-icons/blob/develop/icons/spacex.svg)，仅用于标识对应公司。 |
| ZHONGJI | 中际旭创官网站点图标 | [中际旭创官网](https://www.zj-innolight.com/cn) 的 `favicon.ico`，转存为 PNG。 |
| XIAOMI | 小米官网橙色 Mi 图标 | [小米官网](https://www.mi.com/sg/about/index.html) 使用的 [官方图标文件](https://i01.appmifile.com/webfile/globalimg/mobile/logo/mi.png)。 |
| SKHYNIX | SK hynix 官网页眉标志 | [SK hynix 品牌介绍](https://www.skhynix.com/company/UI-FR-CP0401/) 引用的 `img/common/img_logo.png`。 |
| SAMSUNG | Samsung 官网方形品牌标志 | [Samsung 品牌介绍](https://www.samsung.com/jp/about-us/brand-identity/logo/) 使用的 `logo-square-letter.png`。 |
| QQQ | QQQ 发行商 Invesco 的品牌图形 | [Invesco QQQ 官方页](https://www.invesco.com/us/en/solutions/invesco-qqq.html) 使用的 `invesco-blue.svg`，本地仅裁切图形部分；这是发行商标志，不是交易所或 ETF 独立标志。 |
| NKE | Nike Swoosh 品牌图形 | [Simple Icons 的 Nike 图标](https://github.com/simple-icons/simple-icons/blob/develop/icons/nike.svg)，用于标识公司，非 OKX 合约接口返回。 |
| WDC | Western Digital 公司图形 | [Western Digital 官网](https://www.westerndigital.com/content/dam/store/en-us/assets/home-page/brand-logos/header-main-logo.svg) 的页眉品牌图形，本地保存以免第三方链接失效。 |
| GOOGL、GOOG | Google 彩色 G | [Google 官方静态素材](https://www.gstatic.com/images/branding/googleg/1x/googleg_standard_color_128dp.png)，用于识别 Alphabet 旗下的 Google 品牌。 |
| TSLA | Tesla T 标志 | [Simple Icons 的 Tesla 图标](https://github.com/simple-icons/simple-icons/blob/develop/icons/tesla.svg)，用于识别公司。 |
| ANTHROPIC | Anthropic 官网站点图标 | [Anthropic 官网](https://www.anthropic.com/favicon.ico) 的 48px 图标，转存为 PNG。 |
| INTC | Intel 官网站点图标 | [Intel 官网](https://www.intel.com/favicon.ico) 的 32px 图标，转存为 PNG。 |
| OPENAI | OPENAI 代码文字标识 | 官网图标当前无法稳定获取；本地文字标识并非 OpenAI 官方 Logo。 |

XAU 是黄金商品代号，没有公司 Logo；界面使用本地绘制的金锭示意图作为商品类别识别，并明确标为非官方图标。2026-10-11 起图形改为与 OKX 白银（XAG）图标同款的三枚梯形锭造型（1 上 2 下），圆形金底（#efb237）白色锭面，与 XAG 图标风格统一、仅颜色为金色。

这类图片为公司品牌图标，不代表 OKX 官方合约图标。添加新代码时必须先核对其对应资产，避免将同名代币图案错配到合约。

未人工收录的股票类标的按精确股票代码查询 AllInvestView 公司目录，失败时再向 LoadLogo 查询同一股票代码；加密资产按 OKX 类别过滤后，经 CoinGecko 精确代码与重名风险判断获取项目图，失败时再向 LoadLogo 核对同一币种代码。成功获取的位图缓存在本地。没有可靠匹配时显示完整代码的文字标识，不把它称作官方 Logo。
