let mediaRecorder;
let stream;
const CHUNK_DURATION_MS = 60000; // 1 minute chunks

const recordBtn = document.getElementById('recordBtn');
const stopBtn = document.getElementById('stopBtn');
const summarizeBtn = document.getElementById('summarizeBtn');
const transcriptEl = document.getElementById('transcript');
const summaryEl = document.getElementById('summary');
const copyTranscriptBtn = document.getElementById('copyTranscript');
const copySummaryBtn = document.getElementById('copySummary');
const copyBothBtn = document.getElementById('copyBoth');

recordBtn.addEventListener('click', async () => {
  transcriptEl.value = '';
  summaryEl.value = '';
  copyTranscriptBtn.disabled = true;
  copySummaryBtn.disabled = true;
  copyBothBtn.disabled = true;
  summarizeBtn.disabled = true;
  stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
  mediaRecorder.ondataavailable = async (e) => {
    if (e.data.size > 0) {
      await sendChunk(e.data);
    }
  };
  mediaRecorder.onstop = () => {
    stream.getTracks().forEach((track) => track.stop());
  };
  mediaRecorder.start(CHUNK_DURATION_MS);
  recordBtn.disabled = true;
  stopBtn.disabled = false;
});

stopBtn.addEventListener('click', () => {
  mediaRecorder.stop();
  recordBtn.disabled = false;
  stopBtn.disabled = true;
});

async function sendChunk(blob) {
  const formData = new FormData();
  formData.append('audio', blob, 'chunk.webm');
  const res = await fetch('/api/transcribe', { method: 'POST', body: formData });
  const data = await res.json();
  if (res.ok) {
    transcriptEl.value += data.transcript + ' ';
    copyTranscriptBtn.disabled = false;
    summarizeBtn.disabled = false;
    if (summaryEl.value.trim()) {
      copyBothBtn.disabled = false;
    }
  }
}


summarizeBtn.addEventListener('click', async () => {
  const sumRes = await fetch('/api/summarize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript: transcriptEl.value })
  });
  const sumData = await sumRes.json();
  summaryEl.value = sumData.summary;
  copySummaryBtn.disabled = false;
  if (transcriptEl.value.trim()) {
    copyBothBtn.disabled = false;
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
