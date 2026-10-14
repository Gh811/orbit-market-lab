import tempfile,time,unittest
from pathlib import Path
from unittest.mock import patch,Mock
import server
from market_store import MarketStore
class BrandDiscovery(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.store=MarketStore(Path(self.tmp.name)/'test.sqlite3');self.p=patch.object(server,'market_store',return_value=self.store);self.p.start()
 def tearDown(self):self.p.stop();self.tmp.cleanup()
 def test_new_swap_gets_async_brand_and_saved_image_wins(self):
  catalog={'NEWCOIN':{'instCategory':'1'}}
  with patch.object(server,'ASSET_BRAND_PIPELINE') as pipe:
   self.assertTrue(server.swap_logo_status('NEWCOIN',catalog)['pending']);pipe.submit.assert_called_once_with([{'type':'swap','symbol':'NEWCOIN'}],priority=True)
   image=(server.ROOT/'assets/icons/brand/sh600519.png').read_bytes();self.store.save_logo('NEWCOIN','1',image,'已核实来源')
   self.assertEqual(server.swap_logo_status('NEWCOIN',catalog)['url'],'/api/logo-image?symbol=NEWCOIN');self.assertEqual(pipe.submit.call_count,1)
 def test_search_queues_both_categories(self):
  rows=[{'type':'swap','symbol':'NEWCOIN'},{'type':'ashare','symbol':'SZ000001'}]
  with patch.object(server,'ASSET_BRAND_PIPELINE') as brand,patch.object(server,'ASSET_DATA_PIPELINE'):
   server.register_discovered(rows);brand.submit.assert_called_once_with(rows,priority=False)
 def test_empty_identity_recovers_without_daylong_cache(self):
  key=('coin','RECOVERYTEST');server.CACHE[key]=(time.monotonic()-31,{})
  provider=Mock(return_value={'name':'Recovered'})
  self.assertEqual(server.cached(key,86400,provider)['name'],'Recovered');provider.assert_called_once()
 def test_brand_worker_does_not_need_candle_request(self):
  with patch.object(server,'cached',return_value={'NEWCOIN':{'instCategory':'1'}}),patch.object(server,'resolve_logo',return_value={'url':'','source':''}) as resolve,patch.object(server,'asset_profile') as profile,patch.object(server.okx_market,'candles',side_effect=AssertionError('history must not block branding')):
   server.warm_asset_brand('NEWCOIN');resolve.assert_called_once();profile.assert_called_once_with('swap','NEWCOIN')
if __name__=='__main__':unittest.main()
