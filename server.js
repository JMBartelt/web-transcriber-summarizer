import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import rateLimit from 'express-rate-limit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const upload = multer({ dest: 'uploads/' });
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting for authentication endpoint
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs
  message: {
    error: 'Too many authentication attempts, please try again later.'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

app.post('/api/authenticate', authLimiter, async (req, res) => {
  try {
    const { password } = req.body;
    const CORRECT_PASSWORD = process.env.APP_PASSWORD;

    if (!CORRECT_PASSWORD) {
      return res.status(500).json({ error: 'Server configuration error: APP_PASSWORD not set' });
    }

    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    if (password !== CORRECT_PASSWORD) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    res.json({ success: true, message: 'Authentication successful' });
  } catch (err) {
    console.error('Authentication error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  const filePath = req.file.path;
  try {
    // Check password
    const { password } = req.body;
    const CORRECT_PASSWORD = process.env.APP_PASSWORD;

    if (!CORRECT_PASSWORD) {
      return res.status(500).json({ error: 'Server configuration error: APP_PASSWORD not set' });
    }

    if (!password || password !== CORRECT_PASSWORD) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('Missing OPENAI_API_KEY');
    }

    const form = new FormData();
    form.append('file', fs.createReadStream(filePath), 'audio.webm');
    form.append('model', 'whisper-1');

    const response = await fetch(
      'https://api.openai.com/v1/audio/transcriptions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...form.getHeaders(),
        },
        body: form,
      },
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(JSON.stringify(data));
    }

    res.json({ transcript: data.text });
  } catch (err) {
    console.error('Transcription error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    // Clean up the file after the request is complete
    fs.unlink(filePath, (unlinkErr) => {
      if (unlinkErr) {
        console.error('Error deleting file:', unlinkErr);
      }
    });
  }
});

app.post('/api/summarize', async (req, res) => {
  try {
    const { transcript, prompt, password } = req.body;
    const CORRECT_PASSWORD = process.env.APP_PASSWORD;

    if (!CORRECT_PASSWORD) {
      return res.status(500).json({ error: 'Server configuration error: APP_PASSWORD not set' });
    }

    if (!password || password !== CORRECT_PASSWORD) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
    }
    const chatPrompt =
      prompt ||
      `You are a medical documentation assistant. Create a SOAP note from the provided transcript. Follow these strict guidelines:

IMPORTANT CONSTRAINTS:
- Only include information explicitly stated in the transcript
- If something is unclear due to transcription errors, note it as "[unclear]" 
- Do not infer, assume, or add medical information not present in the transcript
- If a section has no relevant information, write "Not documented" or "Not discussed"
- Preserve exact medical terminology when clearly stated, but flag potential mishearings

FORMAT:
**SUBJECTIVE:**
- Patient's reported symptoms, concerns, and history as stated
- Use quotes for direct patient statements when possible
- Flag potential transcription errors with [unclear: possibly meant "X"]

**OBJECTIVE:**
- Only documented vital signs, examination findings, test results
- Do not assume normal findings unless explicitly stated

**ASSESSMENT:**
- Only diagnoses or clinical impressions explicitly mentioned
- Include differential diagnoses only if discussed in transcript

**PLAN:**
- Only treatments, medications, follow-ups, or instructions actually discussed
- Include dosages and instructions exactly as stated

Note any sections where transcription quality may have affected accuracy.`;
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini-2024-07-18',
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
