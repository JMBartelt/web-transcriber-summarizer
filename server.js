const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const upload = multer({ dest: 'uploads/' });
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  try {
    const filePath = req.file.path;
    const fileStream = fs.createReadStream(filePath);
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
    }
    const formData = new FormData();
    formData.append('file', fileStream, {
      filename: 'audio.wav',
      contentType: 'audio/wav',
    });
    formData.append('model', 'whisper-1');
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });
    const data = await response.json();
    fs.unlink(filePath, () => {});
    if (!response.ok) {
      return res.status(500).json({ error: data });
    }
    res.json({ transcript: data.text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/summarize', async (req, res) => {
  try {
    const { transcript, prompt } = req.body;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
    }
    const chatPrompt = prompt ||
      'Summarize the transcript in proper SOAP note format: Subjective, Objective, Assessment, Plan.';
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: chatPrompt },
          { role: 'user', content: transcript },
        ],
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      return res.status(500).json({ error: data });
    }
    res.json({ summary: data.choices[0].message.content });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
