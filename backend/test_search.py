import os
from rag.search import get_web_search_results
from rag.orchestrator import gather_context_for_query

query = "who is the winner of icc t20 world cup 2026"
print("========== RAW SEARCH ==========")
try:
    print(get_web_search_results(query))
except Exception as e:
    print("Error:", e)
print("========== FULL CONTEXT ==========")
try:
    print(gather_context_for_query(query))
except Exception as e:
    print("Error:", e)
