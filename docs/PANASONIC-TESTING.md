# Testing couch-tv on a Panasonic Viera TV

Thank you for offering. The Panasonic path is new, and a first result from a real Viera is the most useful
thing it can get. This guide is the one safe test, and you do not need to be technical to do it. It takes
about 15 minutes, most of it setting up.

## What the test does, and does not do

The test is a small script, `scripts/panasonic-check.py`. It:

- asks the TV for its description (the model)
- asks which remote actions it offers, which also says whether it is a newer set that needs pairing
- reads the volume and whether the TV is muted
- prints what the TV answered

It does **not**:

- press any button on your TV
- open or install anything on your TV
- change a single setting (it reads the volume, it does not set it)
- pair with your TV (that is a later, separate step, and only if you want to)
- send anything over the internet. It talks to the TV on your home network and prints on your screen.
  Nothing leaves your computer unless you copy it into a GitHub issue yourself.

You can stop at any time with Ctrl and C.

## What you need

- A Mac, Windows or Linux computer on the **same Wi-Fi or network** as the TV.
- The TV switched **on**.
- About 15 minutes.
- A free GitHub account, to post the result. If you would rather not make one, you can send the output to
  whoever asked you to test.

## Step 1. Two things on the TV

1. **Switch on the network remote.** On many Vieras: **Menu, Network, TV Remote App Settings** (older sets:
   **Network Link Settings**), then **TV Remote: On**. The words differ between years. If you cannot find
   it, run the test anyway: it will say whether the TV answered.
2. **Find the TV's address.** It looks like four numbers separated by dots, for example `192.0.2.20`. On the
   TV: **Menu, Network, Network Status** (or **Status**). Write down the **IP address**. If you cannot find
   it, your router's app or web page lists connected devices: look for the Panasonic.

While you are there, also write down:

- The **model number** (for example TX-55...). It is on the sticker on the back of the TV, and usually under
  **Menu, Help, System Information** or **Setup, System Menu, About**.
- The **firmware version**, from the same screen, if it shows one.
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
.venv/bin/python scripts/panasonic-check.py 192.0.2.20
```

**Windows (PowerShell):**

```powershell
.venv\Scripts\python scripts\panasonic-check.py 192.0.2.20
```

It finishes in a few seconds. What you might see:

- `Nothing answers on port 55000 ...` Check the TV is on, the address is right, the computer is on the same
  network, and TV Remote is switched on (step 1). Then run it again. If it still says this, that is a
  result too: please send it.
- `Stopped: ...` Copy it anyway. It tells us what the TV wants.
- Lines starting `trace`, then `Model: ...`, a list of remote actions, `Encrypted set: ...` and
  `Volume: ...`. That is the good result.

## Step 6. Copy the output

Select everything the script printed in the window, copy it, and paste it somewhere to read it through
before you share it.

**Safe to share:** the model, the list of actions, the volume, any error text. The script hides any PIN,
key or session for you (it prints `(hidden)` in their place), and this test never asks for a PIN anyway.

**Check before you paste, and remove if you see them:**

- Anything that looks like a password, PIN or long random code that is **not** marked `(hidden)`. Please
  tell us if you spot one, because that would be a bug.
- Your Wi-Fi network name or your name, if they appear in a line (the TV's own name for itself is in the
  description, and some people name their TV after themselves).

Your TV's address (like `192.0.2.20`) is a private home network address and is fine to leave in. Change it
to something else if you would rather.

**Never share:** your router login, or any file from the `bridge/data` folder.

## Step 7. Post it

1. Go to https://github.com/Seagey/couch-tv/issues/new
2. Title: `Panasonic first test: <your model number>`
3. In the box, write:
   - TV model number, and the year if you know it
   - Firmware version, if you found it
   - Wi-Fi or Ethernet
   - Whether you used a Mac, Windows or Linux computer
4. Paste the output underneath, inside three backticks on their own lines above and below it, so it stays
   neat.
5. Click **Submit new issue**.

That is all that is needed. If you are happy to keep going, the next steps (pairing on a newer set, then
one key from the phone, then the page opening in the browser) are in [PANASONIC.md](PANASONIC.md), "What to
test first", and we will help once we have read your first result.

## Easier option: have Claude Code do it with you

If you use Claude Code, open the couch-tv folder in it and say:

> Open this folder and follow docs/PANASONIC-TESTING.md with me

It will walk you through each step, run the commands, and help you work out your TV's address. You still
read the output before it goes anywhere, and it will not post anything for you.

## Stuck?

Put what you got into an issue. A half finished test with an error message is still very useful.
