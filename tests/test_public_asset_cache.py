import hashlib,io,unittest
import server
class PublicAssetCacheTests(unittest.TestCase):
    def handler(self,headers=None,path='/assets/data.js?v=test'):
        h=object.__new__(server.Handler);h.path=path;h.headers={'Host':'localhost',**(headers or {})};h.wfile=io.BytesIO();h.status=None;h.response_headers={}
        h.send_response=lambda code:setattr(h,'status',code);h.send_header=lambda name,value:h.response_headers.update({name:value});h.end_headers=lambda:None
        return h
    def test_revalidation_sends_no_asset_body(self):
        first=self.handler();first.respond(200,b'public image','image/png',cache_seconds=86400);self.assertEqual(first.status,200)
        again=self.handler({'If-None-Match':first.response_headers['ETag']});again.respond(200,b'public image','image/png',cache_seconds=86400)
        self.assertEqual(again.status,304);self.assertEqual(again.wfile.getvalue(),b'');self.assertNotIn('Content-Length',again.response_headers)
        changed=self.handler({'If-None-Match':first.response_headers['ETag']});changed.respond(200,b'new image','image/png',cache_seconds=86400);self.assertEqual(changed.status,200)
    def test_live_and_account_json_are_not_cached(self):
        h=self.handler(path='/api/auth/session');h.respond(200,{'user':None})
        self.assertEqual(h.response_headers['Cache-Control'],'no-store');self.assertNotIn('ETag',h.response_headers)
    def test_only_content_hash_assets_get_long_cache(self):
        payload=b'changed application'
        old=self.handler(path='/assets/app.js?v=old');old.respond(200,payload,'text/javascript',cache_seconds=31536000)
        self.assertEqual(old.response_headers['Cache-Control'],'private, no-cache')
        current=self.handler(path='/assets/app.js?v='+hashlib.sha256(payload).hexdigest()[:16]);current.respond(200,payload,'text/javascript',cache_seconds=31536000)
        self.assertIn('immutable',current.response_headers['Cache-Control'])
    def test_static_script_reuses_versioned_cache_but_html_remains_live(self):
        h=self.handler();h.respond=lambda code,data,mime,**options:options;result=h.do_GET();self.assertEqual(result['cache_seconds'],31536000)
        h=self.handler(path='/');h.respond=lambda code,data,mime,**options:options;result=h.do_GET();self.assertEqual(result['cache_seconds'],0)
