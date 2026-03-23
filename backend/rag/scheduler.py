from apscheduler.schedulers.background import BackgroundScheduler
import requests
import os
from .vector_db import db_instance
from .scraper import scrape_url_text

def index_news_sources():
    print("Running multi-category scheduled background indexing...")
    api_key = os.getenv("NEWSAPI_KEY")
    if not api_key:
        print("NEWSAPI_KEY not found. Skipping.")
        return

    # Expand to multiple critical categories and relevant regions
    configs = [
        {"country": "us", "category": "technology"},
        {"country": "in", "category": "sports"},
        {"country": "us", "category": "business"},
        {"country": "in", "category": "general"},
    ]

    indexed_urls = set()
    total_indexed = 0

    try:
        for cfg in configs:
            url = f"https://newsapi.org/v2/top-headlines?country={cfg['country']}&category={cfg['category']}&apiKey={api_key}"
            res = requests.get(url, timeout=10)
            data = res.json()

            articles = data.get("articles", [])
            # Take top 3 from each category to stay within free tier limits
            for article in articles[:3]:
                a_url = article.get("url")
                if not a_url or a_url in indexed_urls:
                    continue

                title = article.get("title", "No Title")
                description = article.get("description", "")
                
                # Scrape a bit more content for better RAG
                full_text = scrape_url_text(a_url, 2500)
                
                combined = (
                    f"[NEWS SOURCE: {article.get('source', {}).get('name', 'Web')}]\n"
                    f"CATEGORY: {cfg['category'].upper()}\n"
                    f"TITLE: {title}\n"
                    f"SUMMARY: {description}\n"
                    f"BODY: {full_text}"
                )

                db_instance.add_texts([combined], [{"source": "newsapi", "url": a_url, "category": cfg['category']}])
                indexed_urls.add(a_url)
                total_indexed += 1

        print(f"Index complete: {total_indexed} new articles added to vector DB.")

    except Exception as e:
        print(f"Error during scheduled crawling: {e}")

def start_scheduler():
    scheduler = BackgroundScheduler()
    # Run every 4 hours to keep news fresh but save API quota
    scheduler.add_job(index_news_sources, 'interval', hours=4)
    scheduler.start()
    return scheduler
