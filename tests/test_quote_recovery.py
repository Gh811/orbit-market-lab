import ast
import copy
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import server
from market_store import MarketStore

class QuoteRecoveryTests(unittest.TestCase):
    def setUp(self):
        tree=ast.parse(Path(server.__file__).read_text())
        branch=next(n for n in ast.walk(tree) if isinstance(n,ast.If) and isinstance(n.test,ast.Compare) and isinstance(n.test.comparators[0],ast.Constant) and n.test.comparators[0].value=='/api/quotes')
        fn=ast.FunctionDef(name='route',args=ast.arguments(posonlyargs=[],args=[ast.arg(arg='self'),ast.arg(arg='path')],kwonlyargs=[],kw_defaults=[],defaults=[]),body=[copy.deepcopy(branch)],decorator_list=[])
        module=ast.fix_missing_locations(ast.Module(body=[fn],type_ignores=[]));scope=dict(vars(server));exec(compile(module,'<actual quote handler>','exec'),scope);self.route=scope['route'];self.scope=scope
        self.folder=tempfile.TemporaryDirectory();self.store=MarketStore(Path(self.folder.name)/'data.sqlite3');scope['market_store']=lambda:self.store
        scope['stored_market_data']=lambda parts,ttl,fetch,**kw:self.store.get_or_refresh(MarketStore.key(*parts),ttl,fetch,**kw)
        scope['cached']=lambda key,ttl,fetch:fetch()
        self.handler=SimpleNamespace(respond=lambda code,data:(code,data))
    def tearDown(self):
        self.folder.cleanup()
    def request(self):
        return self.route(self.handler,SimpleNamespace(path='/api/quotes',query='symbols=BTC,SH600519'))
    def test_failed_contract_keeps_saved_quote_and_does_not_block_stock(self):
        self.store.write(MarketStore.key('okx','quote','BTC'),{'c':123,'t':100,'pc':120})
        with patch.object(server.okx_market,'quotes',side_effect=TimeoutError),patch.object(server.ashare_market,'quote',return_value={'c':1500,'t':200,'pc':1490}):
            code,data=self.request()
        self.assertEqual(code,200);self.assertEqual(data['quotes']['BTC']['c'],123);self.assertTrue(data['quotes']['BTC']['stale']);self.assertEqual(data['quotes']['SH600519']['c'],1500)
    def test_successful_batch_saves_each_contract_price(self):
        with patch.object(server.okx_market,'quotes',return_value={'BTC':{'c':456,'t':300,'pc':450}}),patch.object(server.ashare_market,'quote',return_value={'c':1500,'t':200,'pc':1490}):
            code,data=self.request()
        self.assertEqual(code,200);self.assertFalse(data['quotes']['BTC']['stale']);self.assertEqual(self.store.read(MarketStore.key('okx','quote','BTC'))[0]['c'],456)
