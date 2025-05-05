import os
from google import genai

def init_llm():
    """Initialize the LLM service"""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("Warning: GEMINI_API_KEY not set. Using fallback responses.")
        return None
    
    client = genai.Client(api_key=api_key)
    return client

def generate_reply(model, user_text, language_code):
    """Generate a reply using LLM in the specified language"""
    if not model:
        return f"आपने कहा: {user_text}"
        
    lang_map = {
        "hi": "हिंदी", "en": "English", "ta": "तमिल", "bn": "বাংলা",
        "gu": "ગુજરાતી", "mr": "मराठी", "te": "తెలుగు", "kn": "ಕನ್ನಡ",
        "ml": "മലയാളം", "pa": "ਪੰਜਾਬੀ",
    }
    
    lang_name = lang_map.get(language_code, "हिंदी")
    prompt = f"Reply in {lang_name} and help the user. User said: {user_text}"
    
    try:
        response = model.models.generate_content(
            model='gemini-2.0-flash-001',
            contents=prompt
        )
        bot_text = getattr(response, "text", None)
        if not bot_text:
            bot_text = "API did not return a valid response."
    except Exception as e:
        bot_text = f"API error: {e}"
        
    return bot_text
