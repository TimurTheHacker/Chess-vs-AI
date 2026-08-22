// moveParser.js
// Parses the compact move string the AI returns, e.g. "Ne4", "Bxd5+", "e8Q", "Rd1#"
//
// Format the AI is expected to produce:
//   [PieceLetter] [origin-disambiguation?] ["x"?] destination [promotion?] ["+"?|"#"?]
//
// PieceLetter: K Q R B N (uppercase). Absent = pawn.
// destination: file (a-h) + rank (1-8), always required.
// origin-disambiguation: optional file letter or rank digit before destination
//   that narrows which piece moves (e.g. "Rad1" = rook on a-file to d1).
// capture: "x" anywhere before the destination.
// promotion: letter immediately after destination (Q R B N).
// check: "+" suffix.
// checkmate: "#" suffix.
//
// Returns null if the string can't be parsed at all (caller should treat as
// a forfeit/pass for that turn).
//
// IMPORTANT: when multiple candidate pieces of the same type and color could
// reach the destination, we pick ONE AT RANDOM (Math.random()).
// This is intentional — the AI is allowed to be ambiguous, and we don't want
// to deterministically resolve its mistakes. Randomness makes the stacking
// spectacle less predictable and more entertaining.

const MoveParser = (() => {

  const PIECE_LETTERS = new Set(['K', 'Q', 'R', 'B', 'N']);
  const FILES = 'abcdefgh';
  const RANKS = '12345678';
  const PROMOTION_PIECES = new Set(['Q', 'R', 'B', 'N']);

  /**
   * Parse a raw AI move string.
   *
   * @param {string} raw - The string exactly as returned by the AI.
   * @returns {{
   *   pieceType: string,   // 'K'|'Q'|'R'|'B'|'N'|'P'
   *   destination: string, // e.g. 'e4'
   *   isCapture: boolean,
   *   isCheck: boolean,
   *   isCheckmate: boolean,
   *   promotion: string|null,
   *   disambigFile: string|null,  // file letter if given
   *   disambigRank: string|null,  // rank digit if given
   *   raw: string,
   * } | null}
   */
  function parse(raw) {
    if (!raw || typeof raw !== 'string') return null;

    // Strip surrounding whitespace and anything after the first newline
    let s = raw.trim().split('\n')[0].trim();

    // Extract trailing check/checkmate
    let isCheckmate = false;
    let isCheck = false;
    if (s.endsWith('#')) { isCheckmate = true; s = s.slice(0, -1); }
    else if (s.endsWith('+')) { isCheck = true; s = s.slice(0, -1); }

    // Extract promotion letter (only valid when last two chars are destination rank + letter)
    let promotion = null;
    // Promotion looks like: e8Q or e8=Q
    const promoMatch = s.match(/([a-h][18])=?([QRBN])$/i);
    if (promoMatch) {
      promotion = promoMatch[2].toUpperCase();
      // Strip the promotion suffix but keep the destination
      s = s.replace(/=?[QRBN]$/, '');
    }

    // Detect capture marker (x), then remove it for further parsing
    const isCapture = s.includes('x') || s.includes('X');
    s = s.replace(/x/gi, '');

    // The destination square must be the last two characters: file+rank
    if (s.length < 2) return null;
    const destFile = s[s.length - 2].toLowerCase();
    const destRank = s[s.length - 1];
    if (!FILES.includes(destFile) || !RANKS.includes(destRank)) return null;
    const destination = destFile + destRank;
    s = s.slice(0, -2); // what remains: optional piece letter + optional disambiguation

    // Extract piece type
    let pieceType = 'P'; // default: pawn
    if (s.length > 0 && PIECE_LETTERS.has(s[0].toUpperCase())) {
      pieceType = s[0].toUpperCase();
      s = s.slice(1);
    }

    // What's left is optional disambiguation (file and/or rank)
    let disambigFile = null;
    let disambigRank = null;
    for (const ch of s) {
      if (FILES.includes(ch.toLowerCase())) disambigFile = ch.toLowerCase();
      else if (RANKS.includes(ch)) disambigRank = ch;
    }

    return {
      pieceType,
      destination,
      isCapture,
      isCheck,
      isCheckmate,
      promotion: promotion,
      disambigFile,
      disambigRank,
      raw: raw.trim(),
    };
  }

  /**
   * Given a parsed move and board state, pick a specific piece to move.
   *
   * aiColor: 'w' or 'b' — the AI's color.
   * boardStack: the BoardStack module (must expose findPiecesByTypeAndColor).
   * chess: optional chess.js instance used to prefer the legally-reachable piece.
   *
   * Returns { square, piece } or null if no matching piece is found.
   *
   * Disambiguation logic:
   *  1. Find all pieces of the right type+color on the board.
   *  2. Filter by disambigFile / disambigRank if provided.
   *  3. If exactly one candidate: use it.
   *  4. If multiple candidates and a chess instance is available:
   *       a. Filter to those that can legally reach the destination.
   *       b. If exactly one can → use it (unambiguous legal move).
   *       c. If multiple can → pick one at random (genuine ambiguity).
   *       d. If none can (AI making an illegal move) → pick randomly from
   *          all candidates so the chaos still happens.
   *  5. If multiple candidates and no chess instance: pick at random.
   *     -- Randomness is intentional for the cases that remain ambiguous. --
   */
  function resolveSourcePiece(parsed, aiColor, boardStack, chess) {
    if (!parsed) return null;

    // Piece type in boardStack: uppercase for white, lowercase for black.
    const boardPieceType = aiColor === 'w'
      ? parsed.pieceType.toUpperCase()
      : parsed.pieceType.toLowerCase();

    let candidates = boardStack.findPiecesByTypeAndColor(boardPieceType, aiColor);

    if (parsed.disambigFile) {
      candidates = candidates.filter(c => c.square[0] === parsed.disambigFile);
    }
    if (parsed.disambigRank) {
      candidates = candidates.filter(c => c.square[1] === parsed.disambigRank);
    }

    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    // Multiple candidates — try to narrow by legal reachability first.
    if (chess) {
      const legal = candidates.filter(c => {
        const moves = chess.moves({ square: c.square, verbose: true });
        return moves.some(m => m.to === parsed.destination);
      });

      if (legal.length === 1) return legal[0]; // unambiguous legal move
      if (legal.length > 1) {
        // Genuinely ambiguous even after legality filter — pick at random.
        return legal[Math.floor(Math.random() * legal.length)];
      }
      // Zero legal candidates: AI is making an illegal move.
      // Fall through to random selection from all candidates so it still happens.
    }

    // Multiple candidates with no legal distinction — pick at random (intentional).
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  return { parse, resolveSourcePiece };
})();

if (typeof module !== 'undefined') module.exports = MoveParser;
