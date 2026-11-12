# Testing couch-tv on a VIZIO TV

Thank you for offering. The VIZIO version of couch-tv is new, and nobody has run it on a real VIZIO yet, so
you would be the first. This guide is the one safe test, and you do not need to be technical to do it. It
takes about 15 minutes, most of it setting up.

On a VIZIO, couch-tv is a phone remote: power, volume, inputs and opening apps. Its home page does not open
on the TV by itself ([VIZIO.md](VIZIO.md), "The home"), so this test is about the remote.

## What the test does, and does not do

The test is a small script, `scripts/vizio-check.py`. Part 1 (the read):

- finds which network port your TV answers on (7345 or 9000)
- asks the TV whether it is on, which model it is, which input is on screen, which inputs it has, which app
  is in front and the volume
- prints what the TV answered

It does **not**:

- press any button on your TV
- open or install anything on your TV
- change a single setting
- send anything over the internet. It talks to the TV on your home network and prints on your screen.
  Nothing leaves your computer unless you copy it into a GitHub issue yourself.

Part 2 (pairing) makes the TV show a 4 digit PIN, the same as VIZIO's own phone app does the first time.
That is the only thing that appears on the TV. Without it, most VIZIOs answer "requires pairing" to every
question, so part 1 alone tells us little more than the port.

You can stop at any time with Ctrl and C.

## What you need

- A Mac, Windows or Linux computer on the **same Wi-Fi or network** as the TV.
- The TV switched **on**.
- About 15 minutes.
- A free GitHub account, to post the result. If you would rather not make one, you can send the output to
  whoever asked you to test.

## Step 1. Find the TV's address

Every device on your network has an address that looks like four numbers separated by dots, for example
`192.0.2.20`. You need the TV's.

On the TV, press **Menu** (or open **Settings**), then **Network**, then **Network information** (the
wording varies). Write down the **IP address**. If you cannot find it, ask your router's app or web page for
its list of connected devices and look for the VIZIO.

While you are in the menus, also write down:

- The **model number**. It is on the sticker on the back of the TV, and usually under **System,
  System information** (or **Admin and privacy, System information**).
- The **firmware version**, from the same screen, and whether it says **VIZIO OS** or **SmartCast**.
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

## Step 5. Part 1, the read

Replace `192.0.2.20` with your TV's address from step 1.

**Mac and Linux:**

```sh
.venv/bin/python scripts/vizio-check.py 192.0.2.20
```

**Windows (PowerShell):**

```powershell
.venv\Scripts\python scripts\vizio-check.py 192.0.2.20
```

What you might see:

- `Nothing answers on port 7345 or 9000 ...` Check the TV is on, the address, and that the computer is on
  the same network, and run it again.
- `A port is open, but nothing answers like a VIZIO` Copy it anyway. It tells us something.
- `SmartCast answers on port 7345` (or 9000), then a few lines that say `needs pairing`. That is the
  expected result before pairing. Go on to part 2.

## Step 6. Part 2, pairing (shows a PIN on the TV)

Only if you are happy for the TV to show a PIN. Stand where you can see the TV.

**Mac and Linux:**

```sh
.venv/bin/python scripts/vizio-check.py 192.0.2.20 --pair
```

**Windows (PowerShell):**

```powershell
.venv\Scripts\python scripts\vizio-check.py 192.0.2.20 --pair
```

A 4 digit PIN should appear on the TV. Type it in when the script asks and press Enter. It should say
`Paired`. The pairing token is saved in the `bridge/data` folder on your computer, where only you can read
it. It is never printed.

Then run part 1 again (step 5). This time it should print real answers: the power state, the inputs, the app
in front and the volume. Open an app with the TV's own remote (Netflix or YouTube, say) and run part 1 once
more, so we see what the TV says about an app.

If the PIN did not appear, or the script says the TV refused it, that is a real result too: copy it.

## Step 7. Copy the output

Select everything the script printed in the window, copy it, and paste it somewhere to read it through
before you share it.

**Safe to share:** the model, the lines about power, inputs and apps, any error text. The script hides the
PIN, the pairing token and the pairing request number for you (it prints `(hidden)` in their place).

**Check before you paste, and remove if you see them:**

- Anything that looks like a password, PIN or long random token that is **not** marked `(hidden)`. Please
  tell us if you spot one, because that would be a bug.
- The names you gave your inputs, if you would rather keep them private (for example a name on an HDMI
  port).
- Your Wi-Fi network name or your name, if they appear in a line. They should not.

Your TV's address (like `192.0.2.20`) is a private home network address and is fine to leave in. Change it
to something else if you would rather.

**Never share:** your router login, your VIZIO account details, or any file from the `bridge/data` folder.

## Step 8. Post it

1. Go to https://github.com/Seagey/couch-tv/issues/new
2. Title: `VIZIO first test: <your model number>`
3. In the box, write:
   - TV model number
   - VIZIO OS or SmartCast, and the firmware version
   - Wi-Fi or Ethernet
   - Whether you used a Mac, Windows or Linux computer
   - Whether the PIN appeared, and whether pairing said `Paired`
4. Paste the output underneath, inside three backticks on their own lines above and below it, so it stays
   neat.
5. Click **Submit new issue**.

That is all that is needed. If you are happy to keep going, we will send the next step (one key from the
phone remote, volume, an input and an app) once we have read your first result.

## Optional, for people who already run Home Assistant or a Cast tool

VIZIOs have Chromecast built in. If you already use Home Assistant's `cast.show_lovelace_view`, or a
DashCast style tool that shows a web page on a Cast device, you could try showing couch-tv's home page on
the VIZIO that way. It needs couch-tv's page at an `https://` address (your own reverse proxy with a
certificate; never open a router port for it). couch-tv has no code for this and it may not work at all. If
you try it, tell us in the issue what happened: [VIZIO.md](VIZIO.md), "One open experiment".

## Easier option: have Claude Code do it with you

If you use Claude Code, open the couch-tv folder in it and say:

> Open this folder and follow docs/VIZIO-TESTING.md with me

It will walk you through each step, run the commands, and help you work out your TV's address. You still
read the output before it goes anywhere, and it will not post anything for you.

## Stuck?

Reply on the Instagram comment or send a DM, or put what you got into the issue. A half finished test with
an error message is still very useful.
