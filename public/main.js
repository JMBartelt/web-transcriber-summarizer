let mediaRecorder;
let stream;
let isRecording = false;
let cachedPassword = null;
let isAuthenticated = false;
const CHUNK_DURATION_MS = 60000; // 1 minute chunks
const AUDIO_BITS_PER_SECOND = 64000; // keep chunks small/reliable for long sessions
const UPLOAD_TIMEOUT_MS = 120000; // per-chunk upload timeout
const MAX_UPLOAD_RETRIES = 6; // covers transient network/OpenAI hiccups
const RETRY_BASE_DELAY_MS = 1500;
const RETRY_MAX_DELAY_MS = 30000;

let activeRecordingSessionId = null;
let nextChunkIndex = 0;
let uploadQueue = [];
let uploadInFlight = false;

const recordBtn = document.getElementById('recordBtn');
const stopBtn = document.getElementById('stopBtn');
const summarizeBtn = document.getElementById('summarizeBtn');
const transcriptEl = document.getElementById('transcript');
const summaryEl = document.getElementById('summary');
const copyTranscriptBtn = document.getElementById('copyTranscript');
const copySummaryBtn = document.getElementById('copySummary');
const copyBothBtn = document.getElementById('copyBoth');
const recordIndicator = document.getElementById('recordIndicator');
const summaryIndicator = document.getElementById('summaryIndicator');
const uploadStatus = document.getElementById('uploadStatus');
const uploadStatusText = document.getElementById('uploadStatusText');
const authenticateBtn = document.getElementById('authenticateBtn');
const passwordInput = document.getElementById('password');
const authSection = document.getElementById('authSection');
const authStatus = document.getElementById('authStatus');

function setUploadStatus(message) {
  if (!uploadStatus || !uploadStatusText) return;
  if (!message) {
    uploadStatus.classList.add('hidden');
    uploadStatusText.textContent = '';
    return;
  }
  uploadStatusText.textContent = message;
  uploadStatus.classList.remove('hidden');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitteredDelayMs(attempt) {
  const exp = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
  const jitter = 0.2 * exp * (Math.random() - 0.5); // +/-10%
  return Math.max(250, Math.floor(exp + jitter));
}

function pickBestAudioMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ];
  for (const type of candidates) {
    try {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(type)) return type;
    } catch (_) {
      // ignore and try the next candidate
    }
  }
  // Let the browser choose a default if we can't determine support.
  return '';
}

