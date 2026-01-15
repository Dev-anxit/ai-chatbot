from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from openai import OpenAI
import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Initialize FastAPI app
app = FastAPI()

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins (adjust in production)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize OpenAI client
api_key = os.getenv("OPENAI_API_KEY")
client = OpenAI(api_key=api_key)

# Data models
class ChatRequest(BaseModel):
    message: str

class ChatResponse(BaseModel):
    reply: str

# Routes
@app.get("/")
def read_root():
    return {"message": "Ehan AI API is running"}

@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    """Chat endpoint that uses OpenAI API"""
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are Ehan AI, a smart, friendly, and helpful AI assistant."},
                {"role": "user", "content": req.message}
            ],
            temperature=0.7,
            max_tokens=1000
        )
        return ChatResponse(reply=response.choices[0].message.content)
    except Exception as e:
        return ChatResponse(reply=f"Error: {str(e)}")

# Health check endpoint
@app.get("/health")
def health_check():
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
