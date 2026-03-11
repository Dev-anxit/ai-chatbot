import time
from .search import get_web_search_results
from .vector_db import db_instance
from datetime import datetime
import re

def gather_context_for_query(query: str) -> str:
    context_blocks = []

    current_time_str = f"Current Date and Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
    context_blocks.append(current_time_str)

    try:
        similar_docs = db_instance.search(query, k=2)
        if similar_docs:
            internal_memory = "\n".join([f"- {doc.page_content}" for doc in similar_docs])
            context_blocks.append(f"### Internal Knowledge / Past News:\n{internal_memory}")
    except Exception as e:
        print(f"Error reading vector DB: {e}")

    search_keywords = ["latest", "news", "today", "now", "current", "update", "price", "who won", "weather"]
    requires_search = any(k in query.lower() for k in search_keywords)

    if requires_search or True:
        try:
            search_results = get_web_search_results(query, max_results=3)
            context_blocks.append(f"### Live Web Search Results:\n{search_results}")
        except Exception as e:
            print(f"Error searching Web: {e}")

    augmented_prompt = "\n\n".join(context_blocks)

    return f"===== REAL-TIME CONTEXT =====\n{augmented_prompt}\n=============================\n\n"
