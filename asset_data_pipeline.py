"""Bounded, deduplicated first-visit fetching for public instrument data."""

import queue
import heapq
import re
import threading
import time


class AssetDataPipeline:
    def __init__(self, fetch, *, workers=2, capacity=32, retry_seconds=30):
        self.fetch = fetch
        self.workers = workers
        self.retry_seconds = retry_seconds
        self.queue = queue.PriorityQueue(maxsize=capacity)
        self.sequence = 0
        self.pending = set()
        self.retry_after = {}
        self.lock = threading.Lock()
        self.started = False

    def submit(self, items, *, priority=False):
        accepted = []
        with self.lock:
            now = time.monotonic()
            self.retry_after = {key: stamp for key, stamp in self.retry_after.items()
                                if stamp > now}
            for item in items:
                symbol = item.get("symbol") if isinstance(item, dict) else None
                if not isinstance(symbol, str) or not re.fullmatch(r"[A-Z0-9]{1,15}", symbol):
                    continue
                urgent=priority or bool(item.get('_priority'))
                if symbol in self.pending:
                    if urgent:
                        with self.queue.mutex:
                            self.queue.queue[:]=[(0,n,key) if key==symbol else (rank,n,key) for rank,n,key in self.queue.queue]
                            heapq.heapify(self.queue.queue)
                    continue
                if now < self.retry_after.get(symbol, 0):
                    continue
                if not urgent and self.queue.qsize()>=max(1,self.queue.maxsize//2):
                    break
                try:
                    self.sequence += 1
                    self.queue.put_nowait((0 if urgent else 1, self.sequence, symbol))
                except queue.Full:
                    break
                self.pending.add(symbol)
                accepted.append(symbol)
            if accepted and not self.started:
                self.started = True
                for _ in range(self.workers):
                    threading.Thread(target=self._run, daemon=True,
                                     name="asset-first-visit").start()
        return accepted

    def _run(self):
        while True:
            _, _, symbol = self.queue.get()
            try:
                self.fetch(symbol)
            except Exception:
                # One provider failure must not terminate the shared workers.
                pass
            finally:
                with self.lock:
                    self.pending.discard(symbol)
                    self.retry_after[symbol] = time.monotonic() + self.retry_seconds
                self.queue.task_done()
