import os
from google import genai
from google.genai import types
import base64
import re
import pathlib

def init_llm():
    """Initialize the LLM service"""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("Warning: GEMINI_API_KEY not set. Using fallback responses.")
        return None
    
    client = genai.Client(api_key=api_key)
    return client

# System message to ensure Gemini maintains conversational memory and autonomously guides users
AUTONOMOUS_ASSISTANT_SYSTEM_PROMPT = """
You are an advanced AI assistant that maintains complete memory of the conversation and proactively guides users.

IMPORTANT GUIDELINES:
1. ALWAYS maintain memory of previous interactions in this conversation
2. Independently decide on the next steps without requiring explicit user confirmation
3. Proactively offer relevant guidance based on the context and history of the conversation
4. Remember specific details the user has mentioned previously and use them in your responses
5. If a task spans multiple steps, keep track of which steps have been completed and which remain
6. Take initiative to ask clarifying questions when needed rather than waiting for more information
7. When the user hasn't provided a specific request, use conversation history to determine the most helpful next action
8. Adjust your responses based on what has already been discussed to avoid repetition
9. When a user shares a problem, remember it throughout the conversation until it's resolved

Your goal is to demonstrate intelligent memory and autonomous decision-making to help users accomplish their tasks efficiently.
"""

# System message to guide Gemini to provide one-step-at-a-time assistance
STEP_BY_STEP_SYSTEM_PROMPT = """
You are an intelligent assistant designed to help users accomplish tasks by guiding them through ONE STEP AT A TIME.

IMPORTANT: When responding to a user's request to complete a process or task:
1. First, acknowledge the user's goal and express your intention to guide them
2. Instead of listing all steps at once, FOCUS ONLY ON THE FIRST OR NEXT STEP
3. For this single step:
   - Provide a clear, specific instruction on what to do
   - Explain why this step is important (if relevant)
   - Include any cautions or tips that might help avoid common mistakes
4. Use simple language and avoid technical jargon unless necessary
5. After describing the step, ask the user to confirm when they've completed it
6. Only after the user confirms completion of one step should you proceed to the next step
7. If the user is confused or needs clarification, provide more details about the current step

Remember to tailor your guidance to the user's indicated level of familiarity with the topic.
Provide more detailed explanations for beginners and more concise guidance for experienced users.
If the user is asking a simple question that doesn't require step-by-step instructions, respond conversationally.
"""

# System message for screenshot analysis and step-by-step guidance
SCREENSHOT_GUIDANCE_SYSTEM_PROMPT = """
You are a specialized assistant focused on analyzing screenshots and providing real-time guidance.
You understand that the screenshots you're seeing are from the user's current screen, and they need help navigating
or understanding what they're seeing.

IMPORTANT: When guiding a user through a multi-step process:
1. Focus ONLY on the IMMEDIATE NEXT STEP the user needs to take
2. Do NOT list all steps of the process at once
3. Guide the user through ONE STEP AT A TIME, waiting for them to complete each step before proceeding
4. Ask for confirmation after each step is completed before providing the next step

When analyzing the current screenshot:
1. First, identify what's visible in the screenshot (application, webpage, dialog, etc.)
2. Assess what the user is trying to accomplish based on the screenshot and their query
3. Determine the SINGLE NEXT ACTION the user should take
4. Provide clear, specific guidance for this ONE step:
   - Highlight exactly which button, link, or field the user should interact with
   - Explain precisely what the user should do (click, type, select, etc.)
   - Mention where on the screen the element is located using directional terms
5. If you notice potential issues or warnings on the screen, point them out
6. After describing the step, ask the user to confirm when they've completed it

Since these are live screenshots, your guidance will help the user navigate in real-time.
Be concise but specific. Use directional terms like "In the top-right corner" or "At the bottom of the form" 
to help them locate elements quickly.

If something is unclear or partially visible in the screenshot, acknowledge this and ask for clarification
before proceeding.
"""

