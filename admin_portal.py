"""Separate administrator sessions; public accounts never grant admin access."""
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import urlsplit

_FAILURES = {}
_LOCK = threading.Lock()


def _digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def _session(store, token):
    if not token or len(token)>128:
        return None
    with store._db() as db:
        return db.execute('SELECT csrf FROM admin_sessions WHERE token_hash=? AND expires>?',(_digest(token),int(time.time()))).fetchone()


BAN_REASONS=[{'id':'spam','label':'垃圾信息或恶意推广'},{'id':'harassment','label':'辱骂、骚扰其他用户'},{'id':'abuse','label':'恶意请求，影响服务运行'},{'id':'security','label':'冒用身份或账号存在安全风险'},{'id':'rules','label':'违反平台使用规则'},{'id':'other','label':'其他原因'}]


def stats(store):
    now=int(time.time())
    with store._db() as db:
        total=db.execute('SELECT COUNT(*) FROM users').fetchone()[0]
        online=db.execute('SELECT COUNT(DISTINCT user_id) FROM sessions WHERE expires>? AND last_seen>=?',(now,now-120)).fetchone()[0]
        rows=db.execute("SELECT u.id,u.public_id,u.username,u.banned,MAX(s.last_seen),u.ban_reason,u.banned_at,u.ip_region FROM users u LEFT JOIN sessions s ON s.user_id=u.id AND s.expires>? GROUP BY u.id ORDER BY CASE WHEN MAX(s.last_seen)>=? AND u.banned=0 THEN 0 WHEN u.banned=0 THEN 1 ELSE 2 END,u.id DESC LIMIT 200",(now,now-120)).fetchall()
        regions=db.execute("SELECT ip_region,COUNT(*) FROM users GROUP BY ip_region ORDER BY COUNT(*) DESC,ip_region").fetchall()
    return {'totalUsers':total,'onlineUsers':online,'onlineWindowSeconds':120,'banReasons':BAN_REASONS,'regions':[{'region':r[0],'users':r[1]} for r in regions],'users':[{'id':r[0],'userId':r[1],'username':r[2],'banned':bool(r[3]),'online':bool(not r[3] and r[4] and r[4]>=now-120),'banReason':r[5],'bannedAt':r[6],'ipRegion':r[7]} for r in rows]}


def offline_all(store):
    with store._db() as db:
        db.execute('BEGIN IMMEDIATE')
        count=db.execute('SELECT COUNT(DISTINCT user_id) FROM sessions WHERE expires>?',(int(time.time()),)).fetchone()[0]
        db.execute('DELETE FROM sessions')
    return count


def is_admin_name(store,username):
    if not isinstance(username,str):return False
    try:
        config=json.loads(Path(os.environ.get('MARKET_ADMIN_CONFIG',str(store.path.with_name('admin-credentials.json')))).read_text())
        return username.casefold()==config['username'].casefold()
    except (OSError,ValueError,KeyError):return False


