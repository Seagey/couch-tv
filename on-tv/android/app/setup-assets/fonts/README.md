# Setup screen fonts

The on-TV setup screen (SetupLook.kt) uses the couch-tv Studio website's own fonts, bundled so nothing
comes from the network:

- `nunito_black.ttf`: Nunito, weight 900 (headings). Nunito by Vernon Adams and contributors.
- `inter_regular.ttf`, `inter_semibold.ttf`: Inter, weights 400 and 600 (text, buttons). Inter by Rasmus Andersson.

Both are under the SIL Open Font Licence 1.1 (https://openfontlicense.org). They are static cuts of the
variable Latin subsets the website serves (tools/tv-designer/site/public/fonts/*.woff2), made with fontTools:
`instancer.instantiateVariableFont(font, {"wght": 900})` and saved as plain TrueType without glyph names (post table format 3, which Android never reads), because Android 6 to 7
cannot read WOFF2 or pick a weight from a variable font.
