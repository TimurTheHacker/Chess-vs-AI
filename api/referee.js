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
    `Examine the position and the move history and issue exactly one ruling word from this list: ` +
    `check, stalemate, repetition, checkmate, continue. ` +
    `"check" means the side that just moved has put the opponent in check. ` +
    `"checkmate" means the game is over by checkmate. ` +
    `"stalemate" means the game is a draw by stalemate. ` +
    `"repetition" means the position has occurred three or more times (threefold repetition). ` +
    `"continue" means none of the above apply and the game should go on. ` +
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
