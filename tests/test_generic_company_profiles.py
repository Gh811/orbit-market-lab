import json,tempfile,time,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import ashare_market as a
import server
from market_store import MarketStore
class GenericCompanyProfilesTests(unittest.TestCase):
    def row(self,symbol,name,business):
        return {'SECUCODE':symbol[2:]+'.'+symbol[:2],'SECURITY_CODE':symbol[2:],'SECURITY_NAME_ABBR':name,'ORG_NAME':name+'股份有限公司','ORG_PROFILE':'行业领军企业，实力雄厚。','ORG_PROFIE':'公司成立历史。','MAIN_BUSINESS':business,'ORG_WEB':'https://www.example.com/'}
    def test_business_field_works_for_unlisted_companies_not_just_examples(self):
        for symbol,name,business in [('SZ301308','江波龙','存储器和主控芯片的研发设计、封装测试、销售。'),('SZ000651','格力电器','从事消费电器及其配件的生产及销售。'),('SZ002475','立讯精密','连接器及电子产品研发生产。')]:
            body={'result':{'data':[self.row(symbol,name,business)]}}
            with patch.object(a,'CURATED_COMPANIES',{}),patch.object(a.subprocess,'run',return_value=SimpleNamespace(stdout=json.dumps(body))):info=a.info(symbol)
            self.assertFalse(info['incomplete']);self.assertIn(name,info['summary']);self.assertLessEqual(len(info['summary']),70);self.assertNotIn('领军',info['summary']);self.assertEqual(info['website'],'https://www.example.com')
    def test_numbered_business_list_is_a_complete_brief_sentence(self):
        profile={'business':'(一)吸收公众存款;(二)发放短期、中期和长期贷款;(三)办理国内外结算;(四)办理票据承兑'}
        summary=a.describe('SZ000001',{'name':'平安银行'},profile)
        self.assertIn('吸收公众存款',summary);self.assertIn('国内外结算',summary);self.assertNotIn('(一)',summary);self.assertTrue(summary.endswith('等业务。'));self.assertLessEqual(len(summary),70)
    def test_secondary_source_is_used_on_primary_failure(self):
        row=self.row('SZ301308','江波龙','半导体存储器研发销售。')
        with patch.object(a.subprocess,'run',side_effect=[OSError('primary unavailable'),SimpleNamespace(stdout=json.dumps({'jbzl':[row]}))]) as run:
            profile=a.company_profile('SZ301308')
        self.assertEqual(run.call_count,2);self.assertEqual(profile['name'],'江波龙')
    def test_wrong_exchange_never_becomes_another_company(self):
        row=self.row('SH600519','贵州茅台','白酒生产。')
        with patch.object(a.subprocess,'run',return_value=SimpleNamespace(stdout=json.dumps({'result':{'data':[row]}}))):self.assertIsNone(a.company_profile('SZ301308'))
    def test_verified_company_profile_is_saved_and_old_good_data_survives(self):
        with tempfile.TemporaryDirectory() as folder:
            store=MarketStore(Path(folder)/'market.db');symbol='SZ002475';good={'type':'ashare','symbol':symbol,'pair':symbol,'quote':'CNY','summary':'立讯精密主营连接器研发生产。','website':'https://example.com','incomplete':False}
            with patch.object(server,'market_store',return_value=store),patch.object(a,'info',return_value=good):server.verified_ashare_profile(symbol)
            self.assertEqual(store.summary('ashare',symbol)[0],good['summary']);self.assertEqual(store.website('ashare',symbol),good['website'])
            store.write(MarketStore.key('ashare','info-v4',symbol),good)
            with patch.object(server,'market_store',return_value=store),patch.object(a,'info',return_value={**good,'summary':'资料正在补全。','incomplete':True}):
                with self.assertRaises(ValueError):server.verified_ashare_profile(symbol)
    def test_incomplete_tracked_assets_retry_sooner(self):
        with tempfile.TemporaryDirectory() as folder:
            store=MarketStore(Path(folder)/'market.db');store.track_assets([{'type':'ashare','symbol':'SZ002475'}],followed=True);start=time.time()
            store.finish_asset_refresh('ashare','SZ002475',complete=False)
            with patch('time.time',return_value=start+61):self.assertEqual(store.due_assets()[0]['symbol'],'SZ002475')
