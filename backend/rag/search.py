import os
from langchain_community.tools import DuckDuckGoSearchResults
from langchain_community.utilities import SerpAPIWrapper

def get_web_search_results(query: str, max_results: int = 3) -> str:
    serp_api_key = os.getenv("SERPAPI_API_KEY")

    if serp_api_key:
        try:
            search = SerpAPIWrapper(serpapi_api_key=serp_api_key)
            return search.run(query)
        except Exception as e:
            print(f"SerpAPI failed: {e}. Falling back to DuckDuckGo.")

    try:
        search = DuckDuckGoSearchResults(num_results=max_results)
        return search.run(query)
    except Exception as e:
        return f"Live search unavailable: {e}"