def handle(handler,store,root,path,body=None):
    if path not in ('/admin','/admin/','/assets/admin.js','/assets/admin.css','/assets/admin-control.svg','/assets/admin.webmanifest','/assets/admin-icon-180.png','/assets/admin-icon-192.png','/assets/admin-icon-512.png') and not path.startswith('/api/admin/'):
        return False
    if handler.command=='GET' and path in ('/admin','/admin/','/assets/admin.js','/assets/admin.css','/assets/admin-control.svg','/assets/admin.webmanifest','/assets/admin-icon-180.png','/assets/admin-icon-192.png','/assets/admin-icon-512.png'):
        name='admin.html' if path in ('/admin','/admin/') else path.lstrip('/')
        mime='image/png' if name.endswith('.png') else 'application/manifest+json' if name.endswith('.webmanifest') else 'image/svg+xml' if name.endswith('.svg') else 'text/html' if name.endswith('.html') else 'text/css' if name.endswith('.css') else 'application/javascript'
        handler.respond(200,(root/name).read_bytes(),mime if mime.startswith('image/') else mime+'; charset=utf-8');return True
    if path not in ('/api/admin/session','/api/admin/login','/api/admin/logout','/api/admin/offline-all','/api/admin/user-status','/api/admin/offline-user'):
        handler.respond(404,{'error':'页面不存在'});return True
    with store._db() as db:
        db.execute('CREATE TABLE IF NOT EXISTS admin_sessions(token_hash TEXT PRIMARY KEY,csrf TEXT NOT NULL,expires INTEGER NOT NULL)')
    cookie=SimpleCookie()
    try:cookie.load(handler.headers.get('Cookie',''));token=cookie['orbit_admin'].value if 'orbit_admin' in cookie else ''
    except Exception:token=''
    secure='; Secure' if handler.headers.get('X-Forwarded-Proto','').lower()=='https' else ''
    def set_cookie(value='',clear=False):
        return f'orbit_admin={value}; Path=/; HttpOnly; SameSite=Strict; Max-Age={0 if clear else 28800}'+secure
    if handler.command=='POST':
        origin=handler.headers.get('Origin','')
        if origin and urlsplit(origin).netloc.lower()!=handler.headers.get('Host','').lower():
            handler.respond(403,{'error':'请求来源无效'});return True
        if handler.headers.get('Content-Type','').split(';')[0]!='application/json':
            handler.respond(415,{'error':'请求格式无效'});return True
        try:
            size=int(handler.headers.get('Content-Length','0'))
            if not 0<size<=4096:raise ValueError()
            body=json.loads(handler.rfile.read(size))
            if not isinstance(body,dict):raise ValueError()
        except (ValueError,TypeError):
            handler.respond(400,{'error':'请求内容无效'});return True
    if path=='/api/admin/login' and handler.command=='POST':
        address=handler.client_address[0];now=time.time()
        with _LOCK:
            attempts=[v for v in _FAILURES.get(address,[]) if now-v<60]
            if len(attempts)>=5:
                handler.respond(429,{'error':'尝试过多，请 1 分钟后再试'});return True
            if len(_FAILURES)>1000:_FAILURES.pop(next(iter(_FAILURES)))
            _FAILURES[address]=attempts+[now]
        try:
            config=json.loads(Path(os.environ.get('MARKET_ADMIN_CONFIG',str(store.path.with_name('admin-credentials.json')))).read_text())
            password=body.get('password','');username=body.get('username','')
            if not isinstance(password,str) or len(password)>128 or not isinstance(username,str):raise ValueError()
            candidate=hashlib.pbkdf2_hmac('sha256',password.encode(),bytes.fromhex(config['salt']),600000).hex()
            valid=hmac.compare_digest(candidate,config['hash']) and hmac.compare_digest(username.encode(),config['username'].encode())
        except (OSError,KeyError,ValueError):
            handler.respond(503,{'error':'管理员入口尚未配置'});return True
        if not valid:
            handler.respond(401,{'error':'账号或密码不正确'});return True
        with _LOCK:_FAILURES.pop(address,None)
        token=secrets.token_urlsafe(32);csrf=secrets.token_urlsafe(32)
        with store._db() as db:
            db.execute('DELETE FROM admin_sessions WHERE expires<=?',(int(now),))
            db.execute('INSERT INTO admin_sessions VALUES(?,?,?)',(_digest(token),csrf,int(now)+28800))
        handler.respond(200,{'authenticated':True,'csrf':csrf,**stats(store)},cookie=set_cookie(token));return True
    session=_session(store,token)
    if not session:
        handler.respond(401,{'error':'请登录管理后台'});return True
    if path=='/api/admin/session' and handler.command=='GET':
        handler.respond(200,{'authenticated':True,'csrf':session[0],**stats(store)});return True
    if handler.command=='POST' and not hmac.compare_digest(handler.headers.get('X-Admin-CSRF',''),session[0]):
        handler.respond(403,{'error':'操作验证已失效，请刷新后台'});return True
    if path=='/api/admin/user-status' and handler.command=='POST':
        user_id=body.get('userId');banned=body.get('banned')
        if type(user_id) is not int or type(banned) is not bool:
            handler.respond(400,{'error':'用户状态参数无效'});return True
        reason=''
        if banned:
            selection=next((r for r in BAN_REASONS if r['id']==body.get('reason')),None)
            note=body.get('note','')
            if not selection or not isinstance(note,str) or len(note)>120 or selection['id']=='other' and not note.strip():
                handler.respond(400,{'error':'请选择封禁理由，其他原因需要填写说明'});return True
            reason=note.strip() if selection['id']=='other' else selection['label']
        with store._db() as db:
            db.execute('BEGIN IMMEDIATE')
            if not db.execute('SELECT id FROM users WHERE id=?',(user_id,)).fetchone():
                handler.respond(404,{'error':'账号不存在'});return True
            db.execute('UPDATE users SET banned=?,ban_reason=?,banned_at=? WHERE id=?',(int(banned),reason,int(time.time()) if banned else 0,user_id))
            if banned:db.execute('DELETE FROM sessions WHERE user_id=?',(user_id,))
        handler.respond(200,stats(store));return True
    if path=='/api/admin/offline-user' and handler.command=='POST':
        user_id=body.get('userId')
        if type(user_id) is not int:
            handler.respond(400,{'error':'用户参数无效'});return True
        with store._db() as db:
            db.execute('BEGIN IMMEDIATE')
            if not db.execute('SELECT id FROM users WHERE id=?',(user_id,)).fetchone():
                handler.respond(404,{'error':'账号不存在'});return True
            db.execute('DELETE FROM sessions WHERE user_id=?',(user_id,))
        handler.respond(200,stats(store));return True
    if path=='/api/admin/offline-all' and handler.command=='POST':
        count=offline_all(store)
        handler.respond(200,{'offlineUsers':count,**stats(store)});return True
    if path=='/api/admin/logout' and handler.command=='POST':
        with store._db() as db:db.execute('DELETE FROM admin_sessions WHERE token_hash=?',(_digest(token),))
        handler.respond(200,{'ok':True},cookie=set_cookie(clear=True));return True
    handler.respond(405,{'error':'不支持的操作'});return True
