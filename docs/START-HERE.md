# Start here

Three short guides for putting couch-tv on a TV for the first time, one step at a time. No AI agent
and no typing commands. Pick the one for your TV:

- [Google TV, with a phone](#google-tv-with-a-phone) (Sony, TCL, Hisense, Philips, Toshiba Google
  TVs, Chromecast with Google TV, Google TV Streamer)
- [Android TV, with a phone](#android-tv-with-a-phone) (older Sony, Philips, Xiaomi, Nvidia Shield
  and other Android TVs)
- [Samsung, with a computer](#samsung-with-a-computer) (Samsung TVs from 2018 on)

The same steps, with pictures, are on [couchtv.joshuaseage.com/get](https://couchtv.joshuaseage.com/get/).

**Not sure which you have?** On the TV open **Settings**, then **System**, then **About** (older TVs:
**Settings**, **Device Preferences**, **About**). If it says **Google TV**, or the home has For you,
Live, Shows and Apps along the top, it is Google TV. If it says **Android TV OS** and the home has
none of those, it is Android TV. A Samsung from 2018 on runs Samsung's own system (Tizen). LG, Fire
TV, Roku and the others have their own guides in [the docs index](README.md).

**Before you start, for every TV:**

- The TV and your phone (or computer) on the **same Wi-Fi**. Not a guest network.
- About 15 minutes (Samsung: about 30), the TV remote, and your phone.
- Nothing on the TV is deleted. You can always go back: see [UNINSTALL.md](UNINSTALL.md).

## Google TV, with a phone

You get couch-tv's home and the phone remote. Google keeps its own Home button on Google TV at
first. To make Home open Couch TV, do the optional steps at the end (new in couch-tv 0.13.9, no
computer). Or use a Mac or Windows computer once:
[Google TV with a computer](https://couchtv.joshuaseage.com/help/tv-google-computer/).

**Put the app on**

1. On the TV, go to **Apps** at the top, then **Search for apps**, and type **Downloader**.
2. Choose **Downloader by AFTVnews**, the first one. Press **Install**, then **Open**.
3. Downloader opens on a news page. Press **Up** again and again until the **Downloader** button at
   the top left turns light. Press **Right** twice, to the **#** button, and press **OK**.
4. Type **8180170** with the number pad on the screen, then press the tick (or **Load**).
5. The TV says it is not allowed to install unknown apps. Press **Right** to **SETTINGS** and press
   **OK**. Go down to **Downloader**, press **OK** to switch it on, then press **Back**.
   (Downloader closed after this? Many TVs do that: open it again and do steps 3 and 4 again.)
6. The TV asks "Do you want to install this application?". Press **Right** to **Install**, press
   **OK**, then **Open**. (Google Play Protect says the app is blocked? Press **OK**, switch off
   **Scan apps with Play Protect**, install it again, then switch that back on.)
7. **Couch TV** opens. Press **Open the home**. That is your Couch TV home.

**Pair your phone**

8. Point your phone's camera at the QR code on the **Couch TV** screen and open the page. The phone
   pairs by itself. (Or type the address the TV shows into the phone's browser, and the 6 digit
   phone code.)

**Every day:** press **Home**, go to **Couch TV** in your apps row, press **OK**, then **Open the
home**. After the optional steps, just press **Home**.

**Optional: Home opens Couch TV, and updates are one button** (new in couch-tv 0.13.9)

This lets Couch TV press keys for you. It needs **Wireless debugging**, which is on Android 11 or
newer.

9. On the TV: **Settings**, **System**, **About**. Press **OK** on **Android TV OS build** (on some
   TVs, **Build**) seven times. A message says you are now a developer.
10. Press **Back**, open **Developer options**, switch on **Wireless debugging**. Tick **Always allow
    on this network**, then **Allow**. Careful: never press OK on **Revoke USB debugging
    authorisations**, which sits right next to it. No Wireless debugging? Android 10 or older has
    none: switch on **Network debugging** (on some TVs, **USB debugging**) instead and skip step 11.
11. Choose **Pair device with pairing code**. Leave that screen open.
12. On your phone remote, open the TV menu at the top, then **Home settings on this phone**, **This
    TV**, **Let the phone press keys**. Type the 6 digit code from the TV and press **Send the code**.
13. On the TV, open **Couch TV** and press **Make Home open Couch TV**. From now on, updates are one
    button too: **Home settings**, **Updates**, **Update to**.

Make Home open Couch TV is new in 0.13.9 and has not yet been tried on a real Google TV. If it does
not work on yours, the computer way above still does.

**Stuck?** Under **Let the phone press keys** on the phone, press **Check now** under **Can't
connect?**. It says what is in the way and how to fix it. **Copy a report** copies a short note
(no addresses, no passwords) to paste when you ask for help. The common ones are in
[TROUBLESHOOTING.md](TROUBLESHOOTING.md#the-phone-cant-press-keys-adb-or-wireless-debugging-wont-connect).

## Android TV, with a phone

You get couch-tv's home, with the Home button, and the phone remote.

**Put the app on**

1. On the TV, open **Google Play Store**, choose the search at the top and type **Downloader**.
2. Choose **Downloader by AFTVnews**, the first one. Press **Install**, then **Open**.
3. Downloader opens on a news page. Press **Up** again and again until the **Downloader** button at
   the top left turns light. Press **Right** twice, to the **#** button, and press **OK**.
4. Type **8180170** with the number pad on the screen, then press the tick (or **Load**).
5. The TV says it is not allowed to install unknown apps. Press **Right** to **SETTINGS** and press
   **OK**. Go down to **Downloader**, press **OK** to switch it on, then press **Back**.
   (Downloader closed after this? Open it again and do steps 3 and 4 again.)
6. The TV asks "Do you want to install this application?". Press **Right** to **Install**, press
   **OK**, then **Open**. (Google Play Protect says the app is blocked? Press **OK**, switch off
   **Scan apps with Play Protect**, install it again, then switch that back on.)

**Make it the home**

7. **Couch TV** opens. Press **Use as home screen**.
8. The TV asks which home to use. Choose **Couch TV**, then **Always**.

**Pair your phone**

9. Back on the **Couch TV** screen, point your phone's camera at the QR code and open the page. The
   phone pairs by itself. (Or type the address the TV shows, and the 6 digit phone code.)
10. Press **Home** on the TV remote. couch-tv's home opens.

**Optional: let the phone press keys, and updates are one button** (new in couch-tv 0.13.9)

11. On the TV: **Settings**, then **Device Preferences** (or **System**), then **About**. Press
    **OK** on **Android TV OS build** (on some TVs, **Build**) seven times.
12. Press **Back** and open **Developer options**. What you switch on depends on the TV:
    - It has **Wireless debugging** (Android 11 or newer): do steps 10 to 12 of the Google TV guide
      above.
    - No Wireless debugging (Android 10 or older has none): switch on **Network debugging** (on some
      TVs, only **USB debugging**). Then on your phone remote, open the TV menu at the top, then
      **Home settings on this phone**, **This TV**, press **Let the phone press keys**, and on the TV
      tick **Always allow** and press **Allow**.
13. From now on, updates are one button: on the TV, **Home settings**, **Updates**, **Update to**.

**Stuck?** Press **Check now** under **Can't connect?** on the phone, as in the Google TV guide. On
a TV with a network cable, Wireless debugging will not switch on: use Network debugging, or put the
TV on Wi-Fi.

## Samsung, with a computer

You get couch-tv as an app on the Samsung, opened from the apps row. Samsung's Home button still
opens Samsung's menu. You need a Mac or Windows computer for about 30 minutes, and a free Samsung
account. The computer is only needed for the setup.

1. On the computer, download **couch-tv-samsung-setup.zip** from
   [the Releases page](https://github.com/Seagey/couch-tv/releases/latest) and unzip it.
2. Double-click **Install on Mac.command** (Windows: **Install on Windows.cmd**). It shows **This
   computer's address is**, like 192.0.2.20. Leave it open. (The first time, the computer asks if
   you trust it: on a Mac, **Open Anyway** in System Settings, Privacy and Security; on Windows,
   **More info**, **Run anyway**.)
3. On the TV, open **Apps** and press **1 2 3 4 5** on the remote. No number buttons? Press **123**
   (on some remotes, four coloured dots) and pick the numbers on screen. 2022 and newer: if nothing
   happens, open **App Settings** at the bottom of Apps, then press 1 2 3 4 5.
4. Switch **Developer mode** on, type that address (each group as it is: 1, not 001), then press
   **OK**.
5. Restart the TV: hold the power button about 5 seconds, until it goes off and on again. (On The
   Frame a short press is only Art Mode.)
6. In the setup window press **Return** (Windows: **Enter**).
7. Sign in to Samsung in the browser that opens.
8. Press **Allow** on the TV if it asks. couch-tv goes on the TV and opens.

So Couch TV opens again when you switch the TV on (if it was the last app you used): **Settings**,
**General**, **Smart Features**, **Autorun Last App**, **On**.

**Every day:** press **Home**, move to **Couch TV** in the row of apps, press **OK**.

**Get a design:** on the TV, open the gear (**Home settings**), then **Designs**, then **Get a design
from your phone**. Scan the QR code with your phone, pick your design and press **Send to my TV**.
Say yes to **Use this design?**.

**Stuck?** "No TV was found" or "The TV is not ready yet": switch the TV on with its remote first
(The Frame falls asleep from Art Mode by itself), check Developer mode is still on with this
computer's address, and that you restarted the TV by holding power. Then press **Return** in the
setup window (Windows: **Enter**) to check again. More in [SAMSUNG.md](SAMSUNG.md) and
[the Samsung help](https://couchtv.joshuaseage.com/help/tv-samsung/).

Opening by itself at every switch on, even when it was not the last app, and the phone remote need
a computer that stays on at home (optional): see [SAMSUNG.md](SAMSUNG.md).
