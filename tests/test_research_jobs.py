import unittest,threading,time
from unittest.mock import patch
from backtest import jobs

class ResearchJobsTest(unittest.TestCase):
    def test_server_owned_options(self):
        from backtest.config import options
        for symbol in ['BTC','ETH']:
            for tf in ['4h','6h','1d']:
                a,b,c,period=options({'symbol':symbol,'tf':tf,'capital':'10000','strategy':'channelRide','period':'2022'})
                self.assertEqual(c['risk'],.005);self.assertEqual(c['fee'],.0005);self.assertEqual(c['slippage'],.0002)
                self.assertEqual(c['maxHold'],360);self.assertIn('testStart',c)
        for bad in [{'symbol':'SOL'},{'tf':'1h'},{'capital':'12345'},{'capital':True},{'capital':10000.1},{'risk':.05},{'fee':0},{'slippage':0},{'maxHold':1},{'lookback':5000},{'strategy':'unknown'},{'period':'2030'}]:
            with self.assertRaises(ValueError):options(bad)

    def test_only_strategy_and_withdrawn(self):
        for body in [{'strategy':'macroRide','symbol':'BTC'},{'strategy':'macroRide','risk':.01},{'strategy':'macroRide','fee':0},{'strategy':'macroRide','tf':'4h'},{'strategy':'macroRide','capital':50000},{}]:
            with self.assertRaises(ValueError):jobs.submit(99,body)
        with patch.object(jobs,'active_strategies',lambda:[]):
            with self.assertRaises(ValueError):jobs.submit(99,{'strategy':'macroRide'})

    def test_ownership_concurrency_and_failure(self):
        release=threading.Event()
        def calculation(strategy):
            release.wait(2)
            if strategy=='structureRide':raise ValueError('invalid test symbol')
            return {'summary':{'trades':1},'strategy':strategy}
        with jobs.LOCK:jobs.JOBS.clear()
        with patch.object(jobs,'run_suite',calculation),patch.object(jobs,'active_strategies',lambda:[{'value':'macroRide'},{'value':'structureRide'}]):
            one=jobs.submit(101,{'strategy':'macroRide'});two=jobs.submit(102,{'strategy':'structureRide'})
            self.assertIsNone(jobs.status(102,one['id']))
            self.assertEqual(jobs.status(101,one['id'])['status'],'running')
            with self.assertRaises(jobs.BusyError):jobs.submit(101,{'strategy':'macroRide'})
            with self.assertRaises(jobs.BusyError):jobs.submit(103,{'strategy':'macroRide'})
            release.set()
            for _ in range(50):
                if jobs.status(101,one['id'])['status']!='running' and jobs.status(102,two['id'])['status']!='running':break
                time.sleep(.01)
            self.assertEqual(jobs.status(101,one['id'])['status'],'complete')
            self.assertEqual(jobs.status(102,two['id'])['status'],'failed')
            self.assertNotIn('owner',jobs.status(101,one['id']))
if __name__=='__main__':unittest.main()
