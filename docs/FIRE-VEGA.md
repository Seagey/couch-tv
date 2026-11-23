# couch-tv on a Fire TV running Vega OS (New)

**New.** This is the first couch-tv path for Amazon's Vega OS (Fire TV Stick 4K Select, and the newer
sticks that run it). The bridge side is written from Amazon's own documentation and checked against a
stand-in stick on a computer (`tests/vega_standin.py`). The app side (`vega/`) is a few files you drop into
a project made with Amazon's tools, and you build it yourself. We are looking for the first person with a
real stick: [FIRE-VEGA-TESTING.md](FIRE-VEGA-TESTING.md) is a step by step guide, and the issue it ends
with is the most useful thing you can send.

## What it is

Vega is not Android. There is no ADB, no APK, and no way to replace Amazon's home. So, like
[Samsung](SAMSUNG.md), [LG](LG.md), [Roku](ROKU.md) and [VIDAA](VIDAA.md), couch-tv on Vega is **an app
that opens itself, not a true home screen**:

- **The app** (`vega/`) is a tiny Vega app (React Native for Vega) that shows the couch-tv home page in
  Amazon's own WebView. You build it once with Amazon's free tools and install it with Developer Mode.
- **The page** is the same couch-tv home the bridge already serves (`/tv/`).
- **The bridge** (`bridge/vega.py`, option B, a computer that stays on) opens the app when the stick comes
  up, and carries the phone remote's keys to the page.

It needs the computer that stays on. Without one the app opens the page from nowhere and has nothing to show.

## What works and what does not

