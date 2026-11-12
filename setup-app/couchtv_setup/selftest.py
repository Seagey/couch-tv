"""`couch-tv Setup --self-test`: checks the built app still has everything pairing needs (SPAKE2,
pyOpenSSL's TLS 1.3 and keying material export, cryptography, the TLS client) by pairing with
itself on this computer. Changes nothing, talks to no TV. The build workflow runs it on each app."""
import socket
import ssl
import tempfile
import threading

from . import pairing
from .identity import Identity


def run():
    client, tv = Identity(tempfile.mkdtemp()), Identity(tempfile.mkdtemp())
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    got = {}
    t = threading.Thread(target=lambda: got.setdefault("key", pairing.serve_once(listener, "246810", tv.cert, tv.key)))
    t.start()
    pairing.pair("127.0.0.1", listener.getsockname()[1], "246810", client.cert, client.key, client.public_text)
    t.join(10)
    listener.close()
    assert got.get("key") == client.public_text, "pairing with itself failed"
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_3
    ctx.load_cert_chain(client.cert_path, client.key_path)
    print("self test ok")
