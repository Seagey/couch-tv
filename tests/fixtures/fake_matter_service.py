"""A pretend Matter service for tests/test_matter_bridge.py, started the way the bridge starts the real
one (`node bin.js --storage-path ... --listen-address <unix socket> ...`, with the test's Python in
place of node). It writes the arguments it got to <storage>/args.json, listens only on the unix
socket it was given, and answers start_listening with no devices."""
import asyncio
import json
import os
import sys

from aiohttp import web


def arg(name):
    a = sys.argv[1:]
    return a[a.index(name) + 1] if name in a else None


async def main():
    storage = arg("--storage-path")
    sock = arg("--listen-address")
    with open(os.path.join(storage, "args.json"), "w") as f:
        json.dump(sys.argv[1:], f)

    async def ws_handler(request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        await ws.send_json({"sdk_version": "fake service", "schema_version": 15})
        async for msg in ws:
            d = json.loads(msg.data)
            result = [] if d["command"] == "start_listening" else None
            await ws.send_json({"message_id": d["message_id"], "result": result})
        return ws

    app = web.Application()
    app.router.add_get("/ws", ws_handler)
    runner = web.AppRunner(app)
    await runner.setup()
    if os.path.exists(sock):
        os.remove(sock)
    await web.UnixSite(runner, sock).start()
    print("fake matter service listening on", sock, flush=True)
    await asyncio.Event().wait()


if __name__ == "__main__":
    asyncio.run(main())
