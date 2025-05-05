from fastapi import FastAPI, UploadFile, File, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime
import os

# Import our custom modules
from services.tts_service import tts_handler
from services.stt_service import whisper_transcribe_handler
from services.llm_service import generate_reply, init_llm
from utils.text_utils import strip_markdown

# Load environment variables and initialize services
from dotenv import load_dotenv
load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class Message(BaseModel):
    sender: str
    text: str
    language: str = "hi"

messages = [
    {"sender": "bot", "text": "नमस्ते! मैं आपकी कैसे मदद कर सकता हूँ?", "timestamp": datetime.now().isoformat()}
]

# Initialize LLM service
llm_model = init_llm()

@app.get("/")
def root():
    return {"status": "ok"}

@app.get("/messages")
def get_messages():
    return messages

@app.post("/messages")
def post_message(msg: Message):
    user_msg = {
        "sender": "user",
        "text": msg.text,
        "timestamp": datetime.now().isoformat(),
        "language": msg.language,
    }
    messages.append(user_msg)
    
    bot_text = generate_reply(llm_model, msg.text, msg.language)
    
    reply = {
        "sender": "bot",
        "text": bot_text,
        "timestamp": datetime.now().isoformat(),
        "language": msg.language,
    }
    messages.append(reply)
    return reply

@app.post("/whisper")
async def whisper_endpoint(audio: UploadFile = File(...), language: str = "hi-IN"):
    return await whisper_transcribe_handler(audio, language, llm_model)

@app.post("/tts") 
async def tts_endpoint(request: Request):
    return await tts_handler(request)

