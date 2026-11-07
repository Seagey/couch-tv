# TV remotes: which keys do what

The TV home works with the remote that came with the TV, any Android TV remote, a game controller,
a keyboard, and the couch-tv phone remote (which sends the same keys through the bridge). There is
nothing to set up.

## The keys

| What it does | Android key | What the page sees (browser `key`) |
|---|---|---|
| OK (select) | `DPAD_CENTER`, `ENTER`, `NUMPAD_ENTER`, `BUTTON_A`, `BUTTON_SELECT`, `SPACE` | `Enter`, `" "` (space), `Select`, `Accept`, or key code 13, 23 or 32 |
| Back | `BACK`, `ESCAPE`, `BUTTON_B` | `Escape`, `Backspace`, `GoBack`, `BrowserBack`, or key code 27 or 8 |
| Up, down, left, right | `DPAD_UP`, `DPAD_DOWN`, `DPAD_LEFT`, `DPAD_RIGHT`, keyboard and controller arrows | `ArrowUp` and the rest (also the old `Up`, `Down`, `Left`, `Right`), or key code 19 to 22 or 37 to 40 |
| Menu (optional) | `MENU` | `ContextMenu`, or key code 82 or 93 |
| Settings (gear, optional) | `SETTINGS`, and on some TVs `BUTTON_14` through KeyWatch (below) | `Settings`, `TvSettings`, or key code 176 |
| Home | `HOME` | Never reaches the page. Android handles it, and the launcher brings the home back to its first tile. |

The launcher (`tv-home/android`, `MainActivity.dispatchKeyEvent`) turns `BUTTON_A`, `BUTTON_SELECT`
and `NUMPAD_ENTER` into OK, and `BUTTON_B` and `ESCAPE` into Back, before the page sees them, so a
game controller works the same as a remote. Back never leaves the home: the page decides what it
means (close a list, put an app down, go back to the first tile).

Every other key is left alone: play and pause, volume, numbers, the coloured buttons, voice, and
the Netflix, YouTube and other app buttons. The page does not stop them, so Android and the apps
still get them, and they never move the focus.

## Holding OK

Holding OK for about half a second (600 ms) picks something up:

- on an app in the dock: a small menu opens (up and down, OK picks, Back closes it):
  - **Move**: the app lifts so you can move it (left, right, down to More apps, OK to drop);
  - **Hide from home**: the app is hidden on this TV (Home settings, Apps brings it back);
  - **Uninstall**: Android's own remove dialog, which asks first. TVs without one get the app's
    details screen, which has Uninstall;
  - **App info**: Android's details screen for that app;
- on an app in More apps: it goes on the home (the dock);
- on a name in the people list: it lifts so you can move it (up, down, OK to drop).

It works on both kinds of remote: ones that repeat the key while it is held, and ones that only
send the press and then, later, the release. One press is one action: if a hold picks something
up, letting go does not also open it. OK acts when it is let go (as on tvOS), so a quick press
still opens the app straight away.

Where there is nothing to pick up (a show, a quick button), holding OK just does what OK does.

Many remotes have no Menu key. Where there is one, Menu does the same as holding OK.

## The gear button

The remote's gear or Settings button opens the gear menu (Home settings or TV settings), the same as
the gear tile in the dock. Pressed again, or from inside a menu, it goes back to the home.

Most remotes send Android's `SETTINGS` key, and the launcher catches it
(`MainActivity.dispatchKeyEvent`). Some do not: on an ONVO TV (MediaTek, Google TV, Android 14)
the gear sends `BUTTON_14` (201), and Android's global-key table hands it to the maker's hot-key
agent, so no app ever sees it. For those TVs the app has a small accessibility service, **Home gear
button** (`KeyWatch.kt`). It catches only that button, passes every other key on, and reads no
screen content. It is off until you switch it on at the TV: Settings, System (or Device
Preferences), Accessibility, Home gear button. Android switches it off again whenever couch-tv is
reinstalled or updated, so switch it back on after that. `undo.sh` switches it off.

To find what your remote's gear sends: `adb logcat -s couchtv-keywatch` while the service is on.

## Sound

Every arrow and OK plays Android's own navigation sound (`AudioManager.playSoundEffect`), the
one other TV launchers play. It follows the TV's system sounds switch. In a browser preview the page
makes a short tick of its own.

## Focus

Something always has the focus. If nothing does after a key press (a list closed under it, the
apps changed), the first app in the dock gets it.

## Checked with

`tv-home/web` in Chrome (Playwright), sending each key above as the events a WebView sends: every
OK variant opened the people list, every Back variant closed it, every arrow variant moved the
focus, both kinds of hold picked an app up without opening it, the Menu key picked up, five
unknown keys (play and pause, a number, the red button, a voice key, volume up) passed through
without moving the focus, and a lost focus came back on the first dock app.
