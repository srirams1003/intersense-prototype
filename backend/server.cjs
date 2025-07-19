const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
}); 