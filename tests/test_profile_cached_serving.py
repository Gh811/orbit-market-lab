import tempfile,threading,time,unittest
from pathlib import Path
from unittest.mock import patch
import server
from market_store import MarketStore

class CachedProfileServingTest(unittest.TestCase):
    def test_expired_verified_profile_does_not_wait_for_slow_provider(self):
        with tempfile.TemporaryDirectory() as folder:
            store=MarketStore(Path(folder)/'market.sqlite3')
            profile={'type':'swap','symbol':'AAPL','pair':'AAPL-USDT-SWAP','base':'AAPL','quote':'USDT','summary':'苹果设计消费电子产品。','identityVersion':2,'incomplete':False}
            key=MarketStore.key('info','swap','AAPL');store.write(key,profile,fetched_at=time.time()-31*86400)
            started,release=threading.Event(),threading.Event()
            def fetch(*args):started.set();release.wait(2);return {**profile,'summary':'苹果设计手机、电脑及相关服务。'}
            with patch.object(server,'market_store',return_value=store),patch.object(server,'verified_asset_info',side_effect=fetch):
                began=time.monotonic();row,stale=server.asset_profile('swap','AAPL')
                self.assertLess(time.monotonic()-began,.5);self.assertTrue(stale);self.assertEqual(row['summary'],profile['summary']);self.assertTrue(started.wait(1));release.set()
                deadline=time.monotonic()+2
                while key in store._pending and time.monotonic()<deadline:time.sleep(.01)
                self.assertNotIn(key,store._pending)
                self.assertIn('相关服务',store.read(key)[0]['summary'])
if __name__=='__main__':unittest.main()
