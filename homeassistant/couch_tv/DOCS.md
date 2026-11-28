# Couch TV

This app runs couch-tv's bridge ("option B") on your Home Assistant computer, so the phone remote,
"put on Bluey" search and the TV home's server work without another computer left on.

The full guide, in plain words, is
[docs/HOME-ASSISTANT.md](https://github.com/Seagey/couch-tv/blob/main/docs/HOME-ASSISTANT.md).

In short:

1. Start the app. The Log tab prints a pairing link for the phone remote.
2. Your settings live in the app's config folder (`config.json`, `.env`, `adbkey`, `data/`).
   Open it with the File editor, Samba or VS Code apps. Edit `config.json` for your TVs, people and apps.
3. Each TV is set up once from a computer, as in couch-tv's `docs/SETUP.md`, pointing at this app:
   `BRIDGE_URL=http://<home assistant address>:5400`.
4. Options: **Pairing key** (empty makes one for you), **Ask assistant** and **Conversation agent**
   (Ask through a Home Assistant conversation agent, which must be chosen; needs a couch-tv version that has it), and
   **Let Home Assistant's assistant turn the TV off** (off).
5. Home Assistant's MCP integration can use `http://127.0.0.1:5401/mcp` (this computer only).

To undo it, uninstall the app. The TVs keep what was set up on them: see docs/UNINSTALL.md.
