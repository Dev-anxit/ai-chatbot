from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from g4f.client import AsyncClient
from g4f.Provider import PollinationsAI
import g4f
import os
import re
import hashlib
import asyncio
import threading
import json
from dotenv import load_dotenv
import logging
from contextlib import asynccontextmanager

from rag.scheduler import start_scheduler
from rag.orchestrator import gather_context_for_query

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

load_dotenv()

@asynccontextmanager
async def lifespan(application):
    start_scheduler()
    logger.info("Background RAG Scheduler started.")
    yield

app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_cache: dict[str, str] = {}

SYSTEM_PROMPT = (
    "You are Ehan AI — a world-class, professional AI assistant. "
    "You provide accurate, well-researched, and beautifully formatted responses. "
    "Rules: "
    "1. For simple questions, give brief direct answers. "
    "2. For complex topics, explain step by step with examples. "
    "3. Use markdown formatting (bold, lists, code blocks, tables) to make responses clear and scannable. "
    "4. Never make up facts. If unsure, say so. "
    "5. NEVER include any promotional text, advertisements, watermarks, or third-party attributions in your response. "
    "6. Do NOT mention any AI provider, API service, or platform name in your response. "
    "7. You will receive real-time data (weather, search results, date/time) in the context. "
    "You MUST use ONLY the information from those results to answer questions about current events, weather, temperature, sports, news, and anything time-sensitive. "
    "Your training data is outdated. The provided context is ALWAYS correct and overrides your training data. "
    "DO NOT guess or use your training data for recent events. ONLY use the provided context. "
    "8. When weather data is provided, present it clearly with temperature, conditions, humidity, wind, etc. Use emoji for weather conditions. "
    "9. IMPORTANT — ASK FOR MISSING INFORMATION: "
    "If the user asks something that requires specific details you do not have, you MUST ask a polite clarifying question BEFORE answering. Examples: "
    "- If they ask 'what is the temperature?' without a city, ask 'Which city or location would you like the weather for?' "
    "- If they ask 'translate this' without text, ask 'What text would you like me to translate, and to which language?' "
    "- If they ask 'convert this' without values, ask for the value and units. "
    "- If they ask about a person with a common name, ask for clarification (e.g. 'Do you mean X the actor or X the cricketer?'). "
    "- If they ask 'book a flight' or anything you cannot do, politely say what you can help with instead. "
    "Do NOT guess or assume missing details. Always ask first, then answer accurately once you have the info."
)

SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
    "Connection": "keep-alive",
}

AD_PATTERNS = [
    r"🌸.*?Pollinations.*?(?:\.|$)",
    r"\*\*Support Pollinations.*?$",
    r"Support Pollinations.*?$",
    r"Powered by Pollinations.*?$",
    r"---\s*\n.*?Pollinations.*?$",
    r"\n+\s*\*?\s*(?:Ad|Advertisement)\s*\*?\s*\n.*$",
    r"\[.*?pollinations.*?\].*$",
    r"<.*?pollinations.*?>.*$",
]

def strip_ads(text: str) -> str:
    for pattern in AD_PATTERNS:
        text = re.sub(pattern, "", text, flags=re.IGNORECASE | re.MULTILINE | re.DOTALL)
    return text.rstrip()


class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = []

class ChatResponse(BaseModel):
    reply: str


@app.get("/")
def read_root():
    return {"message": "Ehan AI API is running"}


