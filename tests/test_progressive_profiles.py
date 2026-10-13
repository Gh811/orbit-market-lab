import io,json,tempfile,unittest
from pathlib import Path
from unittest.mock import Mock,patch
import server,asset_brand
from market_store import MarketStore

class ProgressiveProfilesTest(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory()
        self.store=MarketStore(Path(self.folder.name)/'market.sqlite3')
        self.patch=patch.object(server,'market_store',return_value=self.store);self.patch.start()
    def tearDown(self):
        self.patch.stop();self.folder.cleanup()
    def test_known_company_summary_website_and_artwork_survive_reopen(self):
        with patch.object(server.ashare_market,'quote',side_effect=ValueError('offline')),patch.object(server.ashare_market,'candles',side_effect=ValueError('offline')):
            server.warm_asset_data('SH600519')
        reopened=MarketStore(self.store.path)
        self.assertIn('茅台酱香系列酒',reopened.summary('ashare','SH600519')[0])
        self.assertEqual(reopened.website('ashare','SH600519'),'https://www.moutai.com.cn/')
        self.assertIsNotNone(reopened.logo('SH600519','ashare'))
        self.assertIsNotNone(reopened.read(MarketStore.key('ashare','info-v2','SH600519')))
    def test_new_company_exact_profile_drives_icon_and_persistence(self):
        info={'type':'ashare','symbol':'SZ000001','name':'平安银行','pair':'SZ000001','quote':'CNY','summary':'平安银行提供银行业务。','website':'https://bank.example.com/','source':'已核对公司资料'}
        image=(server.ROOT/'assets/icons/brand/sh600519.png').read_bytes()
        with patch.object(server.ashare_market,'info',return_value=info),patch.object(server,'company_icon',return_value=(image,'https://bank.example.com/icon.png')) as logo,patch.object(server.ashare_market,'quote',side_effect=ValueError('offline')),patch.object(server.ashare_market,'candles',side_effect=ValueError('offline')):
            server.warm_asset_data('SZ000001')
        logo.assert_called_once_with(info['website'])
        self.assertEqual(self.store.logo('SZ000001','ashare')['image'],image)
        self.assertEqual(self.store.summary('ashare','SZ000001')[0],info['summary'])
        self.assertEqual(server.resolve_ashare_logo('SZ000001')['url'],'/api/logo-image?symbol=SZ000001')
    def test_discovery_endpoint_validates_identity_and_tracks_all_results(self):
        payload=json.dumps({'items':[{'type':'ashare','symbol':'SH600519','website':'https://wrong.invalid/'},{'type':'ashare','symbol':'SZ002384'},{'type':'swap','symbol':'SH600519'},{'type':'ashare','symbol':'UNKNOWN'}]}).encode()
        handler=object.__new__(server.Handler);handler.path='/api/asset-discovery'
        handler.headers={'Host':'localhost','Content-Type':'application/json','Content-Length':str(len(payload))};handler.rfile=io.BytesIO(payload)
        handler.respond=lambda status,body,*args,**kwargs:(status,body)
        auth=Mock();auth.session.return_value={'id':'test'}
        pipeline=Mock()
        with patch.object(server,'accounts',return_value=auth),patch.object(server,'ASSET_DATA_PIPELINE',pipeline):status,body=handler.do_POST()
        self.assertEqual(status,202);self.assertEqual(body['queued'],2)
        self.assertEqual({a['symbol'] for a in self.store.due_assets()},{'SH600519','SZ002384'})
        self.assertTrue(all('website' not in item for item in pipeline.submit.call_args.args[0]))
    def test_company_icon_never_follows_external_or_private_sources(self):
        with self.assertRaises(ValueError):asset_brand.public_url('https://wrong.example/icon.png','company.example')
        with patch.object(asset_brand.socket,'getaddrinfo',return_value=[(None,None,None,None,('127.0.0.1',443))]):
            with self.assertRaises(ValueError):asset_brand.public_url('https://company.example/icon.png','company.example')
    def test_incomplete_refresh_keeps_previous_company_description(self):
        old={'type':'ashare','symbol':'SZ000001','pair':'SZ000001','quote':'CNY','summary':'已经核实的银行业务简介。','website':'https://bank.example.com/','source':'公司资料'}
        self.store.write(MarketStore.key('ashare','info-v2','SZ000001'),old)
        partial={**old,'summary':'平安银行是A股。','website':'','incomplete':True}
        with patch.object(server.ashare_market,'info',return_value=partial):row=server.verified_ashare_profile('SZ000001')
        self.assertEqual(row['summary'],old['summary']);self.assertEqual(row['website'],old['website']);self.assertTrue(row['incomplete'])
        self.store.write(MarketStore.key('ashare','info-v2','SZ000001'),row)
        with patch.object(server.ashare_market,'info',return_value=partial):again=server.verified_ashare_profile('SZ000001')
        self.assertEqual(again['summary'],old['summary'],'consecutive incomplete refreshes retain the description')

    def test_trump_profile_is_saved_to_database(self):
        server.asset_profile('swap','TRUMP')
        self.assertIsNotNone(self.store.read(MarketStore.key('info','swap','TRUMP')))
        self.assertIn('川普币',self.store.summary('crypto','TRUMP')[0])
