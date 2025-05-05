const TARGET_SAMPLE_RATE = 16000; // Gemini expected sample rate
const RESPONSE_SAMPLE_RATE = 24000; // Gemini response sample rate

let audioContext = null;
let mediaStreamSource = null;
let scriptProcessorNode = null;
let audioWorkletNode = null;
let mediaRecorder = null;
let audioChunks = [];
let audioPlayerQueue = [];
let isPlaying = false;
let playbackAudioContext = null;

// --- Audio Capture and Processing ---

/**
 * Downsamples audio buffer to target sample rate (16kHz) and converts to PCM16.
 * @param {AudioBuffer} buffer - Input audio buffer.
 * @param {number} inputSampleRate - Sample rate of the input buffer.
 * @returns {Int16Array} - PCM16 audio data.
 */
function processAudioChunk(buffer, inputSampleRate) {
  const inputData = buffer.getChannelData(0); // Assuming mono audio
  const inputLength = inputData.length;
  const outputLength = Math.floor(inputLength * TARGET_SAMPLE_RATE / inputSampleRate);
  const outputData = new Int16Array(outputLength);
  const ratio = inputSampleRate / TARGET_SAMPLE_RATE;

  let outputIndex = 0;
  for (let i = 0; i < inputLength; i += ratio) {
    let sampleValue = 0;
    let count = 0;
    // Simple averaging for downsampling (can be improved)
    for (let j = 0; j < ratio && i + j < inputLength; j++) {
      sampleValue += inputData[Math.floor(i + j)];
      count++;
    }
    if (count > 0) {
      sampleValue /= count;
    }

    // Clamp and convert to 16-bit PCM
    const pcmValue = Math.max(-1, Math.min(1, sampleValue)) * 32767;
    outputData[outputIndex++] = Math.round(pcmValue);
    if (outputIndex >= outputLength) break;
  }

  return outputData.slice(0, outputIndex); // Return only filled data
}

/**
 * Starts audio capture and processing using ScriptProcessorNode (fallback) or AudioWorklet.
 * @param {Function} onProcessedData - Callback function to handle processed PCM16 data (Int16Array).
 * @param {Function} onError - Callback function for errors.
 */
