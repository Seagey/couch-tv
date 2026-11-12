# couch-tv on a TiVo OS TV (JVC, Telefunken and other Vestel built sets)

## Status: New, Beta

The TiVo OS path is new. It was worked out in November 2026 on one real TV, a **JVC LT-50VUQ3455** (TiVo
OS, software V.2.85.2.0, Vestel chassis MB180), with its owner in front of the screen. What ran on that TV
and what is still a guess are listed apart, below under "What is confirmed" and "What is unconfirmed", and
in one place in `bridge/tivo.py`. If you have a TiVo OS TV, please run the first test below and
[open an issue](https://github.com/Seagey/couch-tv/issues) with what it printed.

## Which TVs

- **TiVo OS on a TV built by Vestel**: sold in Europe as JVC, Telefunken, Hitachi, Daewoo, Regal and other
  names, from 2024 on. The box says "Smart TV powered by TiVo".
- **Older Vestel built smart TVs** (Toshiba, Telefunken, Hitachi, Finlux and others, before TiVo OS) answer
  on the same port and may take the phone remote the same way. Nobody has tried one with couch-tv, and their
  browser is a different one.
- **Not this page:** a TiVo Stream 4K is an Android TV box, a normal couch-tv TV (README, options A, B and
  C). A TiVo OS TV from another builder may not have Smart Center at all: the first test tells.

`scripts/check-tv.py <tv address>` recognises these TVs by port 56789.

## What it is

TiVo OS takes no outside apps, has no app store and lets nothing replace its home screen. It does ship a
web browser, Vewd Browser (Chrome 108 inside on the JVC), and it listens to a network remote, Vestel's
Smart Center. So couch-tv on TiVo OS is **a page that opens itself, not a true home screen**, the same idea
as on a [Panasonic Viera](PANASONIC.md):

- **The page** is the couch-tv home the bridge already serves. You add it once to the browser's Speed Dial,
  as its first tile (step 5).
- **The hook** (`bridge/tivo.py`): the bridge (option B, a computer that stays on) watches the TV. Each time
  the TV is switched on it waits a few seconds, presses the key that opens the browser, waits for it, and
  presses four more keys that lead to the tile: yellow, right, OK, OK.
- **The phone remote and the Claude ask** work against the TV through the same bridge.

It needs the computer that stays on. Without one there is nothing on the TV to open couch-tv.

## What works and what does not

| | TiVo OS (Vestel) |
|---|---|
| couch-tv home in the TV's browser | Yes. With the browser's "Always show menu bar" off, the page fills the whole screen (1920x1080) |
| Opens by itself when the TV is switched on | Built, with the bridge running. Home on the phone remote opened couch-tv on the real TV; a real power on has not been watched yet |
| TiVo's own Home button | **Still opens TiVo's home.** Press Home on the phone remote to get couch-tv back |
| Phone remote: arrows, OK, Back, volume up and down, open the browser | Yes. Volume, right, OK, yellow and the browser key ran on the real TV, the others are from the public key lists |
| Volume level | **No.** The TV gives no level to read, so the phone's slider says to use up and down |
| Opening Netflix and Prime Video from the phone | Yes, both opened on the real TV. Netflix takes a good while to load there |
| Other apps (YouTube, Disney+ and the rest) | Only from couch-tv's page, if at all. The TV refused the question for YouTube and does not know the others by the usual names. `--ask` in the first test finds names, `dial_apps` adds them |
| The remote's colour keys on couch-tv's page | **No.** They belong to the browser: yellow shows its bar, others change the zoom |
| The TV's own remote on couch-tv's page | By pointing: the arrows move the browser's pointer, a tile under it takes the focus, and OK opens it. The home switches to this by itself on TiVo OS. The arrows never reach the page as keys |
| "Put on Bluey" (find and play) | The app opens on its own page and the reply says to pick the show there. No deep link into a show is known on TiVo OS |
| Turning the TV on from the phone | Not tried. The power key is built for a TV that still answers, Wake on LAN for one that does not |
| Which app is in front, what is playing, screenshots | No. The TV does not tell the network any of it |
| Typing from the phone | Partly. Signs and backspace arrive, digits go as number keys, letters are untried. The browser's own address field takes no digits at all |
| Picture mode switch, ADB tools, switching the stock home off | No (Android only) |

## How the hook decides

TiVo OS does not say what is on screen, and it answers every key the same way whether it did anything or
not. So the hook is blind, and keeps to two rules:

- It opens couch-tv only when the TV has **just been switched on**, a few seconds after (`settle`, 8 s by
  default). It never takes over later.
- Anything the phone remote or Claude asked for wins: the hook stays quiet for 20 seconds after any
  command, except a power press from the phone, so turning the TV on from the phone also lands on couch-tv.

Being blind has a price. The browser opens on its own first page (Google) and the four keys only fit once
that page is up. If the TV's internet is slow one day and the page takes longer than `browser_wait` (9 s),
the keys land in the wrong place: Home on the phone remote runs it again. Pressing the browser key from
inside the browser goes out to TiVo's home and back in, so every run starts from the same place.

`"open_on_power_on": false` turns the hook off and keeps the phone remote.

The tile's address never carries the pairing key. The page asks for the key once, typed with the TV remote,
and keeps it in the browser's own storage.

## Before you start

- The bridge running on a computer that stays on (README, option B).
- The TV on the same network as that computer.
- **A fixed address for that computer** (a DHCP reservation in your router). The Speed Dial tile holds the
  computer's address: if the address changes, the tile opens nothing.

## Set it up

### 1. Settings on the TV

- **Settings, Devices, Virtual Remote**: must say Activated. On the JVC it did without anyone touching it.
  (On a German TV: Einstellungen, Geräte, Virtuelle Fernbedienung.)
- Note the TV's address, from Settings, Network.

### 2. The first test

With the bridge stopped:

```sh
python3 scripts/tivo-check.py                 # looks for the TV, then reads it
python3 scripts/tivo-check.py <tv address>    # if it did not find the TV by itself
```

It needs nothing but Python. It reads the TV's description, asks which apps it knows and reads the Smart
Center state. **It presses no key and changes nothing**, and it hides serial numbers and ids in what it
prints. Then, to see that your TV takes keys:

```sh
python3 scripts/tivo-check.py <tv address> --key volume_up
```

Watch the TV: the volume goes up one step. The TV answers "200" whether or not it did anything, so the
screen is the only proof.

`scripts/tivo-browser-check.py` is a second, optional test: it serves a small page that shows what the
TV's browser can do and which keys of the remote reach a page.

### 3. Tell the bridge about the TV

In `config.json`, add the TV with `"kind": "tivo"`:

```json
{ "id": "lounge", "name": "Lounge", "kind": "tivo", "ip": "<tv address>", "trace": true }
```

- `trace: true` logs every message to and from the TV (typed text is hidden). Leave it on for the first
  weeks: it is what an issue needs.
- `mac`: the TV's MAC address, for turning it on from fully off with Wake on LAN (untried on TiVo OS).
- `home_url`: the address for the tile, if the bridge picks the wrong one of this computer's addresses.
- `settle` [8]: seconds the hook waits after the TV comes on.
- `browser_wait` [9]: seconds from the browser key until the browser's first page is up.
- `key_gap` [2.5]: seconds between the keys that lead to the tile.
- `browser_path` [`["yellow", "right", "ok", "ok"]`]: those keys, if your browser needs different ones (for
  example a tile that is not the first).
- `dial_apps`: more apps the TV opens by name, as `{"disney-plus": "TheNameTheTvKnows"}`. Find names with
  `tivo-check.py --ask`.
- `port` [56789]: for a tester who finds the default wrong.

### 4. Start the bridge and read the tile's address

Start the bridge. `GET /api/tvs` shows a `tivo` block for the TV: whether the port answers, the model,
the Smart Center state, how many apps it knows, and **`home_url`**: the address for the next step. It looks
like `http://192.0.2.20:5400/titan/`.

### 5. The browser, once

On the TV, open **Vewd Browser** from TiVo's apps and do three things. The names are from a German
TV, translated: yours may differ a little.

1. **The tile.** Press the yellow key for the browser's bar, go right to the grid symbol (Speed Dial) and
   press OK. Choose **Add to Speed Dial** ("Zur Schnellwahl hinzufügen"). Name it `couch-tv` and type the
   `home_url` from step 4 as the address. This is the slow part: the remote's number keys do not type
   into the browser's fields, so every digit comes from the keyboard on screen. It must end up as the
   **first** tile.
2. **The bar.** In the browser's menu: **Settings, Always show menu bar: Off** ("Menüleiste immer
   zeigen: Aus"). The bar then hides once a page has loaded.
3. **The zoom.** In the same Settings, **Zoom** back to 100% if it is not. The colour keys change it by
   accident.

Open the tile once by hand. The page asks for the bridge's pairing key, if you set one: type it with the
remote. Then the couch-tv home opens.

### 6. Try it

Leave the browser, then press **Home** on the phone remote. About twenty seconds later couch-tv is on
screen. The same happens a few seconds after the TV is switched on.

## What is confirmed

All of it on the JVC LT-50VUQ3455 above, in November 2026:

- The TV answers an SSDP search and gives its DIAL address in `dd.xml` on port 56790.
- `GET :56789/apps/SmartCenter` says "running" while the TV is on.
- A key is `POST :56789/apps/SmartCenter` with `<remote><key code=1016/></remote>`. Volume up (1016),
  volume down (1017), right (1022), OK (1053), yellow (1050) and the browser key (1065) all did what
  they say.
- The browser key opens Vewd Browser on its first page. Yellow, right, OK, OK from there opens the first
  Speed Dial tile. From inside the browser the same five keys work too.
- A page from a computer on the home network loads, fills 1920x1080 with the bar off, and passed all 25
  checks of `tivo-browser-check.py` (Chrome 108: modules, async, grid, `:is()`, WebSocket, WebP and the
  rest). The remote's number keys reach a page as key events.
- `bridge/tivo.py` read that TV correctly: the model, the Smart Center state, and Netflix and Prime Video
  as the apps it knows.
- The bridge's own Home opened couch-tv's real home there, full screen, through the `/titan/` page (no
  pairing key was set).
- Netflix and Prime Video opened over DIAL (`POST :56789/apps/Netflix` answers 201), from the bridge and
  from a tile on couch-tv's home.
- On the home, pointing at a tile with the TV's remote gives it the focus and OK opens it.
- The TV stops answering for many seconds while it starts Netflix, and its web server takes one request
  at a time. The driver first read that as "switched off and on again" and sent the hook into the middle
  of Netflix. It now counts the TV as off only after 30 seconds without any answer.

## What is unconfirmed

- **The hook on a real power on.** Whether port 56789 goes away when the TV is switched off (the hook needs
  that to notice it coming on), and how long the TV needs after power on before it takes the browser key.
- **The pairing key page** (`/titan/` with a key set): typing the key with the TV remote.
- **Every key not listed above**: the arrows up, down and left, Back, mute, power, the media keys and the
  number keys as Smart Center codes. They are from the public lists for older Vestel sets.
- **Letters typed from the phone.**
- **Power on from the phone** and Wake on LAN.
- **Any other model**, and TiVo OS TVs that Vestel did not build.

## What was tried and does not work

Kept here so nobody has to find out twice:

- **A bare key**, `<key code=1016/>` without `<remote>` around it, the form most public notes give: the
  TV answers 200 and does nothing.
- **Typing the page's address from the bridge.** Characters go as
  `<keyboard><key value='46'/></keyboard>`. Dots, colons and backspace arrive in the browser's address
  field. Digits do not, neither as characters nor as number keys, and neither 10 nor 13 confirms the field.
  So an address with a port cannot be typed in from outside.
- **A start page.** The browser's settings have Zoom, Text size, Accessibility mode, Always show menu bar
  and Privacy. No start page.
- **Opening the browser over DIAL.** The TV knows none of Browser, WebBrowser, OpenBrowser or Internet as
  a DIAL name. A second DIAL server on port 12345 (the Vewd engine's) knows none of the names asked for
  either.
- **Installing anything.** TiVo OS has no developer mode an owner can reach. Rooting the TV is not a path
  couch-tv takes.

## If something goes wrong

- **Nothing answers:** is the TV on (not in standby) and on the same network? A guest Wi-Fi or "client
  isolation" in the router keeps the computer and the TV apart.
- **Keys answer 403:** Settings, Devices, Virtual Remote is switched off on the TV.
- **Keys answer 200 and nothing happens:** that is what the TV does with a key it ignores. With `trace` on,
  the log shows what was sent.
- **The keys end up somewhere else in the browser:** the first page was slower than `browser_wait`, or
  couch-tv is not the first tile. Raise `browser_wait`, or set `browser_path`.
- **The tile opens nothing:** the computer's address changed. Give it a fixed address and edit the tile.
- **The bar stays on screen:** step 5, "Always show menu bar".

## Undo

Remove the TV from `config.json`. On the TV, delete the Speed Dial tile ("Edit Speed Dial") and switch
"Always show menu bar" back on if you like. Nothing was installed on the TV and no setting outside the
browser was changed.
