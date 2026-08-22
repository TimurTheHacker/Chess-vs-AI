// api/referee.js — Vercel serverless function
// Separate from move generation. Asks Claude to rule on game state.
// Returns { ruling: 'check'|'stalemate'|'repetition'|'checkmate'|'continue', rawResponse: string }

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const VALID_RULINGS = new Set(['check', 'stalemate', 'repetition', 'checkmate', 'continue']);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { fen, pgn, moveHistory, humanColor } = req.body;
  if (!fen) {
    return res.status(400).json({ error: 'Missing fen in request body' });
  }

  const aiColor = humanColor === 'w' ? 'Black' : 'White';
  const humanColorName = humanColor === 'w' ? 'White' : 'Black';

  const systemPrompt =
    `You are the referee for a chess game between ${humanColorName} (human) and ${aiColor} (AI). ` +
    `The FEN shows the position AFTER the last move; the active color is whose turn comes next.\n\n` +
    `CRITICAL DEFAULT RULE: if you have any doubt at all, respond "continue". ` +
    `A wrong "stalemate" or "checkmate" ends the game unfairly. A wrong "continue" merely delays — it is always the safer error.\n\n` +
    `Only override "continue" in these specific situations:\n` +
    `- "check": you can clearly see the active king is under direct attack by an enemy piece, AND the active side still has legal moves.\n` +
    `- "checkmate": you can clearly see the active king is under attack AND you have carefully enumerated every possible escape — king moves to adjacent squares, blocking moves, and captures of the attacker — and confirmed none are legal. Do NOT rule checkmate unless this is completely unambiguous.\n` +
    `- "stalemate": the active king is NOT in check, AND you have carefully checked that every single piece of the active side has zero legal moves. This is rare; do NOT rule stalemate unless you have verified it piece by piece.\n` +
    `- "repetition": the exact same position (pieces, active color, castling rights, en passant) has clearly appeared three or more times in the move history.\n\n` +
    `Respond with ONLY one word: continue, check, checkmate, stalemate, or repetition.`;

  const userPrompt =
    `Position (FEN): ${fen}\n` +
    (pgn ? `Full game (PGN): ${pgn}\n` : '') +
    `What is your ruling?`;

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 16,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const raw = message.content[0]?.text?.trim().toLowerCase() ?? 'continue';
    const ruling = VALID_RULINGS.has(raw) ? raw : 'continue';
    return res.status(200).json({ ruling, rawResponse: raw });
  } catch (err) {
    console.error('Claude API error (referee):', err);
    return res.status(500).json({ error: 'Referee query failed', detail: err.message });
  }
};
