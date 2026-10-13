import io
import json
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from accounts import AccountStore
import server


class AvatarTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.path = Path(self.folder.name) / 'accounts.sqlite3'
        self.store = AccountStore(self.path)
        self.user, self.token = self.store.register('avatar_user', 'long-secret-A1', 6)
        self.uid = self.store.session(self.token)['id']

    def test_persists_independently_of_group_and_login(self):
        self.store.save_state(self.uid, {'groups': [{'id': 'main', 'name': '自选', 'petKind': 2}], 'assets': []})
        with patch.object(AccountStore, '_avatar_day', return_value='2026-10-12'):
            changed = self.store.change_avatar(self.uid, 4)
            self.assertFalse(changed['avatarCanChange'])
            restored, _ = AccountStore(self.path).login('avatar_user', 'long-secret-A1')
            self.assertEqual(restored['avatarKind'], 4)
            self.assertEqual(restored['state']['groups'][0]['petKind'], 2)
            self.assertFalse(restored['avatarCanChange'])

    def test_daily_allowance_and_independent_accounts(self):
        with patch.object(AccountStore, '_avatar_day', return_value='2026-10-12'):
            self.assertTrue(self.store.change_avatar(self.uid, 6)['avatarCanChange'])
            self.store.change_avatar(self.uid, 1)
            with self.assertRaisesRegex(ValueError, '今天已修改'):
                self.store.change_avatar(self.uid, 2)
            other, _ = self.store.register('avatar_other', 'long-secret-B2', 3)
            self.store.change_avatar(other['id'], 5)
        with patch.object(AccountStore, '_avatar_day', return_value='2026-10-13'):
            self.assertEqual(self.store.change_avatar(self.uid, 2)['avatarKind'], 2)

    def test_beijing_midnight(self):
        with patch('accounts.time.time', return_value=1791820799):
            self.assertEqual(AccountStore._avatar_day(), '2026-10-12')
        with patch('accounts.time.time', return_value=1791820800):
            self.assertEqual(AccountStore._avatar_day(), '2026-10-13')

    def test_concurrent_changes_only_one_succeeds(self):
        def change(kind):
            try:
                self.store.change_avatar(self.uid, kind)
                return True
            except ValueError:
                return False
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sum(pool.map(change, (1, 2))), 1)

    def test_invalid_values(self):
        for kind in (-1, 8, True, None, '3'):
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                self.store.change_avatar(self.uid, kind)

    def test_old_account_migrates_once(self):
        with sqlite3.connect(self.path) as db:
            db.execute('UPDATE users SET state=? WHERE id=?', (json.dumps({'groups': [{'id': 'main', 'petKind': 5}]}), self.uid))
            db.execute('ALTER TABLE users DROP COLUMN avatar_kind')
            db.execute('ALTER TABLE users DROP COLUMN avatar_changed_day')
        migrated = AccountStore(self.path)
        self.assertEqual(migrated.session(self.token)['avatarKind'], 5)
        migrated.change_avatar(self.uid, 3)
        self.assertEqual(AccountStore(self.path).session(self.token)['avatarKind'], 3)

    def test_endpoint_requires_session_and_enforces_limit(self):
        handler = object.__new__(server.Handler)
        handler.path = '/api/auth/avatar'
        body = json.dumps({'avatarKind': 1}).encode()
        handler.headers = {'Host': 'localhost', 'Content-Type': 'application/json', 'Content-Length': str(len(body))}
        handler.respond = lambda status, data, **kwargs: (status, data)
        with patch.object(server, 'ACCOUNT_STORE', self.store):
            handler.rfile = io.BytesIO(body)
            self.assertEqual(handler.do_POST()[0], 401)
            handler.headers['Cookie'] = f'star_session={self.token}'
            handler.rfile = io.BytesIO(body)
            status, data = handler.do_POST()
            self.assertEqual(status, 200)
            self.assertEqual(data['avatarKind'], 1)
            self.assertFalse(data['avatarCanChange'])
            body = json.dumps({'avatarKind': 2}).encode()
            handler.headers['Content-Length'] = str(len(body))
            handler.rfile = io.BytesIO(body)
            self.assertEqual(handler.do_POST()[0], 400)


if __name__ == '__main__':
    unittest.main()
