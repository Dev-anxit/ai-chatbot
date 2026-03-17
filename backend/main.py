import os
import re
import json
import hashlib
import asyncio
import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator, List, Dict, Optional, Any

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv

# Lazy imports with type safety for linters
httpx: Any = None
try:
    import httpx
except ImportError:
    pass

AsyncGroq: Any = None
try:
    from groq import AsyncGroq
except ImportError:
    pass

G4FClient: Any = None
try:
    from g4f.client import AsyncClient as G4FClient
except ImportError:
    pass

from rag.scheduler import start_scheduler
from rag.orchestrator import gather_context_for_query

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

load_dotenv()

@asynccontextmanager
async def lifespan(application: FastAPI):
    # Initialize background tasks
    start_scheduler()
    logger.info("Background RAG Scheduler started.")
    yield

app = FastAPI(lifespan=lifespan)

# Enhanced CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Simple in-memory cache
_cache: Dict[str, str] = {}

SYSTEM_PROMPT = (
    "You are Ehan AI — a friendly and highly intelligent AI. "
    "MANDATORY FORMATTING: "
    "1. Start with `<thought>`: Briefly plan the answer (1-2 sentences for simple chat, more for research). "
    "2. End logic with `</thought>`. "
    "3. Provide final answer AFTER the tag. "
    "Rules: "
    "- If the user says 'hi', 'hello', or greets you, respond NATURALLY and briefly. Don't be over-formal. "
    "- For research/data questions, use the REAL-TIME CONTEXT provided. "
    "- Use Markdown, tables, and bold text for complex info only. "
    "- Be concise. Answer the SPECIFIC question asked."
)

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

@app.get("/")
def read_root():
    return {"message": "Ehan AI API is running", "status": "online"}

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

    # Gather context asynchronously
    real_time_context = await gather_context_for_query(user_msg)
    
    messages_payload = [{"role": "system", "content": SYSTEM_PROMPT + f"\n\nCONTEXT:\n{real_time_context}"}]
    # Fix: Ensure history slicing is handled correctly for the payload
    hist_slice = req.history[-6:] if len(req.history) > 6 else req.history
    for h in hist_slice:
        messages_payload.append({
            "role": h.role if h.role != "bot" else "assistant", 
            "content": h.content
        })
    messages_payload.append({"role": "user", "content": user_msg})

    async def generate() -> AsyncGenerator[str, None]:
        full_text: List[str] = []
        openai_key = os.getenv("OPENAI_API_KEY")
        
        logger.info(f"Generating response: {user_msg[:50]}...")
        
        if openai_key and httpx:
            try:
                # Use Any to satisfy linters without the full lib environment
                async with httpx.AsyncClient(timeout=60.0) as client:
                    async with client.stream(
                        "POST",
                        "https://api.openai.com/v1/chat/completions",
                        headers={"Authorization": f"Bearer {openai_key}"},
                        json={
                            "model": "gpt-4o-mini",
                            "messages": messages_payload,
                            "stream": True,
                            "max_tokens": 1024,
                            "temperature": 0.7
                        }
                    ) as response:
                        if response.status_code == 200:
                            async for line in response.aiter_lines():
                                if not line or not line.startswith("data: "):
                                    continue
                                data_str = line[6:].strip()
                                if data_str == "[DONE]":
                                    break
                                try:
                                    chunk_json = json.loads(data_str)
                                    delta = chunk_json["choices"][0]["delta"].get("content", "")
                                    if delta:
                                        full_text.append(delta)
                                        yield f"data: {json.dumps({'delta': delta})}\n\n"
                                except Exception:
                                    continue
                            
                            if full_text:
                                _cache[cache_key] = "".join(full_text)
                                yield "data: [DONE]\n\n"
                                return
                        else:
                            logger.error(f"OpenAI error {response.status_code}")
            except Exception as e:
                logger.error(f"OpenAI failure: {e}")

        # 2. High-Speed Fallback: Groq
        groq_key = os.getenv("GROQ_API_KEY")
        if groq_key and AsyncGroq:
            logger.info("Using Groq fallback...")
            try:
                g_client = AsyncGroq(api_key=groq_key)
                g_stream = await g_client.chat.completions.create(
                    model="llama-3.1-8b-instant",
                    messages=messages_payload, # type: ignore
                    stream=True,
                    max_tokens=1024
                )
                async for chunk in g_stream:
                    content = chunk.choices[0].delta.content
                    if content:
                        full_text.append(content)
                        yield f"data: {json.dumps({'delta': content})}\n\n"
                
                if full_text:
                    _cache[cache_key] = "".join(full_text)
                    yield "data: [DONE]\n\n"
                    return
            except Exception as e:
                logger.error(f"Groq failure: {e}")

        # 3. Community Fallback: G4F
        if G4FClient:
            logger.info("Using G4F last resort...")
            try:
                g4f_client = G4FClient()
                g4f_res = g4f_client.chat.completions.create(
                    model="gpt-4o",
                    messages=messages_payload, # type: ignore
                    stream=True
                )
                async for chunk in g4f_res:
                    content = getattr(chunk.choices[0].delta, 'content', None)
                    if content:
                        full_text.append(content)
                        yield f"data: {json.dumps({'delta': content})}\n\n"
                
                if full_text:
                    _cache[cache_key] = "".join(full_text)
                    yield "data: [DONE]\n\n"
                    return
            except Exception as e:
                logger.error(f"G4F failure: {e}")

        error_msg = "My neural links are saturated. Please try in a moment!"
        yield f"data: {json.dumps({'delta': error_msg})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")

@app.get("/health")
def health_check():
    import datetime
    return {"status": "ok", "time": datetime.datetime.now().isoformat()}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
