import os
import io
import base64
import uuid
import wave
from fastapi import Request

from sarvam_tts import SarvamTTS
from utils.text_utils import strip_markdown

# Initialize the TTS service
tts_service = SarvamTTS()

async def tts_handler(request: Request):
    """Handle TTS requests with multi-chunk processing for longer texts"""
    try:
        data = await request.json()
        text = data.get("text")
        language = data.get("language", "hi")
        target_language_code = data.get("target_language_code", None)
        speaker = data.get("speaker", None)
        model = data.get("model", "bulbul:v1")
        enable_preprocessing = data.get("enable_preprocessing", True)
        
        if not text:
            return {"error": "Missing text"}
        
        # Strip markdown formatting
        text = strip_markdown(text)
        
        print(f"TTS request: language={language}, length={len(text)}")
        
        # Map language codes
        if not target_language_code:
            language_code_map = {
                "hi": "hi-IN", "en": "en-IN", "ta": "ta-IN", "bn": "bn-IN",
                "gu": "gu-IN", "mr": "mr-IN", "te": "te-IN", "kn": "kn-IN", 
                "ml": "ml-IN", "pa": "pa-IN",
            }
            target_language_code = language_code_map.get(language, "hi-IN")
        
        # Map speakers
        if not speaker:
            speakers = {
                "hi": "meera", "en": "arjun", "ta": "maitreyi", "bn": "amartya",
                "gu": "meera", "mr": "amol", "te": "arvind", "kn": "maya",
                "ml": "diya", "pa": "neel",
            }
            speaker = speakers.get(language, "meera")
        
        # Process text in chunks if longer than 500 characters
        chunk_size = 500
        
        if len(text) <= chunk_size:
            # For short texts
            return tts_service.text_to_speech(
                text=text,
                target_language_code=target_language_code,
                speaker=speaker,
                model=model,
                enable_preprocessing=enable_preprocessing
            )
        else:
            # For longer texts
            return process_long_text(
                text, chunk_size, target_language_code, 
                speaker, model, enable_preprocessing
            )
    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        print(f"TTS exception: {e}\n{error_details}")
        return {"error": f"TTS service failed: {e}"}

def process_long_text(text, chunk_size, target_language_code, speaker, model, enable_preprocessing):
    """Process long text by splitting into chunks and combining the audio"""
    # Split text into chunks
    chunks = [text[i:i + chunk_size] for i in range(0, len(text), chunk_size)]
    print(f"Processing text in {len(chunks)} chunks")
    
    # WAV processing parameters
    all_audio_data = []
    sample_rate = None
    sample_width = None
    n_channels = None
    
    # Process each chunk
    for i, chunk in enumerate(chunks):
        try:
            chunk_result = tts_service.text_to_speech(
                text=chunk,
                target_language_code=target_language_code,
                speaker=speaker,
                model=model,
                enable_preprocessing=enable_preprocessing
            )
            
            if chunk_result and "audio_base64" in chunk_result:
                chunk_audio_bytes = base64.b64decode(chunk_result["audio_base64"])
                
                # Extract audio data from WAV
                with wave.open(io.BytesIO(chunk_audio_bytes), 'rb') as wf:
                    if sample_rate is None:
                        sample_rate = wf.getframerate()
                        sample_width = wf.getsampwidth()
                        n_channels = wf.getnchannels()
                    
                    audio_data = wf.readframes(wf.getnframes())
                    all_audio_data.append(audio_data)
                    print(f"Processed chunk {i+1}: {len(audio_data)} bytes")
            else:
                print(f"Warning: No audio data for chunk {i+1}")
                
        except Exception as e:
            print(f"Error processing chunk {i+1}: {e}")
    
    # Combine all audio chunks
    if all_audio_data and sample_rate:
        combined_audio_data = b''.join(all_audio_data)
        
        # Create WAV in memory
        wav_io = io.BytesIO()
        with wave.open(wav_io, 'wb') as wf:
            wf.setnchannels(n_channels)
            wf.setsampwidth(sample_width)
            wf.setframerate(sample_rate)
            wf.writeframes(combined_audio_data)
        
        # Get the final audio data and convert to base64
        wav_io.seek(0)
        combined_audio_bytes = wav_io.read()
        combined_audio_base64 = base64.b64encode(combined_audio_bytes).decode('utf-8')
        
        return {
            "success": True,
            "audio_base64": combined_audio_base64,
            "content_type": "audio/wav",
            "text_length": len(text),
            "chunks_processed": len(chunks)
        }
    else:
        raise Exception("Failed to generate audio chunks")
