// game.js
// Orchestrates: chess.js (legal move validation for human), BoardStack,
// MoveParser, Board rendering, AI moves via AIAdapter, referee rulings.

const Game = (() => {
  let _chess = null;          // chess.js instance for legal-move validation
  let _humanColor = 'w';
  let _aiColor = 'b';
  let _gameOver = false;
  let _isHumanTurn = false;   // own flag — NOT _chess.turn(), which breaks when AI makes illegal moves
  let _moveHistory = [];      // raw move strings (AI and human SAN)
  let _rulingLog = [];        // referee/claim log entries

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

    if (_humanColor === 'b') {
      // AI (white) goes first
      _isHumanTurn = false;
      _updateTurnIndicator();
      _triggerAIMove();
    } else {
      _isHumanTurn = true;
      _updateTurnIndicator();
    }
  }

  // ─── Human move entry point (called by Board drag-and-drop) ──────────────

  function onHumanMove(from, to) {
    if (_gameOver) return;
    if (!_isHumanTurn) return; // block input while AI is thinking or it's not human's turn

    // Attempt move through chess.js (validates legality)
    // Promotion defaults to queen automatically
    const result = _chess.move({ from, to, promotion: 'q' });

    if (!result) {
      Board.flashIllegal(from);
      return; // illegal — snap back, turn stays with human
    }

    // Immediately mark it as AI's turn so rapid drags are ignored during async work
    _isHumanTurn = false;

    // Apply to BoardStack: human always moves the top piece of 'from'
    const isCapture = result.flags.includes('c') || result.flags.includes('e');
    BoardStack.moveTopPiece(from, to, isCapture);

    // Handle en passant: remove the captured pawn from its actual square
    if (result.flags.includes('e')) {
      const epRank = _humanColor === 'w' ? String(parseInt(to[1]) - 1) : String(parseInt(to[1]) + 1);
      BoardStack.removeTopPiece(to[0] + epRank);
    }

    // Handle castling: move the rook too
    if (result.flags.includes('k') || result.flags.includes('q')) {
      _applyCastlingRook(result);
    }

    _moveHistory.push(result.san);
    Board.render();
    _updateMoveLog();
    _updateTurnIndicator();

    // Query referee after human move, then trigger AI
    _queryReferee().then(ruling => {
      if (_handleRuling(ruling)) return; // game ended — don't trigger AI
      _triggerAIMove();
    });
  }

  /** Return legal destination squares for a piece on `square` (for move highlighting). */
  function getLegalDestinations(square) {
    if (!_isHumanTurn) return [];
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
      _isHumanTurn = true;
      _updateTurnIndicator();
      return;
    }

    _logRuling(`Claude's move: "${rawMove}"`);

    const parsed = MoveParser.parse(rawMove);
    if (!parsed) {
      _logRuling('Could not parse AI move — turn skipped.');
      _moveHistory.push(`(unparseable: ${rawMove})`);
      _updateMoveLog();
      _isHumanTurn = true;
      _updateTurnIndicator();
      return;
    }

    // Find the piece to move (may be buried in a stack)
    const candidate = MoveParser.resolveSourcePiece(parsed, _aiColor, BoardStack, _chess);

    if (candidate) {
      // Apply to BoardStack — no legality check, AI can do anything
      const result = BoardStack.movePieceFromStack(
        candidate.square,
        candidate.piece.id,
        parsed.destination,
        parsed.isCapture
      );
      if (result) {
        // Try to keep chess.js FEN/PGN roughly in sync for referee context.
        // This silently does nothing if the move is illegal — that's fine;
        // _isHumanTurn controls turns, not _chess.turn().
        _tryApplyToChessJs(candidate.square, parsed.destination);
      }
    } else {
      _logRuling(`AI referenced a piece not found on board — skipping piece placement.`);
    }

    // Record raw move string (including +/# annotations)
    _moveHistory.push(rawMove);
    Board.render();
    _updateMoveLog();

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

    // Always hand turn back to human after AI move, regardless of chess.js state
    _isHumanTurn = true;
    _updateTurnIndicator();
    _setStatus('Your turn');
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

  /** Returns true if the game ended as a result of the ruling. */
  function _handleRuling(ruling) {
    if (ruling === 'continue') return false;

    const messages = {
      check:      'Referee: check.',
      checkmate:  'Referee: CHECKMATE — game over.',
      stalemate:  'Referee: STALEMATE — draw.',
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
    const rank = _humanColor === 'w' ? '1' : '8';
    if (result.flags.includes('k')) {
      BoardStack.moveTopPiece('h' + rank, 'f' + rank, false);
    } else {
      BoardStack.moveTopPiece('a' + rank, 'd' + rank, false);
    }
  }

  // ─── chess.js sync ────────────────────────────────────────────────────────

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

  function _tryApplyToChessJs(from, to) {
    try {
      _chess.move({ from, to, promotion: 'q' });
    } catch (_) {
      // Illegal AI move — FEN/PGN will drift slightly, but that's acceptable
    }
  }

  // ─── UI helpers ──────────────────────────────────────────────────────────

  function _updateTurnIndicator() {
    const el = document.getElementById('turn-indicator');
    if (!el) return;
    if (_gameOver) { el.textContent = 'Game over'; return; }
    el.textContent = _isHumanTurn ? 'Your turn' : "Claude's turn";
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
    _isHumanTurn = false;
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
