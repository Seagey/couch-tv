#!/usr/bin/env python3
"""The first test on a TiVo OS TV (built by Vestel: JVC, Telefunken, Medion and others), docs/TIVO.md.
Run it with the bridge stopped.

    python3 scripts/tivo-check.py                   # look for the TV on the network, then test it
    python3 scripts/tivo-check.py <tv address>      # test this one
    python3 scripts/tivo-check.py <tv address> --ask DisneyPlus --ask Spotify    # more DIAL names to ask about
    python3 scripts/tivo-check.py <tv address> --key volume_up                   # press one key, then stop

Reading needs nothing but Python itself. It asks who is on the network (SSDP), knocks on the ports a
Vestel set is known to use, reads the TV's own description, asks DIAL which apps it knows and reads the
Smart Center state. It sends no key, opens nothing and changes nothing. Serial numbers, device ids and
MAC addresses are hidden in what it prints. Paste the output into a GitHub issue.

--key is the one thing that changes something on the TV: it presses that key once, the way the bridge
does, so you can see whether your TV takes keys. Watch the screen: the TV answers 200 to every key, also
to one it ignores, so only your eyes can tell.
"""
import argparse
import re
import select
import socket
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import quote

SSDP_GROUP = ("239.255.255.250", 1900)
SSDP_TARGETS = [
    "urn:dial-multiscreen-org:service:dial:1",
    "urn:schemas-upnp-org:device:MediaRenderer:1",
    "upnp:rootdevice",
]
# Brands Vestel builds TiVo OS sets for. Only used to pick the TV out of the SSDP answers.
TV_HINTS = ("vestel", "tivo", "jvc", "telefunken", "medion", "hitachi", "toshiba", "daewoo", "regal",
            "finlux", "techwood", "bush")
TV_PORTS = {
    56789: "Vestel Smart Center (keys and state on older Vestel sets)",
    56790: "Vestel Smart Center, second port",
    1986: "Vestel command port (older sets)",
    2870: "DLNA media renderer",
    7681: "websocket service seen on Vestel sets",
    8008: "DIAL or Cast",
    8009: "Cast",
    8443: "Cast, encrypted",
    9080: "DIAL on Novatek based sets",
    7236: "Miracast",
    12345: "DIAL of the Vewd browser engine (seen on a JVC, chassis MB180)",
}
# Not announced by SSDP on every set, so these are tried when a port is open and nothing was announced.
DESCRIPTION_GUESSES = {56790: "/dd.xml", 12345: "/deviceDescription.xml", 8008: "/ssdp/device-desc.xml",
                       9080: "/"}
# DIAL has no "list all apps", a server only answers for names it is asked about. The browser names are
# guesses: no public list says what Vestel registers its browser as.
DIAL_APPS = ["YouTube", "Netflix", "AmazonInstantVideo", "PrimeVideo", "DisneyPlus", "SmartCenter",
             "Browser", "WebBrowser", "OpenBrowser", "Internet"]
BODY_LIMIT = 1500
# The keys --key takes by name. volume_up to browser ran on a real JVC; a code from 1000 to 1099 can be
# given as it is. Power is left out on purpose: a first test should not switch the TV off.
KEY_CODES = {"volume_up": 1016, "volume_down": 1017, "mute": 1013, "up": 1020, "down": 1019, "left": 1021,
             "right": 1022, "ok": 1053, "back": 1010, "yellow": 1050, "browser": 1065}
POWER_CODE = 1012


class Redactor:
    """The output is meant for a public issue, and a device description carries ids that single out one
    household's TV."""

    RULES = [
        (re.compile(r"(?i)uuid:[0-9a-f-]{8,}"), "uuid:<hidden>"),
        (re.compile(r"(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b"), "<hidden id>"),
        (re.compile(r"(?i)\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b"), "<hidden mac>"),
        (re.compile(r"(?is)(<serialNumber>).*?(</serialNumber>)"), r"\1<hidden>\2"),
    ]

    @classmethod
    def clean(cls, text_raw):
        text_clean = text_raw
        for rule_pattern, rule_replacement in cls.RULES:
            text_clean = rule_pattern.sub(rule_replacement, text_clean)
        return text_clean


class HttpAnswer:
    def __init__(self, status=None, headers=None, body="", error=None):
        self.status = status
        self.headers = headers or {}
        self.body = body
        self.error = error


