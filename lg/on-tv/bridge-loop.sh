#!/bin/sh
# couch-tv bridge on this TV: start it and restart it if it ever stops.
D=/home/root   # the TV root user's home
cd "$D"/couchtv || exit 1
while true; do
  ./python/bin/python3 run-bridge.py >> /tmp/couchtv-bridge.log 2>&1
  sleep 5
done
