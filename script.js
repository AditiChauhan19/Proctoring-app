// script.js
// Focus & Object Detection — frontend logic
// Author: Generated for Tutedude SDE Assignment
// Updated: Fixed faceLandmarksDetection reference + stability tweaks

if (typeof faceLandmarksDetection === "undefined") {
  console.error("❌ faceLandmarksDetection not loaded. Check script include.");
} else {
  console.log("✅ faceLandmarksDetection loaded:", faceLandmarksDetection);
}


const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const ctx = overlay.getContext('2d');
const logEl = document.getElementById('log');
const candidateNameInput = document.getElementById('candidateName');
const backendUrlInput = document.getElementById('backendUrl');

const startBtn = document.getElementById('startSession');
const stopBtn = document.getElementById('stopSession');
const startRecBtn = document.getElementById('startRec');
const stopRecBtn = document.getElementById('stopRec');
const csvBtn = document.getElementById('downloadCSV');
const pdfBtn = document.getElementById('downloadPDF');

const sessionStatus = document.getElementById('sessionStatus');
const integrityScoreEl = document.getElementById('integrityScore');
const recordingStatusEl = document.getElementById('recordingStatus');

let faceModel = null;
let cocoModel = null;
let detectionRunning = false;
let objLoopTimer = null;
let detectAnimationFrame = null;

let events = []; // { type, timestamp, meta }
let eventCooldowns = {}; // avoid flooding same event every frame
const COOLDOWN_MS = 3000;

let mediaRecorder = null;
let recordedBlobs = [];
let stream = null;
let sessionStartTime = null;
let sessionEndTime = null;

const scoreRules = {
  looking_away: -2,
  no_face: -5,
  phone_detected: -10,
  book_detected: -3,
  multiple_faces: -15
};

function log(msg, severity='info') {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  const div = document.createElement('div');
  div.textContent = line;
  if (severity === 'warn') div.style.color = '#ffcc00';
  if (severity === 'err') div.style.color = '#ff6b6b';
  logEl.prepend(div);
  console.log(line);
}

function addEvent(type, meta = {}) {
  const now = Date.now();
  if (eventCooldowns[type] && now - eventCooldowns[type] < COOLDOWN_MS) return;
  eventCooldowns[type] = now;

  const e = { candidate: candidateNameInput.value || 'Unknown', type, timestamp: now, meta };
  events.push(e);
  log(`EVENT: ${type} ${JSON.stringify(meta)}`, type === 'no_face' ? 'warn' : 'info');

  const backend = backendUrlInput.value.trim();
  if (backend) {
    try {
      fetch(backend.replace(/\/$/, '') + '/logs', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify(e)
      }).catch(() => log('Failed to POST log to backend', 'err'));
    } catch(err) { console.warn(err); }
  }

  updateScore();
}

function updateScore() {
  let score = 100;
  for (const ev of events) {
    if (scoreRules[ev.type]) score += scoreRules[ev.type];
  }
  if (score < 0) score = 0;
  integrityScoreEl.textContent = `Score: ${score}`;
}

// --- Camera + MediaRecorder ---
async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: true });
    video.srcObject = stream;
    await video.play();
    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;
    log('Camera started');
  } catch (err) {
    log('Camera permission denied or not available: ' + err.message, 'err');
    throw err;
  }
}

function startRecording() {
  recordedBlobs = [];
  if (!stream) return log('No stream to record', 'err');
  const options = { mimeType: 'video/webm;codecs=vp8,opus' };
  try {
    mediaRecorder = new MediaRecorder(stream, options);
  } catch (e) {
    log('MediaRecorder error: ' + e.message, 'err');
    return;
  }
  mediaRecorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) recordedBlobs.push(ev.data);
  };
  mediaRecorder.start(1000);
  recordingStatusEl.textContent = 'Recording: Yes';
  log('Recording started');
}

