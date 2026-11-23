# Testing couch-tv on a Philips TV with Titan OS

Thank you for offering. Nobody has run couch-tv on a real Titan OS TV yet, so you would be the first. This
guide is the one safe test, and you do not need to be technical to do it. It takes about 15 minutes, most of
it setting up.

Please know before you start: today this is the **phone remote only**. couch-tv's own home screen cannot
open on a Titan OS TV yet (the reasons are in [PHILIPS-TITAN.md](PHILIPS-TITAN.md), "The home"). What you
send us decides how the remote is finished, and part of it (whether the TV lists Titan's DevView app) tells
us whether the home is possible later.

## What the test does, and does not do

The test is a small script, `scripts/philips-check.py`. It:

- talks to your TV the way Philips's own phone remote app does, on your home network
- reads what the TV says about itself
- after the optional pairing step, also reads whether it is on, its volume, its inputs, its apps and which
  app is open

It does **not**:

- press any button on your TV
- open, install or close anything on your TV
- change a single setting
- send anything over the internet. It talks to the TV and prints on your screen. Nothing leaves your
  computer unless you copy it into a GitHub issue yourself.

The only thing that ever appears on the TV is a PIN, and only in step 6, which is optional. You can stop at
any time with Ctrl and C.

## What you need

- A Mac, Windows or Linux computer on the **same Wi-Fi or network** as the TV.
- The TV switched **on**.
- About 15 minutes.
- A free GitHub account, to post the result. If you would rather not make one, you can send the output to
  whoever asked you to test.

## Step 1. Find the TV's address, and what it is

Every device on your network has an address that looks like four numbers separated by dots, for example
`192.0.2.20`. You need the TV's.

On the TV, open **Settings**, then **Network** (or **Wireless and networks**), then **Network status** (the
wording varies). Write down the **IP address**. If you cannot find it, your router's app or web page lists
connected devices; look for the Philips.

While you are in Settings, also:

- Find the **About** screen (often **Settings, General, About** or **Settings, Support**) and **take a photo
  of it**. Nobody has published what a Titan OS About screen says, so this photo is useful on its own.
- Write down the **model number** (also on the sticker on the back) and the **software version**.
- Note whether the TV is on **Wi-Fi or an Ethernet cable**.
- Look at the app row on the home screen and see whether there is an app called **DevView**. Write that
  down too.

## Step 2. Get the couch-tv files

The easy way, no extra software:

1. Go to https://github.com/Seagey/couch-tv/tree/philips-titan
2. Click the green **Code** button, then **Download ZIP**.
3. Open the ZIP so it becomes a folder. Move that folder somewhere easy, like your Desktop.

If you use git already: `git clone --branch philips-titan https://github.com/Seagey/couch-tv.git`

It has to be the `philips-titan` branch (the ZIP link above is that one). The main branch does not have this
test.

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
the installer). Then close the window and open a fresh one. On a Mac, the first time you use `python3` it may
offer to install developer tools. Say yes.

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

## Step 5. Run the test (no pairing)

Replace `192.0.2.20` with your TV's address from step 1.

**Mac and Linux:**

```sh
.venv/bin/python scripts/philips-check.py 192.0.2.20
```

**Windows (PowerShell):**

```powershell
.venv\Scripts\python scripts\philips-check.py 192.0.2.20
```

What you might see:

- `Nothing answers on port 1926 ...` followed by one of three reasons. If it still says that after a retry, that
  is a real result: please send it.
  - `refused`: the TV is on the network but has no Philips network remote on these ports.
  - `silent`: the TV is probably in deep standby. Switch it on with its own remote and run this again.
  - `unreachable`: this computer cannot reach devices on the home network. The usual causes are a VPN app with a
    kill switch, macOS Local Network permission refused (System Settings, Privacy and Security, Local Network),
    a guest Wi-Fi, or router client isolation.
- `JointSpace answers on /6/` and a line about the TV. That is the good result.
- `What the TV answers without a login:` and a short list, mostly `wants a login`. Expected: it shows which
  reads the TV guards.
- `Not paired yet, so that is all it can read.` Expected. You can stop here and go to step 8, or carry on
  with step 6.

## Step 6. Pairing (optional)

Pairing lets the test read more. It shows a PIN on the TV, and that is all it does on the TV.

Philips TVs only pair with a remote that signs the PIN with a key from Philips's own **TV Remote** phone app.
couch-tv does not include that key, because it belongs to Philips. If you have it (from your own copy of the
app, or somewhere you trust), save it on your computer:

```sh
.venv/bin/python scripts/philips-secret.py
```

(Windows: `.venv\Scripts\python scripts\philips-secret.py`.) It asks you to paste it and shows nothing as you
do. It stays in the `bridge/data` folder on your computer. If you do not have the key, skip to step 8: what
you have is already useful.

Then pair:

```sh
.venv/bin/python scripts/philips-check.py 192.0.2.20 --pair
```

The TV shows a PIN. Type it into the window and press Enter. It says `Paired` when it worked. If it says the
TV refused, run the same command again (each try shows a new PIN) and send us what it printed.

## Step 7. Run the test again, three times

Now run the step 5 command again, three times:

1. With the TV on its **home screen**.
2. With **Netflix or YouTube open** (open it with the TV's own remote first).
3. With **DevView open**, if your TV has it.

Each time it prints the power, the volume, the inputs, the app list and an `In front now` line. That line is
the main thing we need: whether the TV says which app is open.

## Step 8. Copy the output

Select everything the script printed, copy it, and paste it somewhere to read it through before you share it.

**Safe to share:** the model, the API version, the app list, the inputs, the volume, any error text. The
script never prints the PIN, the pairing key or the login.

**Check before you paste, and remove if you see them:**

- Anything that looks like a password, PIN or long random code. Please tell us if you spot one, because that
  would be a bug.
- Your name, if the TV's name includes it (for example "Anna's TV").

Your TV's address (like `192.0.2.20`) is a private home network address and is fine to leave in. Change it to
something else if you would rather.

**Never share:** your router login, your Philips account details, the pairing key, or any file from the
`bridge/data` folder.

## Step 9. Post it

1. Go to https://github.com/Seagey/couch-tv/issues/new
2. Title: `Philips Titan OS first test: <your model number>`
3. In the box, write:
   - TV model number and software version
   - Wi-Fi or Ethernet
   - Whether the TV has a DevView app
   - Whether you used a Mac, Windows or Linux computer
   - Whether you did the pairing step
4. Attach the photo of the About screen.
5. Paste the output underneath, inside three backticks on their own lines above and below it, so it stays
   neat.
6. Click **Submit new issue**.

That is all that is needed. If you are happy to keep going, we will send the next step (pressing one key and
opening one app from the computer) once we have read your result.

## Easier option: have Claude Code do it with you

If you use Claude Code, open the couch-tv folder in it and say:

> Open this folder and follow docs/PHILIPS-TITAN-TESTING.md with me

It will walk you through each step, run the commands, and help you find your TV's address. You still read the
output before it goes anywhere, and it will not post anything for you.

## Stuck?

Reply where you were asked to test, or put what you got into the issue. A half finished test with an error
message is still very useful.
