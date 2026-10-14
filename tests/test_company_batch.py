import json,unittest
from types import SimpleNamespace
from unittest.mock import patch
import ashare_market as market
from asset_brand import Icons
class CompanyBatchTests(unittest.TestCase):
 def test_batch_rejects_other_market_and_unrequested_identity(self):
  rows=[{'SECUCODE':'000651.SZ','SECURITY_CODE':'000651','SECURITY_NAME_ABBR':'格力电器','MAIN_BUSINESS':'空调研发生产','ORG_WEB':'www.gree.com'},
        {'SECUCODE':'301308.SZ','SECURITY_CODE':'000651','SECURITY_NAME_ABBR':'wrong','ORG_PROFIE':'wrong'},
        {'SECUCODE':'600519.SH','SECURITY_CODE':'600519','SECURITY_NAME_ABBR':'unrequested','ORG_PROFIE':'wrong'}]
  with patch.object(market.subprocess,'run',return_value=SimpleNamespace(stdout=json.dumps({'result':{'data':rows}}))) as run:
   result=market.batch_company_profiles(['SZ000651','SZ301308','bad" symbol'])
  self.assertEqual(set(result),{'SZ000651'});self.assertEqual(result['SZ000651']['business'],'空调研发生产');self.assertEqual(run.call_count,1)
 def test_main_logo_excludes_partners(self):
  parser=Icons('https://example.com/')
  parser.feed('<header><a href="/"><img src="/brand/logo.png"></a></header><section><a href="https://partner.com/"><img src="/partner-logo.png"></a></section><link rel="icon" href="/favicon.ico">')
  self.assertEqual(parser.brand_urls,['/brand/logo.png']);self.assertEqual(parser.urls,['/favicon.ico'])
 def test_only_static_self_contained_svg_is_accepted(self):
  from market_store import MarketStore
  good=b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30"><path d="M0 0 L20 20"/></svg>'
  self.assertEqual(MarketStore.logo_mime(good),'image/svg+xml')
  for bad in [good.replace(b'<path',b'<script/><path'),good.replace(b'<path',b'<path onclick="evil()"'),good.replace(b'<path',b'<use href="https://other.example/file"/><path')]:self.assertIsNone(MarketStore.logo_mime(bad))
 def test_factual_business_is_not_marked_missing_only_for_length(self):
  text='测试公司主营'+('完整产品名称及研发生产销售服务'*8)
  summary=market._clip_profile(text)
  self.assertNotIn('正在补全',summary);self.assertEqual(summary,text+'。')
if __name__=='__main__':unittest.main()
