// boardStack.js
// Each square holds an ordered array (stack) of pieces.
// Index 0 = bottom (oldest), last index = top (visible/active).
// Piece objects: { type: 'K'|'Q'|'R'|'B'|'N'|'P'|'k'|..., color: 'w'|'b', id: string }
// Square keys are algebraic notation strings: 'e4', 'a1', etc.

const BoardStack = (() => {
  // Internal state: map from square -> array of piece objects
  let _stacks = {};

  function _key(square) {
    return square.toLowerCase();
  }

  /** Initialize or reset the board stacks. Call with the starting position array.
   *  pieces: [{ square, type, color, id }]
   */
  function init(pieces) {
    _stacks = {};
    for (const p of pieces) {
      const k = _key(p.square);
      _stacks[k] = [{ type: p.type, color: p.color, id: p.id }];
    }
  }

  /** Return the top (visible) piece on a square, or null if empty. */
  function getVisiblePiece(square) {
    const stack = _stacks[_key(square)];
    if (!stack || stack.length === 0) return null;
    return stack[stack.length - 1];
  }

  /** Return all pieces on a square (bottom to top order), or []. */
  function getAllPiecesOnSquare(square) {
    return [...(_stacks[_key(square)] || [])];
  }

  /** Return true if a square has hidden (buried) pieces. */
  function hasHiddenPieces(square) {
    const stack = _stacks[_key(square)];
    return stack && stack.length > 1;
  }

  /**
   * Place a piece onto a square.
   * isCapture = true  → remove ALL existing pieces on the square first (normal capture).
   * isCapture = false → push the new piece on top of whatever is there (stacking mechanic).
   * Returns the array of pieces removed (for capture tracking). Empty array if stacking.
   */
  function placePiece(square, piece, isCapture) {
    const k = _key(square);
    let captured = [];
    if (isCapture) {
      captured = _stacks[k] ? [..._stacks[k]] : [];
      _stacks[k] = [];
    }
    if (!_stacks[k]) _stacks[k] = [];
    _stacks[k].push({ type: piece.type, color: piece.color, id: piece.id });
    return captured;
  }

  /**
   * Remove only the top piece from a square (e.g., when a piece moves away).
   * Returns the removed piece, or null if the square was already empty.
   */
  function removeTopPiece(square) {
    const k = _key(square);
    if (!_stacks[k] || _stacks[k].length === 0) return null;
    return _stacks[k].pop();
  }

  /**
   * Move a specific piece (identified by id) from fromSquare to toSquare.
   * The piece may be anywhere in fromSquare's stack (top or buried).
   * isCapture controls whether existing pieces on toSquare are cleared or stacked.
   *
   * Returns { moved: piece, captured: [] } or null if the piece wasn't found.
   *
   * This is the primary function for applying any move (human or AI).
   * For human moves, fromSquare's visible piece is moved (top of stack).
   * For AI moves, the AI specifies a piece type; we find the matching piece
   * on fromSquare (preferring top, but any match counts since AI can be imprecise).
   */
  function movePieceFromStack(fromSquare, pieceId, toSquare, isCapture) {
    const fk = _key(fromSquare);
    const stack = _stacks[fk];
    if (!stack) return null;

    const idx = _findPieceById(stack, pieceId);
    if (idx === -1) return null;

    const [piece] = stack.splice(idx, 1);
    if (stack.length === 0) delete _stacks[fk];

    const captured = placePiece(toSquare, piece, isCapture);
    return { moved: piece, captured };
  }

  /**
   * Move the top piece of fromSquare to toSquare.
   * Convenience wrapper used for human moves (always move top piece).
   */
  function moveTopPiece(fromSquare, toSquare, isCapture) {
    const fk = _key(fromSquare);
    const stack = _stacks[fk];
    if (!stack || stack.length === 0) return null;
    const piece = stack[stack.length - 1];
    return movePieceFromStack(fromSquare, piece.id, toSquare, isCapture);
  }

  /**
   * Find a piece by type+color anywhere on the board, returning all { square, stackIndex } matches.
   * Used by the move parser to locate candidate pieces for ambiguous AI moves.
   */
  function findPiecesByTypeAndColor(type, color) {
    const results = [];
    for (const [sq, stack] of Object.entries(_stacks)) {
      stack.forEach((p, idx) => {
        if (p.type === type && p.color === color) {
          results.push({ square: sq, stackIndex: idx, piece: p });
        }
      });
    }
    return results;
  }

  /** Return a plain snapshot of all stacks (for serialization/fen-like use). */
  function getSnapshot() {
    const snap = {};
    for (const [sq, stack] of Object.entries(_stacks)) {
      if (stack.length > 0) snap[sq] = stack.map(p => ({ ...p }));
    }
    return snap;
  }

  /** Restore from a snapshot (e.g., undo or reset). */
  function loadSnapshot(snap) {
    _stacks = {};
    for (const [sq, stack] of Object.entries(snap)) {
      _stacks[sq] = stack.map(p => ({ ...p }));
    }
  }

  // --- internal helpers ---

  function _findPieceById(stack, id) {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].id === id) return i;
    }
    return -1;
  }

  return {
    init,
    getVisiblePiece,
    getAllPiecesOnSquare,
    hasHiddenPieces,
    placePiece,
    removeTopPiece,
    movePieceFromStack,
    moveTopPiece,
    findPiecesByTypeAndColor,
    getSnapshot,
    loadSnapshot,
  };
})();

if (typeof module !== 'undefined') module.exports = BoardStack;
