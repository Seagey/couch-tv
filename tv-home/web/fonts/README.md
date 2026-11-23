# TV home fonts

The TV home (app.css @font-face) ships these fonts, so nothing comes from the network:

- `inter-latin-wght-normal.woff2`: Inter, weights 100 to 900 (the home's own words). Copyright 2016 The Inter
  Project Authors (https://github.com/rsms/inter).
- `jost-latin-wght.woff2`: Jost, weights 100 to 900 (a widget's "jost" font, widgets.js FONT). Copyright 2020
  The Jost Project Authors (https://github.com/indestructible-type/Jost).
- `cormorant-garamond-latin-wght.woff2`: Cormorant Garamond, weights 300 to 700 (a widget's "cormorant"
  font). Copyright 2015 The Cormorant Project Authors (github.com/CatharsisFonts/Cormorant).
- `antonio-latin-300.woff2`: Antonio, weight 300 (the Night look's clock). Copyright 2013 The Antonio
  Project Authors (https://github.com/googlefonts/antonioFont).
- `nunito-latin-wght.woff2`: Nunito, weights 200 to 1000 (the first-run welcome's headings). Copyright 2014
  The Nunito Project Authors (https://github.com/googlefonts/nunito).

All five are under the SIL Open Font Licence 1.1 (https://openfontlicense.org). The licence text, with these
copyright lines, is in [OFL.txt](OFL.txt). Each file is a Latin subset; the copyright lines above are each
file's own, from its name table (name ID 0). A design's other fonts come from
the design store when it is shown (google-fonts.js), not from this folder.
