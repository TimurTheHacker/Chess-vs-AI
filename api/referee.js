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
    `The FEN you receive reflects the position AFTER the most recent move was played; the side listed as active in the FEN is the one whose turn it now is. ` +
    `Issue exactly one ruling word from this list: check, checkmate, stalemate, repetition, continue. ` +
    `Follow these steps in order:\n` +
    `1. Is the active side's king currently in check? If NO, go to step 3.\n` +
    `2. Does the active side have at least one legal move that removes the check (king escape, block, or capture)? ` +
       `If YES → rule "check". If NO → rule "checkmate". ` +
       `IMPORTANT: only rule "checkmate" when you are certain there is no legal escape. When in doubt, rule "check".\n` +
    `3. Does the active side have any legal moves at all? If NO → rule "stalemate".\n` +
    `4. Has the exact same position (same pieces, same castling rights, same en-passant square, same side to move) occurred three or more times? If YES → rule "repetition".\n` +
    `5. Otherwise → rule "continue".\n` +
    `Respond with ONLY the single ruling word and nothing else.`;

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
