import { marked } from "marked";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import AudioMessage from "./AudioMessage";

// Helper function to strip markdown
function stripMarkdown(text) {
  if (!text) return '';
  
  // Simple function to remove common markdown formatting
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`(.*?)`/g, '$1')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/^#+\s+(.*)/gm, '$1')
    .replace(/^[\*\-+]\s+(.*)/gm, '$1')
    .replace(/^\d+\.\s+(.*)/gm, '$1')
    .replace(/^\>\s+(.*)/gm, '$1')
    .replace(/---+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function ChatWindow({ messages, messagesEndRef, activePdfFile }) {
  const { t } = useTranslation();
  const [isPlaying, setIsPlaying] = useState(false);
  const [messageAudio, setMessageAudio] = useState({});

  const playTTS = async (text, language, messageId) => {
    try {
      setIsPlaying(true);
      const cleanText = stripMarkdown(text);
      const languageCodeMap = {
        "hi": { code: "hi-IN", speaker: "meera" },
        "en": { code: "en-IN", speaker: "arjun" },
        "ta": { code: "ta-IN", speaker: "maitreyi" },
        "bn": { code: "bn-IN", speaker: "amartya" },
        "gu": { code: "gu-IN", speaker: "meera" },
        "mr": { code: "mr-IN", speaker: "amol" },
        "te": { code: "te-IN", speaker: "arvind" },
        "kn": { code: "kn-IN", speaker: "maya" },
        "ml": { code: "ml-IN", speaker: "diya" },
        "pa": { code: "pa-IN", speaker: "neel" },
      };
      const langInfo = languageCodeMap[language] || languageCodeMap["hi"];
      const res = await fetch("http://localhost:8000/tts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8"
        },
        body: JSON.stringify({
          text: cleanText,
          language: language || "hi",
          target_language_code: langInfo.code,
          speaker: langInfo.speaker,
          model: "bulbul:v1",
          enable_preprocessing: true
        }),
      });
      if (!res.ok) {
        throw new Error(`TTS error: ${await res.text()}`);
      }
      const data = await res.json();
      if (data.audio_base64) {
        setMessageAudio(prev => ({
          ...prev,
          [messageId]: data.audio_base64
        }));
      } else {
        throw new Error("No audio data received");
      }
    } catch (e) {
      console.error("TTS error:", e);
      alert(`Could not create audio: ${e.message || 'Unknown error'}`);
    } finally {
      setIsPlaying(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {messages.length === 0 ? (
        <div className="hero min-h-[40vh]">
          <div className="hero-content text-center">
            <div className="max-w-md">
              <h1 className="text-5xl font-bold">{t("Welcome")}</h1>
              <p className="py-6">{t("Start a conversation in your preferred language.")}</p>
              <div className="badge badge-primary badge-lg">{t("Indic Chat Bot")}</div>
            </div>
          </div>
        </div>
      ) : (
        messages.map((msg, idx) => (
          <div 
            key={idx} 
            className={`chat ${msg.sender === "user" ? "chat-end" : "chat-start"} gap-2`}
          >
            {/* Bot name above bubble, aligned left for bot */}
            {msg.sender === "bot" && (
              <div className="flex w-full">
                <span className="chat-header text-xs opacity-70 flex items-center gap-2">{t("Bot")}</span>
              </div>
            )}
            {/* User name above bubble, aligned right for user */}
            {msg.sender === "user" && (
              <div className="flex w-full justify-end">
                <span className="chat-header text-xs opacity-70 flex items-center gap-2">{t("You")}</span>
              </div>
            )}
            <div>
              <div
                className={`chat-bubble ${msg.sender === "user" ? "chat-bubble-primary" : "chat-bubble-secondary"} text-base`}
                dangerouslySetInnerHTML={{ __html: marked.parse(msg.text || "") }}
              />
              {/* Show PDF file indicator if present */}
              {msg.pdfFile && (
                <div className="mt-2 flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-error" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="text-xs opacity-70">
                    {msg.pdfFile.name} 
                    {msg.usingGoogleAI && (
                      <span className="badge badge-xs badge-success ml-2">{t("Google AI")}</span>
                    )}
                  </span>
                </div>
              )}
              
              {/* Show search query indicator if present */}
              {msg.searchQuery && msg.sender === "user" && (
                <div className="mt-2 flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-info" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <span className="badge badge-xs badge-info">{t("Web Search")}</span>
              </div>
            )}
              
              {/* Show PDF query indicator if present */}
              {msg.pdfQuery && (
                <div className="mt-2">
                  <span className="badge badge-sm">{t("PDF Query")}</span>
                  {msg.usingGoogleAI && (
                    <span className="badge badge-sm badge-success ml-2">{t("Google AI")}</span>
                  )}
                </div>
              )}
              {/* Show screenshot image if present */}
              {msg.image && (
                <div className="mt-2">
                  <img
                    src={msg.image}
                    alt="Shared screen"
                    className="max-w-xs max-h-48 rounded border border-base-300"
                  />
                </div>
              )}
              {/* Only show the icon button below the bubble for bot messages */}
              {msg.sender === "bot" && msg.text && !messageAudio[idx] && (
                <div className="flex mt-2">
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => playTTS(msg.text, msg.language || "hi", idx)}
                    disabled={isPlaying}
                    aria-label={t("Generate Audio")}
                  >
                    {/* Speaker SVG icon */}
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M9 9H5a2 2 0 00-2 2v2a2 2 0 002 2h4l5 5V4l-5 5z" />
                    </svg>
                    {isPlaying && (
                      <span className="loading loading-spinner loading-xs"></span>
                    )}
                  </button>
                </div>
              )}
              {messageAudio[idx] && (
                <div className="audio-message mt-2">
                  <AudioMessage 
                    audioData={messageAudio[idx]} 
                    text={msg.text}
                  />
                </div>
              )}
            </div>
          </div>
        ))
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}

export default ChatWindow;


