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
        self.brand_patch=patch.object(server,'ASSET_BRAND_PIPELINE');self.brand_patch.start()
    def tearDown(self):
        self.brand_patch.stop()
        self.patch.stop();self.folder.cleanup()
    def test_known_company_summary_website_and_artwork_survive_reopen(self):
        with patch.object(server.ashare_market,'quote',side_effect=ValueError('offline')),patch.object(server.ashare_market,'candles',side_effect=ValueError('offline')):
            server.warm_asset_data('SH600519')
        reopened=MarketStore(self.store.path)
        self.assertIn('茅台酱香系列酒',reopened.summary('ashare','SH600519')[0])
        self.assertEqual(reopened.website('ashare','SH600519'),'https://www.moutai.com.cn/')
        self.assertIsNotNone(reopened.logo('SH600519','ashare'))
        self.assertIsNotNone(reopened.read(MarketStore.key('ashare','info-v4','SH600519')))
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
        key=MarketStore.key('ashare','info-v4','SZ000001')
        self.store.write(key,old,fetched_at=0)
        partial={**old,'summary':'平安银行是A股。','website':'','incomplete':True}
        with patch.object(server.ashare_market,'info',return_value=partial):
            row,stale=self.store.get_or_refresh(key,86400,lambda:server.verified_ashare_profile('SZ000001'))
        self.assertEqual(row['summary'],old['summary']);self.assertEqual(row['website'],old['website']);self.assertTrue(stale)
        self.assertEqual(self.store.read(key)[0],old)
        with patch.object(server.ashare_market,'info',return_value=partial):
            again,_=self.store.get_or_refresh(key,86400,lambda:server.verified_ashare_profile('SZ000001'))
        self.assertEqual(again['summary'],old['summary'],'consecutive incomplete refreshes retain the description')

    def test_logo_status_returns_database_image_despite_old_negative_cache(self):
        symbol='SZ000001';image=(server.ROOT/'assets/icons/brand/sh600519.png').read_bytes()
        with patch.object(server,'company_icon',side_effect=AssertionError('cached display needs no remote fetch')):
            pending=server.ashare_logo_status(symbol)
            self.assertTrue(pending['pending'])
            self.store.save_logo(symbol,'ashare',image,'核对过的公司图标')
            with patch.object(server,'cached',side_effect=AssertionError('never return an old negative lookup')):
                ready=server.ashare_logo_status(symbol)
        self.assertEqual(ready['url'],'/api/logo-image?symbol='+symbol)
        self.assertNotIn('pending',ready)

    def test_missing_logo_queues_priority_brand_work_without_waiting_for_quote(self):
        with patch.object(server,'warm_asset_data',side_effect=AssertionError('no synchronous history work')),patch.object(server,'company_icon',side_effect=AssertionError('no synchronous website work')),patch.object(server,'ASSET_BRAND_PIPELINE') as pipeline:
            pending=server.ashare_logo_status('SZ000001')
        self.assertTrue(pending['pending'])
        pipeline.submit.assert_called_once_with([{'type':'ashare','symbol':'SZ000001'}],priority=True)

    def test_catalogue_logo_metadata_does_not_send_image_blobs(self):
        image=(server.ROOT/'assets/icons/brand/sh600519.png').read_bytes()
        self.store.save_logo('SZ000001','ashare',image,'公司官网图标')
        rows=server.attach_cached_logos([{'type':'ashare','symbol':'SZ000001'},{'type':'ashare','symbol':'SH600000'}])
        self.assertEqual(rows[0]['logo'],'/api/logo-image?symbol=SZ000001')
        self.assertNotIn('logo',rows[1]);self.assertNotIn('image',rows[0])

    def test_icon_discovery_uses_official_favicon_when_no_link_is_declared(self):
        import struct
        png=(server.ROOT/'assets/icons/brand/sh600519.png').read_bytes()
        ico=b'\x00\x00\x01\x00\x01\x00'+struct.pack('<BBBBHHII',32,32,0,0,1,32,len(png),22)+png
        requests=[]
        def open_response(request,timeout):
            requests.append(request.full_url)
            response=Mock();response.__enter__=Mock(return_value=response);response.__exit__=Mock(return_value=False)
            response.read.return_value=b'<html></html>' if request.full_url.endswith('/') else ico
            return response
        opener=Mock();opener.open.side_effect=open_response
        with patch.object(asset_brand,'build_opener',return_value=opener),patch.object(asset_brand,'public_url'):
            found=asset_brand.company_icon('https://company.example/')
        self.assertEqual(requests,['https://company.example/','https://company.example/favicon.ico'])
        self.assertEqual(found,(ico,'https://company.example/favicon.ico'))

    def test_verified_jiangxi_copper_artwork_fits_bounded_persistent_cache(self):
        artwork=(server.ROOT/'assets/icons/brand/sh600362.png').read_bytes()
        self.assertGreater(len(artwork),262144)
        self.assertLessEqual(len(artwork),524288)
        self.assertEqual(MarketStore.logo_mime(artwork),'image/png')
        self.assertIsNone(MarketStore.logo_mime(b'\x89PNG\r\n\x1a\n'+b'x'*524288))
        server.warm_asset_brand('SH600362')
        self.assertIn('铜的采选',self.store.summary('ashare','SH600362')[0])
        self.assertEqual(MarketStore(self.store.path).logo('SH600362','ashare')['image'],artwork)

    def test_ico_icon_is_recognised_persisted_and_survives_reopen(self):
        import struct
        png=(server.ROOT/'assets/icons/brand/sh600519.png').read_bytes()
        ico=b'\x00\x00\x01\x00\x01\x00'+struct.pack('<BBBBHHII',32,32,0,0,1,32,len(png),22)+png
        self.assertEqual(MarketStore.logo_mime(ico),'image/x-icon')
        self.assertIsNone(MarketStore.logo_mime(ico[:-1]))
        self.store.save_logo('SZ000001','ashare',ico,'公司官网图标')
        reopened=MarketStore(self.store.path)
        self.assertEqual(reopened.logo('SZ000001','ashare')['image'],ico)

    def test_trump_profile_is_saved_to_database(self):
        server.asset_profile('swap','TRUMP')
        self.assertIsNotNone(self.store.read(MarketStore.key('info','swap','TRUMP')))
        self.assertIn('川普币',self.store.summary('crypto','TRUMP')[0])
