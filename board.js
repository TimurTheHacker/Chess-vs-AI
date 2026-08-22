// board.js
// Renders the 8x8 board and handles native HTML5 drag-and-drop for human moves.
// Calls back into game.js via window.Game.onHumanMove(from, to).

const Board = (() => {
  // Unicode piece glyphs. White = uppercase key, black = lowercase key.
  const GLYPHS = {
    K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙',
    k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',
  };

  let _boardEl = null;
  let _humanColor = 'w';   // set on init
  let _dragFrom = null;    // square key being dragged from

  /** Map piece type+color to a glyph string. */
  function pieceToGlyph(piece) {
    if (!piece) return '';
    return GLYPHS[piece.type] ?? piece.type;
  }

  /**
   * Initialize the board DOM inside `containerEl`.
   * humanColor: 'w' or 'b' — determines which rank is rendered at the bottom.
   * The board itself is 64 square divs in a CSS grid.
   */
  function init(containerEl, humanColor) {
    _boardEl = containerEl;
    _humanColor = humanColor;
    _boardEl.innerHTML = '';
    _boardEl.className = 'chessboard';

    // Build squares in visual order (top-left to bottom-right).
    // If human is white: rank 8 on top, rank 1 at bottom (standard).
    // If human is black: rank 1 on top, rank 8 at bottom (flipped).
    const ranks = humanColor === 'w'
      ? ['8','7','6','5','4','3','2','1']
      : ['1','2','3','4','5','6','7','8'];
    const files = humanColor === 'w'
      ? ['a','b','c','d','e','f','g','h']
      : ['h','g','f','e','d','c','b','a'];

    for (const rank of ranks) {
      for (const file of files) {
        const sq = file + rank;
        const div = document.createElement('div');
        div.className = 'square ' + _squareColor(file, rank);
        div.dataset.square = sq;

        // Drag-and-drop targets
        div.addEventListener('dragover', _onDragOver);
        div.addEventListener('drop', _onDrop);
        div.addEventListener('dragleave', _onDragLeave);

        _boardEl.appendChild(div);
      }
    }
  }

  /**
   * Render the current board state from BoardStack.
   * Call this after every move (human or AI).
   */
  function render() {
    const squares = _boardEl.querySelectorAll('.square');
    squares.forEach(sq => {
      const key = sq.dataset.square;
      const visible = BoardStack.getVisiblePiece(key);
      const hasHidden = BoardStack.hasHiddenPieces(key);

      // Clear old content
      sq.innerHTML = '';
      sq.classList.remove('has-hidden');

      if (visible) {
        const span = document.createElement('span');
        span.className = 'piece ' + (visible.color === 'w' ? 'piece-white' : 'piece-black');
        span.textContent = pieceToGlyph(visible);
        span.draggable = true;
        span.dataset.square = key;
        span.dataset.pieceId = visible.id;
        span.dataset.color = visible.color;

        span.addEventListener('dragstart', _onDragStart);
        sq.appendChild(span);
      }

      // Visual badge for hidden (stacked) pieces
      if (hasHidden) {
        sq.classList.add('has-hidden');
        const badge = document.createElement('span');
        badge.className = 'hidden-badge';
        badge.title = 'Pieces are stacked here';
        badge.textContent = BoardStack.getAllPiecesOnSquare(key).length;
        sq.appendChild(badge);
      }
    });
  }

  /** Highlight legal destination squares for a given piece (visual aid). */
  function highlightLegal(squares) {
    clearHighlights();
    squares.forEach(sq => {
      const el = _boardEl.querySelector(`[data-square="${sq}"]`);
      if (el) el.classList.add('legal-target');
    });
  }

  function clearHighlights() {
    _boardEl.querySelectorAll('.legal-target').forEach(el => el.classList.remove('legal-target'));
    _boardEl.querySelectorAll('.drag-source').forEach(el => el.classList.remove('drag-source'));
    _boardEl.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  }

  /** Flash a square red briefly (illegal move snap-back feedback). */
  function flashIllegal(square) {
    const el = _boardEl.querySelector(`[data-square="${square}"]`);
    if (!el) return;
    el.classList.add('illegal-flash');
    setTimeout(() => el.classList.remove('illegal-flash'), 500);
  }

  // ─── Drag-and-drop handlers ────────────────────────────────────────────────

  function _onDragStart(e) {
    const span = e.currentTarget;
    _dragFrom = span.dataset.square;
    span.closest('.square').classList.add('drag-source');

    // Ask game.js for legal destinations to highlight
    // (Game is a global const — not on window, but accessible in the same script scope)
    if (typeof Game !== 'undefined' && Game.getLegalDestinations) {
      const dests = Game.getLegalDestinations(_dragFrom);
      highlightLegal(dests);
    }

    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', _dragFrom);
  }

  function _onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    e.currentTarget.classList.add('drag-over');
  }

  function _onDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
  }

  function _onDrop(e) {
    e.preventDefault();
    const toSquare = e.currentTarget.dataset.square;
    e.currentTarget.classList.remove('drag-over');
    clearHighlights();

    if (!_dragFrom || !toSquare || _dragFrom === toSquare) {
      _dragFrom = null;
      return;
    }

    const from = _dragFrom;
    _dragFrom = null;

    // Delegate to game logic
    if (typeof Game !== 'undefined' && Game.onHumanMove) {
      Game.onHumanMove(from, toSquare);
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function _squareColor(file, rank) {
    const fileIdx = 'abcdefgh'.indexOf(file);
    const rankIdx = parseInt(rank) - 1;
    return (fileIdx + rankIdx) % 2 === 0 ? 'dark' : 'light';
  }

  return { init, render, highlightLegal, clearHighlights, flashIllegal, pieceToGlyph };
})();
