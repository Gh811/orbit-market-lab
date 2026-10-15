"""Check mobile resources through the actual application's static allowlist."""
import unittest
import server


class MobileAssetTests(unittest.TestCase):
    def request(self, path):
        handler = object.__new__(server.Handler)
        handler.headers = {"Host": "localhost"}
        handler.path = path
        handler.respond = lambda status, body, mime="application/json; charset=utf-8", **kwargs: (status, body, mime)
        return handler.do_GET()

    def test_mobile_feedback_script_is_served(self):
        status, body, mime = self.request('/assets/touch.js?v=mobile')
        self.assertEqual(status, 200)
        self.assertIn('javascript', mime)
        self.assertIn(b'MarketTouch', body)

    def test_pet_atlas_is_served_as_png(self):
        status, body, mime = self.request('/assets/pets/mascots-3d-v1.png')
        self.assertEqual(status, 200)
        self.assertEqual(mime, 'image/png')
        self.assertTrue(body.startswith(b'\x89PNG\r\n\x1a\n'))

    def test_individual_companions_are_served(self):
        for name in ['rabbit', 'robot', 'rover', 'meteor', 'comet', 'saturn', 'crystal', 'ghost']:
            with self.subTest(name=name):
                status, body, mime = self.request('/assets/pets/space-' + name + '-3d-v1.png?v=companions')
                self.assertEqual(status, 200)
                self.assertEqual(mime, 'image/png')
                self.assertTrue(body.startswith(b'\x89PNG\r\n\x1a\n'))
                self.assertEqual(self.request('/assets/icons/crypto/space' + name + '.png')[0], 200)

    def test_market_request_module_is_served(self):
        status, body, mime = self.request('/assets/data.js?v=data')
        self.assertEqual(status, 200)
        self.assertIn('javascript', mime)
        self.assertIn(b'MarketData', body)

    def test_local_newspaper_icon_is_served(self):
        status, body, mime = self.request('/assets/icons/crypto/newspaper.svg')
        self.assertEqual(status, 200)
        self.assertEqual(mime, 'image/svg+xml')
        self.assertIn(b'<svg', body)
        self.assertIn(b'#e7d3a8', body)

    def test_android_download_page_and_client_update_assets_are_public(self):
        for path,mime_part in [('/download','html'),('/assets/download.css','css'),('/assets/client-update.js','javascript')]:
            status,body,mime=self.request(path)
            self.assertEqual(status,200)
            self.assertIn(mime_part,mime)
            self.assertTrue(body)

    def test_device_routing_keeps_desktop_downloads_separate_from_mobile(self):
        cases=[('Mozilla/5.0 (Windows NT 10.0; Win64; x64)','/',b'download.css',b'assets/app.js'),
               ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)','/',b'device-entry.js',b'assets/app.js'),
               ('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)','/',b'assets/app.js',b'assets/device-entry.js'),
               ('Mozilla/5.0 (Linux; Android 13; Tablet)','/',b'download.css',b'assets/app.js'),
               ('Mozilla/5.0 (Linux; Android 13; Tablet)','/?device=mobile',b'download.css',b'assets/app.js'),
               ('Mozilla/5.0 (Linux; Android 13; Tablet) OrbitAndroid/1.0.0','/',b'assets/app.js',b'authDownloadLink'),
               ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)','/?device=mobile',b'assets/app.js',b'assets/device-entry.js'),
               ('Mozilla/5.0 (Windows NT 10.0; Win64; x64)','/backtest/',b'download.css',b'backtest/app.js')]
        for agent,path,present,absent in cases:
            with self.subTest(agent=agent,path=path):
                handler=object.__new__(server.Handler);handler.headers={'Host':'localhost','User-Agent':agent};handler.path=path
                handler.respond=lambda status,body,mime='application/json',**kwargs:(status,body,mime)
                status,body,mime=handler.do_GET()
                self.assertEqual(status,200);self.assertIn(present,body);self.assertNotIn(absent,body)

    def test_old_client_is_blocked_until_it_updates(self):
        from unittest.mock import patch
        with patch.object(server,'required_client_release',return_value='release-b'):
            handler=object.__new__(server.Handler);handler.headers={'Host':'localhost','X-Orbit-Release':'release-a'};handler.path='/api/auth/session'
            responses=[]
            handler.respond=lambda status,body,mime='application/json',**kwargs:responses.append((status,body,mime))
            handler.do_GET();status,body,mime=responses[-1]
            self.assertEqual(status,401);self.assertTrue(body['updateRequired']);self.assertEqual(body['requiredRelease'],'release-b')
            handler.path='/api/auth/login';handler.do_POST()
            self.assertEqual(handler.require_current_client(),True)
            handler.headers['X-Orbit-Release']='release-b'
            self.assertFalse(handler.require_current_client())

    def test_unlisted_files_remain_private(self):
        for path in ['/assets/pets/../../server.py', '/.market_accounts.sqlite3', '/assets/pets/missing.png']:
            with self.subTest(path=path):
                self.assertEqual(self.request(path)[0], 404)


if __name__ == '__main__':
    unittest.main()
