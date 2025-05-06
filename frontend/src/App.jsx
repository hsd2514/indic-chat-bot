import './index.css';
import { useEffect, useRef, useState } from "react";
import ChatWindow from "./components/ChatWindow";
import ChatInput from "./components/ChatInput";
import LiveScreenChat from "./components/LiveScreenChat";
import { useTranslation } from "react-i18next";
import i18n from "./i18n";

const LANGUAGES = [
  { code: "hi", name: "हिंदी" },
  { code: "en", name: "English" },
  { code: "ta", name: "தமிழ்" },
  { code: "bn", name: "বাংলা" },
  { code: "gu", name: "ગુજરાતી" },
  { code: "mr", name: "मराठी" },
  { code: "te", name: "తెలుగు" },
  { code: "kn", name: "ಕನ್ನಡ" },
  { code: "ml", name: "മലയാളം" },
  { code: "pa", name: "ਪੰਜਾਬੀ" },
];

// Chat modes
const CHAT_MODES = {
  STANDARD: 'standard',
  LIVE_SCREEN: 'liveScreen',
  FILE: 'file',
  SEARCH: 'search'  // Add new SEARCH mode
};

function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [language, setLanguage] = useState("hi");
  const [isTyping, setIsTyping] = useState(false);
  const [chatMode, setChatMode] = useState(CHAT_MODES.STANDARD);
  const messagesEndRef = useRef(null);
  const { t } = useTranslation();
  const [activePdfFile, setActivePdfFile] = useState(null);

  useEffect(() => {
    // Get initial messages with proper error handling
    const fetchInitialMessages = async () => {
      try {
        const res = await fetch("http://localhost:8000/messages");
        if (!res.ok) {
          console.error("Failed to fetch initial messages:", res.status);
          return;
        }
        const data = await res.json();
        setMessages(data);
      } catch (error) {
        console.error("Error fetching initial messages:", error);
      }
    };
    
    fetchInitialMessages();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    // fallback to English if language is not available in i18n
    if (!i18n.hasResourceBundle(language, "translation")) {
      i18n.changeLanguage("en");
    } else {
      i18n.changeLanguage(language);
    }
  }, [language]);

  const handleFileUpload = (fileName, fileId) => {
    setActivePdfFile({ name: fileName, id: fileId });
    setMessages((prev) => [
      ...prev,
      { 
        sender: "user", 
        text: `${t("Uploaded PDF")}: ${fileName}`, 
        language,
        pdfFile: { name: fileName, id: fileId } 
      },
      { 
        sender: "bot", 
        text: t("I've received your PDF. You can now ask questions about it."), 
        language 
      }
    ]);
  };

  const handleGoogleAIPDFQuery = async (input) => {
    // Only proceed if we have both input and an active PDF file
    if (!input.trim() || !activePdfFile) {
      return;
    }
    
    const userMessage = { 
      sender: "user", 
      text: input, 
      language,
      pdfQuery: true,
      usingGoogleAI: true
    };
    
    if (activePdfFile) {
      userMessage.pdfFile = activePdfFile;
    }
    
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsTyping(true);
    
    try {
      const res = await fetch(`http://localhost:8000/pdf_query_genai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          query: input, 
          file_id: activePdfFile.id, 
          language 
        }),
      });
      
      const botReply = await res.json();
      botReply.usingGoogleAI = true;
      
      setMessages((prev) => [...prev, botReply]);
    } catch (error) {
      console.error("Error sending message to Google AI:", error);
      setMessages((prev) => [
        ...prev,
        { 
          sender: "bot", 
          text: t("Sorry, there was an error processing your request with Google AI."), 
          language,
          usingGoogleAI: true
        }
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    
    // If PDF is active and we want to use Google AI 
    if (activePdfFile && e.shiftKey) {
      handleGoogleAIPDFQuery(input);
      return;
    }
    
    // Determine the current mode for the message
    let currentMode = chatMode;
    if (activePdfFile) {
      currentMode = CHAT_MODES.FILE;
    }
    
    // Original send message function continues
    const userMessage = { 
      sender: "user", 
      text: input, 
      language,
      mode: currentMode.toLowerCase() 
    };
    
    // If there's an active PDF file, include it in the message
    if (activePdfFile) {
      userMessage.pdfQuery = true;
      userMessage.pdfFile = activePdfFile;
      userMessage.file_id = activePdfFile.id;
    }
    
    // For search mode, add search indicator
    if (currentMode === CHAT_MODES.SEARCH) {
      userMessage.searchQuery = true;
    }
    
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsTyping(true);
    
    try {
      // Ensure we're sending exactly what the backend expects
      const requestBody = { 
        sender: "user", 
        text: input, 
        language,
        mode: currentMode.toLowerCase()
      };
      
      // Only add file_id if it exists
      if (activePdfFile) {
        requestBody.file_id = activePdfFile.id;
      }
      
      // Use the messages endpoint with the correct mode
      const res = await fetch(`http://localhost:8000/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      
      if (!res.ok) {
        throw new Error(`Server responded with status: ${res.status}`);
      }
      
      const botReply = await res.json();
      
      // If quotaExceeded flag is present, show a user-friendly toast message
      if (botReply.quotaExceeded || botReply.fallbackFromSearch) {
        // You could add a toast notification here
        console.warn("Search API quota exceeded, using fallback response");
      }
      
      setMessages((prev) => [...prev, botReply]);
    } catch (error) {
      console.error("Error sending message:", error);
      
      // Special handling for search mode errors
      if (currentMode === CHAT_MODES.SEARCH) {
        // Fall back to standard mode
        setMessages((prev) => [
          ...prev,
          { 
            sender: "bot", 
            text: t("Search service is currently unavailable. I'll try to answer with my existing knowledge instead."), 
            language,
            mode: "standard"
          }
        ]);
        
        // Silently retry in standard mode
        try {
          const standardRes = await fetch(`http://localhost:8000/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
              sender: "user", 
              text: input, 
              language,
              mode: "standard"
            }),
          });
          
          if (standardRes.ok) {
            const fallbackReply = await standardRes.json();
            setMessages((prev) => [...prev, fallbackReply]);
          }
        } catch (fallbackError) {
          console.error("Fallback also failed:", fallbackError);
        }
      } else {
        // Standard error handling for non-search modes
        setMessages((prev) => [
          ...prev,
          { 
            sender: "bot", 
            text: t("Sorry, there was an error processing your request."), 
            language 
          }
        ]);
      }
    } finally {
      setIsTyping(false);
    }
  };

  const handleVoiceEnd = (voiceText, botText) => {
    if (!voiceText) {
      setIsTyping(false);
      return;
    }
    setMessages((prev) => [
      ...prev,
      { sender: "user", text: voiceText, language },
    ]);
    setIsTyping(true);
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        { sender: "bot", text: botText, language },
      ]);
      setIsTyping(false);
    }, 800);
    setInput("");
  };

  const toggleChatMode = (mode) => {
    if (mode !== chatMode) {
      setChatMode(mode);
      
      // If switching to file mode and no active PDF, show a message
      if (mode === CHAT_MODES.FILE && !activePdfFile) {
        setMessages([{ 
          sender: "bot", 
          text: t("Please upload a PDF file to start querying."), 
          language 
        }]);
      } 
      // If switching to search mode, show a simple activation message
      else if (mode === CHAT_MODES.SEARCH) {
        setMessages([{ 
          sender: "bot", 
          text: t("Search mode activated."), 
          language 
        }]);
      }
      // If switching away from file mode, clear activePdfFile
      else if (mode !== CHAT_MODES.FILE && activePdfFile) {
        setActivePdfFile(null);
      }
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center bg-base-200">
      {/* Navbar */}
      <nav className="navbar bg-primary text-primary-content shadow w-full rounded-none">
        <div className="navbar-start">
          <span className="font-bold text-xl">{t("Indic Chat Bot")}</span>
        </div>
        
        {/* Centered Tab Bar */}
        <div className="navbar-center">
          <div className="tabs tabs-boxed bg-primary-content/10 p-1 rounded-box">
            <button 
              className={`tab ${chatMode === CHAT_MODES.STANDARD ? 'tab-active bg-primary text-primary-content' : 'text-primary-content/80'}`}
              onClick={() => toggleChatMode(CHAT_MODES.STANDARD)}
            >
              {t("Standard Chat")}
            </button>
            <button 
              className={`tab ${chatMode === CHAT_MODES.FILE ? 'tab-active bg-primary text-primary-content' : 'text-primary-content/80'}`}
              onClick={() => toggleChatMode(CHAT_MODES.FILE)}
            >
              {t("File Chat")}
            </button>
            <button 
              className={`tab ${chatMode === CHAT_MODES.SEARCH ? 'tab-active bg-primary text-primary-content' : 'text-primary-content/80'}`}
              onClick={() => toggleChatMode(CHAT_MODES.SEARCH)}
            >
              {t("Web Search")}
            </button>
            <button 
              className={`tab ${chatMode === CHAT_MODES.LIVE_SCREEN ? 'tab-active bg-primary text-primary-content' : 'text-primary-content/80'}`}
              onClick={() => toggleChatMode(CHAT_MODES.LIVE_SCREEN)}
            >
              {t("Live Screen")}
            </button>
          </div>
        </div>
        
        <div className="navbar-end">
          {/* Language Selector */}
          <select
            className="select select-sm select-ghost text-primary-content"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          >
            {LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.name}
              </option>
            ))}
          </select>
        </div>
      </nav>

      {/* Chat Card */}
      <main className="flex-1 flex flex-col items-center w-full">
        <div className="card bg-base-100 shadow-xl w-full max-w-5xl my-8 min-h-[85vh]">
          <div className="card-body flex flex-col p-0 h-[80vh] md:h-[85vh]">
            {chatMode !== CHAT_MODES.LIVE_SCREEN ? (
              <>
                <div className="flex-1 overflow-y-auto px-2 py-4">
                  <ChatWindow
                    messages={
                      isTyping
                        ? [
                            ...messages,
                            {
                              sender: "bot",
                              text: `<span class="loading loading-dots loading-md"></span>`,
                              language,
                            },
                          ]
                        : messages
                    }
                    messagesEndRef={messagesEndRef}
                    activePdfFile={activePdfFile}
                  />
                </div>
                <div className="border-t border-base-300">
                  <ChatInput
                    input={input}
                    setInput={setInput}
                    onSend={sendMessage}
                    t={t}
                    language={language}
                    onVoiceStart={() => setIsTyping(true)}
                    onVoiceEnd={handleVoiceEnd}
                    onFileUpload={handleFileUpload}
                    activePdfFile={activePdfFile}
                    fileMode={chatMode === CHAT_MODES.FILE}
                    searchMode={chatMode === CHAT_MODES.SEARCH}
                  />
                </div>
              </>
            ) : (
              <LiveScreenChat language={language} />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
