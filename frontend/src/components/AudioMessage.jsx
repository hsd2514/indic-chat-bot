import { useEffect, useRef, useState } from 'react';

function AudioMessage({ audioData }) {
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState(null);
  const [audioLoaded, setAudioLoaded] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  // Validate and load audio
  useEffect(() => {
    setError(null);
    setAudioLoaded(false);
    
    if (!audioData || typeof audioData !== 'string') {
      setError("Invalid audio data");
      return;
    }
 
    const testAudio = new Audio(`data:audio/wav;base64,${audioData}`);
    
    const handleCanPlay = () => {
      setAudioLoaded(true);
      setDuration(testAudio.duration);
      cleanup();
    };
    
    const handleError = (e) => {
      console.error("Audio validation error:", e);
      setError("Audio format not supported");
      cleanup();
    };
    
    testAudio.addEventListener('canplaythrough', handleCanPlay);
    testAudio.addEventListener('error', handleError);
    
    const cleanup = () => {
      testAudio.removeEventListener('canplaythrough', handleCanPlay);
      testAudio.removeEventListener('error', handleError);
    };
    
    testAudio.load();
    
    return cleanup;
  }, [audioData]);

  // Handle playback
  const handlePlay = () => {
    if (!audioRef.current || !audioLoaded) return;
    
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.load();
      audioRef.current.play()
        .then(() => setIsPlaying(true))
        .catch(e => {
          console.error("Audio play error:", e);
          setError(`Playback error: ${e.message || 'Unknown'}`);
        });
    }
  };

  const formatTime = (seconds) => {
    if (isNaN(seconds) || seconds === Infinity) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="card card-compact bg-base-200 shadow-sm">
      <audio 
        ref={audioRef}
        src={`data:audio/wav;base64,${audioData}`}
        onEnded={() => setIsPlaying(false)}
        onError={() => setError("Audio error")}
        onTimeUpdate={() => {
          if (audioRef.current) {
            setCurrentTime(audioRef.current.currentTime);
            setProgress((audioRef.current.currentTime / audioRef.current.duration) * 100);
          }
        }}
        preload="auto"
      />
      
      <div className="card-body p-2">
        <div className="flex items-center gap-2">
          <button
            onClick={handlePlay}
            className={`btn btn-sm btn-circle ${isPlaying ? 'btn-primary' : 'btn-ghost'}`}
            disabled={!!error || !audioLoaded}
          >
            {isPlaying ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
          </button>
          
          {error ? (
            <div className="badge badge-error badge-sm">Error</div>
          ) : !audioLoaded ? (
            <span className="loading loading-spinner loading-xs"></span>
          ) : (
            <div className="flex-1 flex flex-col gap-1">
              <progress 
                className="progress progress-primary h-2" 
                value={progress} 
                max="100"
              ></progress>
              <div className="flex justify-between text-xs opacity-70">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default AudioMessage;
