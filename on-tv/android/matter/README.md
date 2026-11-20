# The Matter controller library (on-TV app)

These files are the Matter controller that lets Couch TV join devices people already have in Google
Home, Apple Home, SmartThings or Alexa (Matter multi-admin). They come from
[connectedhomeip](https://github.com/project-chip/connectedhomeip) (Apache 2.0) tag `v1.6.1.0`,
built with Android NDK 28.2.13676358. `VERSION` names the exact commit.

| Path | What |
|---|---|
| `jni/armeabi-v7a/`, `jni/arm64-v8a/` | `libCHIPController.so` and `libc++_shared.so`, stripped |
| `libs/` | the controller's Java and Kotlin parts; `CHIPInteractionModelSlim.jar` is `CHIPInteractionModel.jar` without the generated cluster classes the app never uses (8.4 MB to under 1 MB) |
| `assets/matter-paa/` | the production PAA roots (the DCL mirror in the same tag) and the two test PAAs, to check a device was certified |
| `SHA256SUMS` | a checksum for every file here |

## Rebuild

Run on a Mac (Apple silicon, about 40 GB free, ~30 minutes the first time):

```sh
scripts/matter/build-controller.sh build            # on the build Mac
scripts/matter/build-controller.sh remote macbook   # from the repo: build on that ssh host, copy back, verify
scripts/matter/build-controller.sh verify           # check these files against SHA256SUMS
```

## Why the files are in the repo

The library takes a long tool chain (Python bootstrap, the NDK, zap) and half an hour to build, so a
normal `scripts/build-apk.sh` uses these files and needs none of that. They change only when the
pinned tag changes. In the APK the native libraries are stored compressed (`useLegacyPackaging`), which
adds about 8 MB for both processors.
