// api/move.js — Vercel serverless function
// Receives current board state (FEN + move history), asks Claude for its next move.
// Returns { move: string } where move is a raw algebraic-style string.

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { fen, pgn, aiColor, moveHistory } = req.body;
  if (!fen) {
    return res.status(400).json({ error: 'Missing fen in request body' });
  }

  const colorName = aiColor === 'b' ? 'Black' : 'White';

  // Deliberately minimal prompt — no example moves, no mention of stacking,
  // no mention of illegal moves. The model should derive its move from chess knowledge + FEN.
  const systemPrompt =
    `You are playing a game of chess as ${colorName}. ` +
    `Respond with ONLY your chosen move and nothing else — no explanation, ` +
    `no punctuation before or after, no commentary. ` +
    `Use standard algebraic notation: a piece-type letter (K, Q, R, B, N) ` +
    `followed by the destination square (file letter and rank number). ` +
    `Omit the piece letter for pawn moves. ` +
    `Prefix the destination with lowercase x when making a capture. ` +
    `Append + if your move gives check, or # if it gives checkmate. ` +
    `If a pawn reaches the back rank, append the promotion piece letter immediately after the destination square. ` +
    `Do not include any other text.`;

  const userPrompt =
    `Current position (FEN): ${fen}\n` +
    (pgn ? `Move history (PGN): ${pgn}\n` : '') +
    `It is ${colorName}'s turn. What is your move?`;

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 10, // a move string is at most ~7 chars — no budget left for comments
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const moveText = message.content[0]?.text?.trim() ?? '';
    return res.status(200).json({ move: moveText });
  } catch (err) {
    console.error('Claude API error (move):', err);
    return res.status(500).json({ error: 'Failed to get move from Claude', detail: err.message });
  }
};