class HttpReader:
    """GET only. A class of its own so the check cannot grow a POST by accident."""

    def __init__(self, http_timeout=4.0):
        self.http_timeout = http_timeout
        # An empty ProxyHandler: with HTTP_PROXY set in the environment, urllib would send the request for
        # a TV on the home network to the proxy, which cannot see it.
        self.http_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def get(self, url):
        try:
            with self.http_opener.open(url, timeout=self.http_timeout) as reply:
                return HttpAnswer(reply.status, dict(reply.headers), reply.read(65536).decode("utf-8", "replace"))
        except urllib.error.HTTPError as e:
            return HttpAnswer(e.code, dict(e.headers or {}), e.read(65536).decode("utf-8", "replace"))
        except (OSError, ValueError) as e:
            return HttpAnswer(error=str(e))


class KeySender:
    """The only part of this script that writes to the TV, kept apart from HttpReader so reading stays
    reading."""

    def __init__(self, tv_address, key_timeout=6.0):
        self.key_url = f"http://{tv_address}:56789/apps/SmartCenter"
        self.key_timeout = key_timeout
        self.key_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    @staticmethod
    def code_for(key_name):
        key_text = str(key_name).strip().lower()
        if key_text in KEY_CODES:
            return KEY_CODES[key_text]
        if re.fullmatch(r"10\d\d", key_text) and int(key_text) != POWER_CODE:
            return int(key_text)
        return None

    def press(self, key_code):
        # <remote> around the key matters: a real JVC answers 200 to a bare <key code=.../> and ignores it.
        key_body = f"<remote><key code={int(key_code)}/></remote>".encode()
        key_request = urllib.request.Request(self.key_url, data=key_body, method="POST", headers={
            "Content-Type": "text/plain; charset=ISO-8859-1", "Connection": "close"})
        try:
            with self.key_opener.open(key_request, timeout=self.key_timeout) as reply:
                return reply.status, None
        except urllib.error.HTTPError as e:
            return e.code, None
        except (OSError, ValueError) as e:
            return None, str(e)


class SsdpSearch:
    def __init__(self, ssdp_wait=4.0):
        self.ssdp_wait = ssdp_wait

    @staticmethod
    def own_addresses(tv_address=None):
        local_found = set()
        try:
            local_found.update(socket.gethostbyname_ex(socket.gethostname())[2])
        except OSError:
            pass
        if tv_address:
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as route_probe:
                    route_probe.connect((tv_address, 9))   # connect on UDP sends nothing, it only picks the route
                    local_found.add(route_probe.getsockname()[0])
            except OSError:
                pass
        return sorted(a for a in local_found if not a.startswith("127.")) or [""]

    def run(self, tv_address=None):
        """{ip: [answer headers]}. One socket per local address: a computer with a virtual adapter (WSL,
        Hyper-V, a VPN) otherwise sends the search out of that adapter and hears nothing."""
        ssdp_sockets = []
        for local_address in self.own_addresses(tv_address):
            try:
                ssdp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                ssdp_socket.bind((local_address, 0))
                if local_address:
                    ssdp_socket.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_IF, socket.inet_aton(local_address))
                ssdp_sockets.append(ssdp_socket)
            except OSError:
                continue
        ssdp_destinations = [SSDP_GROUP] + ([(tv_address, 1900)] if tv_address else [])
        for ssdp_socket in ssdp_sockets:
            for ssdp_target in SSDP_TARGETS:
                ssdp_message = ("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\n"
                                f"MX: 2\r\nST: {ssdp_target}\r\n\r\n").encode()
                for ssdp_destination in ssdp_destinations:
                    try:
                        ssdp_socket.sendto(ssdp_message, ssdp_destination)
                    except OSError:
                        pass
        ssdp_answers = {}
        ssdp_deadline = time.time() + self.ssdp_wait
        while ssdp_sockets and time.time() < ssdp_deadline:
            ssdp_ready, _, _ = select.select(ssdp_sockets, [], [], max(0.0, ssdp_deadline - time.time()))
            for ssdp_socket in ssdp_ready:
                try:
                    ssdp_data, (ssdp_ip, _) = ssdp_socket.recvfrom(4096)
                except OSError:
                    continue
                ssdp_headers = self.parse(ssdp_data.decode("utf-8", "replace"))
                if ssdp_headers not in ssdp_answers.setdefault(ssdp_ip, []):
                    ssdp_answers[ssdp_ip].append(ssdp_headers)
        for ssdp_socket in ssdp_sockets:
            ssdp_socket.close()
        return ssdp_answers

    @staticmethod
    def parse(ssdp_text):
        ssdp_headers = {}
        for ssdp_line in ssdp_text.split("\r\n")[1:]:
            if ":" in ssdp_line:
                header_name, header_value = ssdp_line.split(":", 1)
                ssdp_headers[header_name.strip().lower()] = header_value.strip()
        return ssdp_headers


class TivoCheck:
    def __init__(self, tv_address, http_reader, dial_apps_extra=()):
        self.tv_address = tv_address
        self.dial_apps = DIAL_APPS + [a for a in dial_apps_extra if a not in DIAL_APPS]
        self.http_reader = http_reader
        self.tv_ports_open = []
        self.dial_urls = []
        self.dial_apps_known = []
        self.smart_center_answers = False

    @staticmethod
    def describe(description_xml):
        """The few fields that name a TV, from a UPnP device description."""
        description_fields = {}
        for field_name in ("friendlyName", "manufacturer", "modelName", "modelNumber", "modelDescription"):
            field_match = re.search(rf"<{field_name}>([^<]*)</{field_name}>", description_xml)
            if field_match and field_match.group(1).strip():
                description_fields[field_name] = field_match.group(1).strip()
        return description_fields

    def knock_ports(self):
        print(f"\n== Ports on {self.tv_address}")
        for tv_port, tv_port_use in TV_PORTS.items():
            if self.knock(tv_port):
                self.tv_ports_open.append(tv_port)
            tv_port_state = "open  " if tv_port in self.tv_ports_open else "closed"
            print(f"  {tv_port:>5}  {tv_port_state}  {tv_port_use}")

    def knock(self, tv_port):
        """Two tries: a JVC on Wi-Fi refused the first knock on 56789 right after serving its
        description from there, and answered a GET on the same port a second later."""
        for knock_try in range(2):
            try:
                with socket.create_connection((self.tv_address, tv_port), timeout=3.0):
                    return True
            except OSError:
                time.sleep(0.7)
        return False

    def read_descriptions(self, ssdp_headers_list):
        print("\n== What the TV says about itself")
        description_urls = []
        for ssdp_headers in ssdp_headers_list:
            print(f"  SSDP: ST={ssdp_headers.get('st', '?')}  SERVER={ssdp_headers.get('server', '?')}")
            if ssdp_headers.get("location") and ssdp_headers["location"] not in description_urls:
                description_urls.append(ssdp_headers["location"])
        if not description_urls:
            print("  No SSDP answer from this address. Trying the usual places on the open ports.")
            description_urls = [f"http://{self.tv_address}:{p}{path}" for p, path in DESCRIPTION_GUESSES.items()
                                if p in self.tv_ports_open]
        for description_url in description_urls:
            description_answer = self.http_reader.get(description_url)
            if description_answer.error:
                print(f"  GET {description_url}: {description_answer.error}")
                continue
            print(f"  GET {description_url}: HTTP {description_answer.status}")
            for field_name, field_value in self.describe(description_answer.body).items():
                print(f"    {field_name}: {Redactor.clean(field_value)}")
            for service_type in sorted(set(re.findall(r"<serviceType>([^<]+)</serviceType>", description_answer.body))):
                print(f"    service: {service_type}")
            dial_url = next((v for k, v in description_answer.headers.items() if k.lower() == "application-url"), None)
            if dial_url:
                print(f"    DIAL Application-URL: {dial_url}")
                if dial_url not in self.dial_urls:
                    self.dial_urls.append(dial_url)

    def read_dial(self):
        print("\n== DIAL (which apps the TV would open when asked)")
        if not self.dial_urls:
            print("  No DIAL address was announced.")
            return
        for dial_url in self.dial_urls:
            print(f"  At {dial_url}")
            for dial_app in self.dial_apps:
                dial_answer = self.http_reader.get(dial_url.rstrip("/") + "/" + quote(dial_app))
                if dial_answer.error:
                    print(f"    {dial_app}: {dial_answer.error}")
                    continue
                dial_state = re.search(r"<state>([^<]*)</state>", dial_answer.body)
                print(f"    {dial_app}: HTTP {dial_answer.status}" + (f", state {dial_state.group(1)}" if dial_state else ""))
                if dial_answer.status == 200:
                    self.dial_apps_known.append(dial_app)
                    print("      " + Redactor.clean(dial_answer.body[:BODY_LIMIT]).strip().replace("\n", "\n      "))

    def read_smart_center(self):
        print("\n== Vestel Smart Center (port 56789)")
        smart_answer = self.http_reader.get(f"http://{self.tv_address}:56789/apps/SmartCenter")
        if smart_answer.error:
            print(f"  GET /apps/SmartCenter: {smart_answer.error}")
            self.smart_center_answers = "SmartCenter" in self.dial_apps_known
            return
        print(f"  GET /apps/SmartCenter: HTTP {smart_answer.status}")
        for header_name, header_value in smart_answer.headers.items():
            print(f"    {header_name}: {Redactor.clean(header_value)}")
        if smart_answer.body:
            print("    " + Redactor.clean(smart_answer.body[:BODY_LIMIT]).strip().replace("\n", "\n    "))
        self.smart_center_answers = smart_answer.status == 200 or "SmartCenter" in self.dial_apps_known

    def verdict(self):
        print("\n== What this means")
        if not self.tv_ports_open and not self.dial_urls:
            print("  Nothing answered. Is the TV on (not in standby) and on the same network? Some routers keep")
            print("  Wi-Fi devices apart (\"client isolation\", guest networks): then no computer can reach the TV.")
            return 1
        if self.smart_center_answers:
            print("  Smart Center answers: this TV should take the phone remote's keys (docs/TIVO.md). To see it,")
            print("  run this again with --key volume_up and watch the volume on the TV.")
        elif 56789 in self.tv_ports_open or any(":56789" in u for u in self.dial_urls):
            print("  Port 56789 is open but Smart Center did not answer as on older sets. Paste the lines above.")
        else:
            print("  No Smart Center: no known way to send keys over the network. On the TV, check that")
            print("  Settings, Devices, Virtual Remote is switched on, then run this again.")
        if self.dial_apps_known:
            dial_apps_shown = ", ".join(a for a in dict.fromkeys(self.dial_apps_known) if a != "SmartCenter")
            print(f"  DIAL knows: {dial_apps_shown or 'only Smart Center'}. Those could be opened from the phone.")
        elif self.dial_urls:
            print("  DIAL answers but knows none of the names asked for.")
        else:
            print("  No DIAL.")
        print("  couch-tv's page opens in the TV's own browser (Vewd Browser): scripts/tivo-browser-check.py")
        print("  shows what that browser can do.")
        return 0


def find_tv(ssdp_answers, http_reader):
    """The one address that looks like a Vestel built TV, or None after printing what was seen."""
    tv_candidates = []
    print("== Devices that answered the search")
    for ssdp_ip, ssdp_headers_list in sorted(ssdp_answers.items()):
        device_text = " ".join(h.get("server", "") for h in ssdp_headers_list)
        device_location = next((h["location"] for h in ssdp_headers_list if h.get("location")), None)
        device_fields = TivoCheck.describe(http_reader.get(device_location).body) if device_location else {}
        device_text += " " + " ".join(device_fields.values())
        print(f"  {ssdp_ip}  {Redactor.clean(device_fields.get('friendlyName', '?'))}  "
              f"({device_fields.get('manufacturer', '?')}, {device_fields.get('modelName', '?')})")
        if any(tv_hint in device_text.lower() for tv_hint in TV_HINTS):
            tv_candidates.append(ssdp_ip)
    if len(tv_candidates) == 1:
        return tv_candidates[0]
    if not ssdp_answers:
        print("  None. Run it again with the TV's address (the TV shows it under its network settings).")
    else:
        print("  Could not tell which one is the TV. Run it again with the TV's address.")
    return None


def press_key(a):
    key_code = KeySender.code_for(a.key)
    if key_code is None:
        print(f"Not a key this script presses: {a.key}. Names: {', '.join(KEY_CODES)}, or a code from 1000 to 1099.")
        return 1
    if not a.address:
        print("--key needs the TV's address: run without --key first to find it.")
        return 1
    key_status, key_error = KeySender(a.address).press(key_code)
    if key_error:
        print(f"The key did not get to the TV: {key_error}")
        return 1
    print(f"Sent {a.key} (code {key_code}), the TV answered HTTP {key_status}.")
    if key_status == 403:
        print("403 means the TV refused it: switch on Settings, Devices, Virtual Remote on the TV.")
        return 1
    print("The TV says 200 to every key, also to one it ignores. Did the TV do it? That is the answer.")
    return 0


def main(a):
    if a.key:
        return press_key(a)
    http_reader = HttpReader()
    ssdp_answers = SsdpSearch(a.wait).run(a.address)
    tv_address = a.address or find_tv(ssdp_answers, http_reader)
    if not tv_address:
        return 1
    tivo_check = TivoCheck(tv_address, http_reader, a.ask)
    tivo_check.knock_ports()
    tivo_check.read_descriptions(ssdp_answers.get(tv_address, []))
    tivo_check.read_dial()
    tivo_check.read_smart_center()
    return tivo_check.verdict()


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("address", nargs="?", help="the TV's address; leave out to look for it")
    p.add_argument("--ask", action="append", default=[], metavar="NAME",
                   help="one more app name to ask DIAL about (a read; may be given more than once)")
    p.add_argument("--key", metavar="NAME", help="press this one key on the TV instead of reading (it changes "
                                                 "what is on the TV: volume_up is a gentle first try)")
    p.add_argument("--wait", type=float, default=4.0, help="seconds to listen for SSDP answers")
    sys.exit(main(p.parse_args()))
