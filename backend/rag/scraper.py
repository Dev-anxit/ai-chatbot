import requests
from bs4 import BeautifulSoup
import traceback

def scrape_url_text(url: str, max_chars: int = 2000) -> str:
    """
    Fetch and extract main paragraphs from a URL.
    Limit extracted content to avoid overwhelming the context window.
    """
    try:
        # Avoid 403 Forbidden with proper headers
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        }
        res = requests.get(url, headers=headers, timeout=5)
        res.raise_for_status()
        
        soup = BeautifulSoup(res.text, "lxml")
        
        # Extrapolate main textual tags
        paragraphs = soup.find_all(["p", "h1", "h2", "h3", "li"])
        text = " ".join([p.get_text(strip=True) for p in paragraphs])
        
        # Clean whitespaces
        text = " ".join(text.split())
        
        return text[:max_chars] if max_chars else text
        
    except Exception as e:
        print(f"Failed to scrape {url}: {traceback.format_exc()}")
        return ""
