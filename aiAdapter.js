// aiAdapter.js
// Common interface for AI player + referee.
// Only the Anthropic adapter is implemented; future adapters (OpenAI, Gemini)
// can be added as sibling objects that implement the same two methods.
//
// Interface contract:
//   getOpponentMove(state) → Promise<string>   raw move string
//   getRefereeRuling(state) → Promise<{ ruling, rawResponse }>
//
// state shape for both calls:
//   { fen, pgn, moveHistory: string[], aiColor: 'w'|'b', humanColor: 'w'|'b' }

const AnthropicAdapter = {
  async getOpponentMove(state) {
    const resp = await fetch('/api/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fen: state.fen,
        pgn: state.pgn,
        aiColor: state.aiColor,
        moveHistory: state.moveHistory,
      }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `Move API returned ${resp.status}`);
    }
    const data = await resp.json();
    return data.move ?? '';
  },

  async getRefereeRuling(state) {
    const resp = await fetch('/api/referee', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fen: state.fen,
        pgn: state.pgn,
        moveHistory: state.moveHistory,
        humanColor: state.humanColor,
      }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `Referee API returned ${resp.status}`);
    }
    return resp.json(); // { ruling, rawResponse }
  },
};

// Active adapter — swap this reference to switch providers.
const AIAdapter = AnthropicAdapter;
