import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from accounts import AccountStore


class AdminPortalTest(unittest.TestCase):
    def test_separate_authority_ban_and_offline(self):
        with tempfile.TemporaryDirectory() as folder:
            folder=Path(folder);db=folder/'accounts.sqlite3';store=AccountStore(db)
            user,old_token=store.register('ordinary123','SamplePassword100')
            salt=secrets.token_bytes(32);config=folder/'admin.json'
            config.write_text(json.dumps({'username':'fixtureAdmin','salt':salt.hex(),'hash':hashlib.pbkdf2_hmac('sha256',b'FixturePassword100',salt,600000).hex()}))
            env={**os.environ,'MARKET_PORT':'8140','MARKET_ACCOUNT_DB':str(db),'MARKET_DATA_DB':str(folder/'market.sqlite3'),'MARKET_ADMIN_CONFIG':str(config),'MARKET_LOGO_CACHE_DIR':str(folder/'logos')}
            with (folder/'server.log').open('w') as log:
                process=subprocess.Popen([sys.executable,'server.py'],cwd=Path(__file__).resolve().parents[1],env=env,stdout=log,stderr=log)
                try:
                    base='http://127.0.0.1:8140';client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
                    def request(path,body=None,headers=None):
                        req=urllib.request.Request(base+path,data=None if body is None else json.dumps(body).encode(),headers={**({'Content-Type':'application/json'} if body is not None else {}),**(headers or {})})
                        try:r=client.open(req,timeout=10)
                        except urllib.error.HTTPError as e:r=e
                        content=r.read();return r.status,json.loads(content) if r.headers.get('Content-Type','').startswith('application/json') else content
                    for _ in range(100):
                        try:
                            if request('/api/status')[0]==200:break
                        except OSError:time.sleep(.1)
                    else:self.fail('server failed to start')
                    self.assertEqual(request('/admin')[0],200)
                    self.assertEqual(request('/api/auth/login',{'username':'fixtureAdmin','password':'FixturePassword100'})[1].get('adminRedirect'),'/admin')
                    self.assertEqual(request('/api/admin/session',headers={'Cookie':'star_session='+old_token})[0],401)
                    self.assertEqual(request('/api/admin/login',{'username':'fixtureAdmin','password':'wrong'})[0],401)
                    status,data=request('/api/admin/login',{'username':'fixtureAdmin','password':'FixturePassword100'});self.assertEqual(status,200);csrf={'X-Admin-CSRF':data['csrf']}
                    self.assertEqual(data['totalUsers'],1);self.assertEqual(data['users'][0]['username'],'ordinary123');self.assertNotIn('password_hash',str(data))
                    self.assertEqual(request('/api/admin/offline-all',{})[0],403)
                    self.assertEqual(request('/api/admin/user-status',{'userId':user['id'],'banned':True,'reason':'abuse'},{**csrf,'Origin':'https://evil.test'})[0],403)
                    self.assertEqual(request('/api/admin/user-status',{'userId':user['id'],'banned':True},csrf)[0],400)
                    self.assertEqual(request('/api/admin/user-status',{'userId':user['id'],'banned':True,'reason':'abuse'},csrf)[0],200)
                    status,banned=request('/api/auth/login',{'username':'ordinary123','password':'SamplePassword100'});self.assertEqual(status,403);self.assertTrue(banned['accountBanned']);self.assertIn('恶意请求',banned['error']);self.assertIsNone(store.session(old_token))
                    self.assertEqual(request('/api/admin/user-status',{'userId':user['id'],'banned':False},csrf)[0],200)
                    _,fresh_token=store.login('ordinary123','SamplePassword100');self.assertTrue(store.session(fresh_token))
                    self.assertEqual(request('/api/admin/offline-user',{'userId':user['id']},csrf)[0],200);self.assertIsNone(store.session(fresh_token))
                    _,fresh_token=store.login('ordinary123','SamplePassword100')
                    status,result=request('/api/admin/offline-all',{},csrf);self.assertEqual(status,200);self.assertEqual(result['offlineUsers'],1);self.assertEqual(result['onlineUsers'],0);self.assertIsNone(store.session(fresh_token));self.assertEqual(request('/api/admin/session')[0],200)
                    self.assertEqual(len(store._public_user(user['id'])['username']),len('ordinary123'))
                    for _ in range(8):self.assertEqual(request('/api/auth/login',{'username':'ordinary123','password':'wrong'})[0],401)
                    status,limited=request('/api/auth/login',{'username':'ordinary123','password':'wrong'});self.assertEqual(status,429);self.assertIn('1 分钟',limited['error'])
                    self.assertEqual(request('/api/admin/logout',{},csrf)[0],200);self.assertEqual(request('/api/admin/session')[0],401)
                finally:
                    process.terminate()
                    try:process.wait(timeout=5)
                    except subprocess.TimeoutExpired:process.kill();process.wait()


if __name__=='__main__':unittest.main()
