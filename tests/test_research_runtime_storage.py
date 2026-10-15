import json,os,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from backtest import suite

class ResearchRuntimeStorageTest(unittest.TestCase):
    def test_cloud_results_use_state_directory_and_preserve_release(self):
        bundled=Path(suite.__file__).parent/'validated-evaluations.json'
        original=bundled.read_bytes()
        row=json.loads(original)[0]
        with tempfile.TemporaryDirectory() as folder:
            target=Path(folder)/'research'/'validated-evaluations.json'
            with patch.dict(os.environ,{'MARKET_RESEARCH_EVALUATIONS':str(target)}):
                suite.update_validated_record(row)
                self.assertEqual(json.loads(target.read_text())[0]['strategy'],row['strategy'])
                suite.update_validated_record(row)
                self.assertEqual(len(json.loads(target.read_text())),1)
                with patch.object(suite,'validated_published_record',return_value=True):
                    self.assertEqual(len(suite.active_strategies()),1)
                self.assertFalse(target.with_suffix('.tmp').exists())
        self.assertEqual(bundled.read_bytes(),original)

if __name__=='__main__':unittest.main()
