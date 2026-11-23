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

## Matter devices in Docker

The bridge can join Matter devices shared from Google Home, Apple Home, SmartThings or Alexa
([MATTER.md](MATTER.md)). The image already has Node.js 22. Install the Matter service once into the
mounted repo, from inside the container, then restart it:

```sh
docker compose -f examples/docker/compose.yaml exec couch-tv sh scripts/matter-setup.sh
docker compose -f examples/docker/compose.yaml restart
```

It needs the host networking the compose file already sets (Matter finds devices by multicast). On a
Linux host with Thread devices, the host needs the IPv6 route settings in MATTER.md (`accept_ra`):
the container uses the host's network. Docker Desktop on a Mac has no real host networking, so
Matter in Docker on a Mac cannot reach devices at home: run the bridge directly on a Mac instead. Tried
on Linux (Debian 12, `node:22-bookworm`) under colima on a Mac: set up, tests and the service ready;
adding a real device in Docker was not tried, because Docker on a Mac cannot reach the home network.

## Synology note

In Container Manager you can make a project from `examples/docker/compose.yaml` instead of using
the command line. Docker on DSM needs root, so this step is for the owner, not an AI agent. On
some Synologys `scp` fails with "Connection closed". Copying the repo with `tar` over `ssh` works:

```sh
tar -cf - . | ssh nas 'cd /volume1/docker/couch-tv && tar -xf -'
```

From **Windows**, OpenSSH's `scp` fails against DSM with "subsystem request failed on channel 0"
unless you add `-O` (the older copy protocol). The `tar` over `ssh` copy also works, but in
PowerShell wrap it in `cmd /c`, because PowerShell's pipeline corrupts the binary stream:

```sh
cmd /c "tar -cf - . | ssh nas ""cd /volume1/docker/couch-tv && tar -xf -"""
```

A bridge for an LG in Docker on a Synology (host network) was run end to end, including the power on
hook and the daily Developer Mode Extend, on an LG 28TQ515S ([LG.md](LG.md), #220, thanks adri07).

The Developer Mode passphrase sits in `examples/docker/.env`, which git ignores. Keep that file
private.
