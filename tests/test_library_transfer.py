import tempfile,unittest,sqlite3
from pathlib import Path
from market_store import MarketStore
from library_transfer import export_library,import_library
class LibraryTransferTests(unittest.TestCase):
 def test_portable_public_dump_excludes_accounts_and_bars_and_preserves_newer_data(self):
  with tempfile.TemporaryDirectory() as folder:
   source=Path(folder)/'source.sqlite3';snapshot=Path(folder)/'snapshot.sqlite3';target=Path(folder)/'target.sqlite3';store=MarketStore(source)
   key=store.key('ashare','info-v4','SZ000651');store.write(key,{'type':'ashare','symbol':'SZ000651','summary':'真实公司资料'},fetched_at=100)
   store.write(store.key('ashare','candles','SZ000651','1d'),[{'t':1,'c':20}],symbol='SZ000651',tf='1d')
   store.save_asset_catalog([{'type':'ashare','symbol':'SZ000651','name':'格力电器'}]);image=(Path(__file__).resolve().parents[1]/'assets/icons/brand/sz000651.png').read_bytes();store.save_logo('SZ000651','ashare',image,'官网')
   with store._db() as db:db.execute('CREATE TABLE users(secret TEXT)');db.execute('INSERT INTO users VALUES("private")')
   counts=export_library(source,snapshot);self.assertEqual(counts['responses'],1)
   with sqlite3.connect(snapshot) as db:
    tables={r[0] for r in db.execute('SELECT name FROM sqlite_master WHERE type="table"')};self.assertNotIn('users',tables);self.assertNotIn('candles',tables)
   import_library(snapshot,target);restored=MarketStore(target);self.assertEqual(restored.read(key)[0]['summary'],'真实公司资料');self.assertEqual(restored.logo('SZ000651')['image'],image)
   restored.write(key,{'type':'ashare','symbol':'SZ000651','summary':'服务器更新的资料'},fetched_at=200)
   import_library(snapshot,target);self.assertEqual(restored.read(key)[0]['summary'],'服务器更新的资料')
   with self.assertRaises(ValueError):export_library(source,snapshot)
if __name__=='__main__':unittest.main()
