# Deep links on a Google TV (tested on one TV)

How the bridge opens a show: JustWatch gives an Android TV link for each offer (an `intent://`
URI with the app's package or scheme), per show and per episode. With ADB on, the bridge runs it
(`adb shell am start -W '<intent uri>'`). Without ADB it sends the plain form (`scheme://...`)
over the Android TV Remote protocol. Then it checks, over ADB, that the app is really on screen.
If not, it falls back (last column).

Tests: `bridge/test_deeplinks.py` (raw links) and `bridge/test_play.py` (the full `/api/play`
path). Screenshots go to `bridge/data/deeplink-shots/` and `bridge/data/play-shots/` (local).

## Results

| App | Package on this TV | What the bridge sends | Result on this TV | Fallback |
|---|---|---|---|---|
| Netflix | `com.netflix.ninja` | JustWatch intent, `https://www.netflix.com/watch/<id>` | **Works.** `/api/play` "Stranger Things": Netflix on screen in 2.4 s and still there at 8 s. Netflix blocks screenshots, so the page itself was not seen. Left in the background for about an hour, Netflix asked "Who's watching?" and dropped the show. Now restarted first (`am start -S`) whenever it is not on screen: a show resumed where it was up to in about 22 s, no profile screen. The bridge then waits until Netflix's media session plays and moves on before it says "playing". | `https://www.netflix.com/search?q=` |
| Stan | `au.com.stan.and` | `stan://programs/<id>` | **Works.** "Bump": Stan opens at "Who's watching?". | open the app |
| Disney+ | `com.disney.disneyplus` | `https://www.disneyplus.com/play/<id>` | **Works.** "The Bear": Disney+ opens at "Who's watching?" (your profiles). | open the app |
| Prime Video | `com.amazon.amazonvideo.livingroom` | `https://app.primevideo.com/...gti=<id>` | **Works.** "The Boys": Prime on screen and loading at 8 s. | open the app |
| SBS On Demand | `com.sbs.ondemand.tv` | the JustWatch **web** link cut to the show page, `https://www.sbs.com.au/ondemand/tv-series/<slug>`, with the app restarted first | **Works.** "Alone Australia": show page with "Play S4 E1" after about 15 s. JustWatch's own SBS intent names a screen this app version no longer has, and with the app already open SBS ignores links and shows its home page. | open the app |
| ABC iview | `au.net.abc.iview` | `iview://video/<episode id>` (the episode link when a season is asked for) | **Works.** "Bluey" season 3 episode 4: iview on its profile screen at 8 s (clean re-test at 18:50; the two earlier runs were knocked back home by another session's tests). | open the app |
| 9Now | `au.com.ninenow.ctv` | `ninenow://<show>/<season>/<episode>` | **Works.** "The Block": 9Now on screen in 1.7 s, still there at 8 s. | open the app |
| 10play | `au.com.tenplay` | `tenplay://tv/open?show_id=<n>&video_id=<n>` (JustWatch's inner screen swapped for the app name) | **Works.** "Paw Patrol": 10play on screen in 3.8 s, still there at 8 s. | open the app |
| YouTube | `com.google.android.youtube.tv` | `https://www.youtube.com/watch?v=<id>` | **Works** (remote protocol). JustWatch rarely lists YouTube, so this is for links Claude finds. | `https://www.youtube.com/results?search_query=` |
| Apple TV | `com.apple.atve.androidtv.appletv` | `https://tv.apple.com/au/show/<slug>/<id>` | **Opens the app** (seen on screen at 3 s). | open the app |
| Binge | `au.com.streamotion.ares.tv` | nothing: the app only accepts `https://open.dazn.com/...` links and JustWatch gives `binge.com.au` ones | **No deep link.** `/api/play` "Colin from Accounts" opens Binge and says "Search for Colin from Accounts on the TV". | open the app |
| Nuvio | `com.nuvio.tv` | not on JustWatch: its own link by the IMDb id JustWatch gives, `nuvio://series/<imdb id>` or `nuvio://movie/<imdb id>` (`TITLE_LINKS` in server.py) | **Opens the show page.** Tested on a Xiaomi Mi Box (Google TV), Nuvio 1.1.0: `nuvio://series/tt22202452` opened the Pluribus page. Show and film pages only: `nuvio://series/tt22202452:1:8` is read as one id and fails, and `stremio:///` links only open Nuvio's home. Film links not yet tried on the TV. | open the app |

"Who's watching?" screens: Stan, Disney+ and iview ask for a profile first. The bridge does not
pick one for you. Still to check from the couch: after picking a profile, does each app carry on
to the show, or land on its home page?

## What does NOT work on this TV

- `intent://` links over the remote protocol: the TV answers with an error. Needs ADB, or the
  plain `scheme://` form.
- `market://launch?id=<package>` (androidtvremote2's way to open an app by package) did nothing.
  Opening an app by package uses ADB (`monkey -p <package> -c
  android.intent.category.LEANBACK_LAUNCHER 1`).
- Bare domains (`https://www.netflix.com`) open nothing. Links need a path to a title.
- Google TV's own search (`android.search.action.GLOBAL_SEARCH`) only shows a search bar with the
  words in it and no results, over whatever is on screen. Not used.
- Screenshots of Netflix, and of any playing video, come out black or garbled (DRM).
