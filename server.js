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
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const upload = multer({ dest: 'uploads/' });
const app = express();
const PORT = process.env.PORT || 3000;

// Replit/most hosted environments sit behind a reverse proxy and will set X-Forwarded-For.
// express-rate-limit throws if XFF exists but trust proxy is disabled.
if (process.env.TRUST_PROXY) {
  const v = process.env.TRUST_PROXY;
  app.set('trust proxy', v === 'true' ? true : Number.isFinite(Number(v)) ? Number(v) : true);
} else {
  app.set('trust proxy', 1);
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting for authentication endpoint
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs
  message: {
    error: 'Too many authentication attempts, please try again later.',
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

app.post('/api/authenticate', authLimiter, async (req, res) => {
  try {
    const { password } = req.body;
    const CORRECT_PASSWORD = process.env.APP_PASSWORD;

    if (!CORRECT_PASSWORD) {
      return res
        .status(500)
        .json({ error: 'Server configuration error: APP_PASSWORD not set' });
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
  if (!req.file) {
    return res.status(400).json({ error: 'Missing audio file' });
  }

  const filePath = req.file.path;
  const chunkIndex = req.body?.chunkIndex;
  const sessionId = req.body?.sessionId;
  const clientMimeType = req.body?.mimeType;
  try {
    // Check password
    const { password } = req.body;
    const CORRECT_PASSWORD = process.env.APP_PASSWORD;

    if (!CORRECT_PASSWORD) {
      return res
        .status(500)
        .json({ error: 'Server configuration error: APP_PASSWORD not set' });
    }

    if (!password || password !== CORRECT_PASSWORD) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('Missing OPENAI_API_KEY');
    }

    if (req.file.size === 0) {
      return res.status(400).json({ error: 'Empty audio chunk received' });
    }
    if (req.file.size < 1024) {
      // Don't hard-fail; short chunks can happen at start/stop. Log for visibility.
      console.warn('Very small audio chunk received:', {
        chunkIndex,
        sessionId,
        mimetype: req.file.mimetype,
        clientMimeType,
        size: req.file.size,
      });
    }

    const model = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';
    const preferredName =
      req.file.originalname ||
      (req.file.mimetype === 'audio/ogg' ? 'audio.ogg' : 'audio.webm');

    const attemptTranscribe = async (p, name) => {
      const form = new FormData();
      form.append('file', fs.createReadStream(p), name);
      form.append('model', model);

      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...form.getHeaders(),
        },
        body: form,
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const err = new Error(JSON.stringify(data));
        err.status = response.status;
        err.data = data;
        throw err;
      }
      return data;
    };

    const isTransientStatus = (status) =>
      status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const transcribeWithRetries = async (p, name) => {
      const maxAttempts = Number(process.env.TRANSCRIBE_RETRIES || 4);
      let lastErr = null;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          return await attemptTranscribe(p, name);
        } catch (e) {
          lastErr = e;
          const status = e?.status;
          if (!isTransientStatus(status)) break;
          const delay = Math.min(30000, 1500 * Math.pow(2, attempt));
          await sleep(delay);
        }
      }
      throw lastErr;
    };

    const isDecodeError = (data) => {
      const msg = data?.error?.message || '';
      return typeof msg === 'string' && msg.toLowerCase().includes('could not be decoded');
    };

    const safeJsonForLog = (obj) => {
      try {
        return JSON.stringify(obj);
      } catch (_) {
        return '[unserializable error]';
      }
    };

    let data;
    try {
      data = await transcribeWithRetries(filePath, preferredName);
    } catch (e) {
      // If the browser produces a chunk OpenAI can't decode, try transcoding to WAV and retrying.
      const errData = e?.data;
      if (isDecodeError(errData)) {
        const wavPath = `${filePath}.wav`;
        const transcoded = await transcodeToWav(filePath, wavPath);
        if (transcoded) {
          data = await transcribeWithRetries(wavPath, 'audio.wav');
          // Best-effort cleanup of temp wav; original file cleanup happens in finally.
          fs.unlink(wavPath, () => {});
        } else {
          console.error(
            'Transcription decode error; ffmpeg not available for fallback.',
            {
              chunkIndex,
              sessionId,
              mimetype: req.file.mimetype,
              clientMimeType,
              size: req.file.size,
              error: safeJsonForLog(errData),
            },
          );
          throw new Error(
            'OpenAI could not decode this audio chunk, and server-side ffmpeg fallback is unavailable. ' +
              'Install ffmpeg or set FFMPEG_PATH to enable automatic transcoding retries. ' +
              `Original error: ${e.message}`,
          );
        }
      } else {
        throw e;
      }
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
      return res
        .status(500)
        .json({ error: 'Server configuration error: APP_PASSWORD not set' });
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
      `You are a physical therapy documentation assistant. Create a SOAP note from the provided transcript. Follow these strict guidelines:

IMPORTANT CONSTRAINTS:
- Only include information explicitly stated in the transcript
- If something is unclear due to transcription errors, note it as "[unclear]"
- Do not infer, assume, or add medical information not present in the transcript
- Preserve exact medical terminology when clearly stated, but flag potential mishearings
- For every included subsection below, you MUST include at least one exact supporting quote from the transcript
- If you cannot provide a relevant supporting quote for a subsection, OMIT that subsection entirely (do not write "Not documented" / "Not discussed")
- Always include the top-level SOAP headers (SUBJECTIVE / OBJECTIVE / ASSESSMENT / PLAN). If a header would otherwise be empty, write "- No relevant information explicitly stated in transcript."

FORMAT:
SUBJECTIVE:
- Chief Complaint:
  Evidence: "<exact quote>"
- Pain Scale (1-10):
  Evidence: "<exact quote>"
- Aggravating Factors:
  Evidence: "<exact quote>"
- Alleviating Factors:
  Evidence: "<exact quote>"
- (Optional) Other subjective history explicitly stated:
  Evidence: "<exact quote>"

OBJECTIVE:
- Observations (e.g., gait, posture, movement quality, swelling, etc):
  Evidence: "<exact quote>"
- Range of Motion:
  - Active range of motion (AROM):
    Evidence: "<exact quote>"
  - Passive range of motion (PROM):
    Evidence: "<exact quote>"
- Manual Muscle Tests (MMT) (include ratings if stated):
  Evidence: "<exact quote>"
- Functional Tests:
  Evidence: "<exact quote>"
- Special Tests:
  Evidence: "<exact quote>"
- Treatment (what was done in-session):
  Evidence: "<exact quote>"

ASSESSMENT:
- Analysis (clinical reasoning / progress / response to treatment, ONLY if explicitly stated):
  Evidence: "<exact quote>"
- Assessment / Clinical Impression (diagnosis, prognosis, or therapist impression, ONLY if explicitly stated):
  Evidence: "<exact quote>"

PLAN:
- Education (what was taught or discussed with patient):
  Evidence: "<exact quote>"
- Home Exercise Program (HEP):
  Evidence: "<exact quote>"
- Plan (next steps, frequency, follow-ups, referrals, precautions, etc, ONLY if explicitly stated):
  Evidence: "<exact quote>"

QUALITY:
- Use short quotes (1-2 sentences) and keep them verbatim (do not paraphrase inside quotes)
- If unclear due to transcription quality, include: [unclear] and optionally [unclear: possibly meant "X"]
- Do not add measurements, test results, diagnoses, or plans that are not explicitly stated in the transcript.`;
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-5.2-2025-12-11',
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

async function transcodeToWav(inputPath, outputPath) {
  const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';

  // Try to run ffmpeg; if it isn't present, return null so the caller can fall back.
  const args = [
    '-y',
    '-loglevel',
    'error',
    '-i',
    inputPath,
    '-ac',
    '1',
    '-ar',
    '16000',
    outputPath,
  ];

  return await new Promise((resolve) => {
    const child = spawn(ffmpegPath, args, { stdio: 'ignore' });
    child.on('error', () => resolve(null));
    child.on('exit', (code) => resolve(code === 0 ? outputPath : null));
  });
}