export async function startAudioCapture(onProcessedData, onError) {
  try {
    if (audioContext) {
      await stopAudioCapture(); // Ensure previous capture is stopped
    }

    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaStreamSource = audioContext.createMediaStreamSource(stream);

    const bufferSize = 4096; // Adjust as needed

    // Prefer AudioWorklet if available
    if (audioContext.audioWorklet) {
       try {
         // Dynamically create the worklet code as a Blob URL
         const workletCode = `
           class Processor extends AudioWorkletProcessor {
             constructor(options) {
               super();
               this.targetSampleRate = options.processorOptions.targetSampleRate;
               this.inputSampleRate = sampleRate; // sampleRate is global in AudioWorkletProcessor
               this.ratio = this.inputSampleRate / this.targetSampleRate;
               this.buffer = []; // Buffer to accumulate samples for downsampling
             }

             process(inputs, outputs, parameters) {
               const input = inputs[0];
               if (!input || !input[0]) {
                 return true; // No input data
               }
               const inputData = input[0]; // Assuming mono

               // Accumulate samples
               for (let i = 0; i < inputData.length; i++) {
                 this.buffer.push(inputData[i]);
               }

               const outputLength = Math.floor(this.buffer.length / this.ratio);
               if (outputLength === 0) return true; // Not enough samples yet

               const outputData = new Int16Array(outputLength);
               let outputIndex = 0;
               let bufferIndex = 0;

               while (outputIndex < outputLength) {
                 let sampleValue = 0;
                 let count = 0;
                 const endIndex = Math.min(bufferIndex + this.ratio, this.buffer.length);

                 for (let j = bufferIndex; j < endIndex; j++) {
                   sampleValue += this.buffer[j];
                   count++;
                 }

                 if (count > 0) {
                   sampleValue /= count;
                 }

                 const pcmValue = Math.max(-1, Math.min(1, sampleValue)) * 32767;
                 outputData[outputIndex++] = Math.round(pcmValue);
                 bufferIndex = Math.floor(bufferIndex + this.ratio); // Move buffer index
               }

               // Keep remaining samples in the buffer
               this.buffer = this.buffer.slice(bufferIndex);

               // Post the processed data (as ArrayBuffer)
               this.port.postMessage(outputData.buffer, [outputData.buffer]);

               return true; // Keep processor alive
             }
           }
           registerProcessor('pcm-processor', Processor);
         `;
         const blob = new Blob([workletCode], { type: 'application/javascript' });
         const workletURL = URL.createObjectURL(blob);

         await audioContext.audioWorklet.addModule(workletURL);
         audioWorkletNode = new AudioWorkletNode(audioContext, 'pcm-processor', {
             processorOptions: { targetSampleRate: TARGET_SAMPLE_RATE }
         });

         audioWorkletNode.port.onmessage = (event) => {
             // Received ArrayBuffer, convert back to Int16Array if needed by callback
             onProcessedData(new Int16Array(event.data));
         };
         audioWorkletNode.port.onmessageerror = (err) => {
             console.error('Error receiving message from worklet:', err);
             if (onError) onError(err);
         };
         audioWorkletNode.onprocessorerror = (err) => {
             console.error('AudioWorklet processor error:', err);
             if (onError) onError(err);
             // Fallback or stop capture might be needed here
         };

         mediaStreamSource.connect(audioWorkletNode).connect(audioContext.destination); // Connect to destination to keep graph running
         console.log("AudioWorklet capture started.");
         URL.revokeObjectURL(workletURL); // Clean up Blob URL

       } catch (workletError) {
         console.warn("AudioWorklet setup failed, falling back to ScriptProcessorNode:", workletError);
         if (onError) onError(new Error("AudioWorklet failed, trying fallback."));
         // Fallback to ScriptProcessorNode if Worklet fails
         setupScriptProcessor(onProcessedData, onError);
       }
    } else {
      console.warn("AudioWorklet not supported, using ScriptProcessorNode.");
      setupScriptProcessor(onProcessedData, onError);
    }

  } catch (err) {
    console.error('Error starting audio capture:', err);
    if (onError) onError(err);
    await stopAudioCapture(); // Clean up on error
  }
}

function setupScriptProcessor(onProcessedData, onError) {
    const bufferSize = 4096;
    scriptProcessorNode = audioContext.createScriptProcessor(bufferSize, 1, 1); // input channels, output channels

    scriptProcessorNode.onaudioprocess = (audioProcessingEvent) => {
      const inputBuffer = audioProcessingEvent.inputBuffer;
      const pcm16Data = processAudioChunk(inputBuffer, audioContext.sampleRate);
      if (pcm16Data.length > 0) {
        onProcessedData(pcm16Data);
      }
    };

    mediaStreamSource.connect(scriptProcessorNode);
    scriptProcessorNode.connect(audioContext.destination); // Connect to destination to keep graph running
    console.log("ScriptProcessorNode capture started.");
}


/**
 * Stops audio capture and releases resources.
 */
export async function stopAudioCapture() {
  if (mediaStreamSource) {
    mediaStreamSource.mediaStream.getTracks().forEach(track => track.stop());
    mediaStreamSource.disconnect();
    mediaStreamSource = null;
  }
  if (scriptProcessorNode) {
    scriptProcessorNode.disconnect();
    scriptProcessorNode.onaudioprocess = null;
    scriptProcessorNode = null;
  }
  if (audioWorkletNode) {
      audioWorkletNode.port.close();
      audioWorkletNode.disconnect();
      audioWorkletNode = null;
  }
  if (audioContext && audioContext.state !== 'closed') {
    try {
      await audioContext.close();
    } catch (e) {
      console.error("Error closing AudioContext:", e);
    }
    audioContext = null;
  }
  console.log("Audio capture stopped.");
}


// --- Audio Playback ---

/**
 * Initializes the playback audio context if not already done.
 */
