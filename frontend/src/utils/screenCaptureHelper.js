/**
 * Helper utilities for capturing and handling screen sharing
 */

let screenStream = null;
let videoElement = null;

/**
 * Starts screen sharing using the browser's getDisplayMedia API
 * @returns {Promise<MediaStream>} The screen capture stream
 */
export const startScreenCapture = async () => {
  try {
    // Request screen sharing permission and get the stream
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        cursor: "always",
        displaySurface: "monitor",
      },
      audio: false,
    });
    
    console.log("Screen capture started");
    return screenStream;
  } catch (err) {
    console.error("Error starting screen capture:", err);
    throw err;
  }
};

/**
 * Stops the screen capture stream and releases resources
 */
export const stopScreenCapture = () => {
  if (screenStream) {
    screenStream.getTracks().forEach(track => track.stop());
    screenStream = null;
    console.log("Screen capture stopped");
  }
};

/**
 * Captures a screenshot from the current screen share as a base64 encoded image
 * @param {number} quality - JPEG quality (0-1)
 * @returns {Promise<string>} Base64 encoded image data
 */
export const captureScreenshot = async (quality = 0.7) => {
  if (!screenStream) {
    throw new Error("Screen capture not active");
  }
  
  try {
    // Create a video element if it doesn't exist
    if (!videoElement) {
      videoElement = document.createElement('video');
      videoElement.style.position = 'fixed';
      videoElement.style.opacity = '0';
      videoElement.style.pointerEvents = 'none';
      document.body.appendChild(videoElement);
    }

    // Set up the video element with the screen stream
    videoElement.srcObject = screenStream;
    await videoElement.play();
    
    // Create a canvas for the screenshot
    const canvas = document.createElement('canvas');
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;
    
    // Draw the current video frame to the canvas
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    
    // Convert to base64 image data
    const imageData = canvas.toDataURL('image/jpeg', quality);
    
    return imageData;
  } catch (err) {
    console.error("Error capturing screenshot:", err);
    throw err;
  }
};

/**
 * Checks if screen sharing is currently active
 * @returns {boolean} True if screen sharing is active
 */
export const isScreenSharingActive = () => {
  return screenStream !== null && screenStream.active;
};

/**
 * Cleans up screen capture resources
 */
export const cleanupScreenCapture = () => {
  stopScreenCapture();
  if (videoElement) {
    videoElement.remove();
    videoElement = null;
  }
};