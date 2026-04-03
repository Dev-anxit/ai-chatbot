import os
import re
import json
import hashlib
import asyncio
import logging
import threading
import time
from datetime import datetime
from contextlib import asynccontextmanager
from typing import AsyncGenerator, List, Dict, Optional, Any

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
from dotenv import load_dotenv

try:
    from groq import AsyncGroq
except ImportError:
    AsyncGroq = None

try:
    from g4f.client import AsyncClient as G4FClient
except ImportError:
    G4FClient = None

from rag.scheduler import start_scheduler
from rag.orchestrator import gather_context_for_query

# Configure logging with structured format
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger(__name__)

load_dotenv()

# ─────────────────────────────────────────────────────
#  KEEP-ALIVE: Prevents Render free tier from sleeping
# ─────────────────────────────────────────────────────
_KEEP_ALIVE_INTERVAL = int(os.getenv("KEEP_ALIVE_INTERVAL", "600"))  # 10 min default

def _keep_alive_worker():
    """Background thread that pings our own /health endpoint to prevent server sleep."""
    port = int(os.getenv("PORT", "8000"))
    url = f"http://localhost:{port}/health"
    logger.info(f"Keep-alive worker started (interval={_KEEP_ALIVE_INTERVAL}s)")
    while True:
        time.sleep(_KEEP_ALIVE_INTERVAL)
        try:
            import urllib.request
            with urllib.request.urlopen(url, timeout=10) as resp:
                logger.debug(f"Keep-alive ping: {resp.status}")
        except Exception as e:
            logger.warning(f"Keep-alive ping failed: {e}")


# ─────────────────────────────────────────────────────
#  STARTUP / SHUTDOWN
# ─────────────────────────────────────────────────────
_startup_time: Optional[float] = None

@asynccontextmanager
async def lifespan(application: FastAPI):
    global _startup_time
    _startup_time = time.time()

    # Start background tasks
    start_scheduler()
    logger.info("Background RAG Scheduler started.")

    # Start keep-alive thread (daemon=True so it dies with the process)
    t = threading.Thread(target=_keep_alive_worker, daemon=True)
    t.start()
    logger.info("Keep-alive background thread started.")

    yield
    logger.info("Application shutting down.")

app = FastAPI(lifespan=lifespan)

# Enhanced CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Simple in-memory cache (bounded to prevent memory leaks)
_cache: Dict[str, str] = {}
_MAX_CACHE_SIZE = 200

SYSTEM_PROMPT = (
    f"You are Ehan AI — a friendly and highly intelligent AI. "
    f"CURRENT DATE: {datetime.now().strftime('%B %d, %Y')}. "
    "MANDATORY FORMATTING: "
    "1. Start with `<thought>`: Briefly plan the answer. "
    "2. End logic with `</thought>`. "
    "3. Provide final answer AFTER the tag. "
    "CRITICAL TRUTH: "
    "- NEVER mention 'training data cutoffs' or date limits (like December 2023). "
    "- You have LIVE access to the web and news. "
    "- Always treat the provided [LATEST REAL-TIME INFORMATION] as your current knowledge. "
    "Rules: "
    "- For greetings, be natural. "
    "- If a query is about the future (like 2026 IPL), use the context to explain what is currently known/announced."
)

GREETING_PATTERNS = [
    r"^(hi|hello|hey|hola|hii|heyy+|gm|gn|good (morning|evening|night|afternoon)|how are you|how's it going|what's up|wassup|who are you|tell me about yourself|hi there|hello there)",
]

def is_greeting(query: str) -> bool:
    lower = query.lower().strip()
    words = lower.split()
    # Fast path only for VERY SHORT greetings (under 5 words total)
    return (any(re.match(p, lower) for p in GREETING_PATTERNS) and len(words) < 5) or len(words) <= 1

