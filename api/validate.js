// api/validate.js — Vercel serverless function
// Called in "chaos mode" when the human tries to make a move that chess.js
// would normally reject. Asks Claude to rule whether the proposed move is
// legal under standard chess rules.
// Returns { verdict: 'legal' | 'illegal' }

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { fen, from, to, humanColor } = req.body;
  if (!fen || !from || !to) {
    return res.status(400).json({ error: 'Missing fen, from, or to' });
  }

  const colorName = humanColor === 'w' ? 'White' : 'Black';

  const systemPrompt =
    `You are a chess referee evaluating a single proposed move for legality. ` +
    `Respond with exactly one word: "legal" if the move is permitted under standard chess rules, ` +
    `or "illegal" if it violates any rule (wrong piece movement, leaves own king in check, ` +
    `moving opponent's piece, etc.). No explanation, no other text.`;

  const userPrompt =
    `Position (FEN): ${fen}\n` +
    `${colorName} proposes to move from ${from} to ${to}. ` +
    `Is this legal?`;

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const raw = message.content[0]?.text?.trim().toLowerCase() ?? 'illegal';
    const verdict = raw.startsWith('legal') ? 'legal' : 'illegal';
    return res.status(200).json({ verdict, rawResponse: raw });
  } catch (err) {
    console.error('Claude API error (validate):', err);
    // On failure, default to allowing the move so a bad API response doesn't hard-lock the player
    return res.status(200).json({ verdict: 'legal', rawResponse: 'error-fallback' });
  }
};
