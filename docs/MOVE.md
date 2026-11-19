# Move what is playing to another TV

You are watching in one room and want to carry on in another. One tap on the phone remote pauses the
show on the first TV and starts it on the other one, as the same person, near the same spot.

**New.** It has run in one house, between a Sony Google TV and a Google TV Streamer, both ways. What
each app did there is in the table below. If it works (or does not) on yours, please open an issue and
say which TVs and which app.

## What you need

- Option B: the bridge, with **two or more TVs** in `config.json` ([CONFIG.md](CONFIG.md), The TVs).
- **Android TV or Google TV at both ends** (a Fire TV on Fire OS with `"adb_only": true` counts), with ADB
  allowed on both ([SETUP.md](SETUP.md), step 1). The bridge reads what is playing, and passes the
  "Who's watching?" screen, over ADB.
- The same app on both TVs, signed in to the same account. It has to be an app in the bridge's own
  list (`bridge/apps.py`).
- Optional, for landing on the same spot: the sync helper app of [SYNC.md](SYNC.md) on the TV you move to.

## How to use it

1. On the phone remote, pick the TV that is playing (pull down the **TV** menu, **Which TV**).
2. While something is playing or paused, a button **Move to <the other TV>** shows under the TV names.
   Tap it.
3. The first TV pauses. The other TV wakes, opens the app from a fresh start, picks your profile and
   plays. Allow 15 to 50 seconds, depending on the app.

If the other TV is playing something itself, nothing happens there and the phone asks first.

## What the bridge does

In this order (`POST /api/move`, [bridge/API.md](../bridge/API.md)):

1. Reads what is playing on the first TV, where it is up to, and who is watching there.
2. Checks the other TV: it is free, it has the app, and it is not on a kids profile.
3. Pauses the first TV, and checks that it took. If the pause key does not take, it is sent again,
   and then the sync helper (when that TV has it) is asked to pause the app itself. If the first TV
   still plays, the answer says so (`source_paused: false`) and the phone tells you to pause it.
4. Wakes the other TV, and waits 4 seconds for its home screen to settle.
5. Sets the same person on the other TV, before the show opens.
6. Closes the app on the other TV and opens the same title in it, picks that person's profile on a
   "Who's watching?" screen, and presses Play if the app stops on the title's page. If the show is open
   but not playing, it waits a little longer, and opens it once more if a profile screen has come up
   in the meantime. In Netflix only, if the screen cannot be read, it then
   presses OK and watches, up to three times.
7. Checks the other TV plays the same title, when both apps say what they play. If it is another one, it is
   paused there and the phone says so.
8. Reads where the other TV started. **Apps mostly resume by themselves.** Only when it is more than 5
   seconds from the first TV's spot is that spot used, as a backup (see below).
9. Leaves the first TV on and paused. It is only turned off when asked (`"power_off": true`), and only
   once the other TV is playing.

If anything fails before the show is open on the other TV (it will not wake, its ADB drops), the first
TV plays on and the other TV keeps the person it had.

## What each app did (one house, November 2026)

A Sony Google TV and a Google TV Streamer, the sync helper on both. "Blind OK" is the
`COUCHTV_MOVE_BLIND_OK` switch described under the limits. Two of the Netflix runs were started from a real phone;
the rest from the bridge's API or the remote page in a browser.

| App | Runs | Played | Seconds | Spot | What it needed, or why not |
|---|---|---|---|---|---|
| Netflix | 13 | 12 | 15 to 37 | Same spot, by itself or through the sync helper | OK pressed on the Streamer's profile screen (not readable). The one miss: a link opened straight after the wake was covered by the home screen; the 4 second wait fixed it |
| YouTube | 12 | 10 | 15 to 27 | Same spot, by the link with the time (once 10 s behind, before the 5 second rule) | Nothing. The 2 misses: YouTube sent its results page in another layout and the video was not found, so only YouTube's search opened; the lookup now asks again and remembers a video it found |
| Prime Video | 3 | 3 | 46 to 48 | Same spot in 2 runs (sync helper), from the start in 1 | Blind OK switched on for it: two presses (profile, then Play) |
| Disney+ | 14 | 2 confirmed right (a film, both ways) | 40 to 45 | Near the same spot (it resumed by itself) | The profile is picked by name. Only the two runs of a film had their title read back from the other TV and confirmed. Of the runs with the series "Bluey", the other TV was found on the series "Bluey Fancy Restaurant" whenever it was checked (4 runs; 2 more were not checked): Disney+ opens that one when asked for the show without an episode. The move now compares the two TVs' titles, pauses the other TV and says so. A move from "Bluey Fancy Restaurant" itself, which the show finder does not know, opens the app's search and says so |
| Plex | 1 | 0 | - | - | On the Sony the bridge saw nothing playing in Plex. And it has no link that opens a Plex title on the other TV |
| An app not in `bridge/apps.py` | 1 | 0 | - | - | Refused: the bridge has no way to open a title in it |

