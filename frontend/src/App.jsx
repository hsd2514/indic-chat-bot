import './index.css';
import { useEffect, useRef, useState } from "react";
import ChatWindow from "./components/ChatWindow";
import ChatInput from "./components/ChatInput";
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

function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [language, setLanguage] = useState("hi");
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef(null);
  const { t } = useTranslation();

  useEffect(() => {
    fetch("http://localhost:8000/messages")
      .then((res) => res.json())
      .then(setMessages);
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

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    const res = await fetch("http://localhost:8000/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sender: "user", text: input, language }),
    });
    const botReply = await res.json();
    setMessages((prev) => [
      ...prev,
      { sender: "user", text: input, language },
      botReply,
    ]);
    setInput("");
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

  return (
    <div className="min-h-screen flex flex-col items-center bg-base-200">
      {/* Navbar */}
      <nav className="navbar bg-primary text-primary-content shadow w-full rounded-none">
        <div className="flex-1">
          <span className="font-bold text-xl">{t("Indic Chat Bot")}</span>
        </div>
        <div className="flex-none">
          <select
            className="select select-bordered select-sm"
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
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
