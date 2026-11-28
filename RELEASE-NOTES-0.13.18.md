## Couch TV 0.13.18: the Windows download of Couch TV Setup is back

0.13.17 had no Couch TV Setup downloads on its Releases page, because the automatic Windows check on the Setup app failed. 0.13.18 fixes that check, so the Mac and Windows downloads of Couch TV Setup are here again. The apps on the TV are the same as 0.13.17.

### Do this after updating

- **Option C (the on-TV app):** Home settings, Updates, Update to. Your settings stay. 0.13.18 carries the same key as 0.13.17.
- **Every other Android TV:** Home settings, Updates, check now, or install `couch-tv-home.apk` over the old one.
- **Couch TV Setup and the Helper:** a Helper updates itself when you press Update ready, restart. Otherwise download Couch TV Setup again from the Releases page.

### What changed

- Windows checks for Couch TV Setup now pass. Seven of its tests assumed Mac and Linux file modes and paths. Only the tests changed; the Setup app itself is the same as 0.13.17.
