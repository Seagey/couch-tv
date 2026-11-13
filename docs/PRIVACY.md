# Privacy clean (Beta)

couch-tv replaces the TV's ad filled home screen. On its own it does not switch off the TV's
tracking, ad and automatic content recognition (ACR) apps: the ones that report what you watch,
including what comes in over HDMI. Privacy clean is an opt in step that does.

**What it does:** it switches off known tracking and ad apps it can find on your TV, reversibly.
It does not remove all tracking, and it cannot promise to: a lot of it lives in the TV's own system,
in apps couch-tv must not touch, or on the maker's servers. Pair it with the menu switches below.

## Using it

Privacy clean is part of `apply.sh` (options A and B, Android TV, Google TV and Fire TV). Nothing
changes unless you set `PRIVACY=1`.

See what it would do first. This installs nothing, switches nothing off and writes no files:

```sh
TV_IP=<your tv address> PRIVACY=1 DRY_RUN=1 sh tv-home/tools/apply.sh
```

Without `TV_IP`, `DRY_RUN=1` just prints the whole list. Then run it for real:

```sh
TV_IP=<your tv address> APK=couch-tv-home.apk PRIVACY=1 sh tv-home/tools/apply.sh
```

It prints each app it switched off and what it does, each one it left on and why, and how many apps
on the list this TV does not have. Only the apps the TV actually has are touched.

**How it switches them off.** `pm disable-user`, the same reversible switch Android's own Settings
uses when you press Disable. Nothing is uninstalled or deleted. Every app it switches off goes on the
same undo list as ambient mode (`tv-home/tvs/<TV_NAME>.disabled`).

**What it will never switch off**, even if the list named it (the same check `EXTRA_OFF` uses):

