#!/usr/bin/env python3
"""What the browser on a TiVo OS TV (Vewd Browser) can do. Run it on a computer on the same network, then
type the address it prints into the TV's browser.

    python3 scripts/tivo-browser-check.py                # stops by itself after 15 minutes
    python3 scripts/tivo-browser-check.py --minutes 5 --port 8765

The page shows the browser's name, the screen size and a list of web features with yes or no, and it
sends the same list back here, so nothing has to be read off the TV. Pressing keys on the TV remote
shows their codes. It only answers on the home network, keeps nothing and stops by itself.
Paste the output into a GitHub issue.
"""
import argparse
import socket
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

# Written for the oldest engine that might open it: var and function only, no arrow, no template string.
# A page that fails to parse on the TV would report nothing at all.
PAGE_HTML = """<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>couch-tv browser check</title>
<style>
body{background:#101418;color:#eee;font:28px sans-serif;margin:40px}
h1{font-size:40px;margin:0 0 10px}
#ua{font-size:22px;color:#9cf;word-break:break-all}
#rows span{display:inline-block;width:30%;margin:4px 0}
.yes{color:#7d7}.no{color:#f77}
#key{font-size:34px;margin-top:20px;color:#fd6}
</style></head><body>
<h1>couch-tv browser check</h1>
<div id="ua"></div><div id="size"></div><div id="rows"></div>
<div id="key">Press keys on the remote: arrows, OK, colours, numbers.</div>
<script>
var results = [];
function send(path, text) { var beacon = new Image(); beacon.src = path + "?d=" + encodeURIComponent(text); }
function row(name, ok) {
  var span = document.createElement("span");
  span.className = ok ? "yes" : "no";
  span.appendChild(document.createTextNode((ok ? "yes  " : "no   ") + name));
  document.getElementById("rows").appendChild(span);
  results.push((ok ? "+" : "-") + name);
}
function probe(name, test) { var ok = false; try { ok = !!test(); } catch (e) { ok = false; } row(name, ok); }
function syntax(code) { try { new Function(code); return true; } catch (e) { return false; } }
function css(prop, value) { return window.CSS && CSS.supports && CSS.supports(prop, value); }
function selector(text) { return window.CSS && CSS.supports && CSS.supports("selector(" + text + ")"); }

document.getElementById("ua").appendChild(document.createTextNode(navigator.userAgent));
var size = window.innerWidth + "x" + window.innerHeight + " css px, ratio " + (window.devicePixelRatio || 1) +
           ", screen " + screen.width + "x" + screen.height;
document.getElementById("size").appendChild(document.createTextNode(size));

probe("let and arrow", function () { return syntax("let a = () => 1"); });
probe("class", function () { return syntax("class A { b() {} }"); });
probe("async await", function () { return syntax("async function f() { await 1 }"); });
probe("optional chaining", function () { return syntax("var a = {}; a?.b"); });
probe("nullish ??", function () { return syntax("var a = null ?? 1"); });
probe("script modules", function () { return "noModule" in document.createElement("script"); });
probe("Promise", function () { return window.Promise; });
probe("fetch", function () { return window.fetch; });
probe("WebSocket", function () { return window.WebSocket; });
probe("EventSource", function () { return window.EventSource; });
probe("localStorage", function () { localStorage.setItem("couch_check", "1"); return localStorage.getItem("couch_check") === "1"; });
probe("IntersectionObserver", function () { return window.IntersectionObserver; });
probe("ResizeObserver", function () { return window.ResizeObserver; });
probe("custom elements", function () { return window.customElements; });
probe("css variables", function () { return css("--a", "0"); });
probe("css grid", function () { return css("display", "grid"); });
probe("css gap", function () { return css("gap", "1px"); });
probe("css aspect-ratio", function () { return css("aspect-ratio", "1"); });
probe("css inset", function () { return css("inset", "0"); });
probe("css :is()", function () { return selector(":is(a)"); });
probe("css :focus-visible", function () { return selector(":focus-visible"); });
probe("css backdrop-filter", function () { return css("backdrop-filter", "blur(1px)"); });
probe("css clamp()", function () { return css("width", "clamp(1px, 2px, 3px)"); });
probe("video h264", function () { return document.createElement("video").canPlayType('video/mp4; codecs="avc1.42E01E"'); });
probe("webp", function () { return document.createElement("canvas").toDataURL("image/webp").indexOf("data:image/webp") === 0; });

send("/report", size + " | " + results.join(" "));

document.onkeydown = function (event) {
  var text = (event.keyCode || event.which) + " " + (event.key || "") + " " + (event.code || "");
  var box = document.getElementById("key");
  box.innerHTML = "";
  box.appendChild(document.createTextNode("Key: " + text));
  send("/key", text);
};
</script></body></html>
"""


class CheckHandler(BaseHTTPRequestHandler):
    def log_message(self, *log_args):   # the default log lacks the User-Agent, which is the point here
        pass

    def do_GET(self):
        request_path, _, request_query = self.path.partition("?")
        request_data = unquote(request_query[2:]) if request_query.startswith("d=") else ""
        request_stamp = time.strftime("%H:%M:%S")
        if request_path == "/":
            print(f"[{request_stamp}] page opened by {self.client_address[0]}")
            print(f"  User-Agent: {self.headers.get('User-Agent', 'none sent')}")
            self.answer(200, "text/html; charset=utf-8", PAGE_HTML.encode())
        elif request_path == "/report":
            print(f"[{request_stamp}] report: {request_data}")
            self.answer(204)
        elif request_path == "/key":
            print(f"[{request_stamp}] key: {request_data}")
            self.answer(204)
        else:
            self.answer(404)
        sys.stdout.flush()

    def answer(self, answer_status, answer_type=None, answer_body=b""):
        self.send_response(answer_status)
        if answer_type:
            self.send_header("Content-Type", answer_type)
        # The Vewd engine caches hard; a stale page would report an old run.
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(answer_body)))
        self.end_headers()
        self.wfile.write(answer_body)


class BrowserCheck:
    def __init__(self, check_port, check_minutes):
        self.check_port = check_port
        self.check_minutes = check_minutes

    @staticmethod
    def own_addresses():
        local_found = set()
        try:
            local_found.update(socket.gethostbyname_ex(socket.gethostname())[2])
        except OSError:
            pass
        return sorted(a for a in local_found if not a.startswith("127."))

    def run(self):
        check_server = ThreadingHTTPServer(("0.0.0.0", self.check_port), CheckHandler)
        threading.Thread(target=check_server.serve_forever, daemon=True).start()
        print("Type one of these into the TV's browser (the one on the same network as the TV):")
        for local_address in self.own_addresses():
            print(f"  http://{local_address}:{self.check_port}")
        print(f"Stops by itself in {self.check_minutes} minutes, or with Ctrl+C.")
        sys.stdout.flush()
        try:
            time.sleep(self.check_minutes * 60)
        except KeyboardInterrupt:
            pass
        check_server.shutdown()
        print("Stopped.")
        return 0


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--minutes", type=float, default=15)
    a = p.parse_args()
    sys.exit(BrowserCheck(a.port, a.minutes).run())
