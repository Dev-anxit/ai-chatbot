import asyncio
import httpx
import re
import logging
from datetime import datetime
from typing import List, Optional, Any, Coroutine

logger = logging.getLogger(__name__)

from .search import get_web_search_results
from .vector_db import db_instance

WEATHER_KEYWORDS = [
    "weather", "temperature", "temp", "forecast", "rain", "snow",
    "sunny", "cloudy", "humidity", "wind", "climate", "hot", "cold",
    "mausam", "thand", "garmi", "barish",
]

async def get_weather_async(location: str) -> Optional[str]:
    try:
        url = f"https://wttr.in/{httpx.utils.quote(location)}?format=j1"
        async with httpx.AsyncClient(timeout=3.5) as client:
            res = await client.get(url, headers={"User-Agent": "curl/7.68.0"})
            if res.status_code != 200:
                return None
            data = res.json()

        current = data.get("current_condition", [{}])[0]
        if not current:
            return None

        area = data.get("nearest_area", [{}])[0]
        location_name = area.get("areaName", [{}])[0].get("value", location)
        region = area.get("region", [{}])[0].get("value", "")
        country = area.get("country", [{}])[0].get("value", "")

        forecast_data = data.get("weather", [])[:3]
        forecast_lines: List[str] = []
        for d in forecast_data:
            desc = d.get("hourly", [{}])[4].get("weatherDesc", [{}])[0].get("value", "N/A") if len(d.get("hourly", [])) > 4 else "N/A"
            line = f"  - {d.get('date', 'N/A')}: {desc}, {d.get('mintempC', '?')}°C – {d.get('maxtempC', '?')}°C"
            forecast_lines.append(line)

        return (
            f"[LIVE WEATHER DATA for {location_name}, {region}, {country}]\n"
            f"Temperature: {current.get('temp_C', '?')}°C ({current.get('temp_F', '?')}°F)\n"
            f"Condition: {current.get('weatherDesc', [{}])[0].get('value', 'N/A')}\n"
            f"Humidity: {current.get('humidity', '?')}%\n"
            f"Wind: {current.get('windspeedKmph', '?')} km/h\n"
            f"\n3-Day Forecast:\n" + "\n".join(forecast_lines)
        )
    except Exception as e:
        print(f"Weather API error: {e}")
        return None

def extract_location(query: str) -> str:
    lower = query.lower()
    cleaned = re.sub(r'\b(weather|temperature|temp|forecast|in|at|of|for|the|current|today|now|what|is|how|\'s|tell|me|about|show)\b', '', lower).strip()
    return cleaned if cleaned else "Delhi"

SEARCH_KEYWORDS = [
    "who", "what", "where", "when", "why", "how", "tell", "show", "search", 
    "latest", "news", "current", "price", "vs", "difference", "compare",
    "stock", "market", "happened", "event", "update", "score", "match",
]

GREETING_PATTERNS = [
    r"^(hi|hello|hey|hola|hii|heyy+|gm|gn|good (morning|evening|night|afternoon)|how are you|how's it going|what's up|wassup|who are you|tell me about yourself)",
]

async def gather_context_for_query(query: str) -> str:
    current_time_str = (
        f"Current Date and Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
        f"Day: {datetime.now().strftime('%A')}\n"
        f"Date: {datetime.now().strftime('%B %d, %Y')}"
    )

    lower = query.lower().strip()
    needs_search = False
    if len(lower) > 2 and not any(re.match(p, lower) for p in GREETING_PATTERNS):
        if any(k in lower for k in SEARCH_KEYWORDS) or len(lower.split()) > 3:
            needs_search = True

    # Define tasks with explicit names to help linter
    weather_task: Coroutine[Any, Any, Optional[str]]
    if any(k in lower for k in WEATHER_KEYWORDS):
        weather_task = get_weather_async(extract_location(query))
    else:
        async def _none() -> Optional[str]: return None
        weather_task = _none()

    async def _vector_task() -> Optional[str]:
        if not needs_search: return None
        try:
            # Move synchronous search to thread to prevent blocking the event loop
            def sync_search():
                res = db_instance.search(query, k=2)
                return "\n".join([f"- {d.page_content}" for d in res])
            return await asyncio.to_thread(sync_search)
        except Exception:
            return None

    async def _web_task() -> Optional[str]:
        if not needs_search: return None
        try:
            # Set a strict timeout for web search to prevent long hangs
            return await asyncio.wait_for(
                asyncio.to_thread(get_web_search_results, query, 3),
                timeout=3.5
            )
        except (asyncio.TimeoutError, Exception):
            logger.warning(f"Web search timed out or failed for: {query}")
            return None

    # Run all three tasks
    results = await asyncio.gather(weather_task, _vector_task(), _web_task())
    weather_res, vector_res, search_res = results
    
    context_blocks = [current_time_str]
    if weather_res: context_blocks.append(weather_res)
    if vector_res: context_blocks.append(f"### Internal Knowledge:\n{vector_res}")
    if search_res: context_blocks.append(f"### Live Web Search:\n{search_res}")

    augmented_prompt = "\n\n".join(context_blocks)
    return f"===== USER CONTEXT =====\n{augmented_prompt}\n========================\n\n"

