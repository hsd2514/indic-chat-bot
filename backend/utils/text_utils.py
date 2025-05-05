import re

def strip_markdown(text):
    """Remove markdown formatting while preserving punctuation"""
    if not text:
        return ""
        
    # Remove bold and italic markers
    text = re.sub(r'\*\*(.*?)\*\*', r'\1', text)  # Bold
    text = re.sub(r'\*(.*?)\*', r'\1', text)      # Italic
    
    # Remove code blocks and inline code
    text = re.sub(r'```.*?```', '', text, flags=re.DOTALL)
    text = re.sub(r'`(.*?)`', r'\1', text)
    
    # Remove links but keep the text
    text = re.sub(r'\[(.*?)\]\(.*?\)', r'\1', text)
    
    # Remove headers but preserve the text
    text = re.sub(r'^#+\s+(.*)', r'\1', text, flags=re.MULTILINE)
    
    # Remove bullet markers but keep the text
    text = re.sub(r'^\s*[\*\-+]\s+', '', text, flags=re.MULTILINE)
    text = re.sub(r'^\s*\d+\.\s+', '', text, flags=re.MULTILINE)
    
    # Remove blockquotes but keep the text
    text = re.sub(r'^\s*>\s+(.*)', r'\1', text, flags=re.MULTILINE)
    
    # Remove horizontal rules
    text = re.sub(r'^\s*---+\s*$', '', text, flags=re.MULTILINE)
    
    # Normalize whitespace
    text = re.sub(r'\s+', ' ', text).strip()
    
    return text
