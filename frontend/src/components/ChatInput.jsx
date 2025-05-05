import { useRef, useState } from "react";

function ChatInput({ input, setInput, onSend, t, language, onVoiceStart, onVoiceEnd }) {
  const [isRecording, setIsRecording] = useState(false);
  const [isVoiceLoading, setIsVoiceLoading] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  const sendAudioToWhisper = async (audioBlob) => {
    setIsVoiceLoading(true);
    if (onVoiceStart) onVoiceStart();

    const formData = new FormData();
    formData.append("audio", audioBlob, "audio.webm");

    try {
      const res = await fetch(`http://localhost:8000/whisper?language=${language}`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      // Always set input to the recognized text (translated if available)
      if (data.text) {
        setInput(data.text);
      }
      // If bot reply is available, call onVoiceEnd
      if (data.bot) {
        if (onVoiceEnd) onVoiceEnd(data.text, data.bot);
      }
    } catch (error) {
      console.error("Speech recognition error:", error);
      alert("Failed to process speech. Please try again.");
    } finally {
      setIsVoiceLoading(false);
    }
  };

  const handleVoice = async () => {
    if (isRecording) {
      setIsRecording(false);
      mediaRecorderRef.current.stop();
      return;
    }

    setIsRecording(true);
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
      setIsRecording(false);
      alert("Microphone access denied or not supported.");
    }
  };

  return (
    <form className="p-4" onSubmit={onSend}>
      <div className="join w-full">
        <input
          type="text"
          className="input input-bordered join-item w-full"
          placeholder={t("Type your message…")}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isVoiceLoading}
        />
        <button 
          type="button"
          className={`btn join-item ${isRecording ? "btn-error" : "btn-ghost"}`}
          onClick={handleVoice}
          disabled={isVoiceLoading}
          title={isRecording ? t("Stop recording") : t("Voice input")}
        >
          {isRecording ? (
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
          disabled={!input.trim() || isVoiceLoading}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </form>
  );
}

export default ChatInput;