export const config = { runtime: "edge" };

const SYSTEM_PROMPT =
  "You are Ehan AI — a world-class, professional AI assistant. " +
  "You provide accurate, well-researched, and beautifully formatted responses. " +
  "Rules: " +
  "1. For simple questions, give brief direct answers. " +
  "2. For complex topics, explain step by step with examples. " +
  "3. Use markdown formatting (bold, lists, code blocks, tables) to make responses clear and scannable. " +
  "4. Never make up facts. If unsure, say so. " +
  "5. NEVER include any promotional text, advertisements, watermarks, or third-party attributions in your response. " +
  "6. Do NOT mention any AI provider, API service, or platform name in your response. " +
  "7. You will receive real-time data (weather, search results, date/time) in the context below. " +
  "You MUST use ONLY the information from those results to answer questions about current events, weather, temperature, sports, news, and anything time-sensitive. " +
  "Your training data is outdated. The provided context is ALWAYS correct and overrides your training data. " +
  "DO NOT guess or use your training data for recent events. ONLY use the provided context. " +
  "8. When weather data is provided, present it clearly with temperature, conditions, humidity, wind, etc. Use emoji for weather conditions. " +
  "9. IMPORTANT — ASK FOR MISSING INFORMATION: " +
  "If the user asks something that requires specific details you do not have, you MUST ask a polite clarifying question BEFORE answering. " +
  "10. FORMATTING FOR HUMANS: " +
  "Make your responses extremely easy to read. " +
  "- Use plenty of white space between sections. " +
  "- Break long paragraphs into smaller ones (max 2-3 sentences). " +
  "- Use **Bold** text for key terms, names, and important dates. " +
  "- For updates or news, ALWAYS prefer Bullet Points with bold headers. " +
  "- Avoid raw HTML tags. Use clean Markdown only. " +
  "11. Examples of clarifying questions: " +
  "- If they ask 'what is the temperature?' without a city → ask 'Which city or location would you like the weather for?' " +
  "- If they ask 'translate this' without text → ask 'What text would you like me to translate, and to which language?' " +
  "- If they ask about a person with common name → ask for clarification (e.g. 'Do you mean X the actor or X the cricketer?'). " +
  "- If they ask 'book a flight' → politely say what you can help with instead. ";

function stripAds(text) {
  const patterns = [
    /🌸.*?Pollinations.*?(?:\.|$)/gis,
    /\*\*Support Pollinations.*$/gim,
    /Support Pollinations.*$/gim,
    /Powered by Pollinations.*$/gim,
    /---\s*\n.*?Pollinations.*$/gims,
    /\n+\s*\*?\s*(?:Ad|Advertisement)\s*\*?\s*\n.*$/gims,
    /\[.*?pollinations.*?\].*$/gim,
    /<.*?pollinations.*?>.*$/gim,
  ];
  for (const pat of patterns) {
    text = text.replace(pat, "");
  }
  return text.trimEnd();
}

const WEATHER_KEYWORDS = [
  "weather", "temperature", "temp", "forecast", "rain", "snow",
  "sunny", "cloudy", "humidity", "wind", "climate", "hot", "cold",
  "mausam", "thand", "garmi", "barish",
];

const DATE_TIME_KEYWORDS = [
  "time", "date", "today", "day", "month", "year",
  "what day", "what time", "current time", "current date",
];

function detectQueryType(query) {
  const lower = query.toLowerCase();
  const types = { weather: false, dateTime: false, general: true };

  if (WEATHER_KEYWORDS.some((k) => lower.includes(k))) types.weather = true;
  if (DATE_TIME_KEYWORDS.some((k) => lower.includes(k))) types.dateTime = true;

  return types;
}

function extractLocation(query) {
  const lower = query.toLowerCase();
  const cleaned = lower
    .replace(/weather|temperature|temp|forecast|in|at|of|for|the|current|today|now|what|is|how|'s/gi, "")
    .trim();
  return cleaned || "Delhi";
}

async function getWeather(location) {
  try {
    const url = `https://wttr.in/${encodeURIComponent(location)}?format=j1`;
    const res = await fetch(url, {
      headers: { "User-Agent": "curl/7.68.0" },
    });
    if (!res.ok) return null;
    const data = await res.json();

    const current = data.current_condition?.[0];
    if (!current) return null;

    const area = data.nearest_area?.[0];
    const locationName = area?.areaName?.[0]?.value || location;
    const region = area?.region?.[0]?.value || "";
    const country = area?.country?.[0]?.value || "";

    const forecast = data.weather?.slice(0, 3) || [];
    const forecastText = forecast
      .map((d) => {
        const desc = d.hourly?.[4]?.weatherDesc?.[0]?.value || "N/A";
        return `  - ${d.date}: ${desc}, ${d.mintempC}°C – ${d.maxtempC}°C`;
      })
      .join("\n");

    return (
      `[LIVE WEATHER DATA for ${locationName}, ${region}, ${country}]\n` +
      `Temperature: ${current.temp_C}°C (${current.temp_F}°F)\n` +
      `Feels Like: ${current.FeelsLikeC}°C (${current.FeelsLikeF}°F)\n` +
      `Condition: ${current.weatherDesc?.[0]?.value || "N/A"}\n` +
      `Humidity: ${current.humidity}%\n` +
      `Wind: ${current.windspeedKmph} km/h ${current.winddir16Point}\n` +
      `Visibility: ${current.visibility} km\n` +
      `UV Index: ${current.uvIndex}\n` +
      `Cloud Cover: ${current.cloudcover}%\n` +
      `Pressure: ${current.pressure} mb\n` +
      `Precipitation: ${current.precipMM} mm\n` +
      `\n3-Day Forecast:\n${forecastText}`
    );
  } catch {
    return null;
  }
}

async function getWeatherFallback(location) {
  try {
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en`;
    const geoRes = await fetch(geoUrl);
    if (!geoRes.ok) return null;
    const geoData = await geoRes.json();
    const place = geoData.results?.[0];
    if (!place) return null;

    const wxUrl = `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,surface_pressure,cloud_cover,uv_index&timezone=auto`;
    const wxRes = await fetch(wxUrl);
    if (!wxRes.ok) return null;
    const wx = await wxRes.json();
    const c = wx.current;
    if (!c) return null;

    const codes = {
      0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
      45: "Foggy", 48: "Rime fog", 51: "Light drizzle", 53: "Drizzle",
      55: "Dense drizzle", 61: "Light rain", 63: "Rain", 65: "Heavy rain",
      71: "Light snow", 73: "Snow", 75: "Heavy snow", 80: "Rain showers",
      81: "Moderate rain showers", 82: "Violent rain showers",
      95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Severe thunderstorm",
    };

    return (
      `[LIVE WEATHER DATA for ${place.name}, ${place.country}]\n` +
      `Temperature: ${c.temperature_2m}°C\n` +
      `Feels Like: ${c.apparent_temperature}°C\n` +
      `Condition: ${codes[c.weather_code] || "Unknown"}\n` +
      `Humidity: ${c.relative_humidity_2m}%\n` +
      `Wind: ${c.wind_speed_10m} km/h\n` +
      `Cloud Cover: ${c.cloud_cover}%\n` +
      `UV Index: ${c.uv_index}\n` +
      `Pressure: ${c.surface_pressure} hPa`
    );
  } catch {
    return null;
  }
}

async function searchWikipedia(query, maxResults = 3) {
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${maxResults}&format=json&origin=*`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.query?.search || []).map((item) => {
      const snippet = item.snippet
        .replace(/<[^>]+>/g, "")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&#039;/g, "'");
      return `[Wikipedia: ${item.title}] ${snippet}`;
    });
  } catch {
    return [];
  }
}

async function getWikipediaExtract(title) {
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=extracts&exintro=1&explaintext=1&format=json&origin=*`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return "";
    const data = await res.json();
    const pages = data?.query?.pages || {};
    const page = Object.values(pages)[0];
    if (page?.extract?.length > 20) return page.extract.substring(0, 1500);
    return "";
  } catch {
    return "";
  }
}

async function searchDDGLite(query, maxResults = 5) {
  try {
    const res = await fetch("https://lite.duckduckgo.com/lite/", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      body: `q=${encodeURIComponent(query)}`,
    });
    if (!res.ok) return [];
    const html = await res.text();
    const re = /class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;
    const snippets = [];
    let match;
    while ((match = re.exec(html)) !== null && snippets.length < maxResults) {
      const clean = match[1]
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&#x27;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, " ")
        .trim();
      if (clean.length > 20) snippets.push(`[Web] ${clean}`);
    }
    return snippets;
  } catch {
    return [];
  }
}

async function searchDDGHTML(query, maxResults = 5) {
  try {
    const res = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      }
    );
    if (!res.ok) return [];
    const html = await res.text();
    const re = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippets = [];
    let match;
    while ((match = re.exec(html)) !== null && snippets.length < maxResults) {
      const clean = match[1]
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&#x27;/g, "'")
        .replace(/&quot;/g, '"')
        .trim();
      if (clean.length > 20) snippets.push(`[Web] ${clean}`);
    }
    return snippets;
  } catch {
    return [];
  }
}

async function gatherContext(query) {
  const qType = detectQueryType(query);
  const tasks = [];

  if (qType.weather) {
    const location = extractLocation(query);
    tasks.push(
      getWeather(location).then(async (r) => {
        if (r) return r;
        return await getWeatherFallback(location);
      })
    );
  }

  tasks.push(searchWikipedia(query, 3));
  tasks.push(searchDDGLite(query, 3));
  tasks.push(searchDDGHTML(query, 3));

  const results = await Promise.all(tasks);

  const all = [];
  let startIdx = 0;

  if (qType.weather) {
    if (results[0]) all.push(results[0]);
    startIdx = 1;
  }

  const wikiSearch = results[startIdx] || [];
  const ddgLite = results[startIdx + 1] || [];
  const ddgHTML = results[startIdx + 2] || [];

  if (wikiSearch.length > 0) {
    const titleMatch = wikiSearch[0].match(/\[Wikipedia: (.+?)\]/);
    if (titleMatch) {
      const extract = await getWikipediaExtract(titleMatch[1]);
      if (extract) all.push(`[Wikipedia Full Article]\n${extract}`);
    }
  }

  all.push(...wikiSearch, ...ddgLite, ...ddgHTML);
  return all;
}

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { message, history } = await req.json();
  if (!message?.trim()) {
    return new Response(JSON.stringify({ error: "Message is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const now = new Date();
  const dateTimeInfo =
    `Current Date & Time: ${now.toISOString()}\n` +
    `Day: ${now.toLocaleDateString("en-US", { weekday: "long" })}\n` +
    `Date: ${now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`;

  let contextBlock = `\n\n===== REAL-TIME CONTEXT =====\n${dateTimeInfo}\n\n`;
  try {
    const results = await gatherContext(message.trim());
    if (results.length > 0) {
      contextBlock +=
        results.join("\n\n") +
        "\n\n===== END OF CONTEXT =====\n" +
        "\nREMINDER: Base your answer ONLY on the context above for any factual, weather, or current-event questions. Do NOT include any promotional text.";
    }
  } catch {}

  const dynamicSystemPrompt = SYSTEM_PROMPT + contextBlock;

  const messagesPayload = [
    { role: "system", content: dynamicSystemPrompt },
    ...(Array.isArray(history) ? history : []),
    { role: "user", content: message.trim() },
  ];

  const endpoints = [
    { model: "openai", stream: true },
    { model: "mistral", stream: true },
    { model: "openai", stream: false },
  ];

  for (const ep of endpoints) {
    try {
      const upstream = await fetch(
        "https://text.pollinations.ai/openai/v1/chat/completions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: ep.model,
            messages: messagesPayload,
            stream: ep.stream,
          }),
        }
      );
      if (!upstream.ok) continue;

      if (!ep.stream) {
        const data = await upstream.json();
        let reply = data?.choices?.[0]?.message?.content || "";
        reply = stripAds(reply);
        if (!reply) continue;

        const encoder = new TextEncoder();
        const body = encoder.encode(
          `data: ${JSON.stringify({ delta: reply })}\n\ndata: [DONE]\n\n`
        );
        return new Response(body, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      }

      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") break;
          try {
            const parsed = JSON.parse(payload);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) accumulated += delta;
          } catch {}
        }
      }

      if (!accumulated) continue;

      const cleanText = stripAds(accumulated);
      if (!cleanText) continue;

      const encoder = new TextEncoder();
      const words = cleanText.split(" ");
      const chunks = [];
      for (let i = 0; i < words.length; i++) {
        const w = words[i] + (i < words.length - 1 ? " " : "");
        chunks.push(`data: ${JSON.stringify({ delta: w })}\n\n`);
      }
      chunks.push("data: [DONE]\n\n");
      const body = encoder.encode(chunks.join(""));

      return new Response(body, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    } catch {
      continue;
    }
  }

  return new Response(
    JSON.stringify({ error: "All upstream providers failed" }),
    { status: 502, headers: { "Content-Type": "application/json" } }
  );
}
