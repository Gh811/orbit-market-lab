import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor

import server


class CacheTests(unittest.TestCase):
    def test_concurrent_requests_share_one_catalog_fetch(self):
        key = ("test", time.monotonic_ns())
        calls = 0
        started = threading.Event()

        def fetch():
            nonlocal calls
            calls += 1
            started.set()
            time.sleep(0.04)
            return {"SOXL": "SOXL-USDT-SWAP"}

        with ThreadPoolExecutor(max_workers=8) as pool:
            futures = [pool.submit(server.cached, key, 60, fetch) for _ in range(8)]
            self.assertTrue(started.wait(1))
            results = [future.result(timeout=2) for future in futures]
        self.assertEqual(calls, 1)
        self.assertTrue(all(result == results[0] for result in results))


if __name__ == "__main__":
    unittest.main()
