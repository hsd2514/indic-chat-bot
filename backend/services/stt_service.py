import os
from fastapi import UploadFile
from sarvamai import SarvamAI
from services.llm_service import generate_reply

# Get the API key
SARVAM_AI_API_KEY = os.getenv("SARVAM_AI_API_KEY")

async def whisper_transcribe_handler(audio: UploadFile, language: str, llm_model):
    """Handle speech-to-text conversion using Sarvam AI"""
    audio_file = None
    temp_audio_path = None
    
    try:
        # Save uploaded audio to temporary file
        audio_bytes = await audio.read()
        
        # Create temp directory if it doesn't exist
        temp_dir = os.path.join(os.path.dirname(__file__), "..", "temp_audio")
        os.makedirs(temp_dir, exist_ok=True)
        temp_audio_path = os.path.join(temp_dir, f"temp_{os.urandom(4).hex()}.wav")
        
        with open(temp_audio_path, "wb") as f:
            f.write(audio_bytes)
        
        # Format language code
        if len(language) <= 3 and '-' not in language:
            language = f"{language}-IN"
        
        # Initialize Sarvam AI client
        client = SarvamAI(api_subscription_key=SARVAM_AI_API_KEY)
        
        # Validate language code
        valid_languages = ['unknown', 'hi-IN', 'bn-IN', 'kn-IN', 'ml-IN', 
                          'mr-IN', 'od-IN', 'pa-IN', 'ta-IN', 'te-IN', 
                          'en-IN', 'gu-IN']
        
        if language not in valid_languages:
            language = "hi-IN"
        
        # Transcribe audio
        audio_file = open(temp_audio_path, "rb")
        response = client.speech_to_text.transcribe(
            file=audio_file,
            model="saarika:v1",
            language_code=language
        )
        audio_file.close()
        audio_file = None
        
        # Extract transcript text
        if isinstance(response, dict):
            text = response.get("transcript", "")
        else:
            text = getattr(response, "transcript", str(response))
        
        # Generate bot reply using LLM
        bot_text = ""
        if text and text.strip():
            bot_text = generate_reply(llm_model, text, language[:2])
        else:
            bot_text = "I couldn't hear what you said. Could you please try again?"
            
        return {"text": text, "bot": bot_text}
        
    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        print(f"STT exception: {e}\n{error_details}")
        return {"text": "", "error": f"Speech-to-text failed: {e}"}
        
    finally:
        # Clean up resources
        if audio_file and not audio_file.closed:
            audio_file.close()
        
        if temp_audio_path and os.path.exists(temp_audio_path):
            try:
                os.remove(temp_audio_path)
            except:
                pass
