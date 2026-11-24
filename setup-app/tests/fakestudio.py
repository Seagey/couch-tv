"""A pretend Couch TV Studio on 127.0.0.1 that answers /v1/setup/* the way the contract says (setup-app/BUILD.md). It
is written from the contract, not copied from the website, so the link tests always run here and in CI. Where the
website's own code is next to this folder, test_link_e2e runs the same tests against that too, so the two cannot
drift apart. Nothing is kept and nothing leaves this computer.

Two signed in people: Sam (cookie tvm_s=1) and Ruby (cookie tvm_s=2).
Test only: POST /test/reset, POST /test/clock {ms}, POST /test/send {tv_id}, GET /test/db?t=<table>.
"""
import http.server
import itertools
import json
import secrets
import threading
import time
import urllib.parse

LETTERS = "23456789ABCDEFGHJKMNPQRSTVWXYZ"
MIN, DAY = 60, 86400
PEOPLE = {"1": ("sam", "s***@example.test"), "2": ("ruby", "r***@example.test")}


class Said(Exception):
    def __init__(self, status, code):
        super().__init__(code)
        self.status, self.code = status, code


class Studio:
    def __init__(self):
        self.old = False          # True: a website from before "whose code is this" (it answers 404 to the new routes)
        self.reset()

    def reset(self):
        self.shift = 0
        self.codes, self.tokens, self.devices, self.tvs, self.links, self.waiting, self.inbox = [], {}, {}, {}, {}, [], []
        self.n = itertools.count(1)

    def now(self):
        return time.time() + self.shift

    def account(self, uid):
        return {"name": None, "email": next(m for u, m in PEOPLE.values() if u == uid), "design": "Cinema night"}

    def token(self, headers):
        t = self.tokens.get((headers.get("Authorization") or "").replace("Bearer ", ""))
        if not t or t["exp"] <= self.now():
            raise Said(401, "expired")
        return t

    def mint(self, uid):
        t = secrets.token_urlsafe(32)
        self.tokens[t] = {"uid": uid, "exp": self.now() + 120 * MIN}
        return t

    def code(self, v):
        c = next((c for c in self.codes if v in (c["long"], c["short"]) and not c["used"] and c["exp"] > self.now()), None)
        if not c:
            raise Said(401, "expired")
        return c

    def promote(self, w):
        self.links[w["tv"]] = {"link": w["link"], "uid": w["uid"], "seen": None}
        self.waiting = [x for x in self.waiting if x["tv"] != w["tv"] or x["n"] > w["n"]]

    def answer(self, method, path, body, headers):
        p = path.replace("/v1/setup/", "")
        if self.old and p in ("who", "seen", "end", "leave", "signout"):
            raise Said(404, "not_found")
        if p in ("start", "mine", "unlink", "signout", "allow"):
            cookie = headers.get("Cookie") or ""
            who = PEOPLE.get(cookie[-1:]) if cookie.startswith("tvm_s=") else None
            if not who:
                raise Said(401, "signin")
            return self.website(p, body, who[0])
        if p == "who":
            c = self.code(body.get("handoff"))
            return 200, {"account": self.account(c["uid"])}
        if p == "handoff":
            c = self.code(body.get("handoff"))
            c["used"] = True
            return 200, {"token": self.mint(c["uid"]), "account": self.account(c["uid"])}
        if p == "device":
            d, u = secrets.token_urlsafe(32), "".join(secrets.choice(LETTERS) for _ in range(8))
            self.devices[d] = {"user": u, "uid": None}
            return 201, {"device_code": d, "user_code": u[:4] + "-" + u[4:], "interval": 2}
        if p == "device/poll":
            d = self.devices.get(body.get("device_code"))
            if not d:
                raise Said(401, "expired")
            if not d["uid"]:
                raise Said(428, "pending")
            del self.devices[body["device_code"]]
            return 200, {"token": self.mint(d["uid"]), "account": self.account(d["uid"])}
        if p == "inbox" or p == "leave":
            return self.tv_asks(p, (headers.get("Authorization") or "").replace("Bearer ", ""))
        t = self.token(headers)
        if p == "end":
            self.tokens = {k: v for k, v in self.tokens.items() if v is not t}
            return 200, {"ended": True}
        if p == "tv":
            return self.register(body, t["uid"])
        tv = self.tvs.get(body.get("tv_id"))
        if not tv or tv["uid"] != t["uid"]:
            raise Said(404, "not_found")
        if p == "seen":
            return 200, {"linked": tv["id"] in self.links and not any(w["tv"] == tv["id"] for w in self.waiting)}
        if p == "done":
            tv["state"] = "ready" if body.get("ok") is True else "failed"
            said = body.get("linked") if "linked" in body and body["linked"] is not None else body.get("ok") is True or None
            w = [x for x in self.waiting if x["tv"] == tv["id"] and x["exp"] > self.now() and body.get("link") in (None, x["link"])]
            if w and said is True:
                self.promote(w[-1])
            elif w and said is False:
                self.waiting.remove(w[-1])
            elif w and said == "sent":
                w[-1]["exp"] = self.now() + 30 * DAY
            return 200, {"ok": True}
        if p == "health":
            tv["reports"].append(body.get("report"))
            return 201, {"ref": "ABCD2345"}
        raise Said(404, "not_found")

    def website(self, p, body, uid):
        if p == "start":
            live = [c for c in self.codes if c["uid"] == uid and not c["used"] and c["exp"] > self.now()]
            for c in live[:-2]:
                self.codes.remove(c)
            s = "".join(secrets.choice(LETTERS) for _ in range(8))
            c = {"uid": uid, "long": secrets.token_urlsafe(32), "short": s[:4] + "-" + s[4:], "used": False, "exp": self.now() + 10 * MIN}
            self.codes.append(c)
            return 201, {"handoff": c["long"], "short": c["short"], "open": "couchtv://setup?handoff=" + c["long"]}
        if p == "allow":
            for d in self.devices.values():
                if d["user"] == str(body.get("user_code")).replace("-", ""):
                    d["uid"] = uid
                    return 200, {"ok": True}
            raise Said(404, "not_found")
        if p == "signout":
            self.tokens = {k: v for k, v in self.tokens.items() if v["uid"] != uid}
            return 200, {"signed_out": 1}
        if p == "unlink":
            self.links.pop(body.get("tv_id"), None)
            self.waiting = [w for w in self.waiting if w["tv"] != body.get("tv_id")]
            self.tokens = {k: v for k, v in self.tokens.items() if v["uid"] != uid}
            return 200, {"unlinked": body.get("tv_id")}
        wait = {w["tv"] for w in self.waiting if w["exp"] > self.now()}
        link = {i: "linked" if i in self.links else "waiting" if i in wait else None for i in self.tvs}
        return 200, {"signedIn": True, "setups": sum(t["uid"] == uid for t in self.tokens.values()),
                     "tvs": [{"id": t["id"], "name": t["name"], "setup_state": t["state"], "linked": link[t["id"]] == "linked",
                              "link": link[t["id"]], "reports": t["reports"]} for t in self.tvs.values() if t["uid"] == uid]}

    def register(self, body, uid):
        tv = self.tvs.get(body.get("tv_id")) if body.get("tv_id") else None
        if body.get("tv_id") and (not tv or tv["uid"] != uid):
            raise Said(404, "not_found")
        if not tv:
            i = f"00000000-0000-4000-8000-{next(self.n):012d}"
            tv = self.tvs[i] = {"id": i, "uid": uid, "name": body.get("name"), "state": None, "reports": []}
        tv["profile"] = body.get("tv")
        w = {"n": next(self.n), "tv": tv["id"], "uid": uid, "link": secrets.token_urlsafe(32), "exp": self.now() + 8 * DAY}
        self.waiting.append(w)
        return 200, {"tv_id": tv["id"], "link": w["link"], "code": "CTV1-" + secrets.token_urlsafe(32), "design": "Cinema night", "home": None}

    def tv_asks(self, p, link):
        w = next((w for w in self.waiting if w["link"] == link and w["exp"] > self.now()), None)
        tv = next((i for i, l in self.links.items() if l["link"] == link), None)
        if p == "leave":
            if tv:
                del self.links[tv]
            elif w:
                self.waiting.remove(w)
            else:
                raise Said(401, "unlinked")
            return 200, {"left": True}
        if w and not tv:
            self.promote(w)
            tv = w["tv"]
        if not tv:
            raise Said(401, "unlinked")
        items = [i for i in self.inbox if i["tv"] == tv]
        self.inbox = [i for i in self.inbox if i["tv"] != tv]
        return 200, {"items": [{"code": i["code"], "title": "Cinema night"} for i in items], "poll": 604800}

    def test(self, method, path, query, body):
        if path == "/test/reset":
            self.reset()
            return 200, {"ok": True}
        if path == "/test/clock":
            self.shift += body["ms"] / 1000
            return 200, {"ok": True}
        if path == "/test/send":
            if body["tv_id"] not in self.links:
                return 200, {"queued": False}
            code = "CTV1-" + secrets.token_urlsafe(32)
            self.inbox.append({"tv": body["tv_id"], "code": code})
            return 200, {"queued": True, "code": code}
        t = query.get("t", [""])[0]
        return 200, {"tvd_tvs": list(self.tvs.values()), "tvd_setup_tokens": list(self.tokens)}.get(t, [])


def serve():
    """(studio, server): the server listens on server.server_address[1] until shutdown()."""
    studio = Studio()

    class Handler(http.server.BaseHTTPRequestHandler):
        def run(self, method):
            u = urllib.parse.urlsplit(self.path)
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n) or b"{}") if n else {}
            try:
                if u.path.startswith("/test/"):
                    status, out = studio.test(method, u.path, urllib.parse.parse_qs(u.query), body)
                else:
                    status, out = studio.answer(method, u.path, body, self.headers)
            except Said as e:
                status, out = e.status, {"error": e.code, "message": "No."}
            raw = json.dumps(out).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self):
            self.run("GET")

        def do_POST(self):
            self.run("POST")

        def log_message(self, *a):
            pass

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return studio, srv