## The limits

- **Netflix can start at the wrong spot** when you move seconds after pausing or seconds after a long
  skip. Netflix resumes from the spot its own servers last saved, and that save lags behind (seen: a
  show moved one second after the pause started from the beginning). The backup fixes it only with the
  sync helper installed (below).
- **A show started with the TV's own remote can only be moved when the app says what it is.** YouTube
  and Disney+ do. Netflix and Prime Video do not (seen on both TVs: no title, or just "PrimeVideo"), so
  for them the move only works for a show couch-tv opened itself (the phone remote, Keep watching, a
  move) in the last three hours, with the app in front ever since. Otherwise the phone says the app does
  not say what is playing. The bridge never guesses the title from the watch history: that could move
  another show. One case it cannot see: you pick another show inside the app with the TV's remote after
  couch-tv opened one. The first show is the one that moves.
- **The first TV may ignore the pause key.** Netflix played on through the pause key right after it had
  been started: three times on the Sony during a move, and once in three tries on the Streamer (TV
  asleep, woken, Netflix started fresh, paused two seconds after it began). The same key worked a
  minute later. The move tries the key twice and then asks the sync helper to pause the app itself;
  on the Streamer that took when the key had not. Without the sync helper on the first TV the move can
  only say that it would not pause. On the Sony, two moves made right after a fresh Netflix start
  then ended with the first TV paused. Measured there, without a move: in the first twenty seconds or
  so after Netflix starts, the pause key took once in four tries; the sync helper's pause took every
  time, but a pause in the first six seconds came undone (Netflix starts playback over about ten
  seconds in), and one after sixteen seconds held. So the move looks at the first TV again when the
  other TV has opened the show, and once more when it plays, and pauses it again if need be.
- **If the other TV cannot be reached** (off at the wall, off the network), the move gives up after
  about 45 seconds with "the TV did not wake", and the first TV, paused meanwhile, plays on.
- **YouTube says what the video is five or six seconds after it starts** (measured on the Sony). A move
  pressed before that waits up to six seconds for the title.
- **YouTube needs the same account, with watch history on, on both TVs.** That is how YouTube knows
  where you were. When it starts somewhere else anyway (seen: from the beginning, on a move right after
  the pause), the bridge opens the video again at the first TV's spot. The bridge finds the video by its
  title and channel on YouTube's public search page. If it is not sure which video it is, it opens
  YouTube's search for the title and you pick it.
  YouTube does not always send that page in the same layout (seen: the same search gave eight results,
  then one, then eight again), so a page with no sure answer is asked for again, twice at most, and a
  video that was found is remembered for six hours.
- **Live TV has no spot.** The channel or app opens; you may land on its home page.
- **Profile names must match.** The bridge looks for the person's name on the "Who's watching?" screen
  (`app_profiles` in [CONFIG.md](CONFIG.md), People). The label has to be the name, or the name with only
  the app's own words around it (Disney+ reads "Access Sam's profile"). A profile it cannot find is
  left for you to pick with the TV remote; it never takes another person's profile on a loose match.
- **A profile screen the bridge cannot read is passed with OK, in Netflix only.** Netflix draws its own
  "Who's watching?" on some TVs (seen on a Google TV Streamer), and nothing on it can be read. The bridge
  then presses OK, which takes the profile Netflix has in focus: the one last used on that TV, not the
  person by name. It only presses while Netflix is the app in front.
