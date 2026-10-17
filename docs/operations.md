# 运行与数据维护

本文面向项目维护者。日常使用、功能与快速启动见 [项目首页](../README.md)。所有命令均在项目根目录执行。

## 标的资料预采集

公开目录先入库，随后分批保存简介、官网与图标。默认并发为 2，任务可续采；不会批量下载 K 线。

```bash
# 常规预采集
python3 scripts/prefill-assets.py

# 优先补齐资料与官网
python3 scripts/prefill-assets.py \
  --batch-profiles --retry-incomplete --metadata-only

# 检查并补采缺失图标
python3 scripts/prefill-assets.py \
  --logos-only --include-missing-logos

# 核对实际资料完整性
python3 scripts/audit-asset-library.py
```

资料和图标写入行情数据库。资料阶段进度见 `.asset_metadata_status.json`，图标阶段见 `.asset_prefill_status.json`；进度文件不上传 GitHub。目录数量、已完成尝试数量和完整资料数量是不同指标，以审核报告为准。失败请求不会覆盖已核实的有效资料。

## 导出与迁移公开资料库

```bash
# 导出当前已保存的公开资料
python3 scripts/transfer-asset-library.py export

# 在目标服务器导入；将下方路径替换为实际绝对路径
python3 scripts/transfer-asset-library.py import \
  --snapshot /srv/orbit/asset-library.sqlite3 \
  --database /srv/orbit/.market_data.sqlite3
```

默认导出文件位于 `.local-data/asset-library-日期时间.sqlite3`。导出使用一致的读取快照，包含公开目录、简介、官网、图标原始字节及资料响应，不含用户账户与 K 线历史。采集期间也可以导出，但仅代表导出时已保存的内容；导入按时间合并，旧资料不会覆盖新资料。

目标服务通过 `MARKET_DATA_DB` 指向导入后的数据库。完整应用迁移还需单独备份账户和行情数据库；请使用 SQLite backup API，或停止服务后备份主库及相应日志，详见 [数据库维护](database-maintenance.md)。

## 缓存边界

手机端资料与图标优先复用本地副本，完整资料允许按 30 天周期检查更新；不完整条目有限重试。自选项受保护，非自选项闲置 30 天后可逐步清理。客户端清理不会删除服务器已采集资料。

客户端缓存按浏览器和域名隔离。更换域名、清理浏览器数据或系统回收存储后，需要重新建立缓存；缓存不可用时仍可读取服务端资料。报价和 K 线使用独立更新逻辑，旧行情会标注缓存状态。账户接口、新闻与登录信息不进入公共标的资料缓存。

## 固定版本发布

```bash
# 构建独立代码快照
python3 scripts/build-release.py

# 查看正在运行的服务版本；端口按实际配置修改
curl --fail --silent http://127.0.0.1:8001/api/status
```

快照保存在 `.releases/`，`release.json` 记录文件校验值与版本身份。数据库、凭据、日志和本地缓存不进入代码快照。正式服务从快照启动，后续工作区编辑不会改变正在运行的界面。

已有本地服务可用以下工具切换版本，参数需填写当前本应用的 PID 与已确认域名：

```bash
read -r -p "当前本应用服务 PID: " app_pid
read -r -p "已确认的访问域名: " app_host

python3 scripts/start-local-release.py \
  --replace-pid "$app_pid" \
  --public-host "$app_host"
```

按提示输入当前本应用服务的 PID 与已确认域名。脚本保留原数据库路径，将运行日志和状态放在 `.local-data/runtime/`，可更新公开目录放在 `.local-data/catalogs/`。状态接口中的 `releaseId`、`sourceHash`、`gitCommit` 和 `gitDirty` 用于核对代码来源；`gitDirty` 为真表示快照含未提交的本地改动。

JS、CSS 引用按实际内容生成版本号，只有版本匹配的资源长期缓存。HTML、账户与实时接口不使用长期缓存。服务器上的自动部署与回退流程见 [部署说明](服务器发布与安卓客户端.md)。
