# Widget settings: the contract

Every widget on a couch-tv home has its own settings. They show only for widgets that are on the
home's design right now. A widget that is not on the screen shows no settings anywhere.

## Where a widget's settings are declared

In `tv-home/web/widget-caps.js`, each kind's record gets a `settings` list:

```js
settings: [
  { key: "place", label: "Beach or town", type: "place", default: "", help: "The surf for this place. Empty uses your home's town." },
  { key: "units", label: "Wave height in", type: "choice", options: [["m", "Metres"], ["ft", "Feet"]], default: "m" }
]
```

Fields:

- `key`: the setting's name, letters and digits only.
- `label`: what the person sees, in plain words for a beginner. No jargon.
- `type`: one of
  - `place`: a town or beach, picked from a search (stored as `{ name, lat, lon, timezone }`)
  - `choice`: one of `options` (`[[value, label], ...]`)
  - `toggle`: on or off
  - `text`: a short line of text
  - `number`: a number, with `min`, `max` and `step`
  - `app`: one of the TV's installed apps (stored as the couch-tv app id or package)
  - `apps`: a list of apps, in order
  - `team`: a sports team, with `sport` and `league` (see the sports widget)
  - `device`: a smart home device of `domain` (Home Assistant `climate`, `camera`, ...)
  - `calendar`: a calendar link (private: kept on the TV only)
- `default`: the value when nothing is set.
- `help`: one plain line under the setting.
- `needs`: optional, what must be there for this setting to mean anything (`{ apps: [...], bridge: true, ha: true }`).
- `private`: `true` for anything personal (calendar links, a home address). Private values never
  leave the TV and the home Wi-Fi.

Two more types:

- `tvlist`: one of the things kept on this TV, named by `from`: `"lists"`, `"photos"`, `"people"` or
  `"calendars"` (stored as that thing's id; `"first"`, `"all"` or `"auto"` as the default)
- `image`: one photo put in the widget in couch-tv Studio (Studio only, kept in the design)

Every record also says where it lives and who shows it (WIDGET-SETTINGS-SPEC.md section 5):

- `store`: `"design"` (a public choice kept in `widget.opts[key]`, which the TV may still override
  for this widget) or `"tv"` (kept on this TV only, in Home settings `ST.widgets["<id>|<kind>"]`,
  never in a design). A `"tv"` setting is never offered in Studio.
- `where`: the screens that offer it, any of `"studio"`, `"tv"` (Hold OK and Home settings),
  `"phone"`. A setting without `"studio"` gets one line in Studio: "Set on the TV: hold OK on the
  widget."
- `pre`: `true` when it is needed before launch. Before launch settings come first in each list.

And, where they apply:

- `when`: `{ otherKey: value }`, shown only while that sibling setting has that value. The value
  `"set"` means while the sibling differs from its own default (commute `arrive_m` once an arrive by
  hour is picked).
- `sets`: the design key a screen writes from this choice, worked out when it is saved (bins
  `thisweek` sets `anchor`, so the bin picked goes out this week).
- `many` with `max`: several values, as a list (a `choice`, `text` or `device` setting).
- `suggest`: for a `text` list, ready made `[value, label]` pairs to pick from (the markets shortcuts).
- `coast` (`place`, beaches only), `domain` (`device`, one Home Assistant domain or a list),
  `league` (`team`, the key of the sibling setting naming the competition), `options`, `min`, `max`,
  `step`.

`CouchWidgetCaps.settings(kind)` returns a kind's list (`[]` for none). `tests/test_ws_schema.js`
checks every record.

## How a widget reads its settings

In `tv-home/web/widgets.js` a renderer reads a setting with

```js
var place = W.setting(o, env, "place");   // inside widgets.js: setting(o, env, "place")
```

`CouchWidgets.setting(o, env, key, dflt)` returns, in order:

1. the value set for this widget on this TV (`env.wset[o.id][key]`), kept on the TV only;
2. what couch-tv Studio set in the design (`o.opts[key]`);
3. the `default` in the widget's `settings` record;
4. `dflt`.

Fetchers in `app.js` that load data for a widget (weather, surf, sports, ...) must load it per widget
with that widget's settings, not once for the whole home, when a setting changes what is fetched
(for example two surf widgets for two beaches).

## Who builds what

- The settings screens and storage (one builder only): the TV's Hold OK menu on a widget, the
  widget's own section in Home settings and on the phone page, storing `env.wset` on the TV, the
  on-TV app's endpoints. Nobody else edits `design.js` storage, `on-tv/web/setup.html`, `Server.kt`
  or the Home settings framework in `app.js`.
- Each widget group's builder: the `settings` records for its own kinds in `widget-caps.js` (only
  those records), its own renderers in `widgets.js` and `widget-detail.js` (only those functions),
  its own fetchers in `app.js` (only those functions), its kinds' options in couch-tv Studio's widget
  panel, and its own test file `tests/test_widgets_<group>.mjs`.

## Honesty rules

- A widget never shows a place, team or source its data is not for.
- Demo data never shows on a real TV. Until real data is there, the widget shows what is missing and
  how to set it, in plain words.
- If a widget cannot work on this kind of TV, it says so plainly, and couch-tv Studio warns before it
  is placed.
