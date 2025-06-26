let mediaRecorder;
let stream;
let isRecording = false;
let cachedPassword = null;
let isAuthenticated = false;
const CHUNK_DURATION_MS = 60000; // 1 minute chunks

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
const authenticateBtn = document.getElementById('authenticateBtn');
const passwordInput = document.getElementById('password');
const authSection = document.getElementById('authSection');
const authStatus = document.getElementById('authStatus');

// helper to start a new recorder for each segment
async function startNewRecorder() {
  mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
  mediaRecorder.ondataavailable = async (e) => {
    if (e.data.size > 0) {
      await sendChunk(e.data);
    }
  };
  mediaRecorder.onstop = () => {
    // if still recording, start again for next chunk
    if (isRecording) startNewRecorder();
    else stream.getTracks().forEach(track => track.stop());
  };
  mediaRecorder.start();
  // stop this recorder after one chunk duration so each blob gets full headers
  setTimeout(() => {
    if (mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    }
  }, CHUNK_DURATION_MS);
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
      alert('Authentication successful! You can now start recording.');
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
  startNewRecorder();
  recordBtn.disabled = true;
  stopBtn.disabled = false;
});

stopBtn.addEventListener('click', () => {
  // hide recording indicator
  recordIndicator.classList.add('hidden');
  // restore button color
  recordBtn.classList.remove('bg-gray-300', 'text-gray-700');
  recordBtn.classList.add('bg-blue-500', 'text-white');
  isRecording = false;
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }
  recordBtn.disabled = false;
  stopBtn.disabled = true;
});

async function sendChunk(blob) {
  try {
    const formData = new FormData();
    formData.append('audio', blob, 'chunk.webm');
    formData.append('password', cachedPassword);
    const res = await fetch('/api/transcribe', { method: 'POST', body: formData });
    const data = await res.json();
    
    if (!res.ok) {
      throw new Error(data.error || 'Failed to transcribe audio chunk');
    }
    
    transcriptEl.value += data.transcript + ' ';
    copyTranscriptBtn.disabled = false;
    summarizeBtn.disabled = false;
    if (summaryEl.value.trim()) {
      copyBothBtn.disabled = false;
    }
  } catch (error) {
    console.error('Error sending chunk:', error);
    // Stop recording on error to prevent further failed chunks
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    }
    // hide recording indicator
    recordIndicator.classList.add('hidden');
    // restore button color
    recordBtn.classList.remove('bg-gray-300', 'text-gray-700');
    recordBtn.classList.add('bg-blue-500', 'text-white');
    recordBtn.disabled = false;
    stopBtn.disabled = true;
    alert('Error transcribing audio: ' + error.message);
  }
}


summarizeBtn.addEventListener('click', async () => {
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
