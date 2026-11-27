## Couch TV 0.13.16: link inside Couch TV Setup with no codes, finished sends, sharp icons and slimmer TV settings

Couch TV Setup now links your TV to your account without any codes to type. A design you send to a TV you trust arrives finished. App icons are sharp, TV settings are slimmer, and the Mac download help is clearer.

### Do this after updating

- **Option C (the on-TV app):** Home settings, Updates, Update to. Your settings stay. 0.13.16 carries the same key as 0.13.15, so a TV on 0.13.15, 0.13.14 or 0.13.13 updates as normal.
- **Every other Android TV:** Home settings, Updates, check now, or install `couch-tv-home.apk` over the old one.
- **Option B (a computer at home):** `git pull`, then restart the bridge. Nothing new to install.
- **Couch TV Setup and the Helper:** a Helper updates itself when you press Update ready, restart. Otherwise download Couch TV Setup again from the Releases page.

### Couch TV Setup

- **Linking with no codes.** Sign in inside Setup, check the account it shows, press Yes, and the TV is linked. You no longer read a code off the TV or type one on the website.
- **One tap for a link you trust.** If the TV is on the same network as the computer running Setup and you have already trusted that Setup, one tap is enough. A link from another network, or from a Setup you have not trusted, still asks you to tick the box first.
- **Clearer Mac download help.** The guide shows the message a Mac gives when it checks Couch TV Setup, and the button to press. It also says what older Macs show instead.

### On your account and the TV

- **Send arrives finished for trusted links.** A design you send to a TV linked to your account lands complete, with the people, photos, town and Wi-Fi your account holds, and nothing more to do on the TV. A TV that is not trusted still waits for you to say yes.
- **Sharp 512 px app icons.** App icons are drawn at 512 px, so they stay crisp on a large TV.
- **Slimmer TV settings.** The TV settings screen is called Settings and shows fewer rows, with the rest tucked under More.
- **Speed check button hidden.** The speed check button is not shown for now.
- **Now playing clears the dock.** In the Night look, the row lifts so Spotify's card no longer sits under the dock (PR #333).
- **Your own picture for input tiles.** Input tiles can use your own picture through app-icons.sh, like an app's (PR #337).
- **Samsung setup wording.** The Samsung setup says which Samsung pages come before Signed in (PR #334).

### Not in this release

- Nothing about a TV is sent anywhere unless you press Yes to link it.
