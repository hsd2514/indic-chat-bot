import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { marked } from 'marked';
import AudioMessage from './AudioMessage';
import ScreenSharePanel from './ScreenSharePanel';
import { startAudioCapture, stopAudioCapture, playPcmChunk, stopPlayback } from '../utils/liveAudioHelper';
import { startScreenCapture, stopScreenCapture, captureScreenshot, cleanupScreenCapture, isScreenSharingActive } from '../utils/screenCaptureHelper';

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

const WEBSOCKET_URL = "ws://localhost:8000/ws/live";

function LiveScreenChat({ language = "en" }) {
  const { t } = useTranslation();
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [error, setError] = useState(null);
  const [currentScreenshot, setCurrentScreenshot] = useState(null);
  const [messageAudio, setMessageAudio] = useState({});
  const [audioLoadingId, setAudioLoadingId] = useState(null);
  const [audioError, setAudioError] = useState({});
  const [isVoiceRecording, setIsVoiceRecording] = useState(false);
  const [isVoiceLoading, setIsVoiceLoading] = useState(false);
  const ws = useRef(null);
  const messagesEndRef = useRef(null);
  const screenshotInterval = useRef(null);
  const screenshotRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  const addMessage = useCallback((sender, text, image = null, isSystem = false, isError = false) => {
    const messageId = new Date().toISOString();
    setMessages(prev => [...prev, { 
      id: messageId,
      sender, 
      text, 
      image,
      timestamp: messageId, 
      isSystem, 
      isError,
      language
    }]);
    
    // Automatically generate audio for bot messages
    if (sender === 'Bot' && !isSystem && !isError && text) {
      playTTS(text, language, messageId);
    }
    
    return messageId;
  }, [language]);

  // TTS functionality
  const playTTS = async (text, language, messageId) => {
    try {
      setAudioLoadingId(messageId);
      setAudioError(prev => ({ ...prev, [messageId]: null }));
      
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
        const errorText = await res.text();
        throw new Error(`TTS error: ${errorText}`);
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
      setAudioError(prev => ({ 
        ...prev, 
        [messageId]: e.message || 'Unknown error' 
      }));
    } finally {
      setAudioLoadingId(null);
    }
  };

  // Voice input functionality
  const sendAudioToWhisper = async (audioBlob) => {
    setIsVoiceLoading(true);
    
    const formData = new FormData();
    formData.append("audio", audioBlob, "audio.webm");

    try {
      const res = await fetch(`http://localhost:8000/whisper?language=${language}`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      // Remove setting input text - we don't want to put text in input box
      // if (data.text) {
      //   setInputText(data.text);
      // }
      
      // If data.bot is available, it means the server processed the request and returned a bot response
      if (data.text && ws.current?.readyState === WebSocket.OPEN) {
        // Send recognized text to websocket
        ws.current.send(JSON.stringify({ 
          type: "text", 
          data: data.text,
          language: language,
          hasScreenshot: !!screenshotRef.current
        }));
        
        // Display user's message with screenshot in the chat
        addMessage('You', data.text, screenshotRef.current);
        
        // Send screenshot as a separate message if available
        if (screenshotRef.current) {
          ws.current.send(JSON.stringify({ 
            type: "screenshot", 
            data: screenshotRef.current,
            language: language
          }));
        }
      }
    } catch (error) {
      console.error("Speech recognition error:", error);
      alert("Failed to process speech. Please try again.");
    } finally {
      setIsVoiceLoading(false);
    }
  };

  const handleVoice = async () => {
    if (isVoiceRecording) {
      setIsVoiceRecording(false);
      mediaRecorderRef.current.stop();
      return;
    }

    setIsVoiceRecording(true);
    audioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new window.MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        await sendAudioToWhisper(audioBlob);
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
    } catch (err) {
      setIsVoiceRecording(false);
      alert("Microphone access denied or not supported.");
    }
  };

  // Scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // WebSocket connection logic
  const connectWebSocket = useCallback(() => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      console.log("WebSocket already open.");
      return;
    }
    if (isConnecting) {
        console.log("WebSocket connection attempt already in progress.");
        return;
    }

    setIsConnecting(true);
    setError(null);
    addMessage('System', t('Connecting...'), null, true);
    setMessages([]); // Clear previous messages on new connection attempt

    ws.current = new WebSocket(WEBSOCKET_URL);
    ws.current.binaryType = 'arraybuffer'; // Expecting raw audio bytes

    ws.current.onopen = () => {
      console.log("WebSocket Connected");
      setIsConnected(true);
      setIsConnecting(false);
      addMessage('System', t('Live Mode with Screen Sharing'), null, true);
      
      // Remove automatic audio capture start
      // startAudioRecording();
    };

    ws.current.onclose = (event) => {
      console.log("WebSocket Disconnected:", event.reason, event.code);
      setIsConnected(false);
      setIsConnecting(false);
      setIsRecording(false);
      setIsScreenSharing(false);
      stopScreenCapture();
      stopAudioCapture();
      stopPlayback();
      
      if (!event.wasClean) {
        setError(t('Disconnected') + `: ${event.reason || 'Connection lost'}`);
        addMessage('System', t('Disconnected') + `: ${event.reason || 'Connection lost'}`, null, true, true);
      } else {
         addMessage('System', t('Disconnected'), null, true);
      }
      ws.current = null;
    };

    ws.current.onerror = (err) => {
      console.error("WebSocket Error:", err);
      setError(t('Error') + ': ' + t('WebSocket connection failed.'));
      addMessage('System', t('Error') + ': ' + t('WebSocket connection failed.'), null, true, true);
      setIsConnected(false);
      setIsConnecting(false);
      setIsRecording(false);
      setIsScreenSharing(false);
      stopScreenCapture();
      stopAudioCapture();
      stopPlayback();
      ws.current = null; // Ensure cleanup
    };

    ws.current.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'text') {
            // Check if it's a system message or bot message
            const sender = message.data.startsWith('System:') ? 'System' : 
                          message.data.startsWith('You:') ? 'You' : 'Bot';
            const text = message.data.startsWith('System:') ? message.data.substring(7).trim() : 
                         message.data.startsWith('You:') ? message.data.substring(4).trim() : message.data;
            const messageId = new Date().toISOString();
            addMessage(sender, text, null, sender === 'System');
            if (sender === 'Bot') {
              playTTS(text, language, messageId);
            }
          }
        } catch (e) {
          console.error("Failed to parse JSON message:", e);
          addMessage('System', t('Error') + ': ' + t('Received invalid message format.'), null, true, true);
        }
      } else if (event.data instanceof ArrayBuffer) {
        // Received binary data (audio from TTS)
        playPcmChunk(event.data);
      } else {
         console.warn("Received unexpected message type:", typeof event.data);
      }
    };
  }, [addMessage, t, isConnecting, language]);

  // Helper function to start audio recording
  const startAudioRecording = async () => {
    try {
      setError(null); // Clear previous errors
      await startAudioCapture(handleProcessedAudio, (err) => {
        console.error("Audio Capture Error:", err);
        setError(t('Error') + ': ' + (err.message || 'Failed to start audio capture. Check microphone permissions.'));
        addMessage('System', t('Error') + ': ' + (err.message || 'Failed to start audio capture.'), null, true, true);
        setIsRecording(false); // Ensure recording state is correct
      });
      setIsRecording(true);
      addMessage('System', t('Listening...'), null, true);
    } catch (err) {
       // Error handled by the callback in startAudioCapture
    }
  };

  // Disconnect WebSocket
  const disconnectWebSocket = useCallback(() => {
    if (ws.current) {
      ws.current.close(1000, "User disconnected"); // 1000 indicates normal closure
    }
    stopAudioCapture();
    stopPlayback();
    stopScreenSharing();
    setIsRecording(false);
    setIsScreenSharing(false);
  }, []);

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      disconnectWebSocket();
      cleanupScreenCapture();
      clearInterval(screenshotInterval.current);
    };
  }, [disconnectWebSocket]);

  // Audio processing callback
  const handleProcessedAudio = useCallback((pcm16Data) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN && isRecording) {
      // Send the Int16Array's underlying ArrayBuffer
      ws.current.send(pcm16Data.buffer);
    }
  }, [isRecording]);

  // Toggle screen sharing
  const toggleScreenSharing = async () => {
    if (!isConnected) {
      // Attempt to connect first if not connected
      connectWebSocket();
      return; // Wait for connection before starting screen sharing
    }

    if (isScreenSharing) {
      // Stop screen sharing
      stopScreenSharing();
      return;
    }

    try {
      // Start screen sharing
      await startScreenCapture();
      setIsScreenSharing(true);
      addMessage('System', t('Screen Sharing Started'), null, true);
      
      // Set up interval to capture screenshots
      screenshotInterval.current = setInterval(async () => {
        if (isScreenSharingActive()) {
          try {
            const screenshot = await captureScreenshot(0.6);
            screenshotRef.current = screenshot;
            setCurrentScreenshot(screenshot);
          } catch (err) {
            console.error("Error capturing screenshot:", err);
          }
        }
      }, 1000); // Capture every second, but only send with messages
    } catch (err) {
      console.error("Failed to start screen sharing:", err);
      setError(t('Error') + ': ' + (err.message || 'Failed to start screen sharing'));
      addMessage('System', t('Error') + ': ' + (err.message || 'Failed to start screen sharing'), null, true, true);
    }
  };

  // Stop screen sharing
  const stopScreenSharing = () => {
    clearInterval(screenshotInterval.current);
    stopScreenCapture();
    setIsScreenSharing(false);
    setCurrentScreenshot(null);
    screenshotRef.current = null;
    addMessage('System', t('Screen Sharing Stopped'), null, true);
  };

  // Send Text Input with screenshot if available
  const sendTextInput = (e) => {
    e.preventDefault();
    if (!inputText.trim() || !isConnected || ws.current?.readyState !== WebSocket.OPEN) return;

    // Capture current screenshot if screen sharing is active
    const screenshot = screenshotRef.current;
    
    // Send message with text, language and optional screenshot
    ws.current.send(JSON.stringify({ 
      type: "text", 
      data: inputText,
      language: language, // Include the selected language
      hasScreenshot: !!screenshot 
    }));
    
    // Display user's message with screenshot in the chat
    addMessage('You', inputText, screenshot);
    
    // Send screenshot as a separate message if available
    if (screenshot && ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ 
        type: "screenshot", 
        data: screenshot,
        language: language // Include the selected language here too
      }));
    }
    
    setInputText('');
  };

  return (
    <div className="flex h-full">
      {/* Chat Panel - Takes 2/3 of space */}
      <div className="flex flex-col w-2/3 h-full">
        {/* Live Chat Window */}
        <div className="flex-1 overflow-y-auto px-2 py-4">
          <div className="flex flex-col gap-4">
            {messages.map((msg, idx) => (
              <>
                <div
                  key={idx}
                  className={`chat ${msg.sender === 'You' ? 'chat-end' : 'chat-start'} gap-1 ${msg.isSystem ? 'opacity-70 text-sm' : ''}`}
                >
                  {/* Header (Sender Name) */}
                  {!msg.isSystem && (
                    <div className={`chat-header text-xs opacity-70 mb-1 ${msg.sender === 'You' ? 'text-right' : 'text-left'}`}>
                      {t(msg.sender)} {/* Translate sender name */}
                    </div>
                  )}

                  {/* Bubble */}
                  <div
                    className={`chat-bubble text-base ${
                      msg.sender === 'You' ? 'chat-bubble-primary' :
                      msg.sender === 'Bot' ? 'chat-bubble-secondary' :
                      msg.isError ? 'chat-bubble-error' : 'chat-bubble-info' // System/Error bubbles
                    }`}
                  >
                    {/* Text content */}
                    <div dangerouslySetInnerHTML={{ __html: marked.parse(msg.text || "") }} />

                    {/* Screenshot (if available) */}
                    {msg.image && (
                      <div className="mt-2">
                        <img
                          src={msg.image}
                          alt="Screenshot"
                          className="max-h-64 w-auto object-contain rounded border border-base-300"
                          onClick={() => window.open(msg.image, '_blank')} // Open in full size on click
                          style={{ cursor: 'pointer' }}
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Audio Controls - Same level as chat div like in ChatWindow */}
                {msg.sender === 'Bot' && msg.text && !msg.isSystem && (
                  <div className={`chat ${msg.sender === 'Bot' ? 'chat-start' : 'chat-end'}`}>
                    <div>
                      {/* Only show the button if audio doesn't exist yet */}
                      {!messageAudio[msg.id] && (
                        <div className="flex mt-2">
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            onClick={() => playTTS(msg.text, msg.language || language, msg.id)}
                            disabled={audioLoadingId !== null}
                            aria-label={t("Generate Audio")}
                          >
                            {/* Speaker SVG icon */}
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M9 9H5a2 2 0 00-2 2v2a2 2 0 002 2h4l5 5V4l-5 5z" />
                            </svg>
                            {audioLoadingId === msg.id && (
                              <span className="loading loading-spinner loading-xs"></span>
                            )}
                          </button>
                        </div>
                      )}

                      {/* Show audio player when audio exists */}
                      {messageAudio[msg.id] && (
                        <div className="audio-message mt-2">
                          <AudioMessage
                            audioData={messageAudio[msg.id]}
                            text={msg.text}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            ))}
            
            {isConnecting && (
               <div className="chat chat-start gap-1 opacity-70 text-sm">
                   <div className="chat-bubble chat-bubble-info">
                       <span className="loading loading-dots loading-sm"></span> {t('Connecting...')}
                   </div>
               </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Area */}
        <div className="border-t border-base-300 p-4">
          {error && <div role="alert" className="alert alert-error mb-2 text-sm p-2"><svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg><span>{error}</span></div>}

          <form onSubmit={sendTextInput} className="join w-full mb-2">
            <input
              type="text"
              className="input input-bordered join-item w-full"
              placeholder={t("Type your message…")}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              disabled={!isConnected}
            />
            
            {/* Voice Input Button - Added like ChatWindow */}
            <button 
              type="button"
              className={`btn join-item ${isVoiceRecording ? "btn-error" : "btn-ghost"}`}
              onClick={handleVoice}
              disabled={!isConnected || isVoiceLoading}
              title={isVoiceRecording ? t("Stop recording") : t("Voice input")}
            >
              {isVoiceRecording ? (
                <span className="loading loading-spinner loading-sm"></span>
              ) : isVoiceLoading ? (
                <span className="loading loading-dots loading-sm"></span>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              )}
            </button>
            
            <button
              type="submit"
              className="btn btn-primary join-item"
              disabled={!inputText.trim() || !isConnected}
            >
              {/* Send Icon */}
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>
            </button>
          </form>

          <div className="flex justify-center gap-2">
            {/* Connect/Disconnect Button */}
            {!isConnected ? (
              <button
                type="button"
                className={`btn btn-success ${isConnecting ? 'btn-disabled' : ''}`}
                onClick={connectWebSocket}
                disabled={isConnecting}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
                {t('Connect Live')}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={disconnectWebSocket}
              >
                {t("Disconnect")}
              </button>
            )}
            
            {/* Recording Status Indicator - Only show when connected */}
            {isConnected && isRecording && (
              <div className="btn btn-ghost">
                <span className="recording-dot mr-2"></span>
                {t("Listening...")}
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Screen Share Panel - Takes 1/3 of space */}
      <div className="w-1/3 h-full">
        <ScreenSharePanel
          isScreenSharing={isScreenSharing}
          toggleScreenSharing={toggleScreenSharing}
          currentScreenshot={currentScreenshot}
          isConnected={isConnected}
        />
      </div>
      
      {/* Add a small CSS for the recording indicator */}
      <style jsx>{`
        .recording-dot {
          display: inline-block;
          width: 12px;
          height: 12px;
          background-color: #f00;
          border-radius: 50%;
          animation: pulse 1.5s infinite;
        }
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.4; }
          100% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

export default LiveScreenChat;