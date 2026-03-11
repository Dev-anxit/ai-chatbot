import os
from langchain_community.vectorstores import FAISS
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_core.documents import Document

VECTOR_DB_PATH = "faiss_index"

class VectorKnowledgeDB:
    def __init__(self):
        # Using free local embeddings to bypass OpenAI costs.
        # all-MiniLM-L6-v2 is small, fast, and highly effective for general purpose.
        self.embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
        self.db = None
        self._load_or_create_db()

    def _load_or_create_db(self):
        """Loads FAISS index from disk or creates a new one."""
        if os.path.exists(VECTOR_DB_PATH):
            try:
                self.db = FAISS.load_local(VECTOR_DB_PATH, self.embeddings, allow_dangerous_deserialization=True)
            except Exception as e:
                print(f"Error loading FAISS vector DB: {e}. Recreating...")
                self._initialize_empty()
        else:
            self._initialize_empty()

    def _initialize_empty(self):
        # Initialize an empty FAISS index with a dummy document so it can be saved.
        from langchain_core.documents import Document
        dummy = [Document(page_content="Genesis: Knowledge base initialized", metadata={"source": "system"})]
        self.db = FAISS.from_documents(dummy, self.embeddings)
        self.db.save_local(VECTOR_DB_PATH)

    def add_texts(self, texts: list[str], metadatas: list[dict] = None):
        """Add new strings into the Vector DB."""
        docs = []
        for i, text in enumerate(texts):
            meta = metadatas[i] if metadatas and i < len(metadatas) else {}
            docs.append(Document(page_content=text, metadata=meta))
        
        self.db.add_documents(docs)
        self.db.save_local(VECTOR_DB_PATH)

    def search(self, query: str, k: int = 3) -> list[Document]:
        """Retrieve most similar snippets to the query."""
        if not self.db:
            return []
        
        # return list of (Document, score) -> we just want Document
        return self.db.similarity_search(query, k=k)

# Global singleton
db_instance = VectorKnowledgeDB()
