import tempfile,unittest
from pathlib import Path
from accounts import AccountStore,clean_state
class WalletState(unittest.TestCase):
 def test_valid_rows_and_invalid_values(self):
  row={'id':'holding-1','name':'BTC','category':'crypto','currency':'USDT','quantity':.25,'price':60000}
  state=clean_state({'wallet':[row,{**row,'id':'bad','quantity':float('nan')},{**row,'id':'bool','price':True},{**row,'id':'negative','quantity':-1},row]})
  self.assertEqual(state['wallet'],[row]);self.assertEqual(clean_state({})['wallet'],[])
 def test_account_store_reopens_with_wallet(self):
  with tempfile.TemporaryDirectory() as folder:
   store=AccountStore(Path(folder)/'accounts.sqlite3')
   row={'id':'holding-1','name':'股票','category':'stock','currency':'CNY','quantity':100,'price':12}
   _,token=store.register('WalletTest','temporary-test-only-123')
   store.save_state(store.session(token)['id'],{'wallet':[row]})
   reopened=AccountStore(Path(folder)/'accounts.sqlite3')
   self.assertEqual(reopened.session(token)['state']['wallet'],[row])
