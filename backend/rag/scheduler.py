from apscheduler.schedulers.background import BackgroundScheduler
import requests
import os
from .vector_db import db_instance
from .scraper import scrape_url_text

def index_news_sources():
    print("Running scheduled web indexing job...")

    api_key = os.getenv("NEWSAPI_KEY")
    if not api_key:
        print("NEWSAPI_KEY not configured. Skipping daily crawl.")
        return

    try:
        url = f"https://newsapi.org/v2/top-headlines?country=us&category=technology&apiKey={api_key}"
        res = requests.get(url)
        data = res.json()

        articles = data.get("articles", [])
        for article in articles[:5]:
            title = article.get("title")
            description = article.get("description", "")
            url = article.get("url")

            full_text_scraped = scrape_url_text(url, 1500)

            combined = f"TITLE: {title}. DESC: {description}. CONTENT: {full_text_scraped}"

            db_instance.add_texts([combined], [{"source": "newsapi", "url": url}])

        print("Daily background index completed.")

    except Exception as e:
        print(f"Error during scheduled crawling: {e}")

def start_scheduler():
    scheduler = BackgroundScheduler()
    scheduler.add_job(index_news_sources, 'interval', hours=24)
    scheduler.start()
    return scheduler
