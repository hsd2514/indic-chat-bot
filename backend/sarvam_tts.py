import requests
import base64
import re
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

class SarvamTTS:
    """
    Class to handle Text-to-Speech conversion using the Sarvam AI API.
    """
    def __init__(self):
        self.api_key = os.getenv("SARVAM_AI_API_KEY")
        self.url = "https://api.sarvam.ai/text-to-speech"
        self.headers = {
            "Content-Type": "application/json",
            "api-subscription-key": self.api_key
        }
    
    def preprocess_text(self, text):
        """
        Preprocess text to handle numbers and special characters.
        """
        # Format numbers with commas for better pronunciation
        # Find numbers with 5+ digits and add commas
        return re.sub(r'(\d{5,})', lambda m: f"{int(m.group(0)):,}", text)
    
    def split_text(self, text, chunk_size=500):
        """
        Split text into chunks of specified size.
        """
        chunks = [text[i:i + chunk_size] for i in range(0, len(text), chunk_size)]
        print(f"Split text into {len(chunks)} chunks")
        return chunks
    
    def text_to_speech(self, text, target_language_code="hi-IN", speaker="meera", model="bulbul:v1", 
                      enable_preprocessing=True, pitch=0, pace=1.0, loudness=1.0):
        """
        Convert text to speech using Sarvam AI API.
        
        Args:
            text (str): Text to convert to speech (max 500 characters)
            target_language_code (str): Target language code (e.g., "hi-IN")
            speaker (str): Speaker voice to use. Available speakers for bulbul:v1 are:
                           meera, pavithra, maitreyi, amol, amartya, arvind, maya, arjun, diya, neel, misha, vian
            model (str): Model to use
            enable_preprocessing (bool): Enable text preprocessing
            pitch (int): Pitch adjustment
            pace (float): Speed of speech
            loudness (float): Volume adjustment
            
        Returns:
            dict: Response containing base64 encoded audio
        """
        # Strip any remaining markdown formatting that might have been missed
        text = self.strip_markdown(text)
        
        # Preprocess text if needed
        if enable_preprocessing:
            text = self.preprocess_text(text)
        
        # Ensure we're within the API's 500 character limit
        if len(text) > 500:
            text = text[:497] + "..."
            print(f"Warning: Truncating chunk to 500 characters for API limit")
        
        # Process the text directly
        payload = {
            "inputs": [text],
            "target_language_code": target_language_code,
            "speaker": speaker,
            "model": model,
            "pitch": pitch,
            "pace": pace,
            "loudness": loudness,
            "enable_preprocessing": enable_preprocessing,
        }
        
        # Make the API request
        response = requests.post(self.url, json=payload, headers=self.headers)
        
        # Check if the request was successful
        if response.status_code == 200:
            audio_response = response.json()
            if "audios" in audio_response and audio_response["audios"]:
                # Get the base64-encoded audio
                audio_base64 = audio_response["audios"][0]
                print(f"Generated audio for chunk: {len(audio_base64)} bytes in base64")
                
                return {
                    "success": True,
                    "audio_base64": audio_base64,
                    "content_type": "audio/wav",
                    "text_length": len(text)
                }
            else:
                raise Exception(f"No audio data in response: {audio_response}")
        else:
            raise Exception(f"API error: {response.status_code} - {response.text}")
    
    def strip_markdown(self, text):
        """
        Remove markdown formatting from text for better TTS results.
        """
        if not text:
            return ""
            
        # Remove formatting markers
        text = re.sub(r'\*\*(.*?)\*\*', r'\1', text)  # Bold
        text = re.sub(r'\*(.*?)\*', r'\1', text)      # Italic
        text = re.sub(r'`(.*?)`', r'\1', text)        # Inline code
        text = re.sub(r'```.*?```', '', text, flags=re.DOTALL)  # Code blocks
        text = re.sub(r'\[(.*?)\]\(.*?\)', r'\1', text)  # Links
        text = re.sub(r'^#+\s+(.*)', r'\1', text, flags=re.MULTILINE)  # Headers
        text = re.sub(r'^\s*[\*\-+]\s+', '', text, flags=re.MULTILINE)  # Bullet points
        text = re.sub(r'^\s*\d+\.\s+', '', text, flags=re.MULTILINE)  # Numbered lists
        text = re.sub(r'^\>\s+', '', text, flags=re.MULTILINE)  # Blockquotes
        
        # Clean up whitespace
        text = re.sub(r'\s+', ' ', text).strip()
        
        return text

# Example usage
if __name__ == "__main__":
    tts = SarvamTTS()
    result = tts.text_to_speech(
        "नमस्ते! मैं आपकी कैसे मदद कर सकता हूँ?",
        target_language_code="hi-IN",
        speaker="anushka"
    )
    print(f"Generated audio of size: {len(result['audio_base64'])}")
