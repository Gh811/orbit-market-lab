# 策略与手机兼容性审查（2026-10-12）

本次基于仓库代码与官方技术资料审查，完成可用 OHLCV 数据计算的策略改动。没有部署，没有实盘或真实历史逐笔回测，也没有对各品牌手机进行真机认证。

## 指南与现有实现

原实现：已完成 K 线的 MA5/10/20 排列与 MA20 斜率；近 120 根已确认的局部高低点；ATR 缓冲的区间外止损、对侧区间前止盈；三根 K 线后走势的非重叠历史分类；样本门槛、止损距离和毛盈亏比门槛。历史分类频率不是交易胜率，原策略本来也不是完整实现所给指南。

本次：合并相近的历史拐点，记录触及次数；由已完成的两根收盘确认前高/前低的角色转换；区间与 EMA20/50/200、确认拐点构成的 Fib 回调重合时记录依据，但不凭均线或 Fib 凭空创造止损目标；计算 Wilder RSI14、MACD12/26/9，基于已确认的局部极值识别 RSI 常规与隐性背离；要求同向价格变化和动量或吞没/长影线形态确认。超过入场结构 1.5 ATR 时不追价。保持既有历史频率和盈亏比定义，不将新增过滤误称为经过验证的胜率。

区间触及次数代表本观察窗口内确认拐点次数，不等于订单量或独立买卖参与者人数。Fib 用窗口内确认高低点作锚，仍存在窗口和锚点选择敏感性。MACD 热身来自输入序列首个收盘，RSI 使用 Wilder 平滑。背离只是辅助信息；不自动买入、卖出或调整仓位。

参考：支撑压力角色转换见 [Fidelity](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/support-and-resistance?print=true-0)，RSI 趋势区间与背离见 [Fidelity RSI](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/RSI)。

尚未实现：真实多周期一致性过滤、逐笔 Volume Profile/POC、链上 MVRV/交易所流量、资金费率和 OI、按美股现金市场交易时段识别缺口、交易费用与资金费的净收益模型。当前使用 OKX 永续合约行情，即便代码对应美股公司，也不是直接分析该股票交易所现货。波段胜率需要按市场、周期、费用与止盈止损实际先后顺序做样本外回测；不能用“指标多”推导 60%–70% 胜率。1.5 ATR 等新增阈值是可审查的策略选择，未通过样本外优化认证。

## 手机与下载

仓库有 `site.webmanifest`、standalone 模式、Apple 主屏图标与安全区设置，没有 APK/IPA、原生平台工程或 Service Worker 注册。目前是网页及添加主屏的 Web App，不能称为所有型号通用的原生下载包。

| 场景 | 代码审查结论 | 限制 |
| --- | --- | --- |
| iPhone Safari 与主屏 Web App | 有专门入口、viewport、安全区和手机模式 | Safari/系统版本及键盘行为需真机检查 |
| Android Chrome / Samsung Internet | 有响应式布局与 Manifest | 目前 Manifest 仅明确声明 180px PNG 和 SVG，缺标准 192/512 PNG；外网安装要求 HTTPS |
| 小米、OPPO、vivo、荣耀等浏览器 | 网页可作为测试目标 | 安装入口、WebView 版本、后台限制不同，不能由品牌推断兼容 |
| 华为及 HarmonyOS 浏览器 | 可检查网页路径 | 没有原生 HarmonyOS 工程，不能宣称原生安装支持 |
| 微信/QQ 等内置浏览器 | 需单独检查 | 主屏安装、触摸、音频、系统权限与独立浏览器有差异 |
| 折叠屏、平板、旧手机 | 尚未认证 | 需测试折叠展开、分屏、浏览器新 CSS 支持、GPU/内存限制 |

动态检查覆盖 320、360、375、390、393、412、430、480 CSS 像素宽度：手机识别、布局变量与横屏后模式保持通过。这是模拟设备几何检查，不是渲染截图、真实软键盘、异形屏、原生安装或稳定性实测。

安装要求和平台差异依据 [MDN：Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)。Service Worker 并非所有浏览器安装的必需条件；当前缺少它意味着没有由它提供的离线资源体验。行情本身仍需联网。

建议验收顺序：先补 192/512 安装图标并确认生产 HTTPS；选 iPhone 小屏/大屏、Android 360/412 宽度、至少一个低内存机与折叠屏；分别验证浏览器和主屏模式的安装、登录、键盘搜索、卡兜拖出、左右翻牌、资料页、断网恢复和连续运行。旧浏览器的新 CSS 功能需要降级，不可仅靠 Manifest 保证兼容。

## 验证与备份

策略测试涵盖区间合并、角色转换、Wilder RSI、背离不直接触发、动量门槛、追价距离和历史前缀隔离；手机端与电脑端模型一致性通过。最大 6000 根 K 线计算在本电脑用时随 JIT 热身变化，不能推断手机帧率。保留了 artifacts/strategy-guide-backup-20261012 下的改动前源文件。

回归记录：两项策略测试、手机/电脑模型一致性及设备尺寸矩阵通过；24 项移动端测试通过。mobile-entry.test.cjs 的一个旧断言仍要求把 70vw 固化为 299.6px，而当前设备样式使用 --phone-layout-width 变量计算，该断言失败。此次没有修改 theme.js；这项失败需在更新该测试预期后重新验证，不能声称全套测试均通过。
