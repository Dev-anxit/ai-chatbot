import os
from langchain_community.vectorstores import FAISS
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_core.documents import Document

VECTOR_DB_PATH = "faiss_index"

class VectorKnowledgeDB:
    def __init__(self):
        self.embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
        self.db = None
        self._load_or_create_db()

    def _load_or_create_db(self):
        if os.path.exists(VECTOR_DB_PATH):
            try:
                self.db = FAISS.load_local(VECTOR_DB_PATH, self.embeddings, allow_dangerous_deserialization=True)
            except Exception as e:
                print(f"Error loading FAISS vector DB: {e}. Recreating...")
                self._initialize_empty()
        else:
            self._initialize_empty()

    def _initialize_empty(self):
        from langchain_core.documents import Document
        dummy = [Document(page_content="Genesis: Knowledge base initialized", metadata={"source": "system"})]
        self.db = FAISS.from_documents(dummy, self.embeddings)
        self.db.save_local(VECTOR_DB_PATH)

    def add_texts(self, texts: list[str], metadatas: list[dict] = None):
        docs = []
        for i, text in enumerate(texts):
            meta = metadatas[i] if metadatas and i < len(metadatas) else {}
            docs.append(Document(page_content=text, metadata=meta))

        self.db.add_documents(docs)
        self.db.save_local(VECTOR_DB_PATH)

    def search(self, query: str, k: int = 3) -> list[Document]:
        if not self.db:
            return []

        return self.db.similarity_search(query, k=k)

db_instance = VectorKnowledgeDB()
