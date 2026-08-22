// api/validate.js — Vercel serverless function
// Called in chaos mode when the human tries a move.
// Only checks whether the piece can geometrically reach the destination —
// ignores check, pins, turn order, and all positional rules.
// This lets unusual/tactical moves through while blocking nonsense
// like a rook moving diagonally or a bishop moving straight.
// Returns { verdict: 'legal' | 'illegal' }

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { fen, to, humanColor } = req.body;
  if (!fen || !to) {
    return res.status(400).json({ error: 'Missing fen or to' });
  }

  const colorName = humanColor === 'w' ? 'White' : 'Black';

  const systemPrompt =
    `You are a casual chess observer. Given a chess position and a proposed move, ` +
    `just glance at it and say whether anything is obviously off. ` +
    `When in doubt, respond "legal". ` +
    `Respond with one word only: "legal" or "illegal".`;

  const userPrompt =
    `Position (FEN): ${fen}\n` +
    `${colorName} plays ${to}. Is anything obviously off with this?`;

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const raw = message.content[0]?.text?.trim().toLowerCase() ?? 'legal';
    const verdict = raw.startsWith('legal') ? 'legal' : 'illegal';
    return res.status(200).json({ verdict, rawResponse: raw });
  } catch (err) {
    console.error('Claude API error (validate):', err);
    return res.status(200).json({ verdict: 'legal', rawResponse: 'error-fallback' });
  }
};