- **Other apps with a screen that cannot be read stop there** (seen: Prime Video's profile screen, then
  its title page with Play in focus). The show is open on the other TV and you press OK on its remote.
  The bridge does not press OK blind in an app that sells rentals or channels, because it cannot see
  whether Play or Rent has the focus. A household that accepts that can name more apps in the
  `COUCHTV_MOVE_BLIND_OK` environment variable of the bridge (app ids, comma separated, for example
  `prime-video`).
  **This setting can cost money.** With it, the bridge presses OK on a title page it cannot read. If
  that page has Rent or Buy in focus instead of Play (a title that is not in your plan on the other
  TV's account, or a different account there), that OK can rent or buy it. Leave it unset unless you
  accept that, and keep a purchase PIN on the app.
- **The show has to be one the show finder knows, by exactly that name** (it is how the bridge opens a
  title in an app). For anything else the app opens on its search, with the title typed in where the
  app allows it, and the phone says so. A near name is never opened in its place: an early version
  took the series "Bluey Fancy Restaurant", which the finder did not know, for the "Fancy Restaurant"
  episode of "Bluey" and opened the wrong show; that guessing is gone.
- **Plex cannot be moved.** On the Streamer Plex does say what is playing, but the bridge has no link
  that opens a Plex title on the other TV (`bridge/apps.py` has Plex as "app only"), so only the app
  would open. On the Sony the bridge saw nothing playing in Plex at all.
- **An app the bridge does not know** (not in `bridge/apps.py`) cannot be moved.
- **The first TV's saved spot is a backup only.** YouTube: the video is opened again with the time in
  the link. Any other app: the bridge can only jump inside it through the sync helper app of
  [SYNC.md](SYNC.md) (`dev.couchtv.sync`), if you have installed it on the other TV, and only if the
  app takes a seek from outside (the helper says). Without it the phone says the show started at
  another spot and where the first TV was, and you wind on by hand.
- **The other TV may come up on another title.** The bridge opens the title by the show finder's link, and the app decides what that plays: Disney+, asked for the show "Bluey", played the series "Bluey Fancy Restaurant". So when both apps say what they play (YouTube and Disney+ do), the move compares the two titles; if they differ it pauses the other TV and the phone says which title came up. Netflix and Prime Video do not say what they play, so there the bridge cannot check.
- **A show the app names differently is opened by the name couch-tv asked for.** Disney+, asked for the show "Bluey", plays the series "Bluey Fancy Restaurant"; asked for the film "Moana", it plays "Moana Sing-Along". The show finder knows neither of those names. When couch-tv itself opened the show on the first TV in the last three hours, the other TV is opened by that same name, and it only counts as moved if the other TV then names the same title itself; if it names another one, or none, it is paused there and the phone says so. A show like that started with the TV's own remote still opens the app's search. If you picked another show inside the app with the TV's remote after couch-tv opened one, the other TV may play the first one for a few seconds before it is paused.
- **Disney+ and its Sing-Along films.** The show finder's one Disney+ link for the film "Tangled" (and for "Moana") is the page of "Tangled Sing-Along", which Disney+ keeps as a film of its own. Started with the TV's own remote, the plain film used to stop on the other TV as the wrong title. Now, when Disney+ comes up on another title, couch-tv opens that title's page, and if exactly one tile there carries the name of the film you were watching it presses that tile and then Play or Continue, and checks again what the TV says it plays. It presses nothing when it cannot be sure: no such tile among the ones on screen (four are), two of them, a button to pay or sign in on the page, or a screen it cannot read. Then it is paused and the phone says so, as before. This adds about 20 seconds to such a move and none to any other. Seen on a Sony Google TV; the button names are English, so a Disney+ set to another language stays as before.
- **Kids mode:** a TV that is on a kids profile is not moved to another person without the parent PIN.
  The phone remote does not ask for the PIN yet: change the person on that TV first.
- **Samsung, LG, Roku, VIDAA, Philips, VIZIO, Panasonic, TiVo and Apple TV** cannot be either end: they
  do not let the bridge read what is playing.
- **Tested on two TVs only.** It is built for any number: the phone shows one Move button for each
  other Android or Google TV, and the bridge asks which TV when there are more than two and none is
  named. With three or more TVs that is covered by the unit tests only, not by real TVs.
- One move at a time. One trigger for now: the phone remote. A button on the TV home and a remote key
  may come later.
