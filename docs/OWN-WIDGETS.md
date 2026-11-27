# Your own widgets

You can make a widget couch-tv does not have, for your own TV, freely. This page says how, and what it takes
for a design with your widget to be **sold** in the couch-tv Studio gallery or **kept in your account**.

couch-tv Studio's editor is for people. AI does not use it. If you are an AI helping someone, everything here
happens in their copy of this repository.

## On your own TV

1. **Pick a kind.** Two to sixteen small letters, not one the editor already has ([EDITOR-READY.md](EDITOR-READY.md)
   lists them). For example `tide`.
2. **Write the widget** in `tv-home/web/own/<kind>.js`:

   ```js
   // Tide chart: today's high and low tides for the home's beach.
   (function () {
     "use strict";
     function draw(root, o, b, env) {
       // root: the widget's box (an element), already the right size and style
       // o:    the widget in the design: o.opts (its settings), o.style (its look)
       // b:    { w, h }, the box in TV pixels (1920 x 1080 screen); draw for any size
       // env:  env.demo is true in couch-tv Studio's picture: draw sample data, fetch nothing
       var big = b.h >= 200;
       var t = document.createElement("div");
       t.textContent = env.demo ? "High tide at five" : "High tide soon";
       t.style.cssText = "font-size:" + (big ? 48 : 30) + "px;font-weight:650";
       root.appendChild(t);
       return root;
     }
     // optional third argument: a smaller drawing for a box under 200 px tall
     if (window.CouchWidgets) window.CouchWidgets.define("tide", draw);
   })();
   ```

3. **Load it** after `widgets.js` in `tv-home/web/index.html`: `<script src="own/tide.js"></script>`.
4. **Let the TV's gate keep it:** add the kind to `WKINDS` in `tv-home/web/design.js`. The gate drops every
   kind it does not know, so without this the widget never shows.
5. **Use it** in the design: `{"id": "tide1", "type": "widget", "kind": "tide", "size": "small", ...}` with its
   place in `design.grid.items["obj:tide1"]`.
6. **Put it on the TV** with your own build: option A rebuilds the app (`scripts/build-apk.sh`, [SETUP.md](SETUP.md)),
   option B serves your `tv-home/web` from the bridge. Put the design under the `design` key of `config.json`
   ([CONFIG.md](CONFIG.md), "Design").

A design with your widget **cannot** go through couch-tv Studio's store as a code (the store's gate is ours,
and it drops kinds it does not know), and it cannot be sold or kept in an account yet. It stays on your TV.

## To sell it, or keep it in your account

Submit it. We check the widget, add it to the editor, and then anyone who buys the design can edit it.

1. Send the design to your own TV first and use it.
2. Run couch-tv Studio's `submit_design` (MCP) with the design, `target` `sale` or `profile`, and
   `widgets: [{ "kind": "tide", "name": "Tide chart", "code": "<the whole of own/tide.js>" }]`.
   Or on the website: Sell, then add the widget's file.
3. The automatic checks run at once ([EDITOR-READY.md](EDITOR-READY.md)). Fix anything they list.
4. Open the link it gives, signed in, and finish: your own TV, your photos, the price.
5. **In review.** We look at the widget, usually 2 to 3 days. We email you if it needs a change.
6. **Added to the editor.** The widget ships in a couch-tv release and the editor, in Basic and Advanced.
7. **Listed** at your price, or kept in your account. Until then it stays on your own TVs only.

## What we check in a new widget

A widget is approved when all of these are true. Write it this way from the start and the review is quick.

- **It works.** It draws on a real TV home in every size it offers, at 1920 x 1080, and in the editor's picture
  (`env.demo`: sample data, nothing fetched).
- **It fits its box.** Nothing spills out at any size; words shrink or shorten; it reads from the couch
  (body words 24 px or more, headlines 40 px or more).
- **It is safe.** No `eval`, `new Function`, `innerHTML` with outside text, `document.write`, iframes or scripts
  added at run time. No links followed, no outside addresses fetched except the ones couch-tv already uses
  (its own bridge and the weather service in `widgets.js`). No storage of its own outside the TV's settings.
- **It is private.** No names, towns, Wi-Fi, calendar links, keys or tokens in its code. Anything personal comes
  from the person's account through the widget's settings, like every other widget ([WIDGET-SETTINGS-CONTRACT.md](WIDGET-SETTINGS-CONTRACT.md)).
- **It is quick.** No timer faster than once a second, no animation that never stops, one picture at most.
  Until it is measured the speed check counts it as one frosted panel.
- **It is plain.** Plain words, Australian spelling, no tech names on screen; one icon from the TV's own sets.
- **Its settings are declared** in `tv-home/web/widget-caps.js` the same way as every other widget, so the editor
  can show them ([WIDGET-SETTINGS-CONTRACT.md](WIDGET-SETTINGS-CONTRACT.md)).
- **It is small:** one file, up to 64 KB, no libraries bundled in.

## Limits

Up to 3 new widgets in one design, 64 KB of code each. Up to 20 designs with new widgets waiting at once,
and 10 new ones a day.
