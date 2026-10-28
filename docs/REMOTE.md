# The phone remote: how it is hosted and how to install it

The phone remote is a small web page. The bridge (the program that runs on your computer at home)
serves it, so there is nothing to install from an app store.

## Where it lives

The bridge serves the remote over plain `http` on your home network:

```
http://<your-computer>.local:5400
http://<your-computer-address>:5400            (four numbers with dots between them)
```

Some things to know:

- It is **not** "localhost" on the phone. On a phone, `localhost` means the phone itself, so a link
  like that opens nothing. Always use the computer's name or address.
- The phone must be on the same Wi-Fi as the computer.
- Because the page is plain `http`, phones treat it as a normal website, not a secure one. That has
  three effects:
  - **No offline copy.** The phone will not keep the remote for use without the computer. If the
    computer is off, the remote shows "Can't reach the computer" and keeps trying by itself.
  - **No microphone button in the app.** Browsers only allow the mic on secure pages. Ask for a show
    by typing, or use your phone keyboard's own dictation key.
  - **A bookmark-style install.** "Add to Home Screen" gives you an icon that opens the remote full
    screen, like an app, but it is a bookmark underneath, not a true installed app.

Voice works through your phone keyboard's own mic key, and the remote sends the request by itself a moment after you stop talking. An in-app mic button only appears if the remote is served over `https` (see the optional section below).

Ask is a short chat. Claude may offer up to 3 quick replies under its answer, and tapping one sends it.

If the computer restarts or the bridge is updated, the remote notices the next time you open it and
switches to the new version by itself.

## Add the icon from the computer's fixed address, not the `.local` name

Use the computer's address (four numbers with dots between them) when you add the icon, and give that
computer a fixed address in your router (often called a DHCP reservation or "static lease") so the
number never changes.

The `.local` name works through a Wi-Fi lookup service that sometimes has not woken up yet when the
phone has just woken from sleep. In that moment the icon opens a blank page. The numeric address does
not need that lookup, so it opens straight away every time.

You can still open the `.local` name in the browser: the remote moves itself to the numeric address
straight away, so the icon you add from there gets the address. An icon added before that change
keeps the `.local` name. If it ever opens a blank page, remove it and add it again from the browser.

## iPhone (Safari)

1. On the phone, open Safari and go to `http://<computer address>:5400`.
2. Tap the Share button, then **Add to Home Screen**, then **Add**.
3. Open the new icon from the Home Screen. The remote opens full screen on a black background.

Use Safari for this step. Other iPhone browsers cannot add a Home Screen icon the same way.

## Android (Chrome)

1. On the phone, open Chrome and go to `http://<computer address>:5400`.
2. Tap the three dots menu, then **Add to Home screen** (on some phones it reads **Install app**).
3. Confirm. The icon appears on your Home screen and opens the remote full screen.

Over plain `http`, Chrome may offer a shortcut rather than a full install. Either works for daily use.

## Optional: a private network, for a real installed app, an offline copy and the mic

If you want the remote to behave like a proper app, give the computer an `https` address that only
your own devices can reach. The usual way is a private network (VPN) app that you run yourself. You
install it on the computer and on your phone, and it gives the computer a private name that comes
with a proper security certificate.

What you gain on that `https` address:

- A real installable app, not a bookmark.
- An offline copy, so the remote opens instantly and shows a calm message if the computer is away.
- The microphone button, so you can ask for a show by voice.
- Control of the TV from outside the house, if you choose to leave the private network app on.

Keep these rules whichever tool you pick:

- **The bridge must never be exposed on the public internet.** Do not forward a port on your router,
  and do not publish it through a public tunnel. The bridge can control your TV and has no login of
  its own. A private network that only your own devices can join is the only safe way to reach it
  from outside the house.
- Set the private `https` name in `config.json` under `bridge.host` so the pages the bridge writes
  point at the right address.
- Add the icon from the `https` address, not the `http` one, or the phone will keep treating it as
  the plain `http` site.

This section is optional. Everything else in the remote works without it.

## When the TV serves the remote itself

If you run couch-tv without a computer (the TV serves the remote itself), the address is the TV's
own, not a computer's. See `on-tv/README.md` once it exists for that setup. The icon steps above
are the same, just with the TV's address.