| | Vega OS |
|---|---|
| couch-tv home in the app, apps in your order, the remote's arrows and OK | Yes, through the WebView, once the app is built and installed |
| Opens by itself when the stick comes up | Built: the bridge opens the app a few seconds after the stick joins the network. Whether the stick leaves the network in standby is not confirmed |
| Amazon's Home button | **Still opens Amazon's home.** Nothing on Vega lets an app replace it. Press Home on the phone remote to bring couch-tv back |
| Phone remote: arrows, OK, Back, play and pause | Built. Keys are pressed on the page itself (Vega has no key injection), so they work **while couch-tv is in front** |
| Volume, mute, input, power off from the phone | **No.** Those belong to the stick and Amazon documents no way to press them |
| Power on from the phone | Wake-on-LAN, if the stick wakes that way. Not documented by Amazon |
| Open Netflix or YouTube, and a show or video in them | Built, through DIAL (the same thing a phone's Cast button uses). Payloads are the apps' own DIAL formats |
| Open any other app from the phone | **No.** A Vega app is opened by its own id and the stick does not list them to the network. Other apps are picked with the stick's remote |
| Which app is in front, what is playing, screenshots, typing from the phone | No |
| Root, or anything that bypasses Amazon's rules | **Never** |

## What you need, and what it costs

All free, none of it paid for by couch-tv:

- An **Amazon Developer account**. Amazon's Developer Mode page lists it as a prerequisite and describes
  signing in; it does not mention a fee. Creating a developer account is free as far as we know (not on
  the Vega pages themselves, so check when you sign up).
- A **Mac or Linux computer** to build with. Amazon says Windows and WSL are not supported.
- **Amazon's Vega tools** (Vega CLI, SDK, Visual Studio Code). The docs we read do not state a price.
- A **USB cable** from the computer to the stick, once, to switch on network access. Amazon's TCP/IP page
  starts "connect the device by USB", and press reports say USB is the only sideloading route.
- Your own **bridge** (option B) with `"kind": "vega"` in `config.json`.

You do **not** need to publish anything to the Amazon Appstore. (If you wanted to, Amazon documents a
submission process and review. We have not tried it, and a free home dashboard may or may not pass review.)

## Set it up

1. **Developer Mode on the stick** (Amazon's steps): Settings, My Fire TV, About, press OK on the device
   name seven times, then Developer options, Developer Mode, Continue. It shows a 6 digit code. On the
   computer: `vega devmode login`, then `vega devmode enable-device --code <code>`. The stick restarts.
   Developer Mode links the stick to your Amazon account until you factory reset it.
2. **Network access** (Amazon's "Connect to a device over TCP/IP"): with the USB cable in, `vega exec vda
   devices`, then `vega exec vda tcpip 5555`. Unplug, find the stick's address (Settings, My Fire TV, About,
   Network) and `vega exec vda connect <address>:5555`. Give the stick a fixed address in your router.
3. **Build the app.** Make a project with `vega project generate` (a blank React Native app), copy
   `vega/src/App.tsx` over its `src/App.tsx`, add `vega/manifest-additions.toml` to its `manifest.toml`,
   and point it at your bridge:

   ```sh
   COUCHTV_KEY=<your pairing key> python3 vega/make-config.py http://<bridge address>:5400 <tv id>
   ```

   Copy the `src/bridge.json` it writes into the project's `src`. Build with `vega build`. The key is inside
   the app you build, so keep that app to yourself (it is in `.gitignore` here).
4. **Install and open it:** `vega device install-app --packagePath <the .vpkg> -d <address>:5555`, then
   `vega device launch-app --appName <the app id> -d <address>:5555`. `vega device installed-apps` lists the
   real app id; if it is not `com.couchtv.home.main`, put it in the TV's `app_id` below.
5. **Tell the bridge:** in `config.json`

   ```json
   { "id": "bed", "name": "Bedroom", "kind": "vega", "ip": "<stick address>", "mac": "<stick mac>" }
   ```

   Optional: `app_id`, `port` (5555), `dial_port` (1900), `dial_name` (`CouchTV`), `cli` (the path to
   `vega` if it is not on the bridge's PATH), `open_on_power_on` (`false` to stop the app opening itself),
   `wake_on_lan` (`false` to switch the wake packet off).

   For the bridge to open the app, either `vega` is on the bridge computer (`vega exec vda connect` is run
   for you), or the app's DIAL entry works (below). Netflix and YouTube links need only DIAL.
6. Run `python3 scripts/check-vega.py <stick address>`: it only reads.

## How it works, and what is and is not confirmed

**Confirmed by Amazon's documentation** (links below):

- Vega apps are React Native for Vega, built with the Vega CLI/SDK; the CLI runs on macOS and Linux.
- Developer Mode needs an Amazon Developer account, a 6 digit code and a restart; sideloading is limited to
  non-Amazon package ids; the stick must be on the same network as the computer.
- `vega device install-app`, `launch-app`, `running-apps`, `is-app-installed`, and `vega exec vda connect
  <ip>:5555` after a one off USB step.
- A WebView component (`@amazon-devices/webview`) loads a URL; plain http is blocked unless the manifest has
  a `network-traffic-policy.cleartext` section; the arrow keys, Enter and media keys reach the page.
- DIAL on Vega: SSDP on 239.255.255.250:1900, the `Application-URL` header, GET and POST on the app name,
  and an app opts in with a `dial_id` extra in its manifest.

**Our reading, not confirmed on a real stick** (these are where it will most likely need fixing):

- That the app id is `<package>.main`, and the exact manifest fields: take Amazon's generated project as
  the truth and tell us what differs.
- That DIAL launches a sideloaded app (Amazon does not say). The bridge tries the CLI first for that reason.
- The DIAL payloads for Netflix (`m=<watch link>`) and YouTube (`v=<id>`), and that a Vega stick registers
  them under the names `Netflix` and `YouTube`.
- That the developer port closes when the stick sleeps, which is how the bridge sees it come on. Wake-on-LAN
  for a stick in standby is not documented at all.
- That a page that is asking the bridge for keys is in front. When Amazon's home takes over, the page's
  requests may carry on a while, so the phone remote may press keys at a page nobody is looking at for a
  few seconds.
- Amazon's DIAL page says nothing on whether a sideloaded app survives updates; one AFTVnews author reported
  sideloaded Vega apps eventually stopped launching. If yours does, rebuild and reinstall.

**Not possible, as far as we found:** replacing or sitting in front of Amazon's home, an app starting at
boot on its own, a phone or computer pressing keys on the stick over the network, Android apps (`.apk`),
and any free route that skips the developer account. Amazon's own Fire TV phone app has no published
protocol on Vega that we found.

## Undo

Remove the app: `vega device uninstall-app --appName <the app id> -d <address>:5555`. Developer Mode off:
Settings, My Fire TV, About, Developer options. It stays registered to your account until a factory reset
(Settings, My Fire TV, Reset to Factory Defaults). Take the TV out of `config.json` and the bridge forgets it.

## Sources (read November 2026)

- [Enable Developer Mode, Vega 2.0](https://developer.amazon.com/docs/vega/2.0/developer-mode.html)
- [Vega CLI tools, Vega 2.0](https://developer.amazon.com/docs/vega/2.0/cli-tools.html)
- [VDA over TCP/IP](https://developer.amazon.com/docs/vega/0.23/vda-over-tcpip.html)
- [Develop your app with WebView, Vega 2.0](https://developer.amazon.com/docs/vega/2.0/develop-your-app-with-webview)
- [DIAL on Vega](https://developer.amazon.com/docs/vega/0.21/dial-vega.html)
- [App submission, Vega 2.0](https://developer.amazon.com/docs/vega/2.0/app-submission.html)
- [Guide to building for Fire TV on Vega OS (Amazon, July 2026)](https://developer.amazon.com/apps-and-games/blogs/2026/07/guide-to-building-for-fire-tv-on-vega-os)
- [AFTVnews on sideloading Vega](https://www.aftvnews.com/?p=45426)