/**
 * Utilities for handling audio in the application
 */

/**
 * Validates if a base64 string is a valid audio format
 * 
 * @param {string} base64String - The base64 encoded audio data
 * @returns {Promise<boolean>} - Whether the audio is valid
 */
export const validateAudioData = (base64String) => {
  return new Promise((resolve, reject) => {
    if (!base64String || typeof base64String !== 'string') {
      reject(new Error('Invalid base64 string'));
      return;
    }
    
    try {
      const audio = new Audio(`data:audio/wav;base64,${base64String}`);
      
      const handleCanPlay = () => {
        cleanup();
        resolve(true);
      };
      
      const handleError = (e) => {
        cleanup();
        reject(new Error(`Audio validation failed: ${e.message || 'Unknown error'}`));
      };
      
      const cleanup = () => {
        audio.removeEventListener('canplaythrough', handleCanPlay);
        audio.removeEventListener('error', handleError);
      };
      
      audio.addEventListener('canplaythrough', handleCanPlay);
      audio.addEventListener('error', handleError);
      
      // Set a timeout in case the event listeners don't fire
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Audio validation timeout'));
      }, 5000);
      
      // Start loading the audio
      audio.load();
    } catch (e) {
      reject(e);
    }
  });
};

/**
 * Plays base64 encoded audio
 * 
 * @param {string} base64String - The base64 encoded audio data
 * @param {Function} onEnd - Callback for when playback ends
 * @param {Function} onError - Callback for when an error occurs
 * @returns {HTMLAudioElement} - The audio element
 */
export const playBase64Audio = (base64String, onEnd, onError) => {
  try {
    const audio = new Audio(`data:audio/wav;base64,${base64String}`);
    
    if (onEnd) {
      audio.addEventListener('ended', onEnd);
    }
    
    if (onError) {
      audio.addEventListener('error', onError);
    }
    
    // Attempt to play audio
    const playPromise = audio.play();
    
    if (playPromise) {
      playPromise.catch(e => {
        console.error('Audio play error:', e);
        if (onError) onError(e);
      });
    }
    
    return audio;
  } catch (e) {
    console.error('Audio creation error:', e);
    if (onError) onError(e);
    return null;
  }
};
