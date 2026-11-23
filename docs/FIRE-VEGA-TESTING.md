# First test on a Fire TV running Vega OS

Thank you for being first. You need a Fire TV Stick on Vega OS (for example the 4K Select), a Mac or Linux
computer, a USB cable, a free Amazon Developer account, and the couch-tv bridge running (README, option B).
About an hour. Nothing here roots or changes the stick beyond Amazon's own Developer Mode, and
[FIRE-VEGA.md](FIRE-VEGA.md) ends with how to undo it.

Say what you see at each step, even when it works: a line is enough.

1. **Look first, change nothing.** `python3 scripts/check-vega.py <stick address>`. Paste what it prints.
   (Closed port and no `vega` command are both expected before step 2.)
2. **Install Amazon's tools** from [Amazon's Vega setup guide](https://developer.amazon.com/docs/vega/2.0/setup-overview.html)
   and run `vega --version`.
3. **Developer Mode** on the stick (FIRE-VEGA.md, step 1). Tell us if any screen differs from what it says.
4. **Network access** (step 2): USB cable once, then `vega device list` while the cable is out. Paste it.
5. **Build the app** (step 3). If `vega build` complains about our `App.tsx` or the manifest lines, paste
   the error: it is the most likely thing to need fixing.
6. **Install and open it** (step 4). Did the couch-tv home appear? Does the arrow key on the stick's own
   remote move around it? Run `vega device installed-apps` and paste the line for the app (the real id).
7. **Tell the bridge** (step 5), restart it, open the phone remote and pick the new TV. With couch-tv in
   front, press the arrows and OK on the phone. Do they move the home?
8. **Press Amazon's Home on the stick's remote, then Home on the phone remote.** Does couch-tv come back?
9. **Put the stick to sleep and wake it.** Did couch-tv open by itself? (`curl` the bridge's `/api/tvs` and
   paste the `hook` lines.)
10. **Netflix and YouTube from the phone**, if you use them: open one, then a show.

Open an issue at [github.com/Seagey/couch-tv/issues](https://github.com/Seagey/couch-tv/issues) with the
numbers above and what each did. Leave your pairing key, the stick's address and its MAC out.
