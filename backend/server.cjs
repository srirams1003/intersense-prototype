const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
const upload = multer();

const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY;

// POST /session { context: string }
app.post('/session', async (req, res) => {
  const { context } = req.body;
  try {
    const instructions = `You are an interview assistant. Here is the script of questions:\n${context}\nAs the user speaks, listen to their speech and for each utterance, reply ONLY with the text of the question from the script that best matches the user's current topic. Do NOT repeat what the user said. Do NOT reply in voice. If no question matches, reply with 'No matching question.' Only output the question text, nothing else.`;
    const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-realtime-preview-2025-06-03',
        instructions,
        modalities: ['text']
      }),
    });
    const data = await r.json();
    res.status(r.status).send(data);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

app.post('/theme', async (req, res) => {
  const { context } = req.body;
  try {
    const instructions = `You are an interview assistant. There are two speakers in this conversation: the interviewer and the interviewee. As you listen to the conversation, for each utterance, first determine who is speaking (either "Interviewer" or "Interviewee") based on the content and context.

If the current speaker is the Interviewee, check if they are talking about a new theme or topic that is NOT covered by the provided script of questions. If so, reply with "NEW_THEME: " followed by a brief description of the new theme. If the Interviewee's topic is already covered by the script, reply with "No new theme."

If the current speaker is the Interviewer, reply with "Interviewer speaking."

Only output one of the following for each utterance:
- "NEW_THEME: ..." (if the Interviewee introduces a new theme)
- "No new theme." (if the Interviewee stays on script)
- "Interviewer speaking." (if the Interviewer is speaking)

Here is the script of questions:
${context}
`;
    const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-realtime-preview-2025-06-03',
        instructions,
        modalities: ['text']
      }),
    });
    const data = await r.json();
    res.status(r.status).send(data);
    console.log(data);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// POST /api/transcribe (audio upload, returns transcript + diarization)
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  try {
    console.log('Uploading audio to AssemblyAI...');
    // 1. Upload audio to AssemblyAI
    const uploadRes = await axios.post(
      'https://api.assemblyai.com/v2/upload',
      req.file.buffer,
      {
        headers: {
          'authorization': ASSEMBLYAI_API_KEY,
          'transfer-encoding': 'chunked',
        },
      }
    );
    const audio_url = uploadRes.data.upload_url;
    console.log('Upload URL:', uploadRes.data.upload_url);

    console.log('Requesting transcription...');
    // 2. Request transcription with diarization
    const transcriptRes = await axios.post(
      'https://api.assemblyai.com/v2/transcript',
      {
        audio_url,
        speaker_labels: true,
        // Optionally: language_code: 'en_us'
      },
      {
        headers: {
          'authorization': ASSEMBLYAI_API_KEY,
          'content-type': 'application/json',
        },
      }
    );
    const transcriptId = transcriptRes.data.id;
    console.log('Transcript ID:', transcriptRes.data.id);

    // Wait 2 seconds before polling
    await new Promise(r => setTimeout(r, 3000));

    // 3. Poll for completion
    let transcript;
    for (let i = 0; i < 60; i++) { // up to ~60s
      await new Promise(r => setTimeout(r, 2000));
      try {
        const pollRes = await axios.get(
          `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
          { headers: { 'authorization': ASSEMBLYAI_API_KEY } }
        );
        if (pollRes.data.status === 'completed') {
          transcript = pollRes.data;
          break;
        }
        if (pollRes.data.status === 'failed') {
          return res.status(500).json({ error: 'Transcription failed.' });
        }
      } catch (err) {
        // If 502, wait and retry
        if (err.response && err.response.status === 502) {
          console.warn('502 from AssemblyAI, retrying...');
          continue;
        }
        // For other errors, throw
        throw err;
      }
    }
    if (!transcript) return res.status(500).json({ error: 'Timed out.' });

    // 4. Format diarized transcript
    let diarized = '';
    if (transcript.words) {
      let lastSpeaker = null;
      transcript.words.forEach(wordObj => {
        if (wordObj.speaker !== lastSpeaker) {
          diarized += (diarized ? '\n' : '') + `Speaker ${wordObj.speaker}: `;
          lastSpeaker = wordObj.speaker;
        }
        diarized += wordObj.text + ' ';
      });
    }

    res.json({
      transcript: diarized.trim(),
      speakers: transcript.words ? transcript.words.map(w => ({
        speaker: w.speaker,
        text: w.text
      })) : [],
      raw: transcript, // for debugging
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});