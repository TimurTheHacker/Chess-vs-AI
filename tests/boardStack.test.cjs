// boardStack.test.js — plain Node.js, no test framework needed
// Run: node tests/boardStack.test.js

const BoardStack = require('../boardStack.js');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

function assertEqual(a, b, label) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (ok) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}\n    expected: ${JSON.stringify(b)}\n    got:      ${JSON.stringify(a)}`);
    failed++;
  }
}

function reset(pieces) {
  BoardStack.init(pieces);
}

// ─── Suite 1: Basic placement & visibility ───────────────────────────────────
console.log('\nSuite 1: Basic placement & visibility');

reset([{ square: 'e4', type: 'P', color: 'w', id: 'wP1' }]);
assert(BoardStack.getVisiblePiece('e4') !== null, 'e4 has a visible piece');
assertEqual(BoardStack.getVisiblePiece('e4').id, 'wP1', 'e4 visible piece is wP1');
assert(BoardStack.getVisiblePiece('e5') === null, 'empty square returns null');

// ─── Suite 2: Non-capture stacking (AI blunder) ──────────────────────────────
console.log('\nSuite 2: Non-capture stacking');

reset([{ square: 'e4', type: 'P', color: 'w', id: 'wP1' }]);
BoardStack.placePiece('e4', { type: 'n', color: 'b', id: 'bN1' }, false);

const all = BoardStack.getAllPiecesOnSquare('e4');
assertEqual(all.length, 2, 'e4 stack has 2 pieces after non-capture push');
assertEqual(all[0].id, 'wP1', 'bottom piece is wP1 (original)');
assertEqual(all[1].id, 'bN1', 'top piece is bN1 (new arrival)');
assertEqual(BoardStack.getVisiblePiece('e4').id, 'bN1', 'visible piece is bN1 (top)');
assert(BoardStack.hasHiddenPieces('e4'), 'e4 reports hidden pieces');

// ─── Suite 3: Capture clears stack ───────────────────────────────────────────
console.log('\nSuite 3: Capture clears stack');

reset([{ square: 'd5', type: 'Q', color: 'w', id: 'wQ1' }]);
BoardStack.placePiece('d5', { type: 'r', color: 'b', id: 'bR1' }, false); // stack
const captured = BoardStack.placePiece('d5', { type: 'B', color: 'w', id: 'wB1' }, true); // capture

assertEqual(BoardStack.getAllPiecesOnSquare('d5').length, 1, 'capture leaves exactly 1 piece');
assertEqual(BoardStack.getVisiblePiece('d5').id, 'wB1', 'wB1 now visible on d5');
assertEqual(captured.length, 2, 'capture returned both buried pieces');

// ─── Suite 4: removeTopPiece ─────────────────────────────────────────────────
console.log('\nSuite 4: removeTopPiece');

reset([{ square: 'f6', type: 'k', color: 'b', id: 'bK1' }]);
BoardStack.placePiece('f6', { type: 'P', color: 'w', id: 'wP2' }, false);
const removed = BoardStack.removeTopPiece('f6');
assertEqual(removed.id, 'wP2', 'removeTopPiece returns the top piece');
assertEqual(BoardStack.getVisiblePiece('f6').id, 'bK1', 'bK1 now visible after pop');
assert(!BoardStack.hasHiddenPieces('f6'), 'no more hidden pieces on f6');

const removedAgain = BoardStack.removeTopPiece('f6');
assertEqual(removedAgain.id, 'bK1', 'removeTopPiece on single-piece square works');
assert(BoardStack.getVisiblePiece('f6') === null, 'f6 is empty after removing last piece');

const removedEmpty = BoardStack.removeTopPiece('f6');
assert(removedEmpty === null, 'removeTopPiece on empty square returns null');

// ─── Suite 5: movePieceFromStack — top piece ─────────────────────────────────
console.log('\nSuite 5: movePieceFromStack (top piece)');

reset([
  { square: 'c3', type: 'N', color: 'w', id: 'wN1' },
  { square: 'd4', type: 'p', color: 'b', id: 'bP1' },
]);
BoardStack.movePieceFromStack('c3', 'wN1', 'd4', false); // stack onto bP1

assertEqual(BoardStack.getVisiblePiece('c3'), null, 'c3 now empty');
assertEqual(BoardStack.getVisiblePiece('d4').id, 'wN1', 'wN1 is top of d4');
assertEqual(BoardStack.getAllPiecesOnSquare('d4').length, 2, 'd4 has 2 pieces');

// ─── Suite 6: movePieceFromStack — buried piece ──────────────────────────────
console.log('\nSuite 6: Moving a buried piece out');

reset([{ square: 'a1', type: 'R', color: 'w', id: 'wR1' }]);
BoardStack.placePiece('a1', { type: 'q', color: 'b', id: 'bQ1' }, false); // bQ1 buries wR1
BoardStack.placePiece('a1', { type: 'B', color: 'w', id: 'wB2' }, false); // wB2 on top

// Move the buried wR1 out (it's at index 0)
const result = BoardStack.movePieceFromStack('a1', 'wR1', 'h8', false);
assert(result !== null, 'movePieceFromStack found buried piece');
assertEqual(result.moved.id, 'wR1', 'moved piece is wR1');
assertEqual(BoardStack.getAllPiecesOnSquare('a1').length, 2, 'a1 still has 2 pieces (bQ1 + wB2)');
assertEqual(BoardStack.getAllPiecesOnSquare('a1')[0].id, 'bQ1', 'bQ1 is now bottom of a1');
assertEqual(BoardStack.getVisiblePiece('h8').id, 'wR1', 'wR1 arrived at h8');

// ─── Suite 7: Multi-level stack ───────────────────────────────────────────────
console.log('\nSuite 7: Multi-level stacks');

reset([]);
const pieces = [
  { type: 'p', color: 'b', id: 'bP5' },
  { type: 'R', color: 'w', id: 'wR2' },
  { type: 'n', color: 'b', id: 'bN2' },
  { type: 'Q', color: 'w', id: 'wQ2' },
];
for (const p of pieces) BoardStack.placePiece('b2', p, false);

const stack7 = BoardStack.getAllPiecesOnSquare('b2');
assertEqual(stack7.length, 4, 'b2 has 4 stacked pieces');
assertEqual(stack7.map(p => p.id), ['bP5','wR2','bN2','wQ2'], 'stack order is bottom-to-top');
assertEqual(BoardStack.getVisiblePiece('b2').id, 'wQ2', 'wQ2 is visible (top)');

// Remove top 4 one by one, check each
const ids = ['wQ2','bN2','wR2','bP5'];
for (const id of ids) {
  const top = BoardStack.removeTopPiece('b2');
  assertEqual(top.id, id, `popped ${id} in order`);
}
assert(BoardStack.getVisiblePiece('b2') === null, 'b2 empty after popping all');

// ─── Suite 8: findPiecesByTypeAndColor ────────────────────────────────────────
console.log('\nSuite 8: findPiecesByTypeAndColor');

reset([
  { square: 'a2', type: 'P', color: 'w', id: 'wP_a2' },
  { square: 'b2', type: 'P', color: 'w', id: 'wP_b2' },
  { square: 'c3', type: 'n', color: 'b', id: 'bN_c3' },
]);
const wPawns = BoardStack.findPiecesByTypeAndColor('P', 'w');
assertEqual(wPawns.length, 2, 'found 2 white pawns');

const bKnights = BoardStack.findPiecesByTypeAndColor('n', 'b');
assertEqual(bKnights.length, 1, 'found 1 black knight');
assertEqual(bKnights[0].square, 'c3', 'black knight is on c3');

// ─── Suite 9: Snapshot/restore ────────────────────────────────────────────────
console.log('\nSuite 9: Snapshot and restore');

reset([{ square: 'g7', type: 'p', color: 'b', id: 'bP_g7' }]);
BoardStack.placePiece('g7', { type: 'R', color: 'w', id: 'wR_g7' }, false);
const snap = BoardStack.getSnapshot();

// Mutate board then restore
BoardStack.placePiece('g7', { type: 'Q', color: 'w', id: 'wQ_tmp' }, false);
assertEqual(BoardStack.getAllPiecesOnSquare('g7').length, 3, 'g7 has 3 after mutation');

BoardStack.loadSnapshot(snap);
assertEqual(BoardStack.getAllPiecesOnSquare('g7').length, 2, 'restored to 2 after loadSnapshot');
assertEqual(BoardStack.getVisiblePiece('g7').id, 'wR_g7', 'correct top piece after restore');

// ─── Suite 10: Interaction — capture on a stacked square ─────────────────────
console.log('\nSuite 10: Capture on a stacked square');

reset([
  { square: 'e5', type: 'Q', color: 'w', id: 'wQ_e5' },
]);
BoardStack.placePiece('e5', { type: 'r', color: 'b', id: 'bR_e5' }, false); // bR on top
// AI plays explicit capture onto e5 — all existing pieces should be cleared
const cap10 = BoardStack.placePiece('e5', { type: 'n', color: 'b', id: 'bN_cap' }, true);
assertEqual(cap10.length, 2, 'explicit capture cleared both pieces from e5');
assertEqual(BoardStack.getVisiblePiece('e5').id, 'bN_cap', 'bN_cap now alone on e5');

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n─────────────────────────────────────`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