function ensurePlaybackContext() {
    if (!playbackAudioContext || playbackAudioContext.state === 'closed') {
        playbackAudioContext = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: RESPONSE_SAMPLE_RATE // Gemini responds at 24kHz
        });
        console.log(`Playback AudioContext initialized/reinitialized at ${playbackAudioContext.sampleRate}Hz.`);
    } else if (playbackAudioContext.state === 'suspended') {
        playbackAudioContext.resume().catch(e => console.error("Error resuming playback context:", e));
    }
}

/**
 * Plays a queue of raw PCM16 audio chunks (received as ArrayBuffer or Blob).
 * @param {ArrayBuffer | Blob} pcmChunk - The raw PCM16 audio data chunk.
 */
export function playPcmChunk(pcmChunk) {
    ensurePlaybackContext();

    const processChunk = (arrayBuffer) => {
        audioPlayerQueue.push(arrayBuffer);
        if (!isPlaying) {
            playNextChunk();
        }
    };

    if (pcmChunk instanceof Blob) {
        pcmChunk.arrayBuffer().then(processChunk).catch(e => console.error("Error converting Blob to ArrayBuffer:", e));
    } else if (pcmChunk instanceof ArrayBuffer) {
        processChunk(pcmChunk);
    } else {
        console.error("Invalid chunk type received for playback:", typeof pcmChunk);
    }
}

/**
 * Plays the next chunk from the queue.
 */
async function playNextChunk() {
    if (audioPlayerQueue.length === 0) {
        isPlaying = false;
        // Consider closing context after a period of inactivity?
        // if (playbackAudioContext) {
        //     setTimeout(() => {
        //         if (!isPlaying && playbackAudioContext && playbackAudioContext.state !== 'closed') {
        //             playbackAudioContext.close().then(() => console.log("Playback context closed due to inactivity."));
        //             playbackAudioContext = null;
        //         }
        //     }, 5000); // Close after 5 seconds of inactivity
        // }
        return;
    }

    isPlaying = true;
    ensurePlaybackContext(); // Ensure context is active

    const arrayBuffer = audioPlayerQueue.shift();
    const pcm16Data = new Int16Array(arrayBuffer);
    const numSamples = pcm16Data.length;

    if (numSamples === 0) {
        console.warn("Received empty audio chunk, skipping.");
        playNextChunk(); // Play next immediately
        return;
    }

    // Convert Int16 PCM to Float32 PCM (-1.0 to 1.0)
    const float32Data = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
        float32Data[i] = pcm16Data[i] / 32768.0;
    }

    try {
        // Create an AudioBuffer
        const audioBuffer = playbackAudioContext.createBuffer(
            1, // number of channels (mono)
            numSamples, // buffer length
            RESPONSE_SAMPLE_RATE // sample rate (24kHz)
        );

        // Fill the buffer with the Float32 data
        audioBuffer.copyToChannel(float32Data, 0);

        // Create a source node
        const source = playbackAudioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(playbackAudioContext.destination);

        // Play the source and schedule the next chunk
        source.onended = () => {
            // console.log("Chunk finished playing");
            playNextChunk(); // Play the next chunk when this one finishes
        };
        source.start(); // Play immediately

    } catch (error) {
        console.error('Error playing audio chunk:', error);
        isPlaying = false;
        // Attempt to recover or clear queue?
        audioPlayerQueue = []; // Clear queue on error to prevent getting stuck
        if (playbackAudioContext && playbackAudioContext.state !== 'closed') {
             playbackAudioContext.close().then(() => console.log("Playback context closed due to error."));
             playbackAudioContext = null;
        }
    }
}

/**
 * Stops any currently playing audio and clears the queue.
 */
export function stopPlayback() {
    audioPlayerQueue = []; // Clear the queue
    isPlaying = false;
    // We don't explicitly stop the current source node here,
    // as playNextChunk won't be called again.
    // Closing the context ensures everything stops.
    if (playbackAudioContext && playbackAudioContext.state !== 'closed') {
        try {
            playbackAudioContext.close().then(() => console.log("Playback context closed manually."));
        } catch(e) {
            console.error("Error closing playback context:", e);
        }
        playbackAudioContext = null;
    }
}
