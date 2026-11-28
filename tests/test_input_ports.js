const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const source = fs.readFileSync(require('path').join(__dirname, '../tv-home/web/app.js'), 'utf8');
let detected = [];
const context = { TVCFG: {}, HOME: {}, window: {}, inputList: () => detected };
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('  function portByOrder('), source.indexOf('  function gridList(')), context);
const ids = cfgs => { context.TVCFG = { inputs: cfgs }; return Array.from(context.resolveInputs(), x => x.id); };
const hdmi = (n, label = '') => ({ id: 'com.example/.Input/HW' + n, label, type: 'hdmi', devices: [] });

// a TCL: HW15 to HW17 are HDMI 1 to 3, listed highest first, with labels that name no port
detected = [hdmi(17), hdmi(16), hdmi(15)];
assert.deepStrictEqual(ids([{ port: 1 }, { port: 2 }, { port: 3 }]), [hdmi(15).id, hdmi(16).id, hdmi(17).id]);
assert.deepStrictEqual(ids([{ port: 4 }]), ['HDMI_4']);

// port numbers that are the HW numbers
detected = [hdmi(1), hdmi(2), hdmi(3)];
assert.deepStrictEqual(ids([{ port: 2 }]), [hdmi(2).id]);

// HW numbers that start above 1 but near the ports keep the old exact match
detected = [hdmi(2), hdmi(3), hdmi(4), hdmi(5)];
assert.deepStrictEqual(ids([{ port: 2 }]), [hdmi(2).id]);

// the TV's own label and an exact id still win
detected = [hdmi(15, 'HDMI 2'), hdmi(16, 'HDMI 1')];
assert.deepStrictEqual(ids([{ port: 1 }]), [hdmi(16).id]);
assert.deepStrictEqual(ids([{ id: hdmi(15).id, port: 1 }]).length, 1);
console.log('Input port matching tests passed.');
