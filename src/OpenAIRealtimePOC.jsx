import React, { useState, useRef, useEffect, useImperativeHandle, forwardRef } from 'react';

const MODEL_ID = "gpt-4o-realtime-preview-2025-06-03";
const baseUrl = "https://api.openai.com/v1/realtime";
const BACKEND_URL = "http://localhost:3001"; // Change if backend runs elsewhere

const OpenAIRealtimePOC = forwardRef(function OpenAIRealtimePOC(props, ref) {
  const { script, onDetectedQuestion, autoStart } = props;
  const [questionsText, setQuestionsText] = useState('');
  const [detectedQuestion, setDetectedQuestion] = useState('');
  const [error, setError] = useState('');
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const dataArrayRef = useRef(null);
  const sourceRef = useRef(null);
  const rafRef = useRef(null);
  const streamRef = useRef(null);
  const pcRef = useRef(null);
  const dcRef = useRef(null);
  const [isActive, setIsActive] = useState(false);
  const [newTheme, setNewTheme] = useState('');
  const audioChunksRef = useRef([]);
  const mediaRecorderRef = useRef(null);
  // Use prop 'script' if provided, else use local textarea
  const effectiveScript = script !== undefined ? script : questionsText;

  // Auto start/stop logic
  useEffect(() => {
    if (autoStart) {
      handleStart();
      return () => handleStop();
    }
    // eslint-disable-next-line
  }, [autoStart, effectiveScript]);
  // const checkNewTheme = async (script) => {
  //   try {
  //     const res = await fetch(`${BACKEND_URL}/theme`, {
  //       method: 'POST',
  //       headers: { 'Content-Type': 'application/json' },
  //       body: JSON.stringify({ context:  }),
  //     });
  //     if (!res.ok) {
  //       setNewTheme('Error checking new theme');
  //       return;
  //     }
  //     const data = await res.json();
  //     // 解析返回内容
  //     // 假设返回格式和之前一样，data.client_secret.value 里有 answer
  //     // 实际上你要根据后端返回结构调整
  //     // 这里假设 data.client_secret.value 是你要的内容
  //     // 你可能需要根据实际返回结构调整
  //     setNewTheme(data.result || 'Error or no result');
  //   } catch (err) {
  //     setNewTheme('Error: ' + (err.message || String(err)));
  //   }
  // };

  // Add circular buffer state
  const circularBufferRef = useRef(null);
  const bufferIndexRef = useRef(0);
  const isBufferFullRef = useRef(false);
  const scriptProcessorRef = useRef(null);

  // --- Rolling buffer logic ---
  useImperativeHandle(ref, () => ({
    getLast5SecondsAudio: async () => {
      if (!circularBufferRef.current) {
        console.log('No circular buffer available');
        return null;
      }
      
      try {
        // Create a new audio context for the final buffer
        const finalContext = new (window.AudioContext || window.webkitAudioContext)();
        const sampleRate = finalContext.sampleRate;
        const duration = 30; // 30 seconds
        const totalSamples = sampleRate * duration;
        
        // Create the final audio buffer from the circular buffer
        const finalBuffer = finalContext.createBuffer(1, totalSamples, sampleRate);
        const outputData = finalBuffer.getChannelData(0);
        
        if (isBufferFullRef.current) {
          // Buffer is full, copy from current position to end, then from start to current position
          for (let i = 0; i < totalSamples; i++) {
            const sourceIndex = (bufferIndexRef.current + i) % totalSamples;
            outputData[i] = circularBufferRef.current[sourceIndex];
          }
        } else {
          // Buffer not full, copy what we have
          for (let i = 0; i < bufferIndexRef.current; i++) {
            outputData[i] = circularBufferRef.current[i];
          }
        }
        
        // Convert AudioBuffer to WAV
        const wavBlob = await audioBufferToWav(finalBuffer);
        console.log('Created WAV blob from last 30 seconds:', wavBlob.size, 'bytes');
        return wavBlob;
        
      } catch (error) {
        console.error('Error creating WAV from circular buffer:', error);
        return null;
      }
    }
  }));
  
  // Helper function to convert AudioBuffer to WAV
  const audioBufferToWav = async (buffer) => {
    const length = buffer.length;
    const numberOfChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const arrayBuffer = new ArrayBuffer(44 + length * numberOfChannels * 2);
    const view = new DataView(arrayBuffer);
    
    console.log('Creating WAV with:', { length, numberOfChannels, sampleRate });
    
    // WAV header
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + length * numberOfChannels * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numberOfChannels * 2, true);
    view.setUint16(32, numberOfChannels * 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, length * numberOfChannels * 2, true);
    
    // Convert audio data
    let offset = 44;
    for (let i = 0; i < length; i++) {
      for (let channel = 0; channel < numberOfChannels; channel++) {
        const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        offset += 2;
      }
    }
    
    const blob = new Blob([arrayBuffer], { type: 'audio/wav' });
    console.log('WAV blob created:', blob.size, 'bytes');
    return blob;
  };


  // --- Start/Stop logic with MediaRecorder for buffer ---
  const handleStart = async () => {
    setError('');
    if (!props.script?.trim()) {
      setError('No script/questions provided.');
      return;
    }
    setDetectedQuestion('');
    setIsActive(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // --- MediaRecorder for rolling buffer ---
      const mediaRecorder = new window.MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push({ blob: e.data, timestamp: Date.now() });
          // Keep only last 10s (more than 5s to ensure we have enough)
          const now = Date.now();
          audioChunksRef.current = audioChunksRef.current.filter(chunk => now - chunk.timestamp <= 10000);
        }
      };
      mediaRecorder.start(100); // 100ms chunks for more granular control

      // 3. Visualization (unchanged)
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      dataArrayRef.current = dataArray;
      source.connect(analyser);
      const draw = () => {
        analyser.getByteTimeDomainData(dataArray);
        rafRef.current = requestAnimationFrame(draw);
      };
      draw();
      
      // 4. Set up circular buffer for last 30 seconds
      const sampleRate = audioContext.sampleRate;
      const duration = 30; // 30 seconds
      const totalSamples = sampleRate * duration;
      circularBufferRef.current = new Float32Array(totalSamples);
      bufferIndexRef.current = 0;
      isBufferFullRef.current = false;
      
      const scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
      scriptProcessorRef.current = scriptProcessor;
      
      scriptProcessor.onaudioprocess = (event) => {
        const inputData = event.inputBuffer.getChannelData(0);
        
        for (let i = 0; i < inputData.length; i++) {
          circularBufferRef.current[bufferIndexRef.current] = inputData[i];
          bufferIndexRef.current = (bufferIndexRef.current + 1) % totalSamples;
          if (bufferIndexRef.current === 0) {
            isBufferFullRef.current = true;
          }
        }
      };
      
      source.connect(scriptProcessor);
      scriptProcessor.connect(audioContext.destination);
      // 4. Create RTCPeerConnection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      // 5. (No need to play remote audio, since modalities: ['text'] disables audio)
      // 6. Add local audio track for mic
      pc.addTrack(stream.getTracks()[0]);
      // 7. Set up data channel for events
      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.onopen = () => {};
      dc.addEventListener("message", (e) => {
        try {
          const msg = JSON.parse(e.data);
          // Only display detected question for response.done events
          if (msg.type === "response.done" && msg.response && Array.isArray(msg.response.output)) {
            const output = msg.response.output[0];
            if (output && Array.isArray(output.content)) {
              const textObj = output.content.find(c => c.type === "text");
              if (textObj && textObj.text) {
                setDetectedQuestion(textObj.text);
                if (onDetectedQuestion) onDetectedQuestion(textObj.text);
                // 检测到问题后，调用 theme 检测
                // checkNewTheme(effectiveScript);
                return;
              }
            }
          }
        } catch {}
      });
      // 8. Start the session using SDP
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      // Get ephemeral key/session from backend
      const sessionRes = await fetch(`${BACKEND_URL}/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: effectiveScript }),
      });
      if (!sessionRes.ok) {
        const err = await sessionRes.text();
        setError('Session error: ' + err);
        setIsActive(false);
        return;
      }
      const sessionData = await sessionRes.json();
      const ephemeralKey = sessionData.client_secret?.value;
      if (!ephemeralKey) {
        setError('No ephemeral key returned from backend.');
        setIsActive(false);
        return;
      }
      const sdpResponse = await fetch(`${baseUrl}?model=${MODEL_ID}`, {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          "Content-Type": "application/sdp"
        },
      });
      const answer = {
        type: "answer",
        sdp: await sdpResponse.text(),
      };
      await pc.setRemoteDescription(answer);
    } catch (err) {
      setError('Error: ' + (err.message || String(err)));
      setIsActive(false);
    }
  };

  const handleStop = () => {
    setIsActive(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (audioContextRef.current) audioContextRef.current.close();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }
    audioContextRef.current = null;
    analyserRef.current = null;
    dataArrayRef.current = null;
    sourceRef.current = null;
    streamRef.current = null;
    rafRef.current = null;
    audioChunksRef.current = [];
    circularBufferRef.current = null;
    bufferIndexRef.current = 0;
    isBufferFullRef.current = false;
  };

  return (
    <div style={{ padding: 16, maxWidth: 600, margin: '0 auto', background: '#fff', borderRadius: 12, boxShadow: '0 2px 12px #0001' }}>
      {error && <div style={{ color: 'red', marginBottom: 12 }}>{typeof error === 'string' ? error : JSON.stringify(error)}</div>}
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontWeight: 500, marginBottom: 4 }}>Detected Question:</div>
        <div style={{ minHeight: 32, background: '#f5f5f5', borderRadius: 8, padding: 10, fontSize: 17, color: '#1976d2', border: '1px solid #ddd' }}>
          {detectedQuestion || <span style={{ color: '#aaa' }}>[Waiting for detection...]</span>}
        </div>
        
      </div>
      {newTheme && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontWeight: 500, marginBottom: 4, color: '#d2691e' }}>New Theme Detection Result:</div>
          <div style={{ minHeight: 32, background: '#fffbe6', borderRadius: 8, padding: 10, fontSize: 17, color: '#d2691e', border: '1px solid #ffe58f' }}>
            {newTheme}
          </div>
        </div>
      )}
    </div>
  );
});

export default OpenAIRealtimePOC;