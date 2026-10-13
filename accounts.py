"""Small local account store for the market dashboard."""

import hashlib
import hmac
import json
import math
import re
import secrets
import sqlite3
import time
from datetime import datetime
from zoneinfo import ZoneInfo
from contextlib import contextmanager
from pathlib import Path
from ashare_market import is_symbol as is_ashare_symbol

SESSION_SECONDS = 30 * 86400
MAX_GROUP_ASSETS = 50
USERNAME = re.compile(r"[A-Za-z0-9_]{3,32}\Z")
SYMBOL = re.compile(r"[A-Z0-9]{1,15}\Z")
PASSWORD_LETTER = re.compile(r"[A-Za-z]")
PASSWORD_DIGIT = re.compile(r"[0-9]")
TIMEFRAMES = {"1m", "5m", "15m", "1h", "2h", "4h", "6h", "1d", "2d", "1w", "1M"}


def clean_state(raw):
    """Allow only the dashboard preferences that a user can edit."""
    if not isinstance(raw, dict):
        raise ValueError("账户数据格式无效")
    groups = []
    group_ids = set()
    raw_groups = raw.get("groups") if isinstance(raw.get("groups"), list) else []
    for row in raw_groups[:10]:
        if not isinstance(row, dict):
            continue
        group_id, name = row.get("id"), row.get("name")
        if (isinstance(group_id, str) and re.fullmatch(r"(?:main|g[a-z0-9]{1,20})", group_id)
                and isinstance(name, str) and 1 <= len(name.strip()) <= 24
                and group_id not in group_ids):
            groups.append({"id": group_id, "name": "自选" if group_id == "main" else
                           "热门" if group_id == "ghot" else name.strip()})
            if group_id != "ghot":
                for key in ("petSlot", "petKind"):
                    value = row.get(key)
                    if type(value) is int and 0 <= value < (8 if key == "petKind" else 5):
                        groups[-1][key] = value
                pet_name = row.get("petName")
                if isinstance(pet_name, str) and 1 <= len(pet_name.strip()) <= 12:
                    groups[-1]["petName"] = pet_name.strip()
            group_ids.add(group_id)
    if "main" not in group_ids:
        groups = groups[:9]
        groups.insert(0, {"id": "main", "name": "自选"})
        group_ids.add("main")
        group_ids = {group["id"] for group in groups}
    assets = []
    seen = set()
    raw_assets = raw.get("assets") if isinstance(raw.get("assets"), list) else []
    group_counts = {}
    for row in raw_assets:
        if not isinstance(row, dict):
            continue
        symbol = row.get("symbol")
        if row.get("type") not in ("swap", "ashare") or not isinstance(symbol, str) or not SYMBOL.fullmatch(symbol) or (row.get("type")=="ashare" and not is_ashare_symbol(symbol)):
            continue
        group_id = row.get("groupId")
        group_id = group_id if isinstance(group_id, str) and group_id in group_ids else "main"
        kind="ashare" if is_ashare_symbol(symbol) else row["type"]
        key = (group_id, kind, symbol)
        if key in seen or group_counts.get(group_id, 0) >= MAX_GROUP_ASSETS:
            continue
        assets.append({"type": kind, "symbol": symbol,
                       "groupId": group_id,
                       "pinned": row.get("pinned") is True})
        if type(row.get("cardColor")) is int and 0 <= row["cardColor"] < 100:
            assets[-1]["cardColor"] = row["cardColor"]
        seen.add(key)
        group_counts[group_id] = group_counts.get(group_id, 0) + 1
    selected = raw.get("selected")
    if isinstance(selected,str) and selected.startswith("swap:") and is_ashare_symbol(selected[5:]):
        selected="ashare:"+selected[5:]
    if not isinstance(selected, str) or selected not in {f"{row['type']}:{row['symbol']}" for row in assets}:
        selected = f"{assets[0]['type']}:{assets[0]['symbol']}" if assets else ""
    active_group = raw.get("activeGroup")
    if active_group not in group_ids:
        active_group = "main"
    toggles = raw.get("toggles") if isinstance(raw.get("toggles"), dict) else {}
    targets = {}
    valid_asset_ids = {f"{row['type']}:{row['symbol']}" for row in assets}
    raw_targets = raw.get("targets") if isinstance(raw.get("targets"), dict) else {}
    for key, value in raw_targets.items():
        if isinstance(key, str) and key in valid_asset_ids and isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and 0 < value < 1e12:
            targets[key] = value
    swing = raw.get("swing")
    timeframe = raw.get("tf")
    scheme = raw.get("scheme")
    return {"assets": assets, "groups": groups, "activeGroup": active_group, "selected": selected,
            "tf": timeframe if isinstance(timeframe, str) and timeframe in TIMEFRAMES else "1d",
            "scheme": scheme if isinstance(scheme, str) and scheme in ("redUp", "greenUp") else "redUp",
            "swing": swing if swing in (0.5, 1, 2, 3, 5) else 1,
            "toggles": {name: toggles.get(name) is not False for name in ("volume", "levels", "fib", "ma")},
            "targets": targets}


class AccountStore:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._db() as db:
            db.execute("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT NOT NULL, username_key TEXT NOT NULL UNIQUE, salt BLOB NOT NULL, password_hash BLOB NOT NULL, state TEXT)")
            db.execute("CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id))")
            columns = {row[1] for row in db.execute("PRAGMA table_info(users)")}
            if "space_id" not in columns:
                db.execute("ALTER TABLE users ADD COLUMN space_id TEXT")
            if "state_updated" not in columns:
                db.execute("ALTER TABLE users ADD COLUMN state_updated INTEGER NOT NULL DEFAULT 0")
            if "public_id" not in columns:
                db.execute("ALTER TABLE users ADD COLUMN public_id TEXT")
            if "avatar_kind" not in columns:
                db.execute("ALTER TABLE users ADD COLUMN avatar_kind INTEGER NOT NULL DEFAULT 0")
                for user_id, payload in db.execute("SELECT id,state FROM users WHERE state IS NOT NULL").fetchall():
                    try:
                        old = json.loads(payload)
                        kind = next((g.get("petKind", 0) for g in old.get("groups", []) if g.get("id") == "main"), 0)
                        if type(kind) is int and 0 <= kind < 8:
                            db.execute("UPDATE users SET avatar_kind=? WHERE id=?", (kind, user_id))
                    except (ValueError, TypeError, AttributeError):
                        pass
            if "avatar_changed_day" not in columns:
                db.execute("ALTER TABLE users ADD COLUMN avatar_changed_day TEXT")
            for (user_id,) in db.execute("SELECT id FROM users WHERE space_id IS NULL"):
                db.execute("UPDATE users SET space_id=? WHERE id=?", (secrets.token_urlsafe(12), user_id))
            for (user_id,) in db.execute("SELECT id FROM users WHERE public_id IS NULL"):
                db.execute("UPDATE users SET public_id=? WHERE id=?", ("U" + secrets.token_hex(10).upper(), user_id))
            db.execute("CREATE UNIQUE INDEX IF NOT EXISTS users_public_id_unique ON users(public_id)")
        try:
            self.path.chmod(0o600)
        except OSError:
            pass

    @contextmanager
    def _db(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.execute("PRAGMA foreign_keys = ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def _password_hash(password, salt):
        return hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1)

    @staticmethod
    def _validate_new_password(password):
        if (not isinstance(password, str) or not 8 <= len(password) <= 128
                or not PASSWORD_LETTER.search(password) or not PASSWORD_DIGIT.search(password)):
            raise ValueError("密码至少 8 位，且须包含字母和数字")

    def register(self, username, password, avatar_kind=0):
        if not isinstance(username, str) or not USERNAME.fullmatch(username):
            raise ValueError("用户名需要 3–32 位英文字母、数字或下划线")
        self._validate_new_password(password)
        if type(avatar_kind) is not int or not 0 <= avatar_kind < 8:
            raise ValueError("请选择有效的人物形象")
        salt = secrets.token_bytes(16)
        try:
            with self._db() as db:
                cursor = db.execute("INSERT INTO users(username, username_key, salt, password_hash, space_id, public_id, avatar_kind) VALUES(?,?,?,?,?,?,?)",
                                    (username, username.casefold(), salt, self._password_hash(password, salt),
                                     secrets.token_urlsafe(12), "U" + secrets.token_hex(10).upper(), avatar_kind))
                user_id = cursor.lastrowid
        except sqlite3.IntegrityError as exc:
            raise ValueError("用户名已被使用") from exc
        token = self._new_session(user_id)
        return self.session(token), token

    def _public_user(self, user_id):
        with self._db() as db:
            row = db.execute("SELECT username, state, space_id, state_updated, public_id, avatar_kind, avatar_changed_day FROM users WHERE id=?", (user_id,)).fetchone()
        return {"username": row[0], "state": json.loads(row[1]) if row[1] else None,
                "spaceId": row[2], "stateUpdated": row[3], "userId": row[4],
                "avatarKind": row[5], "avatarChangedDay": row[6], "avatarCanChange": row[6] != self._avatar_day()}

    @staticmethod
    def _avatar_day():
        return datetime.fromtimestamp(time.time(), ZoneInfo("Asia/Shanghai")).date().isoformat()

    def change_avatar(self, user_id, kind):
        if type(kind) is not int or not 0 <= kind < 8:
            raise ValueError("请选择有效的人物形象")
        with self._db() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT avatar_kind,avatar_changed_day FROM users WHERE id=?", (user_id,)).fetchone()
            if not row:
                raise ValueError("账号不存在")
            if kind != row[0]:
                today = self._avatar_day()
                if row[1] == today:
                    raise ValueError("今天已修改过人物形象，请明天再修改")
                db.execute("UPDATE users SET avatar_kind=?,avatar_changed_day=? WHERE id=?", (kind, today, user_id))
        return self._public_user(user_id)

    def login(self, username, password):
        if (not isinstance(username, str) or not USERNAME.fullmatch(username)
                or not isinstance(password, str) or not 1 <= len(password) <= 128):
            raise ValueError("用户名或密码不正确")
        with self._db() as db:
            row = db.execute("SELECT id, username, salt, password_hash FROM users WHERE username_key=?",
                             (username.casefold(),)).fetchone()
        if not row or not hmac.compare_digest(self._password_hash(password, row[2]), row[3]):
            raise ValueError("用户名或密码不正确")
        token = self._new_session(row[0])
        return self.session(token), token

    def change_password(self, user_id, current_password, new_password, token):
        self._validate_new_password(new_password)
        if not isinstance(current_password, str) or not 1 <= len(current_password) <= 128:
            raise ValueError("当前密码不正确")
        with self._db() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT salt, password_hash FROM users WHERE id=?", (user_id,)).fetchone()
            if not row or not hmac.compare_digest(self._password_hash(current_password, row[0]), row[1]):
                raise ValueError("当前密码不正确")
            salt = secrets.token_bytes(16)
            db.execute("UPDATE users SET salt=?, password_hash=? WHERE id=?",
                       (salt, self._password_hash(new_password, salt), user_id))
            db.execute("DELETE FROM sessions WHERE user_id=? AND token_hash<>?",
                       (user_id, hashlib.sha256(token.encode()).hexdigest()))

    def _new_session(self, user_id):
        token = secrets.token_urlsafe(32)
        with self._db() as db:
            db.execute("DELETE FROM sessions WHERE expires < ?", (int(time.time()),))
            db.execute("INSERT INTO sessions(token_hash, user_id, expires) VALUES(?,?,?)",
                       (hashlib.sha256(token.encode()).hexdigest(), user_id, int(time.time()) + SESSION_SECONDS))
        return token

    def session(self, token):
        if not token or len(token) > 128:
            return None
        digest = hashlib.sha256(token.encode()).hexdigest()
        with self._db() as db:
            row = db.execute("SELECT users.id FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires>?",
                             (digest, int(time.time()))).fetchone()
        if not row:
            return None
        user = self._public_user(row[0])
        user["spaceId"] = hmac.new(user["spaceId"].encode("utf-8"),
                                    token.encode("utf-8"), hashlib.sha256).hexdigest()[:24]
        return {"id": row[0], **user}

    def save_state(self, user_id, raw):
        state = clean_state(raw)
        with self._db() as db:
            db.execute("BEGIN IMMEDIATE")
            current = db.execute("SELECT state_updated FROM users WHERE id=?", (user_id,)).fetchone()
            if not current:
                raise ValueError("账号不存在")
            expected = raw.get("expectedUpdated")
            if expected is not None and expected != current[0]:
                raise StateConflict()
            revision = max(time.time_ns() // 1_000_000, current[0] + 1)
            db.execute("UPDATE users SET state=?, state_updated=? WHERE id=?", (json.dumps(state, ensure_ascii=False, separators=(",", ":")), revision, user_id))
        return state


    def logout(self, token):
        if token:
            with self._db() as db:
                db.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))


class StateConflict(Exception):
    """The browser edited an older account revision."""
