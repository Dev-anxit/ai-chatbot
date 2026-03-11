import time
from .search import get_web_search_results
from .vector_db import db_instance
from datetime import datetime
import re

def gather_context_for_query(query: str) -> str:
    """
    Decides if web search is needed, searches the local vector DB, 
    and returns an augmented context string.
    """
    context_blocks = []
    
    # Always include current datetime
    current_time_str = f"Current Date and Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
    context_blocks.append(current_time_str)
    
    # 1. Ask Vector DB (Internal Memory / Cached Scraped Data)
    try:
        similar_docs = db_instance.search(query, k=2)
        if similar_docs:
            internal_memory = "\n".join([f"- {doc.page_content}" for doc in similar_docs])
            context_blocks.append(f"### Internal Knowledge / Past News:\n{internal_memory}")
    except Exception as e:
        print(f"Error reading vector DB: {e}")
    
    # 2. Heuristic check to see if Web Search is needed.
    # Words commonly associated with real-time needs.
    search_keywords = ["latest", "news", "today", "now", "current", "update", "price", "who won", "weather"]
    requires_search = any(k in query.lower() for k in search_keywords)
    
    # If a year or recent event is mentioned, we search. Also default to search to simulate always up-to-date AI
    if requires_search or True:
        try:
            search_results = get_web_search_results(query, max_results=3)
            context_blocks.append(f"### Live Web Search Results:\n{search_results}")
        except Exception as e:
            print(f"Error searching Web: {e}")
            
    # Compile the final augmented context block
    augmented_prompt = "\n\n".join(context_blocks)
    
    return f"===== REAL-TIME CONTEXT =====\n{augmented_prompt}\n=============================\n\n"
