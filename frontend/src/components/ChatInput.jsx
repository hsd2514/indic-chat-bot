import { useRef, useState } from "react";

function ChatInput({ input, setInput, onSend, t, language, onVoiceStart, onVoiceEnd, onFileUpload, activePdfFile, fileMode, searchMode }) {
  const [isRecording, setIsRecording] = useState(false);
  const [isVoiceLoading, setIsVoiceLoading] = useState(false);
  const [isFileUploading, setIsFileUploading] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const fileInputRef = useRef(null);
  const sendAudioToWhisper = async (audioBlob) => {    
    setIsVoiceLoading(true);
    if (onVoiceStart) onVoiceStart();

    const formData = new FormData();
    formData.append("audio", audioBlob, "audio.webm");
    formData.append("language", language);    try {
      const res = await fetch("http://localhost:8000/whisper", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error(`Server returned ${res.status}: ${errorText}`);
        throw new Error(`Failed to process audio: ${res.status}`);
      }

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
    audioChunksRef.current = [];    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Try to use a format that's well supported by both browser and backend
      let options = {};
      if (MediaRecorder.isTypeSupported('audio/webm')) {
        options = { mimeType: 'audio/webm' };
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        options = { mimeType: 'audio/mp4' };
      }
      
      console.log("Using audio format:", options.mimeType || "default");
      const mediaRecorder = new window.MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        audioChunksRef.current.push(e.data);
      };      mediaRecorder.onstop = async () => {
        // Use the same MIME type that was used for recording
        const mimeType = mediaRecorder.mimeType || 'audio/webm';
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        
        console.log("Recorded audio blob size:", audioBlob.size, "bytes, type:", mimeType);
        await sendAudioToWhisper(audioBlob);
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
    } catch (err) {
      setIsRecording(false);
      alert("Microphone access denied or not supported.");
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    if (file.type !== 'application/pdf') {
      alert(t("Only PDF files are supported"));
      return;
    }

    setIsFileUploading(true);
    
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("language", language);
      
      const response = await fetch("http://localhost:8000/upload_pdf", {
        method: "POST",
        body: formData,
      });
      
      const data = await response.json();
      
      if (data.success && onFileUpload) {
        onFileUpload(file.name, data.file_id);
      } else {
        alert(t("Failed to upload file"));
      }
    } catch (error) {
      console.error("File upload error:", error);
      alert(t("Failed to upload PDF. Please try again."));
    } finally {
      setIsFileUploading(false);
      // Reset the file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <form className="p-4" onSubmit={onSend}>
      <div className="join w-full relative">        <input
          type="text"
          className={`input input-bordered join-item w-full ${searchMode ? 'pr-12' : ''}`}
          placeholder={
            searchMode 
              ? t("Search the web...") 
              : fileMode 
                ? t("Ask a question about your PDF...") 
                : t("Type your message…")
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isVoiceLoading || isFileUploading}
        />
        
        {/* Only show PDF file upload button if in file mode or there's an active PDF */}
        {(fileMode || activePdfFile) && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              className="hidden" 
              onChange={handleFileUpload}
            />
            
            <button 
              type="button"
              className={`btn join-item ${isFileUploading ? "btn-disabled" : "btn-ghost"}`}
              onClick={() => fileInputRef.current && fileInputRef.current.click()}
              disabled={isVoiceLoading || isFileUploading}
              title={t("Upload PDF")}
            >
              {isFileUploading ? (
                <span className="loading loading-spinner loading-sm"></span>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              )}
            </button>
          </>
        )}        {/* Show search icon in search mode */}
        {searchMode && (
          <div className="absolute top-1/2 right-[100px] transform -translate-y-1/2 pointer-events-none">
            <div className="badge badge-primary badge-sm">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>
        )}{/* Show file mode indicator when PDF is active */}
        {activePdfFile && (
          <div className="absolute -top-6 right-0 text-xs opacity-70">
            {!fileMode && (
              <span className="badge badge-sm badge-ghost">{t("Shift+Enter to use Google AI with PDF")}</span>
            )}
            {fileMode && (
              <span className="badge badge-sm badge-primary">{t("File Mode Active")}</span>
            )}
          </div>
        )}
        
        {/* Voice button - show in all modes */}
        <button 
          type="button"
          className={`btn join-item ${isRecording ? "btn-error" : "btn-ghost"}`}
          onClick={handleVoice}
          disabled={isVoiceLoading || isFileUploading}
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
          disabled={(!input.trim() && !isRecording) || isVoiceLoading || isFileUploading}
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