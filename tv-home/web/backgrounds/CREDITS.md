# Background photos

From Wikimedia Commons, used under their Creative Commons licences. Resized and cropped to
1920x1080 for the TV. The home screen shows each place and photographer under the clock.

| File | Place | Photographer | Licence | Source |
|---|---|---|---|---|
| albury-storm.jpg | Storm cloud at sunset, Albury, NSW | Thennicke | CC BY-SA 4.0 | https://commons.wikimedia.org/wiki/File:Cumulonimbus_sunset_panorama,_Albury_NSW_Australia.jpg |
| grose-valley.jpg | Grose Valley, Blue Mountains, NSW | Diliff | CC BY-SA 3.0 | https://commons.wikimedia.org/wiki/File:Grose_Valley,_NSW,_Australia_-_April_2013.jpg |
| tessellated-pavement.jpg | Tessellated Pavement at sunrise, Tasmania | JJ Harrison | CC BY-SA 2.5 | https://commons.wikimedia.org/wiki/File:Tessellated_Pavement_Sunrise_Landscape.jpg |
| aresquiers-beach.jpg | Aresquiers beach at sunset, France | Christian Ferrer | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:Sunset_on_the_Aresquiers_beach.jpg |
| vang-vieng-sunset.jpg | Sunset over paddy fields, Vang Vieng, Laos | Basile Morin | CC BY-SA 4.0 | https://commons.wikimedia.org/wiki/File:Colorful_sky_with_orange_clouds_reflecting_in_the_water_of_a_paddy_field,_at_sunset,_Vang_Vieng,_Laos.jpg |

## Scene backgrounds (the default Night look)

`scene-night.jpg`, `scene-golden.jpg`, `scene-water.jpg`, `scene-fog.jpg` and `scene-dawn.jpg` were
made for couch-tv with an AI image model from text only (no source photo). They are not real places.
Use them however you like.

The files that go with them are made from those same generated scenes, so the same terms apply:

- `scene-<name>-fg.webp` (night, golden, fog, dawn): the scenery cut out of the scene, with the
  sky transparent. It is drawn over the clock, so the peaks, the volcano and the hills overlap the
  bottom of the digits. The mask came from an AI edit that painted only the sky one flat colour;
  every pixel you see in the cut-out is the original scene's. The waterline scene has no cut-out:
  its clock sits on the water instead, with a blurred reflection under the surface.
- `scene-<name>-glass.jpg`: a blurred, brightened copy of the scene, used as the clock's frosted
  glass fill.

## Your own photo with the clock behind it

The easy way: `tv-home/tools/make-scene.py` makes the photo and glass copy (and, if you want it,
the cut-out) into `mine/`, and `home.my_scenes` in `config.json` designs the clock, with no code
to edit.
[docs/MAKE-A-SCENE.md](../../../docs/MAKE-A-SCENE.md) walks through it. By hand:

1. Put the photo in this folder as a 1920x1080 JPEG and add it to `SCENE_LIB` in `../app.js`.
2. The cut-out: in any background remover or image editor, delete the sky and keep everything in
   front of it (mountains, trees, buildings). Export it at the same size as a transparent WebP
   named `<photo>-fg.webp`, for example `cwebp -q 86 -alpha_q 100 -exact cutout.png -o
   <photo>-fg.webp`. Keep the edge soft but not blurry, or it shows a light rim over the digits.
   Then set `fg: true`.
3. The glass fill (optional): `magick <photo>.jpg -blur 0x16 -modulate 130,125 <photo>-glass.jpg`
   with ImageMagick, then set `glass: true`.
4. Move the clock so the scenery covers only the lower part of the digits: `.s-<id> .gclock`
   (`top`, `font-size`) and `.scene-<id> .date` in `../app.css`. Leave at least the top 60% of
   every digit clear so the time is easy to read.
