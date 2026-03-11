from apscheduler.schedulers.background import BackgroundScheduler
import requests
import os
from .vector_db import db_instance
from .scraper import scrape_url_text

# Scheduler logic explicitly intended to run autonomously in the background
def index_news_sources():
    print("Running scheduled web indexing job for global news and updates...")
    
    # 1. Fetch live top tech/general news API for trending info
    # Alternatively use RSS parsing. We will use a mock source or NewsAPI here 
    # to demonstrate the daily process required by instructions.
    
    api_key = os.getenv("NEWSAPI_KEY")
    if not api_key:
        print("NEWSAPI_KEY not configured. Skipping daily crawl. Please add to .env")
        return

    try:
        url = f"https://newsapi.org/v2/top-headlines?country=us&category=technology&apiKey={api_key}"
        res = requests.get(url)
        data = res.json()
        
        articles = data.get("articles", [])
        for article in articles[:5]:  # limit to 5 top articles per index cycle
            title = article.get("title")
            description = article.get("description", "")
            url = article.get("url")
            
            # Scrape main article content
            full_text_scraped = scrape_url_text(url, 1500)
            
            combined = f"TITLE: {title}. DESC: {description}. CONTENT: {full_text_scraped}"
            
            # Add to local FAISS or Pinecone index
            db_instance.add_texts([combined], [{"source": "newsapi", "url": url}])
            
        print("Daily background index completed.")
                
    except Exception as e:
        print(f"Error during scheduled crawling: {e}")

def start_scheduler():
    scheduler = BackgroundScheduler()
    # Runs the job every 24 hours at a specific time (e.g., midnight)
    scheduler.add_job(index_news_sources, 'interval', hours=24)
    scheduler.start()
    return scheduler