function stopRecording() {
  if (!mediaRecorder) return;
  mediaRecorder.stop();
  recordingStatusEl.textContent = 'Recording: No';
  log('Recording stopped — preparing download');

  const blob = new Blob(recordedBlobs, { type: 'video/webm' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'block';
  a.href = url;
  a.download = `${(candidateNameInput.value||'candidate')}_session_${Date.now()}.webm`;
  a.textContent = 'Download recorded video';
  a.className = 'small';
  document.body.appendChild(a);
}

// --- Load models ---
async function loadModels() {
  sessionStatus.textContent = 'Loading models...';
  try {
    await tf.setBackend('webgl');
    await tf.ready();
  } catch (e) { console.warn('tf backend set failed', e); }

  if (!window.faceLandmarksDetection) {
    log('faceLandmarksDetection not loaded — check script includes!', 'err');
    throw new Error('faceLandmarksDetection missing');
  }

  log('Loading face landmarks model (MediaPipe facemesh)...');
  faceModel = await faceLandmarksDetection.load(faceLandmarksDetection.SupportedPackages.mediapipeFacemesh);
  log('Face model loaded');

  log('Loading object detection (coco-ssd)...');
  cocoModel = await cocoSsd.load();
  log('Coco-SSD loaded');

  sessionStatus.textContent = 'Models loaded';
}

// --- Detection logic ---
let noFaceStart = null;
let lookAwayStart = null;

async function detectLoop() {
  if (!detectionRunning) return;
  if (!faceModel) { detectAnimationFrame = requestAnimationFrame(detectLoop); return; }

  try {
    const predictions = await faceModel.estimateFaces({ input: video, returnTensors: false, flipHorizontal: false });
    const now = Date.now();

    ctx.clearRect(0,0,overlay.width, overlay.height);

    if (!predictions || predictions.length === 0) {
      if (!noFaceStart) noFaceStart = now;
      if (now - noFaceStart > 10000) addEvent('no_face', { duration_ms: now - noFaceStart });
      lookAwayStart = null;
      ctx.fillStyle = 'rgba(255,0,0,0.15)'; ctx.fillRect(0,0,overlay.width, overlay.height);
    } else {
      noFaceStart = null;
      if (predictions.length > 1) addEvent('multiple_faces', { count: predictions.length });

      const face = predictions[0];
      const keypoints = face.scaledMesh;

      const leftEye = keypoints[33];
      const rightEye = keypoints[263];
      const noseTip = keypoints[1];

      const xs = keypoints.map(p => p[0]);
      const ys = keypoints.map(p => p[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      ctx.strokeStyle = 'rgba(0,200,80,0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(minX, minY, maxX-minX, maxY-minY);

      ctx.fillStyle = '#ff206e';
      ctx.beginPath(); ctx.arc(noseTip[0], noseTip[1], 4, 0, Math.PI*2); ctx.fill();

      const eyeCx = (leftEye[0] + rightEye[0]) / 2;
      const dx = noseTip[0] - eyeCx;
      const faceWidth = Math.hypot(rightEye[0] - leftEye[0], rightEye[1] - leftEye[1]);
      const normalized = dx / faceWidth;

      const LOOKAWAY_THRESHOLD = 0.35;

      if (Math.abs(normalized) > LOOKAWAY_THRESHOLD) {
        if (!lookAwayStart) lookAwayStart = now;
        if (now - lookAwayStart > 5000) addEvent('looking_away', { normalized: normalized.toFixed(3) });
        ctx.fillStyle = 'rgba(255,165,0,0.08)'; ctx.fillRect(minX, minY, maxX-minX, maxY-minY);
      } else {
        lookAwayStart = null;
      }
    }
  } catch (err) {
    console.error('Face detect error', err);
  }

  detectAnimationFrame = requestAnimationFrame(detectLoop);
}

async function startObjectLoop() {
  if (!cocoModel || !detectionRunning) return;
  try {
    const predictions = await cocoModel.detect(video);
    for (const p of predictions) {
      const label = (p.class || '').toLowerCase();
      if (label.includes('phone') || label.includes('mobile')) {
        addEvent('phone_detected', { score: p.score.toFixed(2), bbox: p.bbox });
      }
      if (label.includes('book')) {
        addEvent('book_detected', { score: p.score.toFixed(2), bbox: p.bbox });
      }
      ctx.strokeStyle = '#60a5fa';
      ctx.lineWidth = 2;
      ctx.strokeRect(p.bbox[0], p.bbox[1], p.bbox[2], p.bbox[3]);
      ctx.fillStyle = '#60a5fa';
      ctx.font = '14px Arial';
      ctx.fillText(`${p.class} (${(p.score*100).toFixed(0)}%)`, p.bbox[0], p.bbox[1] > 16 ? p.bbox[1]-6 : p.bbox[1]+14);
    }
  } catch(err) {
    console.warn('Object detect err', err);
  }
  objLoopTimer = setTimeout(startObjectLoop, 1000);
}

// --- Session control ---
startBtn.addEventListener('click', async () => {
  try {
    startBtn.disabled = true;
    await startCamera();
    await loadModels();
    detectionRunning = true;
    sessionStartTime = Date.now();
    sessionStatus.textContent = 'Session: Running';
    stopBtn.disabled = false;
    startRecBtn.disabled = false;

    detectLoop();
    startObjectLoop();
    log('Session started');
  } catch (err) {
    log('Failed to start session: ' + err.message, 'err');
    startBtn.disabled = false;
  }
});

stopBtn.addEventListener('click', () => {
  detectionRunning = false;
  sessionEndTime = Date.now();
  sessionStatus.textContent = 'Session: Stopped';
  stopBtn.disabled = true;
  startBtn.disabled = false;
  startRecBtn.disabled = true;
  stopRecBtn.disabled = true;

  if (detectAnimationFrame) cancelAnimationFrame(detectAnimationFrame);
  if (objLoopTimer) clearTimeout(objLoopTimer);
  log('Session stopped');
});

startRecBtn.addEventListener('click', () => {
  startRecBtn.disabled = true;
  stopRecBtn.disabled = false;
  startRecording();
});

stopRecBtn.addEventListener('click', () => {
  stopRecBtn.disabled = true;
  startRecBtn.disabled = false;
  stopRecording();
});

// --- Exports: CSV & PDF ---
function generateCSV(eventsList) {
  const rows = [['candidate','type','timestamp_iso','timestamp_ms','meta']];
  for (const ev of eventsList) {
    rows.push([
      `"${ev.candidate}"`,
      ev.type,
      new Date(ev.timestamp).toISOString(),
      ev.timestamp,
      `"${JSON.stringify(ev.meta).replace(/"/g,'""')}"`
    ]);
  }
  return rows.map(r => r.join(',')).join('\n');
}

csvBtn.addEventListener('click', () => {
  if (events.length === 0) {
    log('No events to export', 'warn'); return;
  }
  const csv = generateCSV(events);
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(candidateNameInput.value||'candidate')}_proctor_report_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  log('CSV exported');
});

pdfBtn.addEventListener('click', () => {
  if (!window.jspdf) {
    log('jsPDF not loaded', 'err'); return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const candidate = candidateNameInput.value || 'Unknown';
  const startISO = sessionStartTime ? new Date(sessionStartTime).toISOString() : 'N/A';
  const endISO = sessionEndTime ? new Date(sessionEndTime).toISOString() : new Date().toISOString();
  doc.setFontSize(14);
  doc.text('Proctoring Report', 14, 20);
  doc.setFontSize(11);
  doc.text(`Candidate: ${candidate}`, 14, 30);
  doc.text(`Session start: ${startISO}`, 14, 36);
  doc.text(`Session end: ${endISO}`, 14, 42);
  doc.text(`Total events: ${events.length}`, 14, 50);
  doc.text(`Integrity ${integrityScoreEl.textContent}`, 14, 56);
  let y = 66;
  for (const ev of events.slice(0,40)) {
    const line = `${new Date(ev.timestamp).toISOString()} — ${ev.type} ${JSON.stringify(ev.meta)}`;
    doc.text(line, 14, y);
    y += 6;
    if (y > 280) { doc.addPage(); y = 20; }
  }
  const pdfName = `${candidate}_proctor_report_${Date.now()}.pdf`;
  doc.save(pdfName);
  log('PDF generated: ' + pdfName);
});

window.addEventListener('beforeunload', () => {
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
  }
});
