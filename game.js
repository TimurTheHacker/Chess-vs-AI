// game.js
// Orchestrates: chess.js (legal move validation for human), BoardStack,
// MoveParser, Board rendering, AI moves via AIAdapter, referee rulings.

const Game = (() => {
  let _chess = null;
  let _humanColor = 'w';
  let _aiColor = 'b';
  let _gameOver = false;
  let _isHumanTurn = false;     // own flag — NOT _chess.turn() (breaks on AI illegal moves)
  let _chaosMode = false;       // when true, human moves bypass chess.js; AI referee decides legality
  let _moveHistory = [];
  let _rulingLog = [];

  // ─── Init ────────────────────────────────────────────────────────────────

  function start(humanColor) {
    _humanColor = humanColor;
    _aiColor = humanColor === 'w' ? 'b' : 'w';
    _gameOver = false;
    _moveHistory = [];
    _rulingLog = [];

    _chess = new Chess();
    _syncStackFromChess();

    const boardEl = document.getElementById('board');
    Board.init(boardEl, _humanColor);
    Board.render();

    _updateMoveLog();
    _updateRulingLog();

    if (_humanColor === 'b') {
      _isHumanTurn = false;
      _updateTurnIndicator();
      _triggerAIMove();
    } else {
      _isHumanTurn = true;
      _updateTurnIndicator();
    }
  }

  function setChaosMode(enabled) {
    _chaosMode = enabled;
  }

  // ─── Human move entry point ───────────────────────────────────────────────
  // async so we can await the AI referee validation in chaos mode

  async function onHumanMove(from, to) {
    if (_gameOver || !_isHumanTurn) return;

    const targetPiece = BoardStack.getVisiblePiece(to);
    const enemyKingType = _aiColor === 'w' ? 'K' : 'k';

    // ── Chaos mode: all moves (including king captures) go through the referee ──
    // This prevents trivially dragging the king across the board for an instant win.
    if (_chaosMode) {
      await _handleChaosModeMove(from, to, targetPiece, enemyKingType);
      return;
    }

    // ── Normal mode: king capture bypass ─────────────────────────────────
    // chess.js never allows capturing the king, but the AI can leave its king
    // in check. If the human drags to the enemy king's square, allow it directly.
    if (targetPiece && targetPiece.type === enemyKingType) {
      _isHumanTurn = false;
      BoardStack.moveTopPiece(from, to, true);
      _forceFlipChessTurn();
      _moveHistory.push(`${from}x${to} (king captured!)`);
      Board.render();
      _updateMoveLog();
      _endGame('You captured the king — you win!');
      _logRuling('Human captured the enemy king.');
      return;
    }

    // ── Normal mode: chess.js enforces legality ───────────────────────────
    const result = _chess.move({ from, to, promotion: 'q' });
    if (!result) {
      Board.flashIllegal(from);
      return;
    }

    _isHumanTurn = false;

    const isCapture = result.flags.includes('c') || result.flags.includes('e');
    BoardStack.moveTopPiece(from, to, isCapture);

    if (result.flags.includes('e')) {
      const epRank = _humanColor === 'w' ? String(parseInt(to[1]) - 1) : String(parseInt(to[1]) + 1);
      BoardStack.removeTopPiece(to[0] + epRank);
    }
    if (result.flags.includes('k') || result.flags.includes('q')) {
      _applyCastlingRook(result);
    }

    _moveHistory.push(result.san);
    Board.render();
    _updateMoveLog();
    _updateTurnIndicator();

    _queryReferee().then(ruling => {
      if (_handleRuling(ruling)) return;
      _triggerAIMove();
    });
  }

  // ─── Chaos mode move flow ─────────────────────────────────────────────────

  async function _handleChaosModeMove(from, to, targetPiece, enemyKingType) {
    const preFen = _chess.fen();
    const snapshot = BoardStack.getSnapshot();

    // Apply move tentatively so the board shows the proposed state
    const isCapture = !!(targetPiece && targetPiece.color !== _humanColor);
    BoardStack.moveTopPiece(from, to, isCapture);
    Board.render();

    // Lock turn during async referee call
    _isHumanTurn = false;
    _setStatus('Referee reviewing your move…');

    let verdict;
    try {
      const r = await AIAdapter.validateHumanMove({ fen: preFen, to, humanColor: _humanColor });
      verdict = r.verdict;
    } catch (_) {
      verdict = 'legal'; // fail open — don't hard-lock on API error
    }

    if (verdict === 'illegal') {
      BoardStack.loadSnapshot(snapshot);
      Board.render();
      Board.flashIllegal(from);
      _logRuling(`Referee blocked ${from}→${to}: illegal move.`);
      _isHumanTurn = true;
      _updateTurnIndicator();
      _setStatus('Illegal — referee blocked that move.');
      return;
    }

    // Move approved
    _logRuling(`Referee approved: ${from}→${to}`);

    // If the approved move captured the enemy king, end the game now
    if (targetPiece && targetPiece.type === enemyKingType) {
      _moveHistory.push(`${from}x${to}* (king captured!)`);
      _updateMoveLog();
      _endGame('You captured the king — you win!');
      _logRuling('Human captured the enemy king (chaos mode).');
      return;
    }

    // Regular approved move — keep chess.js in sync and continue
    const chessResult = _chess.move({ from, to, promotion: 'q' });
    if (!chessResult) _forceFlipChessTurn();

    _moveHistory.push(`${from}-${to}*`); // * marks a chaos-mode move
    _updateMoveLog();
    _updateTurnIndicator();

    _queryReferee().then(ruling => {
      if (_handleRuling(ruling)) return;
      _triggerAIMove();
    });
  }

  // ─── Legal destination highlights ────────────────────────────────────────

  function getLegalDestinations(square) {
    if (!_isHumanTurn) return [];
    if (_chaosMode) return []; // in chaos mode any square is potentially valid — don't hint
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

    if (_gameOver) return; // resigned or ended while AI was thinking

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

    const candidate = MoveParser.resolveSourcePiece(parsed, _aiColor, BoardStack, _chess);

    if (candidate) {
      const result = BoardStack.movePieceFromStack(
        candidate.square,
        candidate.piece.id,
        parsed.destination,
        parsed.isCapture
      );
      if (result) _tryApplyToChessJs(candidate.square, parsed.destination);
    } else {
      // No matching piece found — Claude hallucinated a source.
      // Honour the spirit of the move: clear the claimed source square (if
      // a full square can be determined from disambiguation) and spawn a new
      // piece of the claimed type at the destination.
      const srcSquare = (parsed.disambigFile && parsed.disambigRank)
        ? parsed.disambigFile + parsed.disambigRank
        : null;
      if (srcSquare) {
        const removed = BoardStack.removeTopPiece(srcSquare);
        if (removed) _logRuling(`Spawned: removed ${removed.type} from ${srcSquare} (no matching piece).`);
      }
      const spawnType = _aiColor === 'w'
        ? parsed.pieceType.toUpperCase()
        : parsed.pieceType.toLowerCase();
      const spawnId = `${spawnType}_spawn_${Date.now()}`;
      BoardStack.placePiece(parsed.destination, { type: spawnType, color: _aiColor, id: spawnId }, parsed.isCapture);
      _logRuling(`Spawned: ${spawnType} appeared on ${parsed.destination} (Claude claimed it from ${srcSquare ?? 'unknown'}).`);
      _forceFlipChessTurn();
    }

    _moveHistory.push(rawMove);
    Board.render();
    _updateMoveLog();

    if (parsed.isCheckmate) {
      _logRuling('Claude claims: CHECKMATE — game over.');
      _endGame('Claude declared checkmate!');
      return;
    }
    if (parsed.isCheck) {
      _logRuling('Claude claims: check.');
      _showBanner('Check — according to Claude!', false);
    }

    _isHumanTurn = true;
    _updateTurnIndicator();
    _setStatus(_chaosMode ? 'Your turn (Chaos Mode)' : 'Your turn');
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
    const result = _chess.move({ from, to, promotion: 'q' });
    if (!result) {
      // Illegal AI move — chess.js didn't flip its turn counter, so force-flip it
      _forceFlipChessTurn();
    }
  }

  function _forceFlipChessTurn() {
    const parts = _chess.fen().split(' ');
    parts[1] = parts[1] === 'w' ? 'b' : 'w';
    if (parts[1] === 'w') parts[5] = String(parseInt(parts[5]) + 1);
    _chess = new Chess(parts.join(' '));
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

  return { start, newGame, onHumanMove, getLegalDestinations, setChaosMode, resign };
})();
