from fastapi import FastAPI, UploadFile, File, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime
import os
import shutil
import uuid

# Import our custom modules
from services.tts_service import tts_handler
from services.stt_service import whisper_transcribe_handler
from services.llm_service import generate_reply, init_llm, process_pdf_with_genai, search_with_gemini
from services.live_service import handle_live_connection
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
    mode: str = "standard"  # 'standard', 'file', or 'search'
    file_id: str = None  # Optional file ID for file mode

messages = [
    {"sender": "bot", "text": "नमस्ते! मैं आपकी कैसे मदद कर सकता हूँ?", "timestamp": datetime.now().isoformat()}
]

# Initialize LLM service
llm_model = init_llm()

# Create uploads directory if it doesn't exist
uploads_dir = "uploads"
os.makedirs(uploads_dir, exist_ok=True)

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
        "mode": msg.mode
    }
    
    # Add file_id if it exists
    if msg.file_id:
        user_msg["file_id"] = msg.file_id
        
    messages.append(user_msg)
    
    # Route to appropriate handler based on mode
    if msg.mode == "file" and msg.file_id:
        return handle_file_mode_message(msg)
    elif msg.mode == "search":
        return handle_search_mode_message(msg)
    else:
        bot_text = generate_reply(llm_model, msg.text, msg.language)
        
        reply = {
            "sender": "bot",
            "text": bot_text,
            "timestamp": datetime.now().isoformat(),
            "language": msg.language,
            "mode": msg.mode
        }
        messages.append(reply)
        return reply

def handle_file_mode_message(msg):
    """Handle messages in file mode with direct PDF processing"""
    try:
        file_path = os.path.join(uploads_dir, msg.file_id)
        
        if not os.path.exists(file_path):
            error_text = "PDF file not found. Please upload it again."
            reply = {
                "sender": "bot",
                "text": error_text,
                "timestamp": datetime.now().isoformat(),
                "language": msg.language,
                "mode": "file",
                "pdfQuery": True
            }
            messages.append(reply)
            return reply
        
        # Process the PDF with Google Generative AI
        response_text = process_pdf_with_genai(llm_model, file_path, msg.text, msg.language)
        
        reply = {
            "sender": "bot",
            "text": response_text,
            "timestamp": datetime.now().isoformat(),
            "language": msg.language,
            "mode": "file",
            "pdfQuery": True,
            "usingGoogleAI": True,
            "file_id": msg.file_id
        }
        messages.append(reply)
        return reply
        
    except Exception as e:
        print(f"Error in file_mode_message: {e}")
        error_text = f"Error processing your file request: {str(e)}"
        reply = {
            "sender": "bot",
            "text": error_text,
            "timestamp": datetime.now().isoformat(),
            "language": msg.language,
            "mode": "file"
        }
        messages.append(reply)
        return reply

def handle_search_mode_message(msg):
    """Handle messages in search mode with Google Search Retrieval"""
    try:
        # Use search with Gemini function
        response_text = search_with_gemini(llm_model, msg.text, msg.language)
        
        # Check if this is a quota error response
        is_quota_error = "quota exceeded" in response_text.lower() or "resource_exhausted" in response_text.lower()
        
        reply = {
            "sender": "bot",
            "text": response_text,
            "timestamp": datetime.now().isoformat(),
            "language": msg.language,
            "mode": "search",
            "searchQuery": True,
            "quotaExceeded": is_quota_error
        }
        messages.append(reply)
        return reply
        
    except Exception as e:
        print(f"Error in search_mode_message: {e}")
        error_text = f"Error processing your search request. Falling back to standard response mode."
        
        # Get a standard response instead
        try:
            fallback_response = generate_reply(llm_model, msg.text, msg.language)
            reply = {
                "sender": "bot",
                "text": f"[Search mode unavailable. Standard response:]\n\n{fallback_response}",
                "timestamp": datetime.now().isoformat(),
                "language": msg.language,
                "mode": "standard",
                "fallbackFromSearch": True
            }
        except Exception:
            reply = {
                "sender": "bot",
                "text": error_text,
                "timestamp": datetime.now().isoformat(),
                "language": msg.language,
                "mode": "standard"
            }
        
        messages.append(reply)
        return reply

@app.post("/whisper")
async def whisper_endpoint(audio: UploadFile = File(...), language: str = "hi-IN"):
    return await whisper_transcribe_handler(audio, language, llm_model)

@app.post("/tts") 
async def tts_endpoint(request: Request):
    return await tts_handler(request)

@app.post("/pdf_query_genai")
async def pdf_query_genai(request: Request):
    """Process PDF with Google Generative AI"""
    try:
        data = await request.json()
        query = data.get("query", "")
        file_id = data.get("file_id", "")
        language = data.get("language", "en")
        
        # Get the file path from the file_id
        uploads_dir = "uploads"
        file_path = os.path.join(uploads_dir, file_id)
        
        if not os.path.exists(file_path):
            return {"text": "PDF file not found.", "sender": "bot", "language": language}
        
        # Process the PDF with Google Generative AI
        response_text = process_pdf_with_genai(llm_model, file_path, query, language)
        
        return {
            "text": response_text,
            "sender": "bot",
            "language": language,
            "pdfQuery": True,
            "usingGoogleAI": True
        }
    except Exception as e:
        print(f"Error in pdf_query_genai: {e}")
        return {"text": f"Error processing your request: {str(e)}", "sender": "bot", "language": language}

@app.post("/upload_pdf")
async def upload_pdf(file: UploadFile = File(...), language: str = "en"):
    """
    Upload a PDF file and return a unique file ID for future reference
    """
    try:
        # Generate a unique file ID
        file_id = str(uuid.uuid4())
        file_path = os.path.join(uploads_dir, file_id)
        
        # Save the uploaded file
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        return {
            "success": True,
            "file_id": file_id,
            "file_name": file.filename,
            "language": language
        }
    except Exception as e:
        print(f"Error uploading PDF: {e}")
        return {
            "success": False,
            "error": str(e)
        }

# Also add a PDF query endpoint that uses the built-in LLM
@app.post("/pdf_query")
async def pdf_query(request: Request):
    """Process PDF query with default LLM"""
    try:
        data = await request.json()
        query = data.get("query", "")
        file_id = data.get("file_id", "")
        language = data.get("language", "en")
        
        # Get the file path from the file_id
        file_path = os.path.join(uploads_dir, file_id)
        
        if not os.path.exists(file_path):
            return {"text": "PDF file not found.", "sender": "bot", "language": language}
        
        # Simple PDF query response - in real implementation, you would use a PDF parser
        # and process the query against the PDF content
        response_text = generate_reply(
            llm_model, 
            f"User is asking about a PDF document. Their question is: {query}", 
            language
        )
        
        return {
            "text": response_text,
            "sender": "bot",
            "language": language,
            "pdfQuery": True
        }
    except Exception as e:
        print(f"Error in pdf_query: {e}")
        return {"text": f"Error processing your request: {str(e)}", "sender": "bot", "language": language}

@app.websocket("/ws/live")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for live chat with screen sharing support"""
    await handle_live_connection(websocket, llm_model)

