import json
import asyncio
import base64
import time
import uuid
from fastapi import WebSocket, WebSocketDisconnect
from typing import Dict, List, Optional, Any
import logging

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Import LLM service for generating responses
from services.llm_service import generate_reply, process_image_with_text

class ConnectionManager:
    """Manage WebSocket connections for live chat and screen sharing"""
    
    def __init__(self):
        # Store active connections
        self.active_connections: Dict[str, WebSocket] = {}
        # Store conversation state for each connection
        self.conversation_contexts: Dict[str, Dict[str, Any]] = {}
        
    async def connect(self, websocket: WebSocket) -> str:
        """Accept a new WebSocket connection and return a session ID"""
        await websocket.accept()
        session_id = str(uuid.uuid4())
        self.active_connections[session_id] = websocket
        self.conversation_contexts[session_id] = {
            "history": [],
            "is_recording": False,
            "has_screenshot": False,
            "pending_screenshot": None,
            "last_activity": time.time(),
            "language_code": "en",  # Default language
        }
        logger.info(f"New connection established: {session_id}")
        return session_id
        
    def disconnect(self, session_id: str):
        """Clean up when a connection is closed"""
        if session_id in self.active_connections:
            del self.active_connections[session_id]
        if session_id in self.conversation_contexts:
            del self.conversation_contexts[session_id]
        logger.info(f"Connection closed: {session_id}")
            
    async def send_text(self, session_id: str, text: str, message_type: str = "text"):
        """Send a text message to a specific client"""
        if session_id in self.active_connections:
            try:
                await self.active_connections[session_id].send_json({
                    "type": message_type,
                    "data": text
                })
            except Exception as e:
                logger.error(f"Error sending message to {session_id}: {e}")
                
    async def send_binary(self, session_id: str, binary_data: bytes):
        """Send binary data (like audio) to a specific client"""
        if session_id in self.active_connections:
            try:
                await self.active_connections[session_id].send_bytes(binary_data)
            except Exception as e:
                logger.error(f"Error sending binary data to {session_id}: {e}")

    def get_context(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Get conversation context for a session"""
        return self.conversation_contexts.get(session_id)
        
    def update_context(self, session_id: str, update_data: Dict[str, Any]):
        """Update conversation context for a session"""
        if session_id in self.conversation_contexts:
            self.conversation_contexts[session_id].update(update_data)
            self.conversation_contexts[session_id]["last_activity"] = time.time()


# Create a single instance of the connection manager
connection_manager = ConnectionManager()


async def handle_live_connection(websocket: WebSocket, llm_model):
    """Handle a live chat connection with audio and screen sharing support"""
    # Accept the connection and get a session ID
    session_id = await connection_manager.connect(websocket)
    
    # Send welcome message
    await connection_manager.send_text(
        session_id, 
        "System: Connected to live chat with screen sharing support."
    )
    
    try:
        # Main message handling loop
        while True:
            # Receive message (could be text JSON or binary audio)
            message = await websocket.receive()
            
            # Update last activity timestamp
            context = connection_manager.get_context(session_id)
            if not context:
                logger.error(f"No context found for session {session_id}")
                break
                
            # Check if message is text or binary
            if "text" in message:
                await handle_text_message(session_id, message["text"], llm_model)
            elif "bytes" in message:
                await handle_binary_message(session_id, message["bytes"], llm_model)
            else:
                logger.warning(f"Received unknown message format: {message.keys()}")
                
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: {session_id}")
    except Exception as e:
        logger.error(f"Error handling WebSocket connection: {e}", exc_info=True)
        try:
            await connection_manager.send_text(
                session_id, 
                f"System: An error occurred: {str(e)}"
            )
        except:
            pass
    finally:
        # Clean up when the connection is closed
        connection_manager.disconnect(session_id)


async def handle_text_message(session_id: str, text_message: str, llm_model):
    """Handle text messages, which could be text input or JSON commands"""
    try:
        # Parse JSON message
        data = json.loads(text_message)
        message_type = data.get("type", "")
        
        # Get conversation context
        context = connection_manager.get_context(session_id)
        if not context:
            logger.error(f"No context found for session {session_id}")
            return
            
        # Handle different message types
        if message_type == "text":
            # Text message from user
            user_text = data.get("data", "")
            has_screenshot = data.get("hasScreenshot", False)
            
            # Detect and save language
            # Check if language code is specified in the message
            if "language" in data:
                context["language_code"] = data.get("language", "en")
            else:
                # Simple language detection based on text content
                if any(char in "हिंदी" for char in user_text):
                    context["language_code"] = "hi"
                elif any(char in "தமிழ்" for char in user_text):
                    context["language_code"] = "ta"
                
            # Add message to history
            context["history"].append({"role": "user", "content": user_text})
            
            if has_screenshot:
                # If this message has a screenshot, we need to wait for it
                # before generating a response
                context["has_screenshot"] = True
                connection_manager.update_context(session_id, context)
                logger.info(f"Received text with pending screenshot from {session_id}")
                # Message will be processed after screenshot is received
            else:
                # No screenshot, process the message immediately
                await process_message(session_id, user_text, None, llm_model)
                
        elif message_type == "screenshot":
            # Screenshot data from user
            screenshot_data = data.get("data", "")
            
            if screenshot_data and screenshot_data.startswith("data:image"):
                # Check if we have pending text to process with this screenshot
                if context["has_screenshot"]:
                    # Get the last user message
                    last_message = next((msg for msg in reversed(context["history"]) 
                                        if msg["role"] == "user"), None)
                    
                    if last_message:
                        user_text = last_message["content"]
                        # Process message with screenshot
                        await process_message(session_id, user_text, screenshot_data, llm_model)
                    
                    # Reset screenshot flag
                    context["has_screenshot"] = False
                    connection_manager.update_context(session_id, context)
                else:
                    # Standalone screenshot without text
                    await process_message(session_id, "", screenshot_data, llm_model)
            else:
                logger.warning(f"Received invalid screenshot data from {session_id}")
        
        elif message_type == "end_turn":
            # User has finished speaking, end audio turn
            context["is_recording"] = False
            connection_manager.update_context(session_id, context)
            logger.info(f"End of user turn for {session_id}")
            
        else:
            logger.warning(f"Received unknown message type: {message_type}")
            
    except json.JSONDecodeError:
        # Not JSON, assume plain text
        await process_message(session_id, text_message, None, llm_model)
    except Exception as e:
        logger.error(f"Error handling text message: {e}", exc_info=True)
        await connection_manager.send_text(
            session_id, 
            f"System: Error processing your message: {str(e)}"
        )


async def handle_binary_message(session_id: str, binary_data: bytes, llm_model):
    """Handle binary messages (audio data) with real-time transcription"""
    import io
    import os
    import wave
    from datetime import datetime
    from services.stt_service import SarvamAI
    from services.tts_service import tts_service
    import base64
    
    # Update recording state
    context = connection_manager.get_context(session_id)
    if not context:
        logger.error(f"No context found for session {session_id}")
        return
        
    if not context["is_recording"]:
        # First audio packet, mark as recording
        context["is_recording"] = True
        connection_manager.update_context(session_id, context)
        await connection_manager.send_text(session_id, "System: Processing audio...")
    
    try:
        # Get API key from environment
        SARVAM_AI_API_KEY = os.getenv("SARVAM_AI_API_KEY")
        if not SARVAM_AI_API_KEY:
            logger.error("Missing Sarvam AI API key")
            await connection_manager.send_text(
                session_id, 
                "System: Error processing audio: Missing API key"
            )
            return
            
        # Save received audio to temporary file
        temp_dir = os.path.join(os.path.dirname(__file__), "..", "temp_audio")
        os.makedirs(temp_dir, exist_ok=True)
        temp_filename = f"live_{datetime.now().strftime('%Y%m%d%H%M%S')}_{os.urandom(4).hex()}.wav"
        temp_audio_path = os.path.join(temp_dir, temp_filename)
        
        # Check if audio data is already in WAV format or convert it
        try:
            with open(temp_audio_path, "wb") as f:
                f.write(binary_data)
                
            # Get language code for STT
            language_code = context.get("language_code", "en")
            if len(language_code) <= 3 and '-' not in language_code:
                language_code = f"{language_code}-IN"
                
            # Initialize Sarvam AI client and transcribe
            client = SarvamAI(api_subscription_key=SARVAM_AI_API_KEY)
            with open(temp_audio_path, "rb") as audio_file:
                response = client.speech_to_text.transcribe(
                    file=audio_file,
                    model="saarika:v1",
                    language_code=language_code
                )
            
            # Extract transcript text
            if isinstance(response, dict):
                text = response.get("transcript", "")
            else:
                text = getattr(response, "transcript", str(response))
                
            # Process only if we got meaningful text
            if text and text.strip():
                # Add to conversation history
                context["history"].append({"role": "user", "content": text})
                connection_manager.update_context(session_id, context)
                
                # Send transcription to client
                await connection_manager.send_text(
                    session_id, 
                    f"You: {text}"
                )
                
                # Generate bot response
                bot_response = generate_reply(
                    llm_model, 
                    text, 
                    language_code[:2] if '-' in language_code else language_code,
                    context["history"]
                )
                
                # Add bot response to history
                context["history"].append({"role": "assistant", "content": bot_response})
                connection_manager.update_context(session_id, context)
                
                # Send text response to client
                await connection_manager.send_text(session_id, bot_response)
                
                # Convert bot response to speech
                tts_result = tts_service.text_to_speech(
                    text=bot_response,
                    target_language_code=f"{language_code[:2]}-IN" if '-' not in language_code else language_code,
                    speaker=None,  # Will use default based on language
                    model="bulbul:v1",
                    enable_preprocessing=True
                )
                
                if tts_result and "audio_base64" in tts_result:
                    # Decode the base64 audio and send as binary
                    audio_bytes = base64.b64decode(tts_result["audio_base64"])
                    await connection_manager.send_binary(session_id, audio_bytes)
                else:
                    logger.warning(f"No audio data in TTS response for session {session_id}")
            else:
                # No transcription
                await connection_manager.send_text(
                    session_id, 
                    "System: I couldn't hear what you said. Please try again."
                )
                
        except Exception as e:
            logger.error(f"Error processing audio: {e}", exc_info=True)
            await connection_manager.send_text(
                session_id, 
                f"System: Error processing audio: {str(e)}"
            )
            
    finally:
        # Clean up the temporary file
        if os.path.exists(temp_audio_path):
            try:
                os.remove(temp_audio_path)
            except Exception as e:
                logger.error(f"Error removing temp file: {e}")
                
        # Reset recording state
        context["is_recording"] = False
        connection_manager.update_context(session_id, context)
    

async def process_message(session_id: str, text: str, screenshot: Optional[str], llm_model):
    """Process a message with or without screenshot using the LLM"""
    try:
        context = connection_manager.get_context(session_id)
        if not context:
            logger.error(f"No context found for session {session_id}")
            return
            
        language_code = context.get("language_code", "en")
        conversation_history = context.get("history", [])
        
        # Processing notification to user
        await connection_manager.send_text(
            session_id,
            f"System: Processing your {'' if not screenshot else 'screenshot and '}message..."
        )
        
        # Generate response based on whether we have a screenshot or not
        if screenshot:
            # Process using the image processing function with enhanced screenshot guidance
            if text:
                # Text with screenshot
                if any(keyword in text.lower() for keyword in ["help", "guide", "how to", "what should", "next step", "explain"]):
                    # User is explicitly asking for guidance based on what's on their screen
                    prompt = f"The user has shared their screen and is asking for help: '{text}'. Provide step-by-step guidance on what they're seeing and how to proceed next."
                else:
                    # General question with a screenshot
                    prompt = f"The user has shared their screen and says: '{text}'. Analyze the screenshot and respond to the user's message, including any relevant guidance for what's visible on screen."
            else:
                # Screenshot only - assume user needs help understanding what's on screen
                prompt = "The user has shared their screen without text. Analyze what's visible, explain key elements, and provide step-by-step guidance on possible next actions based on what you see."
                
            # Use the dedicated image processing function with conversation history
            bot_response = process_image_with_text(
                llm_model, 
                screenshot, 
                prompt, 
                language_code,
                conversation_history
            )
        else:
            # Text-only message with conversation history
            bot_response = generate_reply(
                llm_model, 
                text, 
                language_code,
                conversation_history
            )
            
        # Add bot response to history
        context["history"].append({"role": "assistant", "content": bot_response})
        connection_manager.update_context(session_id, context)
        
        # Send response to client
        await connection_manager.send_text(session_id, bot_response)
            
    except Exception as e:
        logger.error(f"Error processing message: {e}", exc_info=True)
        await connection_manager.send_text(
            session_id, 
            f"System: Error generating response: {str(e)}"
        )