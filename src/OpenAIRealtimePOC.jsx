import React, { useState, useRef, useEffect } from 'react';

const MODEL_ID = "gpt-4o-realtime-preview-2025-06-03";
const baseUrl = "https://api.openai.com/v1/realtime";
const BACKEND_URL = "http://localhost:3001"; // Change if backend runs elsewhere

function OpenAIRealtimePOC({ script, onDetectedQuestion, autoStart }) {
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

  const handleStart = async () => {
    setError('');
    if (!effectiveScript.trim()) {
      setError('No script/questions provided.');
      return;
    }
    setDetectedQuestion('');
    setIsActive(true);
    try {
      // 2. Get mic stream
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
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
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    audioContextRef.current = null;
    analyserRef.current = null;
    dataArrayRef.current = null;
    sourceRef.current = null;
    streamRef.current = null;
    rafRef.current = null;
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
    </div>
  );
}

export default OpenAIRealtimePOC; 