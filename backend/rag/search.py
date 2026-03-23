import os
from duckduckgo_search import DDGS
from newsapi import NewsApiClient

def get_web_search_results(query: str, max_results: int = 5) -> str:
    results = []
    
    # --- 1. NewsAPI (High Accuracy for Current Events) ---
    news_key = os.getenv("NEWSAPI_KEY")
    if news_key and len(news_key) > 10:
        try:
            newsapi = NewsApiClient(api_key=news_key)
            # Search top headlines and everything
            articles = newsapi.get_everything(q=query, sort_by='relevancy', page_size=2)
            if articles['status'] == 'ok' and articles['totalResults'] > 0:
                for art in articles['articles'][:2]:
                    title = art.get('title', '')
                    desc  = art.get('description', '')
                    src   = art.get('source', {}).get('name', 'News')
                    results.append(f"[NEWS SOURCE: {src}]\nTITLE: {title}\nSUMMARY: {desc}\n")
        except Exception:
            pass

    # --- 2. DuckDuckGo (Broad Web Search) ---
    try:
        with DDGS() as ddgs:
            ddgs_res = list(ddgs.text(query, max_results=max_results))
            for r in ddgs_res:
                title = r.get("title", "")
                body  = r.get("body", "")
                link  = r.get("href", "")
                results.append(f"[WEB SOURCE: {title}]\nINFO: {body}\nLINK: {link}\n")
    except Exception as e:
        if not results:
            return f"Search engine failed: {e}. Please provide the info manually if possible."

    return "\n".join(results) if results else "No latest information found for this query."