AD_PATTERNS = [
    r"🌸.*?Pollinations.*?(?:\.|$)",
    r"\*\*Support Pollinations.*?$",
    r"Support Pollinations.*?$",
    r"Powered by Pollinations.*?$",
    r"\[.*?pollinations.*?\].*$",
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
    history: List[ChatMessage] = []

class ChatResponse(BaseModel):
    reply: str


# ─────────────────────────────────────────────────────
#  HEALTH & ROOT ENDPOINTS
# ─────────────────────────────────────────────────────
@app.get("/")
def read_root():
    return {"message": "Ehan AI API is running", "status": "online"}

@app.get("/health")
def health_check():
    """Enhanced health check with diagnostic info."""
    import datetime as dt
    uptime = int((time.time() - (_startup_time or time.time())) * 10) / 10
    gemini_ok = bool(os.getenv("GEMINI_API_KEY"))
    groq_ok = bool(os.getenv("GROQ_API_KEY"))
    return {
        "status": "ok",
        "time": dt.datetime.now().isoformat(),
        "uptime_seconds": uptime,
        "providers": {
            "gemini": "configured" if gemini_ok else "MISSING",
            "groq": "configured" if groq_ok else "MISSING",
            "openai": "configured" if os.getenv("OPENAI_API_KEY") else "not_set",
        },
        "cache_size": len(_cache),
    }


# ─────────────────────────────────────────────────────
#  MAIN CHAT ENDPOINT
# ─────────────────────────────────────────────────────
@app.post("/chat/stream")
async def chat_stream(req: ChatRequest):
    user_msg = req.message.strip()
    cache_key = hashlib.md5(user_msg.lower().encode()).hexdigest()

    # Return cached response if exists
    if cache_key in _cache:
        async def cached_gen() -> AsyncGenerator[str, None]:
            content: str = _cache[cache_key]
            chunk_size = 20
            for i in range(0, len(content), chunk_size):
                chunk = content[i : i + chunk_size]
                yield f"data: {json.dumps({'delta': chunk})}\n\n"
                await asyncio.sleep(0.01)
            yield "data: [DONE]\n\n"
        return StreamingResponse(cached_gen(), media_type="text/event-stream")

    # ⚡ ULTRA-FAST PATH: Skip EVERYTHING for simple greetings
    if is_greeting(user_msg):
        logger.info(f"Fast path triggered for greeting: {user_msg}")
        async def fast_gen() -> AsyncGenerator[str, None]:
            msg = "Hello! How can I assist you today?" if "how are you" not in user_msg.lower() else "I'm doing great, thank you! How can I help you today?"
            yield f"data: {json.dumps({'delta': msg})}\n\n"
            yield "data: [DONE]\n\n"
        return StreamingResponse(fast_gen(), media_type="text/event-stream")

    # Gather context asynchronously (with timeout so RAG failures don't block)
    try:
        real_time_context = await asyncio.wait_for(
            gather_context_for_query(user_msg), timeout=15.0
        )
    except asyncio.TimeoutError:
        logger.warning("RAG context gathering timed out after 15s, proceeding without context.")
        real_time_context = ""
    except Exception as e:
        logger.error(f"RAG context error: {e}")
        real_time_context = ""
    
    # 1. System Prompt (Formatting and Rules)
    messages_payload = [{"role": "system", "content": SYSTEM_PROMPT}]
    
    # 2. History (Contextual context)
    hist_slice = req.history[-6:] if len(req.history) > 6 else req.history
    for h in hist_slice:
        messages_payload.append({
            "role": h.role if h.role != "bot" else "assistant", 
            "content": h.content
        })

    # 3. Final Augmented User Message
    user_content = user_msg
    if real_time_context and len(real_time_context.strip()) > 50:
        user_content = (
            f"[LATEST REAL-TIME INFORMATION]\n{real_time_context}\n\n"
            f"[USER QUESTION]\n{user_msg}\n\n"
            f"Instruction: Use the provided real-time info to answer accurately. "
            f"If the information is about future events (like 2026), summarize what is known."
        )

    messages_payload.append({"role": "user", "content": user_content})

    async def generate() -> AsyncGenerator[str, None]:
        full_text: List[str] = []
        openai_key = os.getenv("OPENAI_API_KEY")
        groq_key = os.getenv("GROQ_API_KEY")
        
        logger.info(f"Generating response for: '{user_msg[:60]}...'")

        # --- 0. PRIMARY: Gemini (using google.genai — new SDK) ---
        gemini_key = os.getenv("GEMINI_API_KEY")
        if gemini_key:
            gemini_models = ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-flash"]
            for gemini_model_name in gemini_models:
                logger.info(f"Attempting Gemini model: {gemini_model_name}...")
                try:
                    from google import genai as google_genai
                    client = google_genai.Client(api_key=gemini_key)
                    
                    # Build contents for Gemini
                    gemini_contents = []
                    for h in messages_payload:
                        if h["role"] == "system":
                            gemini_contents.append({"role": "user", "parts": [{"text": h["content"]}]})
                            gemini_contents.append({"role": "model", "parts": [{"text": "Understood. I will follow these instructions."}]})
                        else:
                            role = "user" if h["role"] == "user" else "model"
                            gemini_contents.append({"role": role, "parts": [{"text": h["content"]}]})
                    
                    response = client.models.generate_content_stream(
                        model=gemini_model_name,
                        contents=gemini_contents,
                    )
                    
                    for chunk in response:
                        if chunk.text:
                            full_text.append(chunk.text)
                            yield f"data: {json.dumps({'delta': chunk.text})}\n\n"
                    
                    if full_text:
                        logger.info(f"✅ Gemini ({gemini_model_name}) stream completed successfully.")
                        _cache_response(cache_key, "".join(full_text))
                        yield "data: [DONE]\n\n"
                        return
                except Exception as e:
                    logger.error(f"❌ Gemini ({gemini_model_name}) failure: {e}")
                    full_text.clear()  # Reset on failure
                    continue  # Try next model

        # --- 1. SECONDARY: OpenAI (GPT-4o-mini) ---
        if openai_key and httpx:
            logger.info("Attempting OpenAI...")
            try:
                async with httpx.AsyncClient(timeout=45.0) as client:
                    async with client.stream(
                        "POST",
                        "https://api.openai.com/v1/chat/completions",
                        headers={"Authorization": f"Bearer {openai_key}"},
                        json={
                            "model": "gpt-4o-mini",
                            "messages": messages_payload,
                            "stream": True,
                            "max_tokens": 1200,
                            "temperature": 0.7
                        }
                    ) as response:
                        if response.status_code == 200:
                            async for line in response.aiter_lines():
                                if not line or not line.startswith("data: "): continue
                                data_str = line[6:].strip()
                                if data_str == "[DONE]": break
                                try:
                                    chunk_json = json.loads(data_str)
                                    delta = chunk_json["choices"][0]["delta"].get("content", "")
                                    if delta:
                                        full_text.append(delta)
                                        yield f"data: {json.dumps({'delta': delta})}\n\n"
                                except Exception: continue
                            
                            if full_text:
                                _cache_response(cache_key, "".join(full_text))
                                yield "data: [DONE]\n\n"
                                return
                        elif response.status_code == 429:
                            logger.warning("OpenAI Quota Exceeded (429). Falling back to Groq.")
                        else:
                            resp_text = await response.aread()
                            logger.error(f"OpenAI error {response.status_code}: {resp_text.decode()[:100]}")
            except Exception as e:
                logger.error(f"❌ OpenAI failure: {e}")

        # --- 2. FAST FALLBACK: Groq (Llama 3.3 70B → 8B) ---
        if groq_key and AsyncGroq:
            groq_models = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"]
            for groq_model in groq_models:
                logger.info(f"Attempting Groq ({groq_model})...")
                try:
                    g_client = AsyncGroq(api_key=groq_key)
                    g_stream = await asyncio.wait_for(
                        g_client.chat.completions.create(
                            model=groq_model,
                            messages=messages_payload,  # type: ignore
                            stream=True,
                            max_tokens=1500,
                            temperature=0.6
                        ),
                        timeout=30.0
                    )
                    async for chunk in g_stream:
                        content = chunk.choices[0].delta.content
                        if content:
                            full_text.append(content)
                            yield f"data: {json.dumps({'delta': content})}\n\n"
                    
                    if full_text:
                        logger.info(f"✅ Groq ({groq_model}) completed successfully.")
                        _cache_response(cache_key, "".join(full_text))
                        yield "data: [DONE]\n\n"
                        return
                except Exception as e:
                    logger.error(f"❌ Groq ({groq_model}) failure: {e}")
                    full_text.clear()
                    continue

        # --- 3. LAST RESORT: G4F (Community Managed) ---
        if G4FClient:
            logger.info("Using G4F last resort...")
            try:
                g4f_client = G4FClient()
                # G4F returns a sync generator, so run in thread
                def _g4f_sync():
                    chunks = []
                    for chunk in g4f_client.chat.completions.create(
                        model="gpt-4o",
                        messages=messages_payload,  # type: ignore
                        stream=True
                    ):
                        content = getattr(chunk.choices[0].delta, 'content', None)
                        if content:
                            chunks.append(content)
                    return chunks

                g4f_chunks = await asyncio.to_thread(_g4f_sync)
                for content in g4f_chunks:
                    full_text.append(content)
                    yield f"data: {json.dumps({'delta': content})}\n\n"
                
                if full_text:
                    _cache_response(cache_key, "".join(full_text))
                    yield "data: [DONE]\n\n"
                    return
            except Exception as e:
                logger.error(f"❌ G4F failure: {e}")

        # --- 4. ALL PROVIDERS FAILED ---
        logger.critical("🚨 ALL AI PROVIDERS FAILED — no response generated")
        error_msg = (
            "\n\n**System Notice:** All AI providers are currently unavailable. "
            "This could be due to:\n"
            "- API quota limits being reached\n"
            "- Temporary service outages\n\n"
            "Please try again in a few minutes."
        )
        yield f"data: {json.dumps({'delta': error_msg})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


def _cache_response(key: str, value: str):
    """Thread-safe bounded cache insertion."""
    global _cache
    if len(_cache) >= _MAX_CACHE_SIZE:
        # Evict oldest entries (simple FIFO)
        keys = list(_cache.keys())
        for old_key in keys[:50]:
            _cache.pop(old_key, None)
    _cache[key] = value


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
