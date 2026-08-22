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

  const systemPrompt =
    `You are playing chess as ${colorName}. Output your move in algebraic notation and nothing else.`;

  const userPrompt =
    `Position (FEN): ${fen}\n` +
    (pgn ? `Move history (PGN): ${pgn}\n` : '') +
    `${colorName} to move.`;

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 10,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userPrompt },
        { role: 'assistant', content: '' }, // prefill: forces the model to start with the move, nothing before it
      ],
    });

    const moveText = message.content[0]?.text?.trim() ?? '';
    return res.status(200).json({ move: moveText });
  } catch (err) {
    console.error('Claude API error (move):', err);
    return res.status(500).json({ error: 'Failed to get move from Claude', detail: err.message });
  }
};
