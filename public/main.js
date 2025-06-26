let mediaRecorder;
let stream;
let isRecording = false;
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

recordBtn.addEventListener('click', async () => {
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
    const password = document.getElementById('password').value;
    const formData = new FormData();
    formData.append('audio', blob, 'chunk.webm');
    formData.append('password', password);
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
    const password = document.getElementById('password').value;
    const sumRes = await fetch('/api/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        transcript: transcriptEl.value,
        password: password
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
