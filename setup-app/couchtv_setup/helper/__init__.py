"""Couch TV Helper: the optional "extra features from this computer" mode of the Setup app.

Same app, same download. Setup writes `helper.json` in its own folder; when the mode is "helper" the
app runs the bridge (bridge/server.py) as a child process, shows a menu bar or tray item, and can
start with the computer. No AI and no coding: the bridge only gets a config file Setup writes.
"""
