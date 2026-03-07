from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from g4f.client import AsyncClient
from g4f.Provider import PollinationsAI
import g4f
import os
import hashlib
import asyncio
import threading
import json
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_cache: dict[str, str] = {}

SYSTEM_PROMPT = (
    "You are Ehan AI — a smart, accurate, and efficient assistant. "
    "Be clear and well-structured. "
    "For simple questions, give brief direct answers. "
    "For complex topics, explain step by step with examples. "
    "Use markdown (bold, lists, code blocks) when it helps. "
    "Never make up facts."
)

SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
    "Connection": "keep-alive",
}

class ChatRequest(BaseModel):
    message: str

class ChatResponse(BaseModel):
    reply: str


@app.get("/")
def read_root():
    return {"message": "Ehan AI API is running"}


@app.post("/chat/stream")
async def chat_stream(req: ChatRequest):
    user_msg = req.message.strip()
    cache_key = hashlib.md5(user_msg.lower().encode()).hexdigest()

    # Cache hit — simulate streaming so it still feels live
    if cache_key in _cache:
        async def cached_gen():
            text = _cache[cache_key]
            words = text.split(" ")
            for i, w in enumerate(words):
                chunk = w + (" " if i < len(words) - 1 else "")
                yield f"data: {json.dumps({'delta': chunk})}\n\n"
                await asyncio.sleep(0.006)
            yield "data: [DONE]\n\n"
        return StreamingResponse(cached_gen(), media_type="text/event-stream", headers=SSE_HEADERS)

    messages_payload = [{"role": "user", "content": user_msg}]

    async def generate():
        full: list[str] = []

        # ── Primary: Claude via Anthropic SDK ────────────────────────────
        anthropic_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
        anthropic_url = os.getenv("ANTHROPIC_BASE_URL", "").strip()

        if anthropic_key:
            try:
                q: asyncio.Queue = asyncio.Queue()
                loop = asyncio.get_event_loop()
                DONE = object()

                def _worker():
                    try:
                        import anthropic as _a
                        kw = {"api_key": anthropic_key}
                        if anthropic_url:
                            kw["base_url"] = anthropic_url
                        c = _a.Anthropic(**kw)
                        with c.messages.stream(
                            model="claude-haiku-4-5",
                            max_tokens=1024,
                            system=SYSTEM_PROMPT,
                            messages=messages_payload,
                        ) as s:
                            for text in s.text_stream:
                                asyncio.run_coroutine_threadsafe(q.put(text), loop)
                    except Exception:
                        pass
                    finally:
                        asyncio.run_coroutine_threadsafe(q.put(DONE), loop)

                threading.Thread(target=_worker, daemon=True).start()

                while True:
                    chunk = await q.get()
                    if chunk is DONE:
                        break
                    full.append(chunk)
                    yield f"data: {json.dumps({'delta': chunk})}\n\n"

                if full:
                    _cache[cache_key] = "".join(full)
                    yield "data: [DONE]\n\n"
                    return
            except Exception:
                pass

        # ── Fallback: PollinationsAI (simulate streaming) ────────────────
        try:
            client = AsyncClient(provider=PollinationsAI)
            response = await client.chat.completions.create(
                model="openai-fast",
                messages=[{"role": "system", "content": SYSTEM_PROMPT}, *messages_payload],
            )
            reply = response.choices[0].message.content.strip()
            if reply:
                words = reply.split(" ")
                for i, w in enumerate(words):
                    chunk = w + (" " if i < len(words) - 1 else "")
                    full.append(chunk)
                    yield f"data: {json.dumps({'delta': chunk})}\n\n"
                    await asyncio.sleep(0.012)
                _cache[cache_key] = reply
                yield "data: [DONE]\n\n"
                return
        except Exception:
            pass

        yield f"data: {json.dumps({'delta': 'Sorry, I could not get a response. Please try again.'})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream", headers=SSE_HEADERS)


# Keep non-streaming endpoint as fallback
@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    user_msg = req.message.strip()
    cache_key = hashlib.md5(user_msg.lower().encode()).hexdigest()
    if cache_key in _cache:
        return ChatResponse(reply=_cache[cache_key])

    messages_payload = [{"role": "user", "content": user_msg}]

    anthropic_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    anthropic_url = os.getenv("ANTHROPIC_BASE_URL", "").strip()
    if anthropic_key:
        try:
            def _call():
                import anthropic as _a
                kw = {"api_key": anthropic_key}
                if anthropic_url:
                    kw["base_url"] = anthropic_url
                c = _a.Anthropic(**kw)
                with c.messages.stream(
                    model="claude-haiku-4-5",
                    max_tokens=1024,
                    system=SYSTEM_PROMPT,
                    messages=messages_payload,
                ) as s:
                    full = s.get_final_message()
                return next((b.text for b in full.content if hasattr(b, "text")), "")
            reply = await asyncio.to_thread(_call)
            if reply:
                _cache[cache_key] = reply
                return ChatResponse(reply=reply)
        except Exception:
            pass

    try:
        client = AsyncClient(provider=PollinationsAI)
        response = await client.chat.completions.create(
            model="openai-fast",
            messages=[{"role": "system", "content": SYSTEM_PROMPT}, *messages_payload],
        )
        reply = response.choices[0].message.content.strip()
        if reply:
            _cache[cache_key] = reply
            return ChatResponse(reply=reply)
    except Exception:
        pass

    return ChatResponse(reply="Sorry, I could not get a response. Please try again.")


@app.get("/health")
def health_check():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
