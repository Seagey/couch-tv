# Where the small app logos come from

`app-logos.js` holds 17 vector logos for the Keep watching and Now playing cards (one plain path each, cut to its own
box, drawn in one colour). It is made by `tv-home/tools/build_app_logos.mjs` from the original files in
`tv-home/tools/app-logos-src/`. Nothing here was drawn or redrawn by hand: each path is the published logo, with
colours and gradients taken off (the card draws it white) and the page box cut tight.

The logos are the trademarks of their owners and appear only to name the app on the card. A licence on a file covers
the file, not the trademark.

Checked 28 Nov 2026. Tools used to build: svgo 3.3.2 (MIT), svg-path-bbox 2.1.0 (BSD-3-Clause), simple-icons 16.38.1.

## From simple-icons 16.38.1 (npm, exact version, licence CC0-1.0: public domain)

Files `si-*.svg` in `app-logos-src`. Package: https://github.com/simple-icons/simple-icons

| Catalogue id | simple-icons file |
|---|---|
| netflix | netflix.svg |
| youtube | youtube.svg |
| spotify | spotify.svg |
| twitch | twitch.svg |
| appletv | appletv.svg |
| paramount | paramountplus.svg |
| foxtel | foxtel.svg |
| dazn | dazn.svg |
| crunchyroll | crunchyroll.svg |
| stremio | stremio.svg |
| now | now.svg (the NOW wordmark; the catalogue's NOW is NOW Italia, the same wordmark) |

## From Wikimedia Commons (the brand's logo as a plain vector; no brand kit was open to us)

Files `wm-*.svg` in `app-logos-src`. Commons marks each of these "Public domain" (a logo too simple to be copyrighted,
tagged as trademarked), except VTM GO. Uploaders are as Commons lists them.

| Catalogue id | Commons file | Uploader | Licence tag |
|---|---|---|---|
| disney | File:Disney+ logo.svg | Nathan20116 | Public domain (trademarked) |
| stan | File:Stan logo.svg | Daniel.9 | Public domain (trademarked) |
| binge | File:Binge logo.svg | TechnicalNewt | Public domain (trademarked) |
| prime | File:Prime Video logo (2024).svg | Infanf | Public domain (trademarked) |
| raiplay | File:RaiPlay 2023 logo.svg | DimiDimi | Public domain (trademarked) |
| vtmgo | File:VTM Go logo 2024.svg | Conor M98 | CC BY 4.0 |

Credit for VTM GO (CC BY 4.0, https://creativecommons.org/licenses/by/4.0/): logo "VTM Go logo 2024.svg" by Conor M98,
logo of DPG Media, from Wikimedia Commons. Changed: one colour, cut to the logo.

## Kept as the PNG picture (8 apps, no safe vector found)

| Catalogue id | Why |
|---|---|
| iview (ABC iview) | not in simple-icons; none on Commons; the ABC brand pages need a sign-in |
| sbs (SBS On Demand) | same |
| kayo | same |
| 9now | same |
| 10play | same |
| 7plus | Commons has File:7plus.svg but it is CC BY-SA 4.0 (share-alike); not used |
| vrtmax | none found |
| max (HBO Max) | simple-icons "hbomax" draws only the old "max" wordmark, not the stacked HBO max logo the app uses now |

An app with no logo here keeps its square picture exactly as before. A designer or owner who holds an official
brand-kit SVG for one of these can add it to `app-logos-src` and the table in `build_app_logos.mjs`.
