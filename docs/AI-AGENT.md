# Connect your own AI agent to the TV

Your own AI app (Claude Desktop, Claude Code, Cursor, or any program that speaks MCP or plain HTTP) can:

- **show a message on the TV** ("Dinner is ready"): it pops up over the home and fills the **From your AI**
  widget. The TV listens for messages only once you opt in: a **From your AI** or **Ask AI** widget on the
  home, or Ask AI set up on that TV. A home with neither asks the computer nothing;
- **change the TV home**: design one with couch-tv Studio's own MCP tools and send it as a code; the TV
  fetches it and asks **Use this design?** first, so nothing changes until someone presses OK. This works
  only on a TV where designs are turned on (Home settings, Designs): an agent never turns them
  on, and a TV with **Your design** turned off keeps the standard home;
- **drive the TV**: play a show, open an app, press keys, change the volume (the tools that were already there);
- **read what the TV shows** from Ask AI.

It runs on your plan or your key, never couch-tv's.

## What it needs

The agent reaches the TV through couch-tv's own API, so one of:

- **The couch-tv TV app (option C).** No computer at home needed: the agent's computer talks straight to
  the TV app at `http://<tv address>:5400`. Pair once with the PIN the TV shows (the phone remote's pairing).
- **A computer at home running couch-tv (option B).** The bridge at `http://<computer>:5400`, with
  `bridge.pairing_key` if you set one.

Option A alone (the home with no TV app and no computer) has nothing an agent can reach: add the TV app.

**The key for the TV app** (option C): pair the agent once like a phone. On the agent's computer:

```
curl -X POST http://tv.example:5400/api/pair/start          # the TV shows a 6 digit code
curl -X POST http://tv.example:5400/api/pair -H 'content-type: application/json' -d '{"pin": "123456", "name": "My AI"}'
```

The answer's `token` is the `BRIDGE_KEY` below. For the computer at home (option B) it is `bridge.pairing_key`.

## Claude Desktop, Claude Code or Cursor

The TV's MCP server is `bridge/mcp_server.py` (Python 3.11 and `pip install -r bridge/requirements.txt`).
Add it to your app's MCP settings, for example Claude Desktop's `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "tv": {
      "command": "/path/to/couch-tv/.venv/bin/python",
      "args": ["/path/to/couch-tv/bridge/mcp_server.py"],
      "env": { "BRIDGE_URL": "http://tv.example:5400", "BRIDGE_KEY": "your pairing key" }
    }
  }
}
```

Claude Code: `claude mcp add tv --env BRIDGE_URL=http://tv.example:5400 --env BRIDGE_KEY=... -- /path/to/couch-tv/.venv/bin/python /path/to/couch-tv/bridge/mcp_server.py`.
Cursor: the same `command`, `args` and `env` in `.cursor/mcp.json`.

To design homes too, add couch-tv Studio's own MCP server as well: couch-tv Studio's help gives the line to add.
Then ask: "Design an autumn home for the lounge TV and put it on the TV." Studio's `send_to_tv` gives a code,
and this server's `set_home_design` hands the code to the TV.

## The tools for the TV home

| Tool | What it does |
|---|---|
| `show_message(text, sender, seconds)` | Up to 280 characters, plain words, shown 5 to 600 seconds |
| `set_home_design(code)` | A couch-tv Studio code (`ABCDE-FGHJK` or `CTV1-...`); the TV asks first |
| `tv_says()` | The last question and answer, message and design code |
| `list_widgets()` | The widgets on the home's design, each with its settings and their values now |
| `set_widget_setting(widget, setting, value)` | Changes one setting of one widget, as the phone's Home settings page does. Only settings a phone may change; the TV checks the value |

For example, ask: "Set the weather widget's place to Byron Bay." The agent finds the widget with `list_widgets`
and changes its `town`. The Couch TV home has to be open on the TV; if it is not, the answer says to open it.

## Plain HTTP (any program)

Every call carries `Authorization: Bearer <pairing key>` when the TV app or bridge has one.

```
POST /api/say/message   {"text": "Dinner is ready", "from": "Claude", "seconds": 30}
POST /api/say/design    {"code": "ABCDE-FGHJK", "from"?: "phone"}   -> {"design": {...}, "asks_first": true, "listening": true}
POST /api/say/scene     {"pick": "next" | "prev"}                     -> {"scene": {...}, "listening": true}
GET  /api/say           {"ask": {...}, "message": {...}, "design": {...}, "scene": {...}}
```

`/api/say/scene` is what the phone remote's Next scene and Previous scene buttons send (in its TV sheet):
the home shows the next or the previous scene (Night) or photo (Classic) within a few seconds, if it was
pressed in the last minute. Only `next` and `prev` are taken.

`from` is optional: `"phone"` is what the phone remote's Send a design sends, and the TV then says the
design came from your phone. Anything else, or nothing, is an AI agent ("from your AI"). Only those two
words reach the TV. `listening` is false when the TV home has not asked in the last 30 seconds (it is not
open): it shows the design when it next opens, within 10 minutes.

A message is plain text: no link is made clickable and nothing in it is run. A design code is only a code:
the TV fetches the design from couch-tv Studio's store itself and puts it through the same gate as a typed
code. Nothing is kept on disk.
