// game.js
// Orchestrates: chess.js (legal move validation for human), BoardStack,
// MoveParser, Board rendering, AI moves via AIAdapter, referee rulings.

const Game = (() => {
  let _chess = null;       // chess.js instance for legal-move validation
  let _humanColor = 'w';
  let _aiColor = 'b';
  let _gameOver = false;
  let _moveHistory = [];   // raw move strings (AI and human SAN)
  let _rulingLog = [];     // referee/claim log entries

  // ─── Init ────────────────────────────────────────────────────────────────

  function start(humanColor) {
    _humanColor = humanColor;
    _aiColor = humanColor === 'w' ? 'b' : 'w';
    _gameOver = false;
    _moveHistory = [];
    _rulingLog = [];

    _chess = new Chess(); // chess.js standard starting position

    // Sync BoardStack with starting position
    _syncStackFromChess();

    // Render board
    const boardEl = document.getElementById('board');
    Board.init(boardEl, _humanColor);
    Board.render();

    _updateMoveLog();
    _updateRulingLog();
    _updateTurnIndicator();

    // If AI goes first (human plays black), trigger AI move immediately
    if (_humanColor === 'b') {
      _triggerAIMove();
    }
  }

  // ─── Human move entry point (called by Board drag-and-drop) ──────────────

  function onHumanMove(from, to) {
    if (_gameOver) return;
    if (_chess.turn() !== _humanColor) return; // not human's turn

    // Attempt move through chess.js (validates legality)
    // Try promotion to queen automatically if pawn reaches back rank
    let result = _chess.move({ from, to, promotion: 'q' });

    if (!result) {
      Board.flashIllegal(from);
      return; // illegal — snap back
    }

    // Apply to BoardStack: human always moves the top piece of 'from'
    const isCapture = result.flags.includes('c') || result.flags.includes('e');
    BoardStack.moveTopPiece(from, to, isCapture);

    // Handle en passant: remove the captured pawn (it's not on 'to')
    if (result.flags.includes('e')) {
      const epRank = _humanColor === 'w' ? String(parseInt(to[1]) - 1) : String(parseInt(to[1]) + 1);
      const epSquare = to[0] + epRank;
      BoardStack.removeTopPiece(epSquare);
    }

    // Handle castling: move the rook too
    if (result.flags.includes('k') || result.flags.includes('q')) {
      _applyCastlingRook(result);
    }

    _moveHistory.push(result.san);
    Board.render();
    _updateMoveLog();
    _updateTurnIndicator();

    // Query referee after human move
    _queryReferee().then(ruling => {
      if (_handleRuling(ruling)) return; // game over
      _triggerAIMove();
    });
  }

  /** Return legal destination squares for a piece on `square` (for highlighting). */
  function getLegalDestinations(square) {
    if (_chess.turn() !== _humanColor) return [];
    return _chess.moves({ square, verbose: true }).map(m => m.to);
  }

  // ─── AI move ─────────────────────────────────────────────────────────────

  async function _triggerAIMove() {
    if (_gameOver) return;

    _setStatus('AI is thinking…');

    let rawMove;
    try {
      rawMove = await AIAdapter.getOpponentMove({
        fen: _chess.fen(),
        pgn: _chess.pgn(),
        aiColor: _aiColor,
        humanColor: _humanColor,
        moveHistory: _moveHistory,
      });
    } catch (err) {
      _setStatus('AI error — skipping turn.');
      _logRuling(`AI error: ${err.message}`);
      _chess.move('--'); // dummy pass isn't in chess.js; just flip turn workaround
      // Flip turn manually by swapping to human's turn
      _updateTurnIndicator();
      return;
    }

    _logRuling(`Claude's move: "${rawMove}"`);

    const parsed = MoveParser.parse(rawMove);
    if (!parsed) {
      _logRuling('Could not parse AI move — turn skipped.');
      _moveHistory.push(`(unparseable: ${rawMove})`);
      _updateMoveLog();
      _updateTurnIndicator();
      return;
    }

    // Find the piece to move on the board (may be buried)
    const candidate = MoveParser.resolveSourcePiece(parsed, _aiColor, BoardStack);

    if (candidate) {
      // Apply move to BoardStack (bypasses chess.js legality)
      const result = BoardStack.movePieceFromStack(
        candidate.square,
        candidate.piece.id,
        parsed.destination,
        parsed.isCapture
      );
      if (result) {
        // Speculatively update chess.js only if the move happens to be legal
        // (so FEN/PGN stay roughly accurate for referee prompts)
        _tryApplyToChessJs(candidate.square, parsed.destination);
      }
    } else {
      _logRuling(`AI referenced a piece not found on board — move applied to destination only.`);
      // Place a ghost marker? Just log it; destination square isn't touched.
    }

    // Record raw move string including +/# annotations
    _moveHistory.push(rawMove);
    Board.render();
    _updateMoveLog();
    _updateTurnIndicator();

    // Handle check/checkmate claims from AI's own annotation
    if (parsed.isCheckmate) {
      _logRuling('Claude claims: CHECKMATE — game over.');
      _endGame('Claude declared checkmate!');
      return;
    }
    if (parsed.isCheck) {
      _logRuling('Claude claims: check.');
      _showBanner('Check — according to Claude!', false);
    }

    _setStatus("Your turn");
  }

  // ─── Referee ─────────────────────────────────────────────────────────────

  async function _queryReferee() {
    try {
      const result = await AIAdapter.getRefereeRuling({
        fen: _chess.fen(),
        pgn: _chess.pgn(),
        moveHistory: _moveHistory,
        humanColor: _humanColor,
      });
      return result.ruling;
    } catch (err) {
      console.warn('Referee query failed:', err);
      return 'continue';
    }
  }

  /** Returns true if the game ended. */
  function _handleRuling(ruling) {
    if (ruling === 'continue') return false;

    const messages = {
      check: 'Referee: check.',
      checkmate: 'Referee: CHECKMATE — game over.',
      stalemate: 'Referee: STALEMATE — draw.',
      repetition: 'Referee: Threefold repetition — draw.',
    };

    _logRuling(messages[ruling] ?? `Referee ruling: ${ruling}`);

    if (ruling === 'checkmate' || ruling === 'stalemate' || ruling === 'repetition') {
      _endGame(messages[ruling]);
      return true;
    }
    if (ruling === 'check') {
      _showBanner('Check — referee ruling', false);
    }
    return false;
  }

  // ─── Castling helper ─────────────────────────────────────────────────────

  function _applyCastlingRook(result) {
    // result.flags: 'k' = kingside, 'q' = queenside
    const rank = _humanColor === 'w' ? '1' : '8';
    if (result.flags.includes('k')) {
      BoardStack.moveTopPiece('h' + rank, 'f' + rank, false);
    } else {
      BoardStack.moveTopPiece('a' + rank, 'd' + rank, false);
    }
  }

  // ─── chess.js sync ────────────────────────────────────────────────────────

  /** Populate BoardStack from chess.js board (initial sync or reset). */
  function _syncStackFromChess() {
    const pieces = [];
    const board = _chess.board();
    let idCounter = 0;
    board.forEach((row, rankIdx) => {
      row.forEach((cell, fileIdx) => {
        if (cell) {
          const file = 'abcdefgh'[fileIdx];
          const rank = String(8 - rankIdx);
          const type = cell.color === 'w' ? cell.type.toUpperCase() : cell.type.toLowerCase();
          pieces.push({ square: file + rank, type, color: cell.color, id: `${type}_${idCounter++}` });
        }
      });
    });
    BoardStack.init(pieces);
  }

  /**
   * Try to apply AI move to chess.js (for FEN/PGN tracking).
   * This will fail if the move is illegal — that's fine, we just catch and ignore.
   */
  function _tryApplyToChessJs(from, to) {
    try {
      _chess.move({ from, to, promotion: 'q' });
    } catch (_) {
      // Illegal AI move — chess.js can't track it, but boardStack already applied it.
    }
  }

  // ─── UI helpers ──────────────────────────────────────────────────────────

  function _updateTurnIndicator() {
    const el = document.getElementById('turn-indicator');
    if (!el) return;
    if (_gameOver) { el.textContent = 'Game over'; return; }
    const whose = _chess.turn() === _humanColor ? 'Your turn' : "Claude's turn";
    el.textContent = whose;
  }

  function _updateMoveLog() {
    const el = document.getElementById('move-log');
    if (!el) return;
    el.innerHTML = '';
    _moveHistory.forEach((m, i) => {
      const div = document.createElement('div');
      div.className = 'log-entry';
      div.textContent = `${i + 1}. ${m}`;
      el.appendChild(div);
    });
    el.scrollTop = el.scrollHeight;
  }

  function _updateRulingLog() {
    const el = document.getElementById('ruling-log');
    if (!el) return;
    el.innerHTML = '';
    _rulingLog.forEach(entry => {
      const div = document.createElement('div');
      div.className = 'log-entry';
      div.textContent = entry;
      el.appendChild(div);
    });
    el.scrollTop = el.scrollHeight;
  }

  function _logRuling(msg) {
    _rulingLog.push(msg);
    _updateRulingLog();
  }

  function _setStatus(msg) {
    const el = document.getElementById('status-msg');
    if (el) el.textContent = msg;
  }

  function _showBanner(msg, isEnd) {
    const el = document.getElementById('banner');
    if (!el) return;
    el.textContent = msg;
    el.className = 'banner ' + (isEnd ? 'banner-end' : 'banner-check');
    el.style.display = 'block';
    if (!isEnd) setTimeout(() => { el.style.display = 'none'; }, 3000);
  }

  function _endGame(msg) {
    _gameOver = true;
    _showBanner(msg, true);
    _updateTurnIndicator();
  }

  function resign() {
    if (_gameOver) return;
    _endGame('You resigned.');
    _logRuling('Human resigned.');
  }

  function newGame(humanColor) {
    const banner = document.getElementById('banner');
    if (banner) banner.style.display = 'none';
    start(humanColor);
  }

  return { start, newGame, onHumanMove, getLegalDestinations, resign };
})();
