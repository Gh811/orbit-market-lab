import unittest
from unittest.mock import patch
import server
import ashare_market

class CuratedProfilesTest(unittest.TestCase):
    def test_company_profiles_survive_provider_failure(self):
        with patch.object(ashare_market, 'company_profile', side_effect=AssertionError('curated profiles need no remote request')):
            for symbol, business in [('SH600519','茅台酱香系列酒'),('SZ002384','印制电路板'),('SH600362','铜的采选')]:
                info=ashare_market.info(symbol)
                self.assertEqual(info['type'],'ashare')
                self.assertIn(business,info['summary'])
                self.assertTrue(info['website'].startswith('https://'))
                self.assertIn('官网',info['source'])

    def test_trump_has_verified_identity_and_metadata(self):
        with patch.object(server.okx_market,'instruments',side_effect=AssertionError('project metadata must not depend on live exchange requests')):
            info=server.verified_asset_info('swap','TRUMP')
        self.assertEqual(info['pair'],'TRUMP-USDT-SWAP')
        self.assertLessEqual(len(info['summary']),100)
        for field in ['contractAddress','chain']:self.assertNotIn(field,info)
        self.assertEqual(info['maxSupply'],'10 亿枚')
        self.assertEqual(info['network'],'Solana / TRON')
        self.assertFalse(info['incomplete'])
        self.assertIn('川普',server.public_asset_info(info)['summary'])
        self.assertNotIn('price',info)

    def test_trump_info_endpoint_works_without_market_provider(self):
        handler=object.__new__(server.Handler)
        handler.headers={'Host':'localhost'}
        handler.path='/api/info?type=swap&symbol=TRUMP'
        handler.respond=lambda status,body,*args,**kwargs:(status,body)
        with patch.object(server,'market_store'), patch.object(server,'accounts') as account_mock, patch.object(server.okx_market,'instruments',side_effect=AssertionError('no live exchange dependency')):
            account_mock.return_value.session.return_value={'id':'test'}
            status,body=handler.do_GET()
        self.assertEqual(status,200)
        self.assertEqual(body['symbol'],'TRUMP')
        self.assertEqual(body['website'],'https://gettrumpmemes.com/')

    def test_company_logos_are_actually_served_by_static_route(self):
        for symbol in ['SH600519','SZ002384','SH600362']:
            handler=object.__new__(server.Handler);handler.headers={'Host':'localhost'}
            handler.path=server.ASHARE_BRAND_LOGOS[symbol][0]
            handler.respond=lambda status,body,*args,**kwargs:(status,body)
            status,payload=handler.do_GET()
            self.assertEqual(status,200);self.assertTrue(payload.startswith(b'\x89PNG\r\n\x1a\n'))
