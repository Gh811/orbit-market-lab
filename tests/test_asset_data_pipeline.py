import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import server
from asset_data_pipeline import AssetDataPipeline
from market_store import MarketStore


class AssetDataPipelineTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.store = MarketStore(Path(self.folder.name) / 'market.sqlite3')
        self.store_patch = patch.object(server, 'market_store', return_value=self.store)
        self.store_patch.start()

    def tearDown(self):
        self.store_patch.stop()
        self.folder.cleanup()

    @staticmethod
    def profile(symbol='SOXS', summary='半导体三倍看跌 ETF。'):
        return {'type': 'swap', 'symbol': symbol, 'pair': symbol+'-USDT-SWAP',
                'base': symbol, 'quote': 'USDT', 'summary': summary, 'category': 'stock'}

    def test_unrelated_search_hit_and_similar_ticker_rejected(self):
        self.assertFalse(server.profile_identity_matches('SOXS', 'SOXL ETF', 'SOXL fund'))
        self.assertFalse(server.profile_identity_matches('META', 'Metadata', 'Metadata company'))
        self.assertTrue(server.profile_identity_matches('SOXS', 'Direxion Semiconductor Bear 3X ETF'))
        self.assertTrue(server.profile_identity_matches('CXMT', 'ChangXin Memory Technologies',
                                                      'ChangXin Memory Technologies (CXMT) makes memory.'))
        with patch.object(server, 'remote_json', return_value={
                'query': {'search': [{'title': 'Wrong Company'}]}}), \
             patch.object(server, '_wikipedia_page', return_value=(
                 'Wrong Company is a company that mentions nothing relevant.', 'Wrong Company')), \
             patch.object(server, '_zh_intro_from_en_page') as zh:
            self.assertIsNone(server.wikipedia_search_intro('SOXS'))
            zh.assert_not_called()

    def test_matching_profile_written_before_return_and_survives_reopen(self):
        with patch.object(server, 'asset_info', return_value=self.profile()) as fetch:
            data, stale = server.asset_profile('swap', 'SOXS')
            self.assertFalse(stale)
            self.assertEqual(data['identityVersion'], 2)
            server.asset_profile('swap', 'SOXS')
            self.assertEqual(fetch.call_count, 1)
        reopened = MarketStore(self.store.path)
        self.assertEqual(reopened.read(MarketStore.key('info', 'swap', 'SOXS'))[0], data)

    def test_wrong_symbol_and_pair_never_enter_database(self):
        for info in [self.profile('SOXL'), {**self.profile(), 'pair': 'SOXL-USDT-SWAP'}]:
            with self.subTest(info=info), patch.object(server, 'asset_info', return_value=info):
                with self.assertRaises(ValueError):
                    server.asset_profile('swap', 'SOXS')
                self.assertIsNone(self.store.read(MarketStore.key('info', 'swap', 'SOXS')))

    def test_old_wrong_cached_response_is_repaired(self):
        key = MarketStore.key('info', 'swap', 'SOXS')
        self.store.write(key, self.profile('SOXL'))
        with patch.object(server, 'asset_info', return_value=self.profile()) as fetch:
            info, _ = server.asset_profile('swap', 'SOXS')
            self.assertEqual(info['symbol'], 'SOXS')
            fetch.assert_called_once()
        self.assertEqual(self.store.read(key)[0]['symbol'], 'SOXS')

    def test_placeholder_retries_after_thirty_seconds_not_one_hour(self):
        now = time.time()
        with patch.object(server, 'asset_info', side_effect=[self.profile(summary='中文简介正在补全。'), self.profile()]) as fetch:
            first, _ = server.asset_profile('swap', 'SOXS')
            self.assertTrue(first['incomplete'])
            with patch('time.time', return_value=now + 31):
                second, _ = server.asset_profile('swap', 'SOXS')
            self.assertFalse(second['incomplete'])
            self.assertEqual(fetch.call_count, 2)

    def test_profile_failure_does_not_lose_successful_candles(self):
        bars = [{'t': 1728000000000, 'o': 1, 'h': 2, 'l': .5, 'c': 1.5, 'v': 10}]
        with patch.object(server, 'asset_profile', side_effect=ValueError('provider unavailable')), \
             patch.object(server.okx_market, 'candles', return_value=bars):
            server.warm_asset_data('SOXS')
        self.assertEqual(self.store.recent_candles('SOXS', '1d'), bars)
        with patch.object(server, 'asset_info', return_value=self.profile()), \
             patch.object(server.okx_market, 'candles', side_effect=ValueError('unavailable')):
            server.warm_asset_data('SOXS')
        self.assertIsNotNone(self.store.read(MarketStore.key('info', 'swap', 'SOXS')))

    def test_search_persists_result_and_schedules_fetch_without_waiting(self):
        instrument = {'instId': 'SOXS-USDT-SWAP', 'instCategory': '3', 'state': 'live'}
        catalog = {'SOXS': instrument}
        handler = object.__new__(server.Handler)
        handler.headers = {'Host': 'localhost'}
        handler.path = '/api/search?q=SOXS'
        handler.respond = Mock()
        auth = Mock(); auth.session.return_value = {'id': 1}
        pipeline = Mock()
        with patch.object(server, 'accounts', return_value=auth), \
             patch.object(server, 'cached', return_value=catalog), \
             patch.object(server, 'ASSET_DATA_PIPELINE', pipeline):
            handler.do_GET()
        args = handler.respond.call_args.args
        self.assertEqual(args[0], 200)
        self.assertEqual(args[1]['results'][0]['name'], 'Direxion Semiconductor Bear 3X ETF')
        pipeline.submit.assert_called_once_with(args[1]['results'])
        with self.store._db() as db:
            self.assertEqual(db.execute('SELECT symbol FROM instruments').fetchall(), [('SOXS',)])
            self.assertEqual(db.execute('SELECT query FROM searches').fetchall(), [('SOXS',)])

    def test_bounded_workers_deduplicate_and_recover_from_provider_error(self):
        started, release, done = threading.Event(), threading.Event(), threading.Event()
        calls = []
        def fetch(symbol):
            calls.append(symbol)
            if symbol == 'SOXS':
                started.set(); release.wait(2)
                raise ValueError('upstream unavailable')
            done.set()
        pipeline = AssetDataPipeline(fetch, workers=1, capacity=1)
        self.assertEqual(pipeline.submit([{'symbol': 'SOXS'}]), ['SOXS'])
        self.assertTrue(started.wait(2))
        self.assertEqual(pipeline.submit([{'symbol': 'SOXS'}, {'symbol': 'SOXL'}, {'symbol': 'META'}]), ['SOXL'])
        release.set();self.assertTrue(done.wait(2))
        # Worker continues after failure, and repeated keystrokes do not refetch immediately.
        self.assertEqual(calls, ['SOXS', 'SOXL'])
        self.assertEqual(pipeline.submit([{'symbol': 'SOXS'}]), [])
        self.assertEqual(pipeline.submit([{'symbol': '../bad'}]), [])
