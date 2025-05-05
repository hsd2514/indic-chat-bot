import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { marked } from 'marked';
import { startAudioCapture, stopAudioCapture, playPcmChunk, stopPlayback } from '../utils/liveAudioHelper';

const WEBSOCKET_URL = "ws://localhost:8000/ws/live";
const AUDIO_CHUNK_DURATION_MS = 100; // Send audio chunks every 100ms

function LiveChat() {
  const { t } = useTranslation();
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [error, setError] = useState(null);
  const ws = useRef(null);
  const messagesEndRef = useRef(null);
  const audioBufferRef = useRef([]); // Buffer for outgoing audio chunks

  const addMessage = useCallback((sender, text, isSystem = false, isError = false) => {
    setMessages(prev => [...prev, { sender, text, timestamp: new Date().toISOString(), isSystem, isError }]);
  }, []);

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
    addMessage('System', t('Connecting...'), true);
    setMessages([]); // Clear previous messages on new connection attempt

    ws.current = new WebSocket(WEBSOCKET_URL);
    ws.current.binaryType = 'arraybuffer'; // Expecting raw audio bytes

    ws.current.onopen = () => {
      console.log("WebSocket Connected");
      setIsConnected(true);
      setIsConnecting(false);
      addMessage('System', t('Live Mode (Audio Only)'), true);
      // Send initial config if needed (e.g., video mode)
      // ws.current.send(JSON.stringify({ type: "config", video_mode: "none" }));
    };

    ws.current.onclose = (event) => {
      console.log("WebSocket Disconnected:", event.reason, event.code);
      setIsConnected(false);
      setIsConnecting(false);
      setIsRecording(false); // Stop recording if connection drops
      stopAudioCapture();
      stopPlayback();
      if (!event.wasClean) {
        setError(t('Disconnected') + `: ${event.reason || 'Connection lost'}`);
        addMessage('System', t('Disconnected') + `: ${event.reason || 'Connection lost'}`, true, true);
      } else {
         addMessage('System', t('Disconnected'), true);
      }
      ws.current = null;
    };

    ws.current.onerror = (err) => {
      console.error("WebSocket Error:", err);
      setError(t('Error') + ': ' + t('WebSocket connection failed.'));
      addMessage('System', t('Error') + ': ' + t('WebSocket connection failed.'), true, true);
      setIsConnected(false);
      setIsConnecting(false);
      setIsRecording(false);
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
            const sender = message.data.startsWith('System:') ? 'System' : 'Bot';
            const text = message.data.startsWith('System:') ? message.data.substring(7).trim() : message.data;
            addMessage(sender, text, sender === 'System');
          }
        } catch (e) {
          console.error("Failed to parse JSON message:", e);
          addMessage('System', t('Error') + ': ' + t('Received invalid message format.'), true, true);
        }
      } else if (event.data instanceof ArrayBuffer) {
        // Received binary data (assume raw PCM audio from Gemini)
        playPcmChunk(event.data);
      } else {
         console.warn("Received unexpected message type:", typeof event.data);
      }
    };
  }, [addMessage, t, isConnecting]);

  // Disconnect WebSocket
  const disconnectWebSocket = useCallback(() => {
    if (ws.current) {
      ws.current.close(1000, "User disconnected"); // 1000 indicates normal closure
      // State updates (isConnected, isConnecting, etc.) handled by onclose handler
    }
    stopAudioCapture();
    stopPlayback();
    setIsRecording(false);
  }, []);

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      disconnectWebSocket();
    };
  }, [disconnectWebSocket]);

  // Audio processing callback
  const handleProcessedAudio = useCallback((pcm16Data) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN && isRecording) {
      // Send the Int16Array's underlying ArrayBuffer
      ws.current.send(pcm16Data.buffer);
    }
  }, [isRecording]);

  // Start/Stop Recording
  const toggleRecording = async () => {
    if (!isConnected) {
        // Attempt to connect first if not connected
        connectWebSocket();
        return; // Wait for connection before starting recording
    }

    if (isRecording) {
      setIsRecording(false);
      await stopAudioCapture();
      // Optionally send an "end_turn" signal if needed by backend logic
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
         ws.current.send(JSON.stringify({ type: "end_turn" }));
         addMessage('You', `(${t('Send Turn')})`, true); // Indicate turn sent
      }
    } else {
      try {
        setError(null); // Clear previous errors
        await startAudioCapture(handleProcessedAudio, (err) => {
          console.error("Audio Capture Error:", err);
          setError(t('Error') + ': ' + (err.message || 'Failed to start audio capture. Check microphone permissions.'));
          addMessage('System', t('Error') + ': ' + (err.message || 'Failed to start audio capture.'), true, true);
          setIsRecording(false); // Ensure recording state is correct
        });
        setIsRecording(true);
        addMessage('System', t('Recording...'), true);
      } catch (err) {
         // Error handled by the callback in startAudioCapture
      }
    }
  };

  // Send Text Input
  const sendTextInput = (e) => {
    e.preventDefault();
    if (!inputText.trim() || !isConnected || ws.current?.readyState !== WebSocket.OPEN) return;

    ws.current.send(JSON.stringify({ type: "text", data: inputText }));
    addMessage('You', inputText); // Display user's text message
    setInputText('');
    // Optionally send an "end_turn" signal immediately after text
    // ws.current.send(JSON.stringify({ type: "end_turn" }));
    // addMessage('You', `(${t('Send Turn')})`, true);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Live Chat Window */}
      <div className="flex-1 overflow-y-auto px-2 py-4">
        <div className="flex flex-col gap-4">
          {messages.map((msg, idx) => (
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
                dangerouslySetInnerHTML={{ __html: marked.parse(msg.text || "") }}
              />
            </div>
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
            disabled={!isConnected || isRecording} // Disable text input while recording
          />
          <button
            type="submit"
            className="btn btn-primary join-item"
            disabled={!inputText.trim() || !isConnected || isRecording}
          >
            {/* Send Icon */}
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>
          </button>
        </form>

        <div className="flex justify-center gap-4">
           <button
             type="button"
             className={`btn ${isRecording ? "btn-error" : "btn-success"} ${isConnecting ? 'btn-disabled' : ''}`}
             onClick={toggleRecording}
             disabled={isConnecting} // Disable while initially connecting
           >
             {isRecording ? (
               <>
                 {/* Stop Icon */}
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M5 3.5h6A1.5 1.5 0 0 1 12.5 5v6a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 11V5A1.5 1.5 0 0 1 5 3.5"/>
                 </svg>
                 {t("Stop Live Session")}
               </>
             ) : (
               <>
                 {/* Mic Icon */}
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                 {isConnected ? t("Start Live Session") : t('Connect Live')}
               </>
             )}
           </button>
           {isConnected && !isRecording && ( // Show disconnect only when connected and not recording
              <button
                type="button"
                className="btn btn-ghost"
                onClick={disconnectWebSocket}
              >
                {t("Disconnect")}
              </button>
           )}
        </div>
      </div>
    </div>
  );
}

export default LiveChat;