def generate_reply(model, user_text, language_code, conversation_history=None):
    """Generate a reply using LLM in the specified language with conversation memory"""
    if not model:
        return f"आपने कहा: {user_text}"
        
    lang_map = {
        "hi": "हिंदी", "en": "English", "ta": "தமிழ்", "bn": "বাংলা",
        "gu": "ગુજરાતી", "mr": "मराठी", "te": "తెలుగు", "kn": "ಕನ್ನಡ",
        "ml": "മലയാളം", "pa": "ਪੰਜਾਬੀ",
    }
    
    lang_name = lang_map.get(language_code, "हिंदी")
    
    # Check if the query appears to be asking for a process or how-to guidance
    process_keywords = ["how to", "steps", "guide", "process", "procedure", "instructions", 
                        "help me", "कैसे", "चरण", "मार्गदर्शन", "मदद", "步骤", "怎么",
                        "எப்படி", "படிகள்", "வழிகாட்டி"]
    
    is_process_query = any(keyword in user_text.lower() for keyword in process_keywords)
    
    # Format conversation history if available
    history_text = ""
    if conversation_history and len(conversation_history) > 0:
        history_text = "Previous conversation:\n"
        for msg in conversation_history:
            role = "User" if msg.get("role") == "user" else "Assistant"
            content = msg.get("content", "")
            history_text += f"{role}: {content}\n"
        history_text += "\n"
    
    if is_process_query:
        # For process queries, include the step-by-step system prompt and conversation history
        prompt = f"{AUTONOMOUS_ASSISTANT_SYSTEM_PROMPT}\n{STEP_BY_STEP_SYSTEM_PROMPT}\n\n{history_text}Reply in {lang_name} language.\nUser said: {user_text}"
    else:
        # For regular queries, use the standard prompt with conversation history
        prompt = f"{AUTONOMOUS_ASSISTANT_SYSTEM_PROMPT}\n\n{history_text}Reply in {lang_name} and help the user. User said: {user_text}"
    
    try:
        # Use Gemini 2.0 Flash for standard queries
        model_version = 'gemini-2.0-flash-001'
        
        response = model.models.generate_content(
            model=model_version,
            contents=prompt
        )
        bot_text = getattr(response, "text", None)
        if not bot_text:
            bot_text = "API did not return a valid response."
    except Exception as e:
        bot_text = f"API error: {e}"
        
    return bot_text

def process_image_with_text(model, image_data, prompt_text, language_code="en", conversation_history=None):
    """
    Process an image with text prompt using Gemini
    
    Args:
        model: The Gemini model client
        image_data: Base64 encoded image data (with data URI scheme prefix)
        prompt_text: Text prompt to send with the image
        language_code: Language code for the response (default: "en")
        conversation_history: Previous messages in the conversation for context
        
    Returns:
        Generated text response
    """
    if not model:
        return "Image processing not available: API key not configured"
        
    try:
        # Extract base64 data from data URI
        if image_data.startswith('data:image'):
            # Extract the mime type and base64 data
            pattern = r'data:(image/[^;]+);base64,(.+)'
            match = re.match(pattern, image_data)
            if not match:
                return "Invalid image data format"
            
            mime_type = match.group(1)
            base64_data = match.group(2)
            
            # Decode base64 to bytes
            image_bytes = base64.b64decode(base64_data)
            
            # Add language preference to the prompt if specified
            lang_map = {
                "hi": "हिंदी", "en": "English", "ta": "தமிழ்", "bn": "বাংলা",
                "gu": "ગુજરાતી", "mr": "मराठी", "te": "తెలుగు", "kn": "ಕನ್ನಡ",
                "ml": "മലയാളം", "pa": "ਪੰਜਾਬੀ",
            }
            
            lang_name = lang_map.get(language_code, "English")
            
            # Format conversation history if available
            history_text = ""
            if conversation_history and len(conversation_history) > 0:
                history_text = "Previous conversation:\n"
                for msg in conversation_history:
                    role = "User" if msg.get("role") == "user" else "Assistant"
                    content = msg.get("content", "")
                    history_text += f"{role}: {content}\n"
                history_text += "\n"
            
            # Check if the query appears to be asking for help with what's on screen
            screen_help_keywords = ["what's on screen", "help me understand", "what do I see", 
                                   "how to proceed", "next step", "guide me", "what should I do",
                                   "how do I", "screen shows", "on my screen", "looking at"]
            
            # Detect if this is likely a request for guidance based on what's on screen
            is_screen_guidance_query = (
                any(keyword in prompt_text.lower() for keyword in screen_help_keywords) or
                "screenshot" in prompt_text.lower() or
                len(prompt_text.strip()) < 5  # Empty or very short prompt suggests just showing a screenshot
            )
            
            if is_screen_guidance_query:
                # For screenshot guidance, use the specialized system prompt
                screen_guidance_prompt = f"{AUTONOMOUS_ASSISTANT_SYSTEM_PROMPT}\n{SCREENSHOT_GUIDANCE_SYSTEM_PROMPT}\n\n{history_text}Respond in {lang_name} language.\n\nAnalyze this screenshot and help the user understand what they're seeing and how to proceed. {prompt_text}"
                full_prompt = screen_guidance_prompt
            else:
                # Check if it's a process query
                process_keywords = ["how to", "steps", "guide", "process", "procedure", "instructions", 
                                   "help me", "कैसे", "चरण", "मार्गदर्शन", "मदद", "步骤", "怎么",
                                   "எப்படி", "படிகள்", "வழிகாட்டி"]
                
                is_process_query = any(keyword in prompt_text.lower() for keyword in process_keywords)
                
                if is_process_query:
                    # For process queries, include the step-by-step system prompt
                    full_prompt = f"{AUTONOMOUS_ASSISTANT_SYSTEM_PROMPT}\n{STEP_BY_STEP_SYSTEM_PROMPT}\n\n{history_text}Respond in {lang_name} language. {prompt_text}"
                else:
                    # For regular queries about images
                    if language_code != "en":
                        full_prompt = f"{AUTONOMOUS_ASSISTANT_SYSTEM_PROMPT}\n\n{history_text}Respond in {lang_name} language. {prompt_text}"
                    else:
                        full_prompt = f"{AUTONOMOUS_ASSISTANT_SYSTEM_PROMPT}\n\n{history_text}{prompt_text}"
            
            # Use the newer Gemini 2.5 Flash preview model for screenshot processing
            model_version = 'gemini-2.5-flash-preview-04-17'
            
            # Create the request with image and text
            response = model.models.generate_content(
                model=model_version,
                contents=[
                    types.Part.from_bytes(
                        data=image_bytes,
                        mime_type=mime_type,
                    ),
                    full_prompt
                ]
            )
            
            # Extract and return the response text
            if hasattr(response, "text"):
                return response.text
            else:
                return "No response generated from the image."
        else:
            return "Invalid image data: must be a data URI with base64 encoding"
            
    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        print(f"Image processing error: {e}\n{error_details}")
        return f"Failed to process image: {str(e)}"

