# Testing couch-tv on a Hisense VIDAA TV

Thank you for offering. couch-tv now runs on a real Hisense 55U7N (VIDAA 9). Your TV, on a different model or firmware, helps us make sure it works on yours too. This
guide is the one safe test, and you do not need to be technical to do it. It takes about 15 minutes, most
of it setting up.

## What the test does, and does not do

The test is a small script, `scripts/vidaa-check.py`. It:

- connects to your TV the way Hisense's own phone remote app does
- asks the TV where it is (home screen, live TV and so on) and which apps it has
- prints what the TV says for 60 seconds while you press buttons on the TV's own remote

It does **not**:

- press any button on your TV
- open or install anything on your TV
- change a single setting
- pair with your TV (that is a later, separate step, and only if you want to)
- send anything over the internet. It talks to the TV on your home network and prints on your screen.
  Nothing leaves your computer unless you copy it into a GitHub issue yourself.

You can stop at any time with Ctrl and C.

One honest caveat: some newer Hisense sets only let a phone remote in if it shows Hisense's own certificate.
If yours is one of those, the test will say it could not log in. That is a useful result, not a failure.
Please still send it.

The certificate comes from Hisense's Android app (RemoteNOW). You need an Android phone, or RemoteNOW from
Google Play in an Android emulator on your computer: there is no iPhone only way yet. Current RemoteNOW keeps
the certificate in a keystore, and `scripts/vidaa-cert.py` opens it when it has no password, or tells you
plainly when it is locked (thanks trentosc, #131).

## What you need

- A Mac, Windows or Linux computer on the **same Wi-Fi or network** as the TV.
- The TV switched **on** (not fully off).
- About 15 minutes.
- A free GitHub account, to post the result. If you would rather not make one, you can send the output to
  whoever asked you to test.

## Step 1. Find the TV's address

Every device on your network has an address that looks like four numbers separated by dots, for example
`192.0.2.20`. You need the TV's.

On the TV, go to **Settings**, then **Network**, then **Network Status** (or **Network Info**, the wording
varies). Write down the **IP address**. If you cannot find it, ask your router's app or web page for its
list of connected devices and look for the Hisense.

While you are in Settings, also write down:

- The **model number**. It is on the sticker on the back of the TV, and usually under **Settings, Support,
  About** (or **Settings, System, About**).
- The **VIDAA version** and **firmware version**, from the same About screen.
- Whether the TV is on **Wi-Fi or an Ethernet cable**.

## Step 2. Get the couch-tv files

The easy way, no extra software:

1. Go to https://github.com/Seagey/couch-tv
2. Click the green **Code** button, then **Download ZIP**.
3. Open the ZIP so it becomes a folder. Move that folder somewhere easy, like your Desktop.

If you use git already: `git clone https://github.com/Seagey/couch-tv.git`


## Step 3. Check Python is installed

The test needs Python 3.11 or newer.

**Mac:** open **Terminal** (press Cmd and Space, type Terminal, press Enter). Type:

```sh
python3 --version
```

**Windows:** open **PowerShell** (Start menu, type PowerShell). Type:

```powershell
py --version
```

**Linux:** open a terminal and type `python3 --version`.

If it prints 3.11 or higher, you are set. If it says command not found, or a lower number, install Python
from https://www.python.org/downloads/ (on Windows, tick **Add python.exe to PATH** on the first screen of
the installer). Then close the window and open a fresh one. On a Mac, the first time you use `python3` it
may offer to install developer tools. Say yes.

## Step 4. Set it up (once)

In the same window, move into the folder you made in step 2. The easy way: type `cd ` (with a space), then
drag the folder into the window and press Enter.

**Mac and Linux:**

```sh
python3 -m venv .venv
.venv/bin/pip install -r bridge/requirements.txt
```

**Windows (PowerShell):**

```powershell
py -m venv .venv
.venv\Scripts\pip install -r bridge\requirements.txt
```

This downloads a few small helper packages into the folder. It touches nothing else on your computer. On
Linux, if `venv` fails, install the `python3-venv` package and try again.

## Step 5. Run the test

Replace `192.0.2.20` with your TV's address from step 1.

**Mac and Linux:**

```sh
.venv/bin/python scripts/vidaa-check.py 192.0.2.20
```

**Windows (PowerShell):**

```powershell
.venv\Scripts\python scripts\vidaa-check.py 192.0.2.20
```

It will print a few lines, then say it is listening for 60 seconds. While it listens, pick up the TV's own
remote and press a few things: the Home button, then go into Settings and back out, switch to live TV, open
an app and come back. Each press is a message the TV sends, and those are exactly what we need.

It stops by itself after 60 seconds.

What you might see:

- `Nothing answers on port ... Is the TV on (not fully off)?` Switch the TV fully on, check the address and
  that the computer is on the same network, and run it again.
  If it still says nothing answers, check for a mesh Wi-Fi or a second router in router mode. The TV can
  end up on its own network behind the main router, where a computer plugged into the main router cannot
  reach it. Join the computer to the same Wi-Fi as the TV (or set the mesh to bridge mode) and try again.
  Thanks to trentosc for spotting this (#131).
- `Could not log in: ...` Copy it anyway. It tells us what the TV wants.
- `Logged in as couchtv-...`, then a line for where the TV is and a list of apps. That is the good result.

## Step 6. Copy the output

Select everything the script printed in the window, copy it, and paste it somewhere to read it through
before you share it.

**Safe to share:** the model, the lines about the screen, the app list, any error text. The script hides the
PIN and the pairing token for you (it prints `(hidden)` in their place), and this test never asks for a PIN
anyway.

**Check before you paste, and remove if you see them:**

- Anything that looks like a password, PIN or long random token that is **not** marked `(hidden)`. Please
  tell us if you spot one, because that would be a bug.
- Your Wi-Fi network name or your name, if they appear in a line. They should not.

Your TV's address (like `192.0.2.20`) is a private home network address and is fine to leave in. Change
it to something else if you would rather.

**Never share:** your router login, your Hisense account details, or any file from the `bridge/data` folder.

## Step 7. Post it

1. Go to https://github.com/Seagey/couch-tv/issues/new
2. Title: `VIDAA first test: <your model number>`
3. In the box, write:
   - TV model number
   - VIDAA version
   - Firmware version
   - Wi-Fi or Ethernet
   - Whether you used a Mac, Windows or Linux computer
4. Paste the output underneath, inside three backticks on their own lines above and below it, so it stays
   neat.
5. Click **Submit new issue**.

If you pressed buttons on the TV's remote and nothing printed, say that too. It is a real result.

That is all that is needed. If you are happy to keep going, we will send the next step (pairing) once we
have read your first result.

## Easier option: have Claude Code do it with you

If you use Claude Code, open the couch-tv folder in it and say:

> Open this folder and follow docs/VIDAA-TESTING.md with me

It will walk you through each step, run the commands, and help you work out your TV's address. You still
read the output before it goes anywhere, and it will not post anything for you.

## Stuck?

Reply on the Instagram comment or send a DM, or put what you got into the issue. A half finished test with
an error message is still very useful.
