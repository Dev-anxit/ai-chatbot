# Ehan AI — Full-Stack AI Chatbot

A professional AI chatbot with a streaming FastAPI backend and a React frontend featuring real-time token-by-token responses, syntax-highlighted code blocks, and a neural network animated background.

**Live Demo:**
- Frontend: [ehan-ai.vercel.app](https://ehan-ai.vercel.app) *(deploy to update)*
- Backend API: [ehan-ai-backend.onrender.com](https://ehan-ai-backend.onrender.com) *(deploy to update)*

---

## Features

- **Streaming responses** — tokens appear in real time via SSE (Server-Sent Events)
- **Stop generation** — cancel a response mid-stream
- **Markdown rendering** — bold, lists, tables, blockquotes, inline code
- **Syntax-highlighted code blocks** — with per-block copy button
- **Per-message actions** — copy and regenerate buttons
- **Scroll-to-bottom** — floating button when scrolled up
- **Chat history** — persisted in `localStorage`
- **Response caching** — identical questions return instantly
- **Neural network background** — animated canvas particles
- **Keyboard shortcuts** — `⌘K` to focus input, `Enter` to send, `Shift+Enter` for newline
- **Mobile responsive**

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite, react-markdown, react-syntax-highlighter |
| Backend | Python 3.11, FastAPI, Uvicorn |
| AI Provider | Anthropic Claude (primary) · PollinationsAI via g4f (fallback) |
| Deployment | Vercel (frontend) · Render (backend) |

---

## Project Structure

```
ai-chatbot/
├── backend/
│   ├── main.py              # FastAPI app — /chat/stream SSE endpoint
│   ├── requirements.txt     # Python dependencies
│   ├── start.sh             # Local start script
│   └── .env.example         # → copy to .env and fill in keys
│
├── frontend/chat-ui/
│   ├── src/
│   │   ├── Chat.jsx         # Main chat component (streaming, actions, UI)
│   │   ├── NeuralBackground.jsx  # Canvas neural animation
│   │   ├── App.jsx          # Root component
│   │   ├── App.css          # All styles — glass-morphism, animations
│   │   └── index.css        # Global resets & fonts
│   ├── vercel.json          # Vercel SPA routing config
│   └── .env.example         # → copy to .env.local and fill in
│
└── render.yaml              # Render.com backend deployment config
```

---

## Local Development

### Prerequisites
- Python 3.11+
- Node.js 18+

### 1. Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Copy `.env.example` → `.env` and add your key:
```
ANTHROPIC_API_KEY=sk-ant-...
```

Start the server:
```bash
uvicorn main:app --reload --port 8000
```

API runs at `http://localhost:8000`

### 2. Frontend

```bash
cd frontend/chat-ui
npm install
```

Copy `.env.example` → `.env.local` (leave `VITE_API_BASE` empty for localhost).

```bash
npm run dev
```

Frontend runs at `http://localhost:5173` (or next available port).

---

## Deployment

### Backend → Render

1. Go to [render.com](https://render.com) → **New Web Service**
2. Connect this GitHub repo
3. Render auto-detects `render.yaml` — just add the `ANTHROPIC_API_KEY` environment variable in the Render dashboard
4. Deploy — your backend URL will be `https://ehan-ai-backend.onrender.com`

### Frontend → Vercel

1. Go to [vercel.com](https://vercel.com) → **New Project**
2. Import this GitHub repo
3. Set **Root Directory** to `frontend/chat-ui`
4. Add environment variable: `VITE_API_BASE` = your Render backend URL
5. Deploy

---

## API Reference

### `POST /chat/stream`
Streams an AI response as Server-Sent Events.

**Request body:**
```json
{ "message": "Explain quantum computing" }
```

**SSE stream:**
```
data: {"delta": "Quantum "}
data: {"delta": "computing "}
...
data: [DONE]
```

### `POST /chat`
Non-streaming fallback — returns full response at once.

### `GET /health`
```json
{ "status": "ok" }
```

---

## Environment Variables

### Backend (`backend/.env`)
| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Recommended | Claude API key — [get one here](https://console.anthropic.com) |

Without a key, the backend falls back to PollinationsAI (free, no key needed).

### Frontend (`frontend/chat-ui/.env.local`)
| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_API_BASE` | Production only | Backend URL, e.g. `https://ehan-ai-backend.onrender.com` |

---

## License

MIT
