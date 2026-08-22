// api/validate.js — Vercel serverless function
// Called in chaos mode when the human tries a move. Uses a smaller, less
// precise model with a lenient prompt so some borderline moves slip through —
// this keeps chaos mode actually chaotic rather than playing like strict chess.
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

  // Intentionally vague prompt + smaller model so only obviously wrong moves
  // are blocked. The point of chaos mode is that unusual/borderline moves get
  // through — the referee should catch gross violations, not fine ones.
  const systemPrompt =
    `You are a casual chess observer. Look at the proposed move and verify whether ` +
    `it seems like a reasonable chess move for that type of piece — does the piece ` +
    `generally move that way? Only respond "illegal" for clear violations like a rook ` +
    `moving diagonally or a bishop moving in a straight line. If it seems plausible, ` +
    `respond "legal". Respond with one word only: "legal" or "illegal".`;

  const userPrompt =
    `Position (FEN): ${fen}\n` +
    `${colorName} wants to move from ${from} to ${to}. Does this seem correct?`;

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001', // smaller model = less strict = more chaos
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
