"""The menu as a page on this computer (127.0.0.1, a random port, a secret per run), for a desktop with no
tray. Same items, same actions as the tray. Nothing else on the network can reach it."""
import json
import secrets
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import menu

CSP = "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"

PAGE = """<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Couch TV Helper</title><meta name="key" content="__KEY__">
<style>body{font:16px system-ui,sans-serif;max-width:30em;margin:2em auto;padding:0 1em}
.dot{display:inline-block;width:.8em;height:.8em;border-radius:50%;margin-right:.4em}
.green{background:#2ea043}.amber{background:#e6a014}.grey{background:#8c8c8c}
button{display:block;width:100%;margin:.4em 0;padding:.7em;font:inherit}li{list-style:none;margin:.3em 0}ul{padding:0}</style></head>
<body><h1>Couch TV Helper</h1><p id="head"></p><ul id="tvs"></ul><div id="acts"></div><script src="page.js"></script></body></html>"""

JS = """(function(){var KEY=document.querySelector('meta[name="key"]').content;
function post(p,b){return fetch(p,{method:'POST',headers:{'Content-Type':'application/json','X-Helper-Key':KEY},body:JSON.stringify(b||{})}).then(function(r){return r.json();});}
function draw(s){var d=document.createElement('span');d.className='dot '+s.dot;var h=document.getElementById('head');h.textContent='';h.appendChild(d);h.appendChild(document.createTextNode(s.headline));
var tv=document.getElementById('tvs');tv.textContent='';s.items.forEach(function(i){if(i.id.indexOf('tv')===0){var li=document.createElement('li');li.textContent=i.label;tv.appendChild(li);}});
var a=document.getElementById('acts');a.textContent='';s.items.forEach(function(i){if(i.id==='-'||!i.enabled)return;var b=document.createElement('button');b.textContent=(i.checked?'\\u2713 ':'')+i.label;
b.onclick=function(){var ask={off:'Couch TV stays on your TV. The helper stops and will not start with this computer.',remove:'This deletes the TV key, settings and downloads kept here. Couch TV stays on your TV.'};if(ask[i.id]&&!confirm(ask[i.id]))return;post('/api/act',{id:i.id}).then(refresh,function(){});};a.appendChild(b);});}
function refresh(){post('/api/state').then(draw,function(){document.getElementById('head').textContent='The helper has stopped.';});}
refresh();setInterval(refresh,5000);})();"""


def make_server(ctl):
    secret = secrets.token_urlsafe(24)
    holder = {}

    class H(BaseHTTPRequestHandler):
        server_version = "couch-tv-helper"
        sys_version = ""

        def log_message(self, *a):
            pass

        def _send(self, code, raw, ctype):
            raw = raw if isinstance(raw, bytes) else json.dumps(raw).encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Content-Security-Policy", CSP)
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def _host_ok(self):
            port = holder["httpd"].server_address[1]
            allowed = {"127.0.0.1:%d" % port, "localhost:%d" % port}
            o = self.headers.get("Origin")
            return (self.headers.get("Host") or "") in allowed and (o is None or o in {"http://" + h for h in allowed})

        def do_GET(self):
            if not self._host_ok():
                return self._send(403, b"not this page", "text/plain")
            p = self.path.split("?")[0]
            if p in ("/", ""):
                return self._send(200, PAGE.replace("__KEY__", secret).encode(), "text/html; charset=utf-8")
            if p == "/page.js":
                return self._send(200, JS.encode(), "text/javascript; charset=utf-8")
            self._send(404, b"not found", "text/plain")

        def do_POST(self):
            try:
                n = min(max(int(self.headers.get("Content-Length") or 0), 0), 4096)
            except ValueError:
                n = 0
            raw = self.rfile.read(n)   # read before any answer: Windows resets the connection over an unread body
            if not self._host_ok() or not secrets.compare_digest(self.headers.get("X-Helper-Key") or "", secret):
                return self._send(403, {"error": "not this page"}, "application/json")
            try:
                body = json.loads(raw or b"{}")
            except ValueError:
                body = {}
            if self.path == "/api/act":
                ok = ctl.act(str(body.get("id") or "")) if isinstance(body, dict) else False
                return self._send(200, {"ok": ok}, "application/json")
            if self.path == "/api/state":
                st = ctl.state()
                return self._send(200, {"dot": menu.dot(st), "headline": menu.headline(st), "items": menu.build(st)}, "application/json")
            self._send(404, {"error": "no such step"}, "application/json")

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), H)
    holder["httpd"] = httpd
    return httpd, secret


def serve(ctl):
    """Starts the page in the background. Returns its address."""
    httpd, _ = make_server(ctl)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    # stop a moment later, so the page's own Quit request still gets its answer (Windows aborted it, a flaky CI test)
    ctl.on_quit = lambda: threading.Timer(0.5, httpd.shutdown).start()
    return "http://127.0.0.1:%d/" % httpd.server_address[1]
