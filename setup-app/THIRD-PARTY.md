# Third party code in couch-tv Setup

couch-tv Setup is part of couch-tv (MIT, see `../LICENSE`). It also contains or bundles the work
below. Each package's own licence file travels inside the built app (PyInstaller `--copy-metadata`).

## couch-tv-setup by killy10o10

The Fire TV setup builds on [couch-tv-setup](https://github.com/killy10o10/couch-tv-setup) by
killy10o10. Parts of these files are adapted from it, and each says so at the top:
`couchtv_setup/paths.py`, `couchtv_setup/finder.py`, `couchtv_setup/server.py`,
`couchtv_setup/web/index.html`, the `FIRE_MODELS` table in `couchtv_setup/steps.py`, and
`../.github/workflows/setup-app.yml`. What was reused and why is in `REVIEW-killy10o10.md`.

```
MIT License

Copyright (c) 2026 killy10o10

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Python packages inside the built app

| Package | Version | Licence | What for |
|---|---|---|---|
| [adb-shell](https://github.com/JeffLIrion/adb_shell) | 0.4.4 | Apache-2.0 | ADB in pure Python (the same library couch-tv's bridge uses) |
| [cryptography](https://github.com/pyca/cryptography) | 48.0.1 | Apache-2.0 or BSD-3-Clause | keys, the certificate, HKDF and AES-GCM for pairing (it bundles OpenSSL, Apache-2.0) |
| [pyOpenSSL](https://github.com/pyca/pyopenssl) | 26.2.0 | Apache-2.0 | TLS 1.3 with keying material export, for pairing |
| [rsa](https://github.com/sybrenstuvel/python-rsa) | 4.9.1 | Apache-2.0 | ADB key signing (through adb-shell) |
| [pyasn1](https://github.com/pyasn1/pyasn1) | 0.6.5 | BSD-2-Clause | used by rsa and adb-shell |
| [cffi](https://github.com/python-cffi/cffi) | 2.1.1 | MIT-0 | used by cryptography |
| [pycparser](https://github.com/eliben/pycparser) | 3.12 | BSD-3-Clause | used by cffi |
| [typing_extensions](https://github.com/python/typing_extensions) | 4.16.0 | PSF-2.0 | used by pyOpenSSL |
| [certifi](https://github.com/certifi/python-certifi) | 2026.10.23 | MPL-2.0 (unmodified) | the CA list for HTTPS to GitHub and Open-Meteo |
| Python | 3.12 | PSF-2.0 | the app runs on it (it bundles OpenSSL, Apache-2.0) |
| [PyInstaller](https://github.com/pyinstaller/pyinstaller) bootloader | 6.16.0 | GPL-2.0 with the bootloader exception | starts the app; the exception allows bundling any program |

## Written for couch-tv, from public specifications (nothing copied)

- `couchtv_setup/spake2.py`: SPAKE2 over edwards25519, written to match BoringSSL's
  `crypto/curve25519/spake25519.cc` (the constants M and N are the public points listed there).
- `couchtv_setup/pairing.py` and `couchtv_setup/adbtls.py`: Wireless debugging pairing and the TLS
  connection, written from AOSP `packages/modules/adb` (Apache-2.0) as a description of the protocol.
- `couchtv_setup/mdns.py`: a small mDNS browser from RFC 6762 and RFC 6763.
- `couchtv_setup/tv.py`: couch-tv's own `tv-home/tools/tvadb.py`.

Google's `adb` and platform-tools are not included.