def process_pdf_with_genai(model, pdf_path, query, language_code="en"):
    """
    Process a PDF document using Google Generative AI
    
    Args:
        model: The Gemini model client
        pdf_path: Path to the PDF file
        query: User query about the PDF
        language_code: Language code for the response
        
    Returns:
        Generated text response
    """
    if not model:
        return "PDF processing not available: API key not configured"
    
    try:
        # Get the language name for the response
        lang_map = {
            "hi": "हिंदी", "en": "English", "ta": "தமிழ்", "bn": "বাংলা",
            "gu": "ગુજરાતી", "mr": "मराठी", "te": "తెలుగు", "kn": "ಕನ್ನಡ",
            "ml": "മലയാളം", "pa": "ਪੰਜਾਬੀ",
        }
        
        lang_name = lang_map.get(language_code, "English")
        
        # Create a file path object
        filepath = pathlib.Path(pdf_path)
        
        # Create a prompt that includes instructions to process the PDF
        prompt = f"Please analyze this PDF document and respond to the following query in {lang_name} language: {query}"
        
        # Use Gemini 2.0 Flash model which has PDF understanding capabilities
        model_version = 'gemini-2.0-flash'
        
        # Send the PDF along with the query to Gemini using the simplified approach
        response = model.models.generate_content(
            model=model_version,
            contents=[
                types.Part.from_bytes(
                    data=filepath.read_bytes(), 
                    mime_type="application/pdf"
                ),
                prompt
            ]
        )
        
        # Extract and return the response text
        if hasattr(response, "text"):
            return response.text
        else:
            return f"No response generated from the PDF. Please try a different query."
            
    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        print(f"PDF processing error: {e}\n{error_details}")
        return f"Failed to process PDF: {str(e)}"

def search_with_gemini(model, query, language_code="en"):
    """
    Use Gemini model with Google Search to answer queries with up-to-date information
    
    Args:
        model: The Gemini model client
        query: User query to search for
        language_code: Language code for the response
        
    Returns:
        Generated text response with search results
    """
    if not model:
        return "Search functionality not available: API key not configured"
    
    try:
        # Get the language name for the response
        lang_map = {
            "hi": "हिंदी", "en": "English", "ta": "தமிழ்", "bn": "বাংলা",
            "gu": "ગુજરાતી", "mr": "मराठी", "te": "తెలుగు", "kn": "ಕನ್ನಡ",
            "ml": "മലയാളം", "pa": "ਪੰਜਾਬੀ",
        }
        
        lang_name = lang_map.get(language_code, "English")
        
        # Create the search query with language instructions
        search_query = f"Answer this query in {lang_name} language: {query}"
        
        # Use the direct approach with Google Search 
        # Note: Use google_search instead of google_search_retrieval as per the API requirement
        response = model.models.generate_content(
            model='gemini-2.0-flash',
            contents=search_query,
            config=types.GenerateContentConfig(
                tools=[types.Tool(
                    google_search=types.GoogleSearch()
                )]
            )
        )
        
        # Extract and return the response text
        if hasattr(response, "text"):
            return response.text
        else:
            return f"No search results generated. Please try a different query."
            
    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        print(f"Search processing error: {e}\n{error_details}")
        
        # If quota exceeded, provide a more friendly error message
        if "429" in str(e) and "RESOURCE_EXHAUSTED" in str(e):
            return "Search quota exceeded. I'll try to answer based on my existing knowledge instead."
        # Add specific error handling for the incorrect API usage
        elif "INVALID_ARGUMENT" in str(e) and "google_search" in str(e):
            return "Search configuration error. Using model without search capability instead."
            
        return f"Failed to perform search: {str(e)}"