- the TV's home screens and setup apps (switching those off made a Sony Bravia loop at every start,
  see [If your TV loops after a restart](TROUBLESHOOTING.md#if-your-tv-loops-after-a-restart))
- anything with a persistent process, and any core part of Android or Google Play Services
- **the remote:** Bluetooth, remote pairing, voice and the Assistant, HDMI CEC, the keyboard
- **Keep watching:** the TV provider that holds Android's Watch Next list (`com.android.providers.tv`),
  TV inputs and listings

**After a TV update.** An update can switch apps back on. With option B the bridge's daily check
switches them off again. With option A, run `apply.sh` with `PRIVACY=1` again.

**A later run without `PRIVACY=1`** leaves them as they are: they stay off and stay on the undo list.

## Undo

`undo.sh` switches back on everything `apply.sh` switched off, privacy apps included, and puts the
TV's own home back ([Undo: put the Google home screen back](SETUP.md#undo-put-the-google-home-screen-back)):

```sh
TV_IP=<your tv address> sh tv-home/tools/undo.sh
```

To keep couch-tv but switch only the privacy apps back on, run `undo.sh`, then `apply.sh` again
without `PRIVACY=1`. Any single app can also be switched back on by hand:
`adb shell pm enable <package>`. An app that was already off before couch-tv is left as it is and
is not put on the undo list, so undo never switches on something you switched off yourself.

## What it switches off, by brand

The full list, with what each app does, what changes when it is off and where it came from, is
[`tv-home/tools/privacy-list.txt`](../tv-home/tools/privacy-list.txt). In short:

| Brand | Apps | What they are |
|---|---|---|
| Google TV and Android TV (any brand, including Chromecast with Google TV and onn) | `com.google.android.feedback`, `com.google.android.adservices.api` | Feedback and crash reports; Privacy Sandbox ad services |
| Some budget Android TVs | `tv.alphonso.alphonso_eula` | Alphonso ACR |
| Sony Bravia | `tv.samba.ssm`, `com.sony.dtv.promos`, `com.sony.dtv.sonyselect`, `com.sony.dtv.notificationcenter` | Samba TV ACR; Sony promotions, promoted apps and promo notifications |
| Xiaomi Mi TV and Mi Box | `com.miui.tv.analytics`, `com.miui.analytics`, `com.miui.msa.global` | Xiaomi analytics; MSA, Xiaomi's ad service |
| Amazon Fire TV (Fire OS 6 and 7) | `com.amazon.tv.acr`, `com.amazon.hybridadidservice`, `com.amazon.privacypassservice`, `com.amazon.hedwig`, `com.amazon.sneakpeek`, `com.amazon.kso.blackbird`, and eight metrics, analytics and log uploaders | ACR; advertising ID and ad tokens; watch time tracking; autoplaying promos and banner ad sync; telemetry |

Google TV's ambient mode (`dreamx`, the idle adverts) is already switched off by every `apply.sh`
run unless you set `KEEP_AMBIENT=1`, so it is not on this list.

**TCL, Hisense (Google TV), Philips and onn:** no ACR or ad app made by these brands was found in a
source we could check, so nothing brand specific is switched off on them yet. The Google apps above
still are. Their tracking is switched off in the TV's menu (below). If you find one, open an issue
with the package name and a source.

## What it cannot do

- **Samsung (Tizen), LG (webOS), Hisense VIDAA, Roku, Vizio and Panasonic** are not Android: there are
  no apps for couch-tv to switch off. Use their menu switches below.
- **Protected apps.** Some apps cannot be switched off without rooting the TV, for example Fire TV's
  `com.amazon.device.metrics`, `com.amazon.device.crashmanager` and `com.amazon.ftvads.deeplinking`.
  couch-tv never roots a TV. Blocking their servers on your router or with a DNS blocker is the only
  way.
- **Tracking inside the system.** ACR built into the TV's own firmware or its home screen, and
  sponsored banners the stock home fetches itself, stay. couch-tv's home replaces the stock home on
  screen, but the stock home stays installed (switching it off is what made TVs loop).
- **Your apps.** Netflix, YouTube and the rest keep their own tracking. Google's ad ID can be
  reset or deleted in Settings (below).

## Switches to turn off in the TV's own menu

These are the maker's own switches and they work on every TV, with or without couch-tv. Menu names
change between models and years, so look for the nearest match.

- **Google TV** (including Sony, TCL, Hisense and Philips Google TVs, Chromecast, onn):
  Settings, Privacy, Usage and diagnostics: off. Settings, Privacy, Ads: Delete advertising ID (or
  Opt out of Ads Personalisation on older models). On older Android TVs: Settings, Device
  Preferences (or Personal), Usage and diagnostics.
  Sources: [Google TV Help, ads](https://support.google.com/googletv/answer/13392198),
  [Sony, Usage & Diagnostics](https://www.sony.co.uk/electronics/support/articles/00155797),
  [TCL support](https://support.tcl.com/en_US/change-ad-settings-for-your-google-tv).
- **Sony Bravia:** Settings, System Preferences (or Device Preferences), Samba Interactive TV:
  Disagree and Disable. Sony says this stops it collecting your viewing history.
  Source: [Sony support 00182856](https://www.sony.com.au/electronics/support/articles/00182856).
- **Samsung:** Settings, All Settings, General & Privacy, Terms & Privacy (Privacy Choices): switch
  off Viewing Information Services, Interest Based Advertising and, if you do not use it, Voice
  Recognition Services. On 2018 to 2021 models: Settings, Support, Terms & Policies.
  Source: [Malwarebytes](https://www.malwarebytes.com/blog/news/2026/03/samsung-tvs-stop-spying-on-viewers-in-texas-heres-how-to-disable-acr-anywhere).
- **LG:** Settings, All Settings, General, System, Additional Settings: Live Plus off. Then under
  User Agreements, switch off Viewing Information, Interest Based and Cross Device Advertising and
  Voice Information.
  Source: [Tom's Guide](https://www.tomsguide.com/tvs/your-tv-is-watching-you-how-to-turn-off-data-collection-on-lg-samsung-roku-and-more).
- **Hisense VIDAA:** Settings, System, Privacy (on some models System, Viewing Information): switch off
  Viewing Information Services or Smart TV Experience. Hisense publishes no official page for this,
  and some owners report it switching itself back on after a restart, so check again.
  Source: [RTINGS, smart TV tracking](https://www.rtings.com/tv/learn/research/smart-tv-tracking).
- **TCL:** Google TV models use the Google TV switches above. Roku TV models: Settings, Privacy,
  Smart TV Experience: untick Use info from TV inputs.
  Source: [Consumer Reports](https://www.consumerreports.org/privacy/how-to-turn-off-smart-tv-snooping-features-a4840102036/).
- **Roku TVs** (also Hisense and TCL Roku models): as TCL Roku above.
- **Vizio:** System, Reset & Admin, Viewing Data: off.

## Left off the list, and why

These were looked at and are not switched off:

- **Home screens and their parts** (`launcherx`, `tvlauncher`, Xiaomi PatchWall `com.mitv.tvhome.*`
  including Mi Channel, `com.amazon.tv.launcher`, `com.amazon.firehomestarter`): switching off a home
  can leave a TV on a black screen or looping at start.
- **Setup** (`setupwraith`, `com.google.android.partnersetup`): setup apps are needed at start.
- **`com.google.android.tvrecommendations`:** Android TV Core Services on some TVs (rated Expert in
  UAD-ng); it can feed rows on the home and in apps. Not worth the risk to Keep watching.
- **Fire TV `com.amazon.media.recommendations`:** removes sponsored rows, but apps also send their rows
  through it, so it could touch Keep watching.
- **Fire TV protected apps** (`com.amazon.device.metrics`, `crashmanager`, `ftvads.deeplinking`):
  Fire OS refuses to switch them off.
- **Fire TV `com.amazon.tigris`:** one source calls it telemetry, another the Appstore's storefront.
- **Fire TV `com.amazon.wifilocker`, `com.amazon.device_remote_config_sync_service`, `com.amazon.katoch`,
  `com.amazon.ale`:** Wi-Fi password sync and remote configuration, not tracking or ads, and they can
  change how the TV behaves.
- **Android's own ad stack** (`com.android.adservices.api`, `com.android.ondevicepersonalization.services`,
  `com.android.federatedcompute.services`): core Android modules, which couch-tv never switches off.
- **Philips** (`org.droidtv.frameworklogger`, `org.droidtv.oemtabprovider`) and **Xiaomi**
  `com.xiaomi.statistic`: only one source each, which we could not open to check.
- **Alexa, voice and the remote's services** on any TV: the remote must keep working.
- **System update apps** of any brand, Chromecast built in (`mediashell`), TV inputs, tuners and HDMI.

## Sources

The list was written for couch-tv from these references, checked on 13 November 2026. No code from
any of them is used.

- Universal Android Debloater Next Generation, `uad_lists.json` (removal ratings):
  https://github.com/Universal-Debloater-Alliance/universal-android-debloater-next-generation
- dumbtv, Fire TV package list: https://dumbtv.org/blocked
- Clean Your TV, Fire TV guide: https://cleanyourtv.site/debloat-fire-tv/
- noted.lol, "I debloated my Fire TV": https://noted.lol/i-debloated-my-fire-tv/
- Sony community, disabling system apps via ADB (Samba TV):
  https://community.sony.es/t5/android-tv/disabling-system-apps-via-adb/td-p/2403349
- Android source, AdServices: https://source.android.com/docs/core/ota/modular-system/adservices
- The menu sources are linked in each entry above.
