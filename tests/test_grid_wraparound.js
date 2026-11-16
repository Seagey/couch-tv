// Tests for Issue #167: Wrap-around left/right navigation in the dock and in More apps.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const js = fs.readFileSync(path.join(__dirname, '..', 'tv-home', 'web', 'app.js'), 'utf8').replace(/\r\n/g, '\n');

// 1. Verify app.js contains the circular navigation in move()
assert(
  /if\s*\(\s*expanded\s*\)\s*g\s*=\s*\(g\s*\+\s*dx\s*\+\s*n\)\s*%\s*n;/.test(js),
  'app.js must implement circular line-by-line navigation when expanded'
);
assert(
  /var\s+first\s*=\s*row\s*\*\s*GRID_COLS,\s*last\s*=\s*Math\.min\(n,\s*first\s*\+\s*GRID_COLS\)\s*-\s*1;/.test(js),
  'app.js must calculate row bounds for unexpanded dock'
);
assert(
  /g\s*=\s*nx\s*>\s*last\s*\?\s*first\s*:\s*nx\s*<\s*first\s*\?\s*last\s*:\s*nx;/.test(js),
  'app.js must wrap within current row when unexpanded'
);

// 2. Logic simulation function matching move()'s grid branch
function simulateGridMove(g, dx, expanded, n, GRID_COLS) {
  var row = Math.floor(g / GRID_COLS);
  if (dx && n > 0) {
    if (expanded) {
      return (g + dx + n) % n;
    } else {
      var first = row * GRID_COLS;
      var last = Math.min(n, first + GRID_COLS) - 1;
      var nx = g + dx;
      return nx > last ? first : nx < first ? last : nx;
    }
  }
  return g;
}

// 3. Test unexpanded dock: single row of 8 items, GRID_COLS = 12
const DOCK_COLS = 12;
const DOCK_COUNT = 8;
// Left from first app (0) jumps to last tile (7)
assert.strictEqual(simulateGridMove(0, -1, false, DOCK_COUNT, DOCK_COLS), 7, 'dock: left from 0 wraps to last item 7');
// Right from last tile (7) jumps to first app (0)
assert.strictEqual(simulateGridMove(7, 1, false, DOCK_COUNT, DOCK_COLS), 0, 'dock: right from last item 7 wraps to 0');
// Normal steps in dock
assert.strictEqual(simulateGridMove(0, 1, false, DOCK_COUNT, DOCK_COLS), 1, 'dock: 0 + 1 = 1');
assert.strictEqual(simulateGridMove(4, 1, false, DOCK_COUNT, DOCK_COLS), 5, 'dock: 4 + 1 = 5');
assert.strictEqual(simulateGridMove(4, -1, false, DOCK_COUNT, DOCK_COLS), 3, 'dock: 4 - 1 = 3');

// 4. Test unexpanded multi-row dock (Classic look, 20 items, 10 per row)
const CLASSIC_COLS = 10;
const CLASSIC_COUNT = 20;
// Row 0 wrapping
assert.strictEqual(simulateGridMove(0, -1, false, CLASSIC_COUNT, CLASSIC_COLS), 9, 'classic row 0: left from 0 wraps to 9');
assert.strictEqual(simulateGridMove(9, 1, false, CLASSIC_COUNT, CLASSIC_COLS), 0, 'classic row 0: right from 9 wraps to 0');
// Row 1 wrapping
assert.strictEqual(simulateGridMove(10, -1, false, CLASSIC_COUNT, CLASSIC_COLS), 19, 'classic row 1: left from 10 wraps to 19');
assert.strictEqual(simulateGridMove(19, 1, false, CLASSIC_COUNT, CLASSIC_COLS), 10, 'classic row 1: right from 19 wraps to 10');

// 5. Test expanded More apps: 25 items across 3 rows, 12 per row
const MORE_COLS = 12;
const MORE_COUNT = 25;
// Line-by-line transitions
assert.strictEqual(simulateGridMove(11, 1, true, MORE_COUNT, MORE_COLS), 12, 'more apps: right on 11 moves across row to 12');
assert.strictEqual(simulateGridMove(12, -1, true, MORE_COUNT, MORE_COLS), 11, 'more apps: left on 12 moves across row to 11');
assert.strictEqual(simulateGridMove(23, 1, true, MORE_COUNT, MORE_COLS), 24, 'more apps: right on 23 moves across row to 24');
assert.strictEqual(simulateGridMove(24, -1, true, MORE_COUNT, MORE_COLS), 23, 'more apps: left on 24 moves across row to 23');
// Full grid circular wrap-around
assert.strictEqual(simulateGridMove(24, 1, true, MORE_COUNT, MORE_COLS), 0, 'more apps: right on last item 24 wraps to 0');
assert.strictEqual(simulateGridMove(0, -1, true, MORE_COUNT, MORE_COLS), 24, 'more apps: left on first item 0 wraps to last item 24');

// 6. Edge cases: single item and empty list
assert.strictEqual(simulateGridMove(0, 1, false, 1, 12), 0, 'single item stays at 0');
assert.strictEqual(simulateGridMove(0, -1, false, 1, 12), 0, 'single item stays at 0');
assert.strictEqual(simulateGridMove(0, 1, true, 1, 12), 0, 'expanded single item stays at 0');
assert.strictEqual(simulateGridMove(0, -1, true, 1, 12), 0, 'expanded single item stays at 0');
assert.strictEqual(simulateGridMove(0, 1, false, 0, 12), 0, 'empty list stays at 0');
assert.strictEqual(simulateGridMove(0, 1, true, 0, 12), 0, 'expanded empty list stays at 0');

console.log('Grid wraparound tests (#167) passed.');
