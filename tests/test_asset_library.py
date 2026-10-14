import tempfile,unittest
from pathlib import Path
from asset_library import prefill
from market_store import MarketStore
class AssetLibraryTests(unittest.TestCase):
 def test_resumes_complete_profiles_and_preserves_cached_data_on_provider_failure(self):
  with tempfile.TemporaryDirectory() as directory:
   store=MarketStore(Path(directory)/'data.sqlite3');items=[{'type':'ashare','symbol':'SZ000651','name':'格力电器'},{'type':'ashare','symbol':'SZ301308','name':'江波龙'}];calls=[]
   def fetch(kind,symbol):
    calls.append(symbol)
    if symbol=='SZ301308':raise OSError('provider offline')
    return {'type':kind,'symbol':symbol,'summary':'研发生产家用电器'}
   result=prefill(store,items,fetch,lambda *args:None)
   self.assertEqual(result['complete'],1);self.assertEqual(result['partial'],1)
   key=store.key('ashare','info-v4','SZ000651');self.assertEqual(store.read(key)[0]['summary'],'研发生产家用电器')
   result=prefill(store,items,fetch,lambda *args:None);self.assertEqual(result['queued'],0);self.assertEqual(len(calls),2)
   with store._db() as db:db.execute('UPDATE library_prefill SET next_retry=0')
   prefill(store,items,fetch,lambda *args:None);self.assertEqual(calls.count('SZ000651'),1,'saved complete profile avoids upstream reload')
 def test_mismatched_identity_never_enters_the_database(self):
  with tempfile.TemporaryDirectory() as directory:
   store=MarketStore(Path(directory)/'data.sqlite3')
   result=prefill(store,[{'type':'ashare','symbol':'SZ000651','name':'格力电器'}],lambda *args:{'type':'ashare','symbol':'SZ301308','summary':'wrong'},lambda *args:None)
   self.assertEqual(result['partial'],1);self.assertIsNone(store.read(store.key('ashare','info-v4','SZ000651')))
 def test_interrupted_provider_does_not_stop_other_assets(self):
  from http.client import IncompleteRead
  with tempfile.TemporaryDirectory() as directory:
   store=MarketStore(Path(directory)/'data.sqlite3');items=[{'type':'ashare','symbol':'SZ000651','name':'格力'},{'type':'ashare','symbol':'SZ301308','name':'江波龙'}]
   def fetch(kind,symbol):return {'type':kind,'symbol':symbol,'summary':'核实简介'}
   def logo(kind,symbol,info):
    if symbol=='SZ000651':raise IncompleteRead(b'partial')
   result=prefill(store,items,fetch,logo)
   self.assertEqual(result['processed'],2);self.assertEqual(result['complete'],2)
   with store._db() as db:self.assertEqual(db.execute('SELECT error FROM library_failures').fetchone()[0],'IncompleteRead')
 def test_legacy_false_complete_placeholder_is_refetched(self):
  with tempfile.TemporaryDirectory() as directory:
   store=MarketStore(Path(directory)/'data.sqlite3');key=store.key('ashare','info-v4','BJ920000');store.write(key,{'type':'ashare','symbol':'BJ920000','summary':'业务简介正在补全。','incomplete':False})
   item={'type':'ashare','symbol':'BJ920000','name':'安徽凤凰'}
   with store._db() as db:
    db.execute('CREATE TABLE library_prefill(kind TEXT,symbol TEXT,attempted_at REAL,next_retry REAL,complete INTEGER,PRIMARY KEY(kind,symbol))');db.execute('INSERT INTO library_prefill VALUES(?,?,0,9999999999,1)',('ashare','BJ920000'))
   result=prefill(store,[item],lambda *args:{'type':'ashare','symbol':'BJ920000','summary':'安徽凤凰生产汽车滤清器。'},lambda *args:None,retry_incomplete=True)
   self.assertEqual(result['processed'],1);self.assertTrue(store.profile_complete(store.read(key)[0]))
if __name__=='__main__':unittest.main()