function makeSessionId() {
  // crypto.randomUUID isn't supported everywhere, so fall back to time+random.
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  return `sess_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function updateUploadBacklogUI() {
  if (!activeRecordingSessionId) return;
  if (!isAuthenticated && uploadQueue.length > 0) {
    setUploadStatus('Authentication required to continue uploading/transcribing. Please re-authenticate.');
    return;
  }
  const existing = uploadStatusText?.textContent || '';
  if (existing.startsWith('Upload/transcription stalled on chunk')) return;
  if (uploadQueue.length === 0 && !uploadInFlight) {
    setUploadStatus('');
    // If we're not recording anymore, allow the user to start a fresh session.
    if (!isRecording) recordBtn.disabled = false;
    return;
  }
  const label = isRecording ? 'Uploading (recording continues)...' : 'Uploading remaining chunks...';
  setUploadStatus(`${label} Backlog: ${uploadQueue.length}${uploadInFlight ? ' (+1 in flight)' : ''}`);
}

function enqueueChunk(blob, mimeType) {
  if (!activeRecordingSessionId) return;
  uploadQueue.push({
    sessionId: activeRecordingSessionId,
    index: nextChunkIndex++,
    blob,
    mimeType: mimeType || blob.type || '',
    attempt: 0,
    lastError: null,
  });
  updateUploadBacklogUI();
  void processUploadQueue();
}

async function processUploadQueue() {
  if (uploadInFlight) return;
  uploadInFlight = true;
  try {
    // Process sequentially to keep transcript ordering stable.
    while (uploadQueue.length > 0) {
      const item = uploadQueue[0];
      if (item.sessionId !== activeRecordingSessionId) {
        // Old session leftovers; drop them.
        uploadQueue.shift();
        continue;
      }
      try {
        const text = await uploadChunkWithRetry(item);
        transcriptEl.value += text + ' ';
        copyTranscriptBtn.disabled = false;
        summarizeBtn.disabled = false;
        if (summaryEl.value.trim()) copyBothBtn.disabled = false;
        uploadQueue.shift();
        updateUploadBacklogUI();
      } catch (err) {
        const status = err?.status;
        if (status === 401) {
          // Don't burn retries; prompt re-auth and keep the queued audio in memory.
          isAuthenticated = false;
          cachedPassword = null;
          authSection.classList.remove('hidden');
          authStatus.classList.add('hidden');
          recordBtn.disabled = true;
          setUploadStatus('Authentication required to continue uploading/transcribing. Please re-authenticate.');
          // If this happens mid-recording, stop capture to avoid an unbounded in-memory queue.
          if (isRecording) {
            isRecording = false;
            recordIndicator.classList.add('hidden');
            if (mediaRecorder && mediaRecorder.state === 'recording') {
              mediaRecorder.stop();
            }
            stopBtn.disabled = true;
          }
          return;
        }
        if (status === 400) {
          // Unrecoverable chunk (e.g., too small/corrupt upload). Mark it and continue.
          const msg = err?.message || String(err);
          transcriptEl.value += `[Untranscribed chunk ${item.index + 1}: ${msg}] `;
          uploadQueue.shift();
          updateUploadBacklogUI();
          continue;
        }
        // If a chunk becomes permanently untranscribable, we don't want to silently drop audio.
        // Keep it in the queue and show a persistent warning so the user can stop+save/retry later.
        const msg = err?.message || String(err);
        setUploadStatus(
          `Upload/transcription stalled on chunk ${item.index + 1}: ${msg} (will keep retrying)`,
        );
        await sleep(jitteredDelayMs(Math.min(item.attempt, 6)));
      }
    }
  } finally {
    uploadInFlight = false;
    updateUploadBacklogUI();
  }
}

async function uploadChunkWithRetry(item) {
  let lastErr = null;
  for (let attempt = item.attempt; attempt <= MAX_UPLOAD_RETRIES; attempt++) {
    item.attempt = attempt;
    try {
      return await uploadChunk(item);
    } catch (err) {
      lastErr = err;
      item.lastError = err?.message || String(err);

      // Most 4xx errors are not recoverable by retrying (bad auth, empty chunk, etc.).
      const status = err?.status;
      if (status && status >= 400 && status < 500 && status !== 429) {
        throw err;
      }

      // If recording has ended, we still keep retrying; long sessions often finish with a backlog.
      const delay = jitteredDelayMs(attempt);
      setUploadStatus(
        `Retrying chunk ${item.index + 1} in ${Math.ceil(delay / 1000)}s (attempt ${attempt + 1}/${MAX_UPLOAD_RETRIES + 1})...`,
      );
      await sleep(delay);
    }
  }
  throw lastErr || new Error('Failed to upload/transcribe chunk');
}

async function uploadChunk(item) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const formData = new FormData();
    // Preserve the container/codec in the part's Content-Type via Blob.type.
    const mt = item.mimeType || item.blob.type || '';
    const ext = mt.includes('ogg') ? 'ogg' : mt.includes('webm') ? 'webm' : 'bin';
    formData.append('audio', item.blob, `chunk_${item.index}.${ext}`);
    formData.append('password', cachedPassword);
    formData.append('chunkIndex', String(item.index));
    formData.append('sessionId', item.sessionId);
    formData.append('mimeType', item.mimeType);

    const res = await fetch('/api/transcribe', {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const err = new Error(data.error || 'Failed to transcribe audio chunk');
      err.status = res.status;
      throw err;
    }
    if (!data.transcript) {
      throw new Error('Server returned no transcript for this chunk');
    }
    return data.transcript;
  } catch (e) {
    // Make AbortError messages more actionable.
    if (e?.name === 'AbortError') {
      const err = new Error('Upload timed out. Check your connection and server load.');
      err.status = 0;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Disable recording button initially
recordBtn.disabled = true;

// Add Enter key support for password input
passwordInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    authenticateBtn.click();
  }
});

authenticateBtn.addEventListener('click', async () => {
  const password = passwordInput.value;
  if (!password) {
    alert('Please enter a password');
    return;
  }

  try {
    authenticateBtn.disabled = true;
    authenticateBtn.textContent = 'Authenticating...';
    
    const response = await fetch('/api/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });

    const data = await response.json();

    if (response.ok) {
      cachedPassword = password;
      isAuthenticated = true;
      authSection.classList.add('hidden');
      authStatus.classList.remove('hidden');
      recordBtn.disabled = false;
      // If a long-session upload stalled due to auth, resume now.
      if (uploadQueue.length > 0) {
        void processUploadQueue();
      }
    } else {
      alert('Authentication failed: ' + (data.error || 'Invalid password'));
      authenticateBtn.disabled = false;
      authenticateBtn.textContent = 'Authenticate';
    }
  } catch (error) {
    console.error('Authentication error:', error);
    alert('Authentication error: ' + error.message);
    authenticateBtn.disabled = false;
    authenticateBtn.textContent = 'Authenticate';
  }
});

recordBtn.addEventListener('click', async () => {
  if (!isAuthenticated) {
    alert('Please authenticate first');
    return;
  }
  
  // show recording indicator
  recordIndicator.classList.remove('hidden');
  setUploadStatus('');
  // change button color to light grey
  recordBtn.classList.remove('bg-blue-500', 'text-white');
  recordBtn.classList.add('bg-gray-300', 'text-gray-700');
  transcriptEl.value = '';
  summaryEl.value = '';
  copyTranscriptBtn.disabled = true;
  copySummaryBtn.disabled = true;
  copyBothBtn.disabled = true;
  summarizeBtn.disabled = true;
  stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  isRecording = true;
  activeRecordingSessionId = makeSessionId();
  nextChunkIndex = 0;
  uploadQueue = [];

  const mimeType = pickBestAudioMimeType();
  try {
    mediaRecorder = mimeType
      ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: AUDIO_BITS_PER_SECOND })
      : new MediaRecorder(stream);
  } catch (e) {
    // Some browsers are picky about mimeType even if isTypeSupported returned true.
    mediaRecorder = new MediaRecorder(stream, { audioBitsPerSecond: AUDIO_BITS_PER_SECOND });
  }

  mediaRecorder.ondataavailable = (e) => {
    // The final chunk is emitted after stop() as well; keep enqueuing as long as
    // this session is still active.
    if (!activeRecordingSessionId) return;
    if (e.data && e.data.size > 0) {
      enqueueChunk(e.data, mediaRecorder.mimeType || mimeType);
    }
  };

  mediaRecorder.onerror = (e) => {
    console.error('MediaRecorder error:', e);
    setUploadStatus('Recording error: your browser could not encode audio reliably. Try Chrome/Edge.');
  };

  mediaRecorder.onstop = () => {
    stream.getTracks().forEach((track) => track.stop());
  };

  // Timeslice makes the recorder emit a chunk every CHUNK_DURATION_MS without stop/restart gaps.
  mediaRecorder.start(CHUNK_DURATION_MS);
  updateUploadBacklogUI();
  recordBtn.disabled = true;
  stopBtn.disabled = false;
});

stopBtn.addEventListener('click', () => {
  // hide recording indicator
  recordIndicator.classList.add('hidden');
  // keep record disabled until all chunks are uploaded, to avoid mixing sessions.
  recordBtn.disabled = true;
  // restore button color
  recordBtn.classList.remove('bg-gray-300', 'text-gray-700');
  recordBtn.classList.add('bg-blue-500', 'text-white');
  isRecording = false;
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }
  stopBtn.disabled = true;
  updateUploadBacklogUI();
});

// Intentionally no "sendChunk" that can stop the recorder; long sessions need to keep recording
// even if a single chunk upload/transcription fails. Upload happens via the queue above.


summarizeBtn.addEventListener('click', async () => {
  if (isRecording || uploadQueue.length > 0 || uploadInFlight) {
    alert('Please wait until recording stops and all audio chunks finish uploading/transcribing.');
    return;
  }
  // Show summary indicator and disable button
  summaryIndicator.classList.remove('hidden');
  summarizeBtn.disabled = true;
  
  try {
    const sumRes = await fetch('/api/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        transcript: transcriptEl.value,
        password: cachedPassword
      })
    });
    const sumData = await sumRes.json();
    summaryEl.value = sumData.summary;
    copySummaryBtn.disabled = false;
    if (transcriptEl.value.trim()) {
      copyBothBtn.disabled = false;
    }
  } catch (error) {
    console.error('Error generating summary:', error);
    alert('Error generating summary: ' + error.message);
  } finally {
    // Hide summary indicator and re-enable button
    summaryIndicator.classList.add('hidden');
    summarizeBtn.disabled = false;
  }
});

copyTranscriptBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(transcriptEl.value);
});

copySummaryBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(summaryEl.value);
});

copyBothBtn.addEventListener('click', async () => {
  const text = `Transcript:\n${transcriptEl.value}\n\nSummary:\n${summaryEl.value}`;
  await navigator.clipboard.writeText(text);
});
