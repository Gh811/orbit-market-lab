import json,subprocess,tempfile,unittest
from pathlib import Path
from accounts import AccountStore,default_account_state
class InitialAccountLayout(unittest.TestCase):
 def test_frontend_and_registration_defaults_match(self):
  code="const fs=require('fs'),vm=require('vm');const s=fs.readFileSync('assets/app.js','utf8'),p=s.indexOf('function defaultAccountState()');const c={};vm.createContext(c);vm.runInContext(s.slice(p,s.indexOf('\\nfunction restoreAccount(',p)),c);process.stdout.write(JSON.stringify(c.defaultAccountState()));"
  self.assertEqual(json.loads(subprocess.check_output(['node','-e',code],text=True)),default_account_state())
 def test_new_account_defaults_persist_before_first_frontend_save(self):
  with tempfile.TemporaryDirectory() as d:
   path=Path(d)/'accounts.sqlite3';store=AccountStore(path);user,token=store.register('DefaultTest','temporary-default-123',3)
   self.assertEqual(user['state'],default_account_state());self.assertEqual(user['avatarKind'],3)
   self.assertGreater(user['stateUpdated'],0);self.assertEqual(AccountStore(path).session(token)['state']['assets'][-1]['symbol'],'SH600519')
