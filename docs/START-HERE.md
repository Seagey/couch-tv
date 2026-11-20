# Start here

Three short guides for putting couch-tv on a TV for the first time, one step at a time. No AI agent
and no typing commands. Pick the one for your TV:

- [Google TV, with a phone](#google-tv-with-a-phone) (Sony, TCL, Hisense, Philips, Toshiba Google
  TVs, Chromecast with Google TV, Google TV Streamer)
- [Android TV, with a phone](#android-tv-with-a-phone) (older Sony, Philips, Xiaomi, Nvidia Shield
  and other Android TVs)
- [Samsung, with a computer](#samsung-with-a-computer) (Samsung TVs from 2018 on)

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

You get couch-tv's home and the phone remote. Google keeps its own Home button on Google TV, so you
open couch-tv from your apps row. (To make the Home button open couch-tv too, you need a Mac or
Windows computer once: see [the Setup app](../setup-app/README.md).)

**Put the app on**

1. On the TV, go to **Apps** at the top, then **Search for apps**, and type **Downloader**.
2. Choose **Downloader by AFTVnews**, the first one. Press **Install**, then **Open**.
3. Downloader opens on a news page. Press **Up** again and again until the **Downloader** button at
   the top left turns light. Press **Right** twice, to the **#** button, and press **OK**.
4. Type **8180170** with the number pad on the screen, then press the tick (or **Load**).
5. The TV says it is not allowed to install unknown apps. Press **Right** until **SETTINGS** is lit
   up, press **OK**, go down to **Downloader**, press **OK** to switch it on, then press **Back**.
6. If Downloader closed, open it again and type **8180170** again (step 3 and 4).
7. The TV asks "Do you want to install this application?". Press **Install**, then **Open**.
   If Google Play Protect says the app is blocked, press **OK**, switch off **Scan apps with Play
   Protect**, install it again, then switch that back on.
8. **Couch TV** opens. Press **Open the home**. That is your couch-tv home.

**Pair your phone**

9. Point your phone's camera at the QR code on the **Couch TV** screen and open the page. The phone
   pairs by itself. (Or type the address the TV shows into the phone's browser, and the 6 digit
   phone code.)

**Let the phone press keys** (for the arrows, typing and "what is playing" from the phone)

10. On the TV: **Settings**, **System**, **About**. Press **OK** on **Build** seven times. A message
    says you are now a developer.
11. Go back to **Settings**, **System**, **Developer options**. Switch on **Wireless debugging**.
    When it asks "Allow wireless debugging on this network?", tick **Always allow on this network**
    and choose **Allow**. Careful: never press OK on **Revoke USB debugging authorizations**, which
    sits right next to it.
12. Choose **Wireless debugging**, then **Pair device with pairing code**. Leave that screen open.
13. On your phone, open **Home settings**: the address the TV shows, with `/setup` on the end (for
    example `http://192.0.2.10:5400/setup`). Go to **This TV**, **Let the phone press keys**, type
    the 6 digit code from the TV, and press **Send the code**.

**Every day:** press **Home**, go to **Couch TV** in your apps row, press **OK**, then **Open the
home**.

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
5. The TV says it is not allowed to install unknown apps. Press **Right** until **SETTINGS** is lit
   up, press **OK**, go down to **Downloader**, press **OK** to switch it on, then press **Back**.
6. If Downloader closed, open it again and type **8180170** again (step 3 and 4).
7. The TV asks "Do you want to install this application?". Press **Install**, then **Open**.
   If Google Play Protect says the app is blocked, press **OK**, switch off **Scan apps with Play
   Protect**, install it again, then switch that back on.

**Make it the home**

8. **Couch TV** opens. Press **Use as home screen**.
9. The TV asks which home to use. Choose **Couch TV**, then **Always**.

**Pair your phone**

10. Back on the **Couch TV** screen, point your phone's camera at the QR code and open the page. The
    phone pairs by itself. (Or type the address the TV shows, and the 6 digit phone code.)
11. Press **Home** on the TV remote. couch-tv's home opens.

**Let the phone press keys**

12. On the TV: **Settings**, **Device Preferences**, **About**. Press **OK** on **Build** seven
    times.
13. Go back to **Settings**, **Device Preferences**, **Developer options**. What you switch on
    depends on the TV:
    - It has **Wireless debugging** (Android 11 and newer): do steps 11 to 13 of the Google TV guide
      above, with Device Preferences in place of System.
    - It has **Network debugging** (or only **USB debugging**): switch it on. Then on your phone, in
      **Home settings**, **This TV**, press **Let the phone press keys**, and on the TV tick
      **Always allow** and press **Allow**.

**Stuck?** Press **Check now** under **Can't connect?** on the phone, as in the Google TV guide. On
a TV with a network cable, Wireless debugging will not switch on: use Network debugging, or put the
TV on Wi-Fi.

## Samsung, with a computer

You get couch-tv as an app on the Samsung, opened from the apps row. Samsung's Home button still
opens Samsung's menu. You need a Mac or Windows computer for about 30 minutes, and a free Samsung
account. The computer is only needed for the setup.

1. On the computer, download **couch-tv-samsung-setup.zip** from
   [the Releases page](https://github.com/Seagey/couch-tv/releases/latest) and unzip it.
2. Find the computer's address. Mac: **System Settings**, **Wi-Fi**, **Details** next to your
   network, **TCP/IP**, "IP address". Windows: **Settings**, **Network & internet**, **Wi-Fi**, the
   network's **Properties**, "IPv4 address". (The setup also prints it in step 6.)
3. On the TV, open **Apps** and press **1 2 3 4 5** on the remote. No number buttons? Press **123**
   (on some remotes, four coloured dots) and pick the numbers on screen. 2022 and newer: if nothing
   happens, open **App Settings** at the bottom of Apps, then press 1 2 3 4 5.
4. Switch **Developer mode** on, type the computer's address (each group as it is: 1, not 001),
   then press **OK**.
5. Restart the TV: hold the power button about 5 seconds, until it goes off and on again. (On The
   Frame a short press is only Art Mode.)
6. On the computer, double-click **Install on Mac.command** (Windows: **Install on Windows.cmd**).
   The first time, the computer asks if you trust it: on a Mac, **Open Anyway** in System Settings,
   Privacy and Security; on Windows, **More info**, **Run anyway**.
7. Sign in to Samsung in the browser that opens.
8. Press **Allow** on the TV if it asks. couch-tv goes on the TV and opens.
9. To make couch-tv come back by itself: on the TV, **Settings**, **General**, **Smart Features**,
   **Autorun Last App**, **On**.

**Every day:** press **Home**, move to **Couch TV** in the row of apps, press **OK**.

**Stuck?** "No TV was found" or "The TV is not ready yet": switch the TV on with its remote first
(The Frame falls asleep from Art Mode by itself), check Developer mode is still on with this
computer's address, and that you restarted the TV by holding power. Then press **Return** in the
setup window (Windows: **Enter**) to check again. More in [SAMSUNG.md](SAMSUNG.md).

Opening by itself at every switch on, and the phone remote, need a computer that stays on at home
(optional): see [SAMSUNG.md](SAMSUNG.md).
