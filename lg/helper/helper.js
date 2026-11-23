'use strict';
// Runs the relay and turns its lines into app launches. Exits with the relay; the bridge starts
// the Helper again at the next power on. ES5 only: older webOS ships an old Node.
var cp = require('child_process');
var path = require('path');

var COUCH = 'app.couchtv.home';
var LG_HOME = 'com.webos.app.home';

function log(line) { console.log(new Date().toISOString() + ' ' + line); }
function luna(uri, payload, what) {
  cp.execFile('/usr/bin/luna-send-pub', ['-n', '1', uri, JSON.stringify(payload)], function (err) {
    if (err) log(what + ' failed: ' + err.message);
  });
}
function launch(id) { luna('luna://com.webos.applicationManager/launch', { id: id }, 'launch ' + id); }
function toast(message) { luna('luna://com.webos.notification/createToast', { message: message }, 'toast'); }

var relay = cp.spawn(path.join(__dirname, 'relay'), [], { stdio: ['pipe', 'pipe', 'inherit'] });
relay.stdin.on('error', function () {});
var beat = setInterval(function () { relay.stdin.write('P'); }, 500);

var buf = '';
relay.stdout.on('data', function (d) {
  buf += d;
  var i;
  while ((i = buf.indexOf('\n')) >= 0) {
    var line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    log(line);
    if (line === 'HOME') launch(COUCH);
    else if (line === 'LGHOME') launch(LG_HOME);
    else if (line === 'OFF') toast('Home button: LG home. Press Home 3 times to switch back.');
    else if (line === 'ON') toast('Home button: Couch TV');
  }
});
relay.on('exit', function (code) {
  clearInterval(beat);
  log('relay exit ' + code);
  if (code === 27) launch(LG_HOME);
  setTimeout(function () { process.exit(0); }, 500);
});
process.on('SIGTERM', function () { relay.stdin.write('Q'); });
