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

    def test_unlisted_files_remain_private(self):
        for path in ['/assets/pets/../../server.py', '/.market_accounts.sqlite3', '/assets/pets/missing.png']:
            with self.subTest(path=path):
                self.assertEqual(self.request(path)[0], 404)


if __name__ == '__main__':
    unittest.main()