@app.post("/chat/stream")
async def chat_stream(req: ChatRequest):
    user_msg = req.message.strip()
    cache_key = hashlib.md5(user_msg.lower().encode()).hexdigest()

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

    real_time_context = gather_context_for_query(user_msg)
    dynamic_system_prompt = SYSTEM_PROMPT + f"\n\nHere is dynamic real-time context to answer the user's query accurately:\n{real_time_context}"

    messages_payload = [{"role": h.role, "content": h.content} for h in req.history]
    messages_payload.append({"role": "user", "content": user_msg})

    async def generate():
        full: list[str] = []

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
                            system=dynamic_system_prompt,
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
                    cleaned = strip_ads("".join(full))
                    _cache[cache_key] = cleaned
                    yield "data: [DONE]\n\n"
                    return
            except Exception:
                pass

        try:
            client = AsyncClient(provider=PollinationsAI)
            stream = client.chat.completions.create(
                model="openai-fast",
                messages=[{"role": "system", "content": dynamic_system_prompt}, *messages_payload],
                stream=True,
            )
            async for chunk in stream:
                delta = chunk.choices[0].delta.content
                if delta:
                    full.append(delta)
            if full:
                cleaned = strip_ads("".join(full))
                _cache[cache_key] = cleaned
                words = cleaned.split(" ")
                for i, w in enumerate(words):
                    chunk = w + (" " if i < len(words) - 1 else "")
                    yield f"data: {json.dumps({'delta': chunk})}\n\n"
                yield "data: [DONE]\n\n"
                return
        except Exception as e:
            logger.error(f"PollinationsAI fallback failed: {type(e).__name__}: {e}")

        try:
            client = AsyncClient()
            stream = client.chat.completions.create(
                model="",
                messages=[{"role": "system", "content": dynamic_system_prompt}, *messages_payload],
                stream=True,
            )
            async for chunk in stream:
                delta = chunk.choices[0].delta.content
                if delta:
                    full.append(delta)
            if full:
                cleaned = strip_ads("".join(full))
                _cache[cache_key] = cleaned
                words = cleaned.split(" ")
                for i, w in enumerate(words):
                    chunk = w + (" " if i < len(words) - 1 else "")
                    yield f"data: {json.dumps({'delta': chunk})}\n\n"
                yield "data: [DONE]\n\n"
                return
        except Exception as e:
            logger.error(f"g4f auto-provider fallback failed: {type(e).__name__}: {e}")

        yield f"data: {json.dumps({'delta': 'Sorry, I could not get a response. Please try again.'})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream", headers=SSE_HEADERS)


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    user_msg = req.message.strip()
    cache_key = hashlib.md5(user_msg.lower().encode()).hexdigest()
    if cache_key in _cache:
        return ChatResponse(reply=_cache[cache_key])

    real_time_context = gather_context_for_query(user_msg)
    dynamic_system_prompt = SYSTEM_PROMPT + f"\n\nHere is dynamic real-time context to answer the user's query accurately:\n{real_time_context}"

    messages_payload = [{"role": h.role, "content": h.content} for h in req.history]
    messages_payload.append({"role": "user", "content": user_msg})

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
                    system=dynamic_system_prompt,
                    messages=messages_payload,
                ) as s:
                    full = s.get_final_message()
                return next((b.text for b in full.content if hasattr(b, "text")), "")
            reply = await asyncio.to_thread(_call)
            if reply:
                cleaned = strip_ads(reply)
                _cache[cache_key] = cleaned
                return ChatResponse(reply=cleaned)
        except Exception:
            pass

    try:
        client = AsyncClient(provider=PollinationsAI)
        response = await asyncio.wait_for(
            client.chat.completions.create(
                model="openai-fast",
                messages=[{"role": "system", "content": dynamic_system_prompt}, *messages_payload],
            ),
            timeout=45,
        )
        reply = response.choices[0].message.content.strip()
        if reply:
            cleaned = strip_ads(reply)
            _cache[cache_key] = cleaned
            return ChatResponse(reply=cleaned)
    except Exception:
        pass

    try:
        client = AsyncClient()
        response = await asyncio.wait_for(
            client.chat.completions.create(
                model="",
                messages=[{"role": "system", "content": dynamic_system_prompt}, *messages_payload],
            ),
            timeout=30,
        )
        reply = response.choices[0].message.content.strip()
        if reply:
            cleaned = strip_ads(reply)
            _cache[cache_key] = cleaned
            return ChatResponse(reply=cleaned)
    except Exception:
        pass

    return ChatResponse(reply="Sorry, I could not get a response. Please try again.")


@app.get("/health")
def health_check():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
