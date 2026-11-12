# Testing couch-tv on an older Philips TV (Saphi)

Thank you for offering. couch-tv's Saphi support is new (Beta), and what your TV answers decides how it is
finished. The first test takes two minutes, needs nothing installed and changes nothing on the TV. Background:
[PHILIPS-SAPHI.md](PHILIPS-SAPHI.md).

## What the tests do, and do not do

Steps 1 to 5 only **read**: they ask the TV what it is. They press no button, open nothing, change no setting
and send nothing over the internet. Step 6 is optional and opens one web page on the TV, nothing more. You can
stop at any point.

## Step 1. Find the TV's address

On the TV: **Settings**, then **Wireless and networks** (or **Network**), then **View network settings**. Write
down the **IP address**, four numbers with dots, for example `192.0.2.20`. While you are there, write down the
**model number** (also on the sticker on the back) and, under **Settings, About** (or **Update software,
Current software info**), the **software version**.

## Step 2. The cheapest test: ask the TV what it is

Keep the TV **on**. On a computer, phone or tablet on the **same Wi-Fi**, open a web browser and type this into
the address bar, with your TV's address instead of `192.0.2.20`:

```
http://192.0.2.20:1925/system
```

If that shows an error or nothing, try these, one at a time:

```
http://192.0.2.20:1925/6/system
http://192.0.2.20:1925/5/system
http://192.0.2.20:1925/1/system
```

What you might see:

- **Some text in curly brackets** with the model, a name and an `api_version`. That is the good result. Look
  through it for the word **browser** (your browser's Find, Ctrl and F or Cmd and F, is quickest) and note
  whether it is there. Copy the whole text.
- **A login box** asking for a user name and password. Your TV wants pairing. Press Cancel and note that.
- **Nothing, or "cannot connect"**, on all four. Your TV may not have the network remote, or it may be off.
  That is a real result too: please send it.

The page is plain text from your own TV on your own network. Nothing leaves your home.

## Step 3. If you can, the full read only test

This needs Python 3.11 or newer and the couch-tv files. [PHILIPS-TITAN-TESTING.md](PHILIPS-TITAN-TESTING.md),
steps 2 to 4, shows how, for Mac, Windows and Linux. Use the `philips-saphi` branch:
https://github.com/Seagey/couch-tv/tree/philips-saphi (green **Code** button, **Download ZIP**).

Then, in the couch-tv folder:

```sh
.venv/bin/python scripts/check-tv.py 192.0.2.20
.venv/bin/python scripts/philips-check.py 192.0.2.20
```

(Windows: `.venv\Scripts\python scripts\check-tv.py 192.0.2.20` and the same for `philips-check.py`.)

`philips-check.py` knocks on ports 1925 and 1926, uses 1925 first and prints:

- `JointSpace answers on /1/, port 1925 (plain)` (or `/6/`, `/5/`): the version.
- `Browser activity listed: yes` or `no`.
- `Login: none needed`: your TV needs no pairing, and the script reads the power, volume, inputs and what is
  in front. Lines that say `no answer` are fine and useful: many of these TVs leave some out.
- `Not paired yet`: your TV wants pairing. Stop there and send what it printed. Pairing is the
  [PHILIPS-TITAN-TESTING.md](PHILIPS-TITAN-TESTING.md) step 6, and only if you want to go further.

## Step 4. Twice more, with something else in front

Run `philips-check.py` again with **an app open** (YouTube, say) and again with **an HDMI input** showing. The
`In front now` and `Input in front` lines are what we need. An error on them is a result, not a failure.

## Step 5. Copy the output

Copy what the browser showed in step 2 and anything the scripts printed in steps 3 and 4. They never print a
PIN, a key or a login. If the TV's name includes your own name, change it before you share.

## Step 6 (optional). Does the TV's browser open a page?

Only if step 2 or 3 said **browser**. This opens one web page on the TV, the IANA example page, and nothing
else. On a Mac or Linux computer, with your TV's address and the version that worked in step 2 (`6`, `5` or
`1`):

```sh
curl -s -X POST -H 'Content-Type: application/json' -d '{"url": "https://example.com/"}' http://192.0.2.20:1925/6/activities/browser
```

Look at the TV. Note whether the browser opened with "Example Domain" on it, whether the browser's address bar
shows, and what pressing **Back** on the TV remote does. Press the remote's **Home** to leave. If the TV asked
for a login in step 2, skip this step.

## Step 7. Post it

1. Go to https://github.com/Seagey/couch-tv/issues/new
2. Title: `Philips Saphi first test: <your model number>`
3. Write: the model number and software version, Wi-Fi or Ethernet, which address in step 2 answered, whether
   **browser** was in it, and, if you did step 6, what the TV showed.
4. Paste the output underneath, inside three backticks on their own lines above and below it.
5. Click **Submit new issue**.

A test that stopped with an error is still useful. Thank you.

## Easier option: have Claude Code do it with you

If you use Claude Code, open the couch-tv folder in it and say:

> Open this folder and follow docs/PHILIPS-SAPHI-TESTING.md with me

It runs the read only steps with you. It only does step 6 if you say yes, and it will not post anything for
you.
