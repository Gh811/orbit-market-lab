import hashlib
import tempfile
import unittest
from pathlib import Path
from release_tools import version_html, build_snapshot, release_identity


class ReleaseVersionsTest(unittest.TestCase):
    def test_page_exposes_its_own_release_for_version_checks(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'release.json').write_text('{"releaseId":"release-a"}')
            html=version_html('<html><head></head><body></body></html>',root,'/')
            self.assertIn(b'<meta name="orbit-release" content="release-a">',html)

    def test_html_uses_actual_file_version_and_changes_when_asset_changes(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); (root / 'assets').mkdir(); asset = root / 'assets/app.js'
            asset.write_text('first')
            html = b'<script src="/assets/app.js?v=old"></script>'
            one = version_html(html, root, '/')
            self.assertIn(hashlib.sha256(b'first').hexdigest()[:16].encode(), one)
            asset.write_text('second')
            two = version_html(html, root, '/')
            self.assertNotEqual(one, two)
            (root / 'backtest').mkdir(); (root / 'backtest/app.js').write_text('research')
            self.assertIn(hashlib.sha256(b'research').hexdigest()[:16].encode(), version_html(b'<script src="./app.js?v=old"></script>', root, '/backtest/'))
            self.assertEqual(version_html(b'<script src="https://example.com/app.js"></script>', root, '/'), b'<script src="https://example.com/app.js"></script>')

    def test_running_snapshot_stays_fixed_when_working_code_changes(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); (root / 'assets').mkdir(); (root / 'assets/app.js').write_text('first')
            (root / '.market_accounts.sqlite3').write_text('private accounts')
            (root / '.env').write_text('private configuration')
            release = build_snapshot(root)
            self.assertFalse((release / '.market_accounts.sqlite3').exists())
            self.assertFalse((release / '.env').exists())
            self.assertNotEqual(release_identity(release)['releaseId'], 'development')
            (root / 'assets/app.js').write_text('second')
            self.assertEqual((release / 'assets/app.js').read_text(), 'first')
            self.assertNotEqual(build_snapshot(root), release)
