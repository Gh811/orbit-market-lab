import copy,json,tempfile,threading,unittest
from pathlib import Path
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch
import ashare_market as a
from accounts import clean_state
from market_store import MarketStore
from asset_data_pipeline import AssetDataPipeline
from backtest import validation
from backtest.config import PRESETS

class AShareTest(unittest.TestCase):
    def test_identity_and_directory(self):
        self.assertEqual(a.secid('SH600519'),'1.600519');self.assertEqual(a.secid('SZ000001'),'0.000001');self.assertEqual(a.secid('BJ920001'),'0.920001')
        for invalid in ['600519','SH000001','SZ600519','BJ810011','NBIS','BTC']:
            with self.assertRaises(ValueError):a.secid(invalid)
        self.assertIsNone(a.catalog_item({'f12':'BK1627','f13':90,'f14':'板块'}))
        self.assertIsNone(a.catalog_item({'f12':'810011','f13':0,'f14':'定转'}))
        self.assertEqual(a.search('600519')[0]['symbol'],'SH600519')
        self.assertEqual(a.search('贵州茅')[0]['symbol'],'SH600519')
        self.assertGreater(len(a.catalog()),5000)

    def test_old_saved_stock_marked_as_swap_is_repaired_without_changing_swaps(self):
        state=clean_state({'groups':[{'id':'main','name':'自选'}],'assets':[{'type':'swap','symbol':'SH600519','groupId':'main'},{'type':'swap','symbol':'SZ002384','groupId':'main'},{'type':'swap','symbol':'ZHONGJI','groupId':'main'}],'selected':'swap:SH600519'})
        self.assertEqual([item['type'] for item in state['assets']],['ashare','ashare','swap'])
        self.assertEqual(state['selected'],'ashare:SH600519')

    def test_company_profile_requires_exact_code_and_market(self):
        body={'jbzl':[{'SECURITY_CODE':'600519','SECUCODE':'600519.SH','SECURITY_NAME_ABBR':'贵州茅台','EM2016':'食品饮料-饮料-白酒','ORG_PROFILE':'贵州茅台酒股份有限公司主营茅台酒及系列酒的生产与销售,2001年在上海证券交易所上市。','ORG_WEB':'www.moutaichina.com'}]}
        with patch.object(a.subprocess,'run',return_value=SimpleNamespace(stdout=json.dumps(body))):
            profile=a.company_profile('SH600519')
        self.assertEqual(profile['website'],'https://www.moutaichina.com')
        summary=a.describe('SH600519',{'name':'贵州茅台','exchange':'上海证券交易所'},profile)
        self.assertNotIn('上海证券交易所',summary);self.assertNotIn('人民币计价A股',summary);self.assertIn('主营茅台酒',summary);self.assertLessEqual(len(summary),80)
        wrong={'jbzl':[{'SECURITY_CODE':'000001','SECUCODE':'000001.SZ','SECURITY_NAME_ABBR':'平安银行','EM2016':'银行','ORG_PROFILE':'平安银行简介','ORG_WEB':''}]}
        with patch.object(a.subprocess,'run',return_value=SimpleNamespace(stdout=json.dumps(wrong))):
            self.assertIsNone(a.company_profile('SH600519'))
        with patch.object(a.subprocess,'run',return_value=SimpleNamespace(stdout='not json')):
            self.assertIsNone(a.company_profile('SH600519'))

    def test_generic_profile_describes_business_instead_of_listing_history(self):
        summary=a.describe('SZ000001',{'name':'平安银行','exchange':'深圳证券交易所'},{'profile':'平安银行成立于1987年。公司的主要业务包括零售银行、企业银行和财富管理服务。','industry':'银行'})
        self.assertIn('零售银行',summary);self.assertNotIn('1987',summary);self.assertNotIn('交易所',summary);self.assertLessEqual(len(summary),80)

    def test_quote_fields_currency_and_no_invented_timestamp(self):
        row={'f57':'600519','f43':1234.56,'f60':1240,'f86':1791840000,'f124':0}
        with patch.object(a,'request',return_value=row):
            quote=a.quote('SH600519');self.assertEqual(quote['c'],1234.56);self.assertEqual(quote['currency'],'CNY');self.assertEqual(quote['t'],row['f86'])
        for bad in [{**row,'f57':'000001'},{**row,'f86':0},{**row,'f43':'-'}]:
            with patch.object(a,'request',return_value=bad),self.assertRaises(ValueError):a.quote('SH600519')

    def test_actual_closed_bars_and_amount_not_share_volume(self):
        now=datetime(2026,10,13,10,5,tzinfo=a.CNY)
        rows=a.normalize_bars(['2026-10-13 10:00,10,11,12,9,500,50000','2026-10-13 10:15,11,12,13,10,600,60000'],'15m',now)
        self.assertTrue(rows[0]['confirmed']);self.assertFalse(rows[1]['confirmed']);self.assertEqual(rows[0]['v'],50000)
        self.assertEqual(datetime.fromtimestamp(rows[0]['t']/1000,a.CNY).strftime('%H:%M'),'09:45')
        rows=a.normalize_bars(['2026-10-12,10,11,12,9,500,50000','2026-10-13,11,12,13,10,600,60000'],'1d',now)
        self.assertTrue(rows[0]['confirmed']);self.assertFalse(rows[1]['confirmed'])
        with self.assertRaises(ValueError):a.candles('SH600519','6h')

    def test_equity_and_swap_states_remain_distinct(self):
        state=clean_state({'groups':[{'id':'main','name':'自选'}],'assets':[{'type':'ashare','symbol':'SH600519'},{'type':'swap','symbol':'NBIS'},{'type':'ashare','symbol':'NBIS'}],'selected':'ashare:SH600519'})
        self.assertEqual([x['type'] for x in state['assets']],['ashare','swap']);self.assertEqual(state['selected'],'ashare:SH600519')

    def test_interest_priority_survives_restart_and_preserves_metadata(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'market.sqlite3';s=MarketStore(path);item={'type':'ashare','symbol':'SH600519','name':'贵州茅台'}
            s.save_asset_catalog([item]);s.track_assets([item]);s.finish_asset_refresh('ashare','SH600519')
            self.assertEqual(s.due_assets(),[]);s.track_assets([item],followed=True)
            reopened=MarketStore(path);self.assertTrue(reopened.due_assets()[0]['_priority'])
            s.save_asset_catalog([{'type':'ashare','symbol':'SH600519'}])
            with s._db() as db:self.assertIn('贵州茅台',db.execute('SELECT payload FROM asset_catalog').fetchone()[0])

    def test_followed_fetch_jumps_ahead_of_search_queue(self):
        started,release=threading.Event(),threading.Event();calls=[]
        def fetch(symbol):
            calls.append(symbol)
            if symbol=='BLOCK':started.set();release.wait(2)
        p=AssetDataPipeline(fetch,workers=1,capacity=8)
        p.submit([{'symbol':'BLOCK'}]);self.assertTrue(started.wait(1));p.submit([{'symbol':'SEARCH'}]);p.submit([{'symbol':'WATCH'}],priority=True);release.set();p.queue.join()
        self.assertEqual(calls,['BLOCK','WATCH','SEARCH'])

class FrozenValidationTest(unittest.TestCase):
    def test_stale_parameters_or_rules_and_one_good_asset_cannot_qualify(self):
        name=PRESETS['strategies'][0]['value'];record={'strategy':name,'qualified':True,'plan':copy.deepcopy(PRESETS['suite']),'configurationHash':validation.configuration_hash(name),'results':[{'symbol':symbol,'tf':PRESETS['suite']['tf'],'strategyHash':validation.rules_hash(),'summary':{'eligibility':'pass','completeYears':5,'trades':50,'annualizedReturn':.15,'averageYearlyReturn':.15}} for symbol in PRESETS['suite']['symbols']]}
        self.assertTrue(validation.validated_record(record))
        bad=copy.deepcopy(record);bad['results'][1]['summary']['annualizedReturn']=.01;self.assertFalse(validation.validated_record(bad))
        bad=copy.deepcopy(record);bad['configurationHash']='old';self.assertFalse(validation.validated_record(bad))
        bad=copy.deepcopy(record);bad['results'][0]['strategyHash']='old';self.assertFalse(validation.validated_record(bad))
        bad=copy.deepcopy(record);bad['plan']['capital']=99999;self.assertFalse(validation.validated_record(bad))
        self.assertFalse(validation.validated_record({'strategy':name,'qualified':True}))
if __name__=='__main__':unittest.main()
