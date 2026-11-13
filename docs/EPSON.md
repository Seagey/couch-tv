# Epson LS projectors: paired Wireless debugging

An LS300 running Android TV 14 identifies its Android hardware as Askey / Projector,
product `sti6200d101`. Do not detect Epson support from the manufacturer string alone.
Firmware and Android versions may differ on other LS300 units.

## Other LS models

The adapter selects an ADB capability, not a model or manufacturer allowlist. Other LS
models can try the same path **only if their Android device offers paired Wireless
debugging**. Android TV branding alone does not establish that capability.

| Model | Status and installation target |
| --- | --- |
| LS300 | Tested on one Android TV 14 unit; see the validation limits below |
| LS650 | Untested candidate; Epson documents [Android TV](https://epson.com/For-Home/Projectors/Streaming-Entertainment/Epson-EpiqVision-Ultra-LS650-Smart-Streaming-Laser-Projector/p/V11HB07020). Verify debugging availability and controls on the actual firmware |
| LS800 / EH-LS800 | Untested candidate; Epson documents [built-in Android TV](https://epson.com/epiqvision-ultra-laser-projection-tv). Do not assume the LS300's input components or Home behaviour |
| LS500WATV / LS500BATV | Untested; target the [included Android TV streaming device](https://files.support.epson.com/docid/cpd5/cpd57962/source/setup/tasks/hcls500_ls500atv/connecting_streaming_device_ls500_ls500atv.html), not the projector firmware. Check that device's Android version and debugging capabilities |

An LS model without Android TV needs a separate compatible streaming device. No projector
firmware is flashed. If only plain network ADB is available, use the existing default
transport; this adapter cannot add paired debugging to a device that lacks it. For a new
model, record Android version, successful install, app launches, physical controls and
restart behaviour before describing it as tested. Keep serials, addresses and personal
settings out of reports.

## Connect without switching to plaintext ADB

`tv-home/tools/tvadb.py` can optionally use Google's platform-tools `adb` for an
already paired Wireless debugging connection. Its default Python transport is
unchanged. This adapter also works with other Android TVs that offer paired debugging.
It does not add TLS support to the bridge, `check-tv.py` or the on-TV remote.

1. Enable Wireless debugging in Developer options. Choose **Pair device with pairing
   code**. Use the address, pairing port and code currently shown on the projector:

   ```sh
   adb pair <projector-address>:<pairing-port>
   ```

2. Return to the main Wireless debugging screen and connect to its **connection port**,
   which differs from the pairing port:

   ```sh
   adb connect <projector-address>:<connection-port>
   adb devices -l
   ```

3. Select that exact connected transport for the launcher tools:

   ```sh
   export TV_ADB_BINARY="$(command -v adb)"
   export TV_IP='<projector-address>'
   export ADB_PORT='<connection-port>'
   python3 tv-home/tools/tvadb.py ping
   python3 tv-home/tools/tvadb.py install dist/couch-tv-home.apk
   python3 tv-home/tools/tvadb.py shell 'am start -W -n app.couchtv.launcher/.MainActivity --es bridge none'
   ```

Use the same adb executable for pairing, connecting and `TV_ADB_BINARY`. The value is
an executable path, not a command with flags. This mode needs an explicit port and
never picks another connected Android device implicitly. It does not pair, enable
plaintext debugging, or disconnect other adb clients on exit. The port can change
when Wireless debugging or the projector restarts; reconnect and update `ADB_PORT`.
On macOS, adb may need Local Network permission.

## Trying option A (TV home only)

Option A uses the bundled home and needs no running computer or phone remote service.
For modest hardware, start with `home.lighter: true`, `home.moving_tiles: false`, and
`home.glass: "off"`. Leave video backgrounds off. Keep streaming apps installed;
Couch TV launches those apps and does not replace their playback or subscriptions.

Open Couch TV as an app first. Check D-pad focus, each streaming app, the input picker,
and the physical Home, Settings, Input and volume buttons. Keep the previous launcher
available until Home behaviour and a restart are verified. Do not remove or disable
Epson services to make the launcher work. Projector settings, firmware updates and
input switching remain the manufacturer's responsibility.

On the examined Android TV 14 unit, `com.android.tv.action.VIEW_INPUTS` resolves to
`com.droidlogic.tv.extras/.tvsource.TvSourceActivity`; `android.settings.TV_INPUT_SETTINGS`
has no handler. Couch TV's existing fallback already covers that source picker.
These intent-resolution checks alone do not establish end-to-end compatibility.

The encrypted connection, installation and launcher behaviour must be tested separately.
Do not claim a stock LS300 Home-button setup based on a unit whose previous launcher
configuration was already changed. After testing, turn Wireless debugging off and
optionally forget the paired computer; option A does not need debugging to keep running.

## Validation on one LS300

Tested with Android TV 14 / SDK 34, using the locally built release launcher and
paired Google adb. Results apply to this unit and configuration:

| Check | Result |
| --- | --- |
| Native adapter ping, shell, APK transfer/install, screenshot pull | Passed over paired TLS |
| Bundled scenic home with Lighter home | Rendered and navigated with the D-pad |
| Prime Video, HBO Max, put.io, YouTube dock icons | Each opened the intended app |
| Video playback and physical Home, Settings, Input, volume | Owner confirmed working and responsive |
| Input quick menu | Listed HDMI1, HDMI2, Bluetooth and Network; HDMI signal playback was not tested |
| Restart | Owner confirmed Couch TV returned with the saved app order |

The unit already used a replacement launcher and had its stock Google launcher disabled
before this trial. No additional system packages were disabled for Couch TV. Selecting
Couch TV with `cmd package set-home-activity` worked in that existing configuration;
this is **not a stock-firmware Home-button validation**. The previous launcher stayed
installed for rollback. The bridge, phone remote, sleep/picture automation, firmware
upgrade survival, and other Epson models have not been tested.
