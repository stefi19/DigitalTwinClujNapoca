import asyncio
from typing import Dict, Any


class Broadcaster:
    def __init__(self):
        self.subscribers = set()

    async def subscribe(self):
        q = asyncio.Queue()
        self.subscribers.add(q)
        try:
            while True:
                item = await q.get()
                yield item
        finally:
            self.subscribers.discard(q)

    def publish(self, item: Dict[str, Any]):
        for q in list(self.subscribers):
            try:
                q.put_nowait(item)
            except Exception:
                pass


broadcaster = Broadcaster()
