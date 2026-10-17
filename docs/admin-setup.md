# 后台管理部署

后台是本项目的一部分：`admin.html`、`admin_portal.py`、`assets/admin.*` 及管理图标，入口为 `/admin`。服务端导入 `ip_region.py` 与 `tools/ip2region/`，后者保留上游许可证和来源说明。

后台使用独立管理员会话，普通用户登录不会获得管理权限。提供用户列表、在线状态、地区汇总、封禁及解封、单用户下线和全部用户下线。在线状态按最近 120 秒内的会话活动统计。

## 管理员凭据

部署时在代码目录之外生成私有 JSON，并通过 `MARKET_ADMIN_CONFIG` 指定绝对路径。未配置时管理登录返回“管理员入口尚未配置”。凭据格式含 `username`、随机十六进制 `salt` 和 PBKDF2-SHA256 `hash`，迭代次数为 600000。

在服务账号可读的私有目录中运行以下命令，输入密码不会显示：

```bash
python3 - <<'PY'
import getpass, hashlib, json, os, secrets
from pathlib import Path
path = Path(input('凭据文件绝对路径：').strip()).expanduser()
if not path.is_absolute():
    raise SystemExit('需要绝对路径')
username = input('管理员用户名：').strip()
password = getpass.getpass('管理员密码：')
if not username or not 12 <= len(password) <= 128:
    raise SystemExit('用户名不能为空，密码需为 12 至 128 位')
if password != getpass.getpass('再次输入密码：'):
    raise SystemExit('两次密码不一致')
salt = secrets.token_bytes(32)
data = {'username': username, 'salt': salt.hex(), 'hash': hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 600000).hex()}
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as f:
    json.dump(data, f)
print('凭据已创建；请配置 MARKET_ADMIN_CONFIG 后重启服务')
PY
```

设置该环境变量后重启 Python 服务。后台凭据、会话数据库、真实用户记录不提交 GitHub，也不要复制到公开静态目录。

## 离线地区库

地区查询在服务器本地执行。将自行准备的兼容 ip2region 数据文件 `ip2region_v4.xdb`、`ip2region_v6.xdb` 放在 `MARKET_IP_REGION_DIR` 指定的目录。默认目录为账户数据库旁的 `ip-region/`。未配置或查询失败显示“未知”，不影响账号登录；非公网地址显示“内网”。库文件不随源码提交。

## 验证

```bash
python3 -m unittest discover -s tests -p 'test_admin_portal.py'
```

该测试使用临时数据库，覆盖管理员独立权限、来源和 CSRF 校验、封禁、解封、会话撤销及登录限流，不操作生产账号。`tests/admin-mobile-browser.cjs` 使用模拟数据检查管理界面的手机和平板布局。
