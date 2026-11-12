# The bridge in Docker

Option B's bridge can run in Docker on a NAS or any other always-on machine that has Docker.
[`examples/docker/`](../examples/docker/) holds the files. They come from a setup by
[ChrisFWCB](https://github.com/ChrisFWCB), who first ran it on a Synology DS1019+ (DSM 7.2) with an
LG TV ([#56](https://github.com/Seagey/couch-tv/issues/56)). Thank you.

The image carries Python, the bridge's packages and LG's `ares` tools (used only by LG TVs, for the
daily Developer Mode Extend). The repo folder is mounted at `/app`, so `config.json`, `remote/dist`
and `bridge/data/` (the pairing keys and history) live in the repo folder and survive a rebuild.
The container uses host networking, so Wake-on-LAN and finding TVs work. The bridge listens on port
5400, or `PORT` if you set one.

## Set it up

1. Follow the [SETUP.md](SETUP.md) steps up to the bridge for your TV (steps 1 to 4), on any computer, then copy
   the repo to the Docker host with `config.json` and the phone remote built (`remote/dist`).
   Set `bridge.host` in `config.json` to the Docker host's name or address.
2. Pair the TV (step 3) so that `bridge/data/` holds its keys. You can run `bridge/pair_tv.py`
   on the Docker host's copy of the repo, or copy `bridge/data/` across after pairing elsewhere.
   **Android and Google TV:** the bridge also talks to the TV over ADB, with the key in
   `bridge/data/adbkey` inside the container. Copy `~/.android/adbkey` and `~/.android/adbkey.pub`
   from the computer you set the TV up with into `bridge/data/`, since the TV already trusts that
   key. If you do not, the bridge makes a new key and the TV asks "Allow USB debugging?" once more:
   tick Always allow.
3. **LG only.** Put the TV's Developer Mode key at `lg-key/<ares_device>_webos` in the repo
   ([LG.md](LG.md), step 2). `lg-key/` is in `.gitignore`.
4. Copy `examples/docker/.env.example` to `examples/docker/.env`, fill it in and run
   `chmod 600` on it. For a TV that is not an LG, leave `TV_IP` empty.
5. From the repo folder, start it:

   ```sh
   docker compose -f examples/docker/compose.yaml up -d --build
   ```

6. Open `http://<docker host>:5400/api/tvs` to check it. For an LG, the Developer Mode status
   is in that reply.

After you change `config.json` or the bridge's code, restart the container:
`docker compose -f examples/docker/compose.yaml restart`.

Everything in [HOW-IT-WORKS.md](HOW-IT-WORKS.md#privacy-and-safety) about who can reach the bridge still applies: it has no password, so keep
it on your home network and never forward a port to it.

## Synology note

In Container Manager you can make a project from `examples/docker/compose.yaml` instead of using
the command line. Docker on DSM needs root, so this step is for the owner, not an AI agent. On
some Synologys `scp` fails with "Connection closed". Copying the repo with `tar` over `ssh` works:

```sh
tar -cf - . | ssh nas 'cd /volume1/docker/couch-tv && tar -xf -'
```

The Developer Mode passphrase sits in `examples/docker/.env`, which git ignores. Keep that file
private.
