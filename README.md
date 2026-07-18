# Live LLM Maze Prototype

Prototype-first version of the first-person maze. The browser renders the game and sends hint requests to a local Node/Express backend. The backend calls a live LLM and validates that the returned full path reaches the goal legally.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from `.env.example`.

For OpenAI:

```env
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-your-openai-key
OPENAI_MODEL=gpt-4.1-mini
```

For Venice credits:

```env
LLM_PROVIDER=venice
VENICE_API_KEY=your-venice-key
VENICE_MODEL=zai-org-glm-5-1
```

Venice credits cannot be spent on OpenAI's API directly. They can be used through Venice's OpenAI-compatible `/api/v1/chat/completions` endpoint.

For Gemini:

```env
LLM_PROVIDER=gemini
GEMINI_API_KEY=your-gemini-key
GEMINI_MODEL=gemini-2.5-flash-lite
```

Gemini keys cannot be spent on OpenAI's API directly. They are used through Google's Gemini API with structured JSON output.

3. Start the prototype:

```bash
npm run dev
```

4. Open `http://localhost:3000/participant` for the game or `http://localhost:3000/moderator` for the moderator view.

<!-- Use the bird's-eye AI validator at `http://localhost:3000/ai_validator.html` to call the same live AI endpoint from any maze cell and compare the returned full path with a local shortest-path calculation. -->

## Notes

- Every hint click calls the live LLM.
- The LLM must return the full path to the goal.
- The participant only sees the first few hint steps.
- If the moderator disables AI, the backend blocks LLM calls.
- The participant and moderator use the supplied PDF maze translated into the existing 17x17 wall/passage format.
- Live AI keeps the original request format; the separate static preview remains available at `http://localhost:3000/pdf_maze_moderator.html`.
- The generator adds extra openings and breaks straight single-path stretches longer than 5 visible spaces.
- The maze-generation and graph-to-wall translation approach is adapted from the MIT-licensed `simondevyoutube/AStar_60000` demo, while the live LLM remains responsible for participant hints.
