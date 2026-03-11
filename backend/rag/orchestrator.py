import time
from .search import get_web_search_results
from .vector_db import db_instance
from datetime import datetime
import re
import requests

WEATHER_KEYWORDS = [
    "weather", "temperature", "temp", "forecast", "rain", "snow",
    "sunny", "cloudy", "humidity", "wind", "climate", "hot", "cold",
    "mausam", "thand", "garmi", "barish",
]

DATE_TIME_KEYWORDS = [
    "time", "date", "today", "day", "month", "year",
    "what day", "what time", "current time", "current date",
]

def extract_location(query):
    lower = query.lower()
    cleaned = re.sub(r'\b(weather|temperature|temp|forecast|in|at|of|for|the|current|today|now|what|is|how|\'s|tell|me|about|show)\b', '', lower).strip()
    return cleaned if cleaned else "Delhi"

def get_weather(location):
    try:
        url = f"https://wttr.in/{requests.utils.quote(location)}?format=j1"
        res = requests.get(url, headers={"User-Agent": "curl/7.68.0"}, timeout=5)
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
        forecast_lines = []
        for d in forecast_data:
            desc = d.get("hourly", [{}])[4].get("weatherDesc", [{}])[0].get("value", "N/A") if len(d.get("hourly", [])) > 4 else "N/A"
            forecast_lines.append(f"  - {d.get('date', 'N/A')}: {desc}, {d.get('mintempC', '?')}°C – {d.get('maxtempC', '?')}°C")

        return (
            f"[LIVE WEATHER DATA for {location_name}, {region}, {country}]\n"
            f"Temperature: {current.get('temp_C', '?')}°C ({current.get('temp_F', '?')}°F)\n"
            f"Feels Like: {current.get('FeelsLikeC', '?')}°C ({current.get('FeelsLikeF', '?')}°F)\n"
            f"Condition: {current.get('weatherDesc', [{}])[0].get('value', 'N/A')}\n"
            f"Humidity: {current.get('humidity', '?')}%\n"
            f"Wind: {current.get('windspeedKmph', '?')} km/h {current.get('winddir16Point', '')}\n"
            f"Visibility: {current.get('visibility', '?')} km\n"
            f"UV Index: {current.get('uvIndex', '?')}\n"
            f"Cloud Cover: {current.get('cloudcover', '?')}%\n"
            f"Pressure: {current.get('pressure', '?')} mb\n"
            f"Precipitation: {current.get('precipMM', '?')} mm\n"
            f"\n3-Day Forecast:\n" + "\n".join(forecast_lines)
        )
    except Exception as e:
        print(f"Weather API error: {e}")
        return None

def gather_context_for_query(query: str) -> str:
    context_blocks = []

    current_time_str = (
        f"Current Date and Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
        f"Day: {datetime.now().strftime('%A')}\n"
        f"Date: {datetime.now().strftime('%B %d, %Y')}"
    )
    context_blocks.append(current_time_str)

    lower = query.lower()
    is_weather = any(k in lower for k in WEATHER_KEYWORDS)
    if is_weather:
        location = extract_location(query)
        weather_data = get_weather(location)
        if weather_data:
            context_blocks.append(weather_data)

    try:
        similar_docs = db_instance.search(query, k=2)
        if similar_docs:
            internal_memory = "\n".join([f"- {doc.page_content}" for doc in similar_docs])
            context_blocks.append(f"### Internal Knowledge / Past News:\n{internal_memory}")
    except Exception as e:
        print(f"Error reading vector DB: {e}")

    try:
        search_results = get_web_search_results(query, max_results=3)
        context_blocks.append(f"### Live Web Search Results:\n{search_results}")
    except Exception as e:
        print(f"Error searching Web: {e}")

    augmented_prompt = "\n\n".join(context_blocks)

    return f"===== REAL-TIME CONTEXT =====\n{augmented_prompt}\n=============================\n\n"
