// popup.js — ApplyAI Chrome Extension

const uploadZone   = document.getElementById('uploadZone');
const resumeInput  = document.getElementById('resumeInput');
const uploadMain   = document.getElementById('uploadMain');
const fileInfo     = document.getElementById('fileInfo');
const fileName     = document.getElementById('fileName');
const removeBtn    = document.getElementById('removeBtn');
const parseStatus  = document.getElementById('parseStatus');
const parseText    = document.getElementById('parseText');
const parseSpinner = document.getElementById('parseSpinner');
const autofillBtn  = document.getElementById('autofillBtn');
const matchBtn     = document.getElementById('matchBtn');
const matchResult  = document.getElementById('matchResult');
const scoreBadge   = document.getElementById('scoreBadge');
const scoreFill    = document.getElementById('scoreFill');
const scoreBreakdown = document.getElementById('scoreBreakdown');
const fillStatus   = document.getElementById('fillStatus');
const fillText     = document.getElementById('fillText');
const statusDot    = document.getElementById('statusDot');
const statusLabel  = document.getElementById('statusLabel');

// ── Init ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Load saved resume from storage
  chrome.storage.local.get(['resumeData', 'resumeName'], (result) => {
    if (result.resumeData && result.resumeName) {
      showFileLoaded(result.resumeName);
      enableButtons();
    }
  });
});

// ── Upload Zone — Click ───────────────────────────────
uploadZone.addEventListener('click', () => resumeInput.click());

// ── Upload Zone — Drag & Drop ─────────────────────────
uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadZone.classList.add('drag-over');
});

uploadZone.addEventListener('dragleave', () => {
  uploadZone.classList.remove('drag-over');
});

uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

// ── File Input Change ─────────────────────────────────
resumeInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) handleFile(file);
});

// ── Handle File ───────────────────────────────────────
function handleFile(file) {
  const allowed = ['application/pdf',
                   'application/msword',
                   'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
  if (!allowed.includes(file.type)) {
    showFillStatus('Unsupported format. Use PDF or DOC/DOCX.', false);
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showFillStatus('File too large. Max size is 5MB.', false);
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const base64 = e.target.result;
    chrome.storage.local.set({ resumeData: base64, resumeName: file.name }, () => {
      showFileLoaded(file.name);
      parseResume(file.name, base64);
    });
  };
  reader.readAsDataURL(file);
}

// ── Show File Loaded ──────────────────────────────────
function showFileLoaded(name) {
  uploadZone.classList.add('has-file');
  uploadMain.textContent = 'Resume uploaded';
  fileName.textContent = name;
  fileInfo.style.display = 'flex';
  statusDot.classList.add('active');
  if (statusLabel) statusLabel.textContent = 'Ready';
}

// ── Remove Resume ─────────────────────────────────────
removeBtn.addEventListener('click', () => {
  chrome.storage.local.remove(['resumeData', 'resumeName', 'parsedResume'], () => {
    uploadZone.classList.remove('has-file');
    uploadMain.textContent = 'Click or drag & drop your resume';
    fileInfo.style.display = 'none';
    parseStatus.style.display = 'none';
    matchResult.style.display = 'none';
    fillStatus.style.display = 'none';
    statusDot.classList.remove('active');
    if (statusLabel) statusLabel.textContent = 'Idle';
    disableButtons();
    resumeInput.value = '';
  });
});

// ── Parse Resume (calls backend) ──────────────────────
async function parseResume(name, base64Data) {
  parseStatus.style.display = 'flex';
  parseText.textContent = 'Parsing resume...';
  parseSpinner.style.display = 'block';

  try {
    const response = await fetch('http://localhost:8000/parse-resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: base64Data, filename: name })
    });

    if (!response.ok) throw new Error('Parse failed');
    const data = await response.json();

    chrome.storage.local.set({ parsedResume: data.parsed }, () => {
      parseText.textContent = 'Resume parsed successfully';
      parseSpinner.style.display = 'none';
      enableButtons();
      setTimeout(() => { parseStatus.style.display = 'none'; }, 2500);
    });
  } catch (err) {
    parseText.textContent = 'Could not reach server — resume saved locally';
    parseSpinner.style.display = 'none';
    enableButtons();
    setTimeout(() => { parseStatus.style.display = 'none'; }, 3000);
  }
}

// ── Autofill Button ───────────────────────────────────
autofillBtn.addEventListener('click', async () => {
  autofillBtn.disabled = true;
  fillStatus.style.display = 'none';

  chrome.storage.local.get(['parsedResume', 'resumeData', 'resumeName'], async (result) => {
    if (!result.resumeData) {
      showFillStatus('No resume uploaded yet.', false);
      autofillBtn.disabled = false;
      return;
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Ask content script to collect form fields
    chrome.tabs.sendMessage(tab.id, { action: 'getFormFields' }, async (fields) => {
      if (chrome.runtime.lastError || !fields) {
        showFillStatus('No form fields detected on this page.', false);
        autofillBtn.disabled = false;
        return;
      }

      try {
        const response = await fetch('http://localhost:8000/autofill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields,
            resume: result.parsedResume || null
          })
        });

        if (!response.ok) throw new Error('Autofill failed');
        const { filled } = await response.json();

        // Send filled values back to content script
        chrome.tabs.sendMessage(tab.id, { action: 'fillForm', data: filled }, (res) => {
          if (res?.success) {
            showFillStatus(`${res.count} field(s) filled successfully!`, true);
          } else {
            showFillStatus('Filled what was possible on this page.', true);
          }
        });
      } catch {
        showFillStatus('Server unreachable. Make sure the backend is running.', false);
      }
      autofillBtn.disabled = false;
    });
  });
});

// ── Match Score Button ────────────────────────────────
matchBtn.addEventListener('click', async () => {
  matchBtn.disabled = true;
  matchResult.style.display = 'none';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.storage.local.get(['parsedResume', 'resumeData'], async (result) => {
    if (!result.resumeData) {
      showFillStatus('No resume uploaded yet.', false);
      matchBtn.disabled = false;
      return;
    }

    // Ask content script for page text (job description)
    chrome.tabs.sendMessage(tab.id, { action: 'getPageText' }, async (pageText) => {
      if (chrome.runtime.lastError || !pageText) {
        showFillStatus('Could not read page content.', false);
        matchBtn.disabled = false;
        return;
      }

      try {
        const response = await fetch('http://localhost:8000/match-score', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            resume: result.parsedResume || null,
            jobDescription: pageText
          })
        });

        if (!response.ok) throw new Error('Match failed');
        const data = await response.json();
        displayMatchScore(data);
      } catch {
        showFillStatus('Server unreachable. Make sure the backend is running.', false);
      }
      matchBtn.disabled = false;
    });
  });
});

// ── Display Match Score ───────────────────────────────
function displayMatchScore(data) {
  const score = data.score || 0;
  matchResult.style.display = 'flex';

  scoreBadge.textContent = `${score}%`;
  scoreFill.style.width = `${score}%`;

  // Color coding
  const level = score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';
  scoreBadge.className = `score-badge ${level}`;
  scoreFill.className = `score-fill ${level}`;

  // Breakdown items
  scoreBreakdown.innerHTML = '';
  if (data.breakdown) {
    for (const [key, val] of Object.entries(data.breakdown)) {
      const item = document.createElement('div');
      item.className = 'breakdown-item';
      item.innerHTML = `<span>${key}</span><span>${val}%</span>`;
      scoreBreakdown.appendChild(item);
    }
  }
}

// ── Fill Status Helper ────────────────────────────────
function showFillStatus(message, success) {
  fillStatus.style.display = 'flex';
  fillStatus.className = `toast${success ? '' : ' error'}`;
  fillText.textContent = message;
  const icon = document.getElementById('toastIcon');
  icon.innerHTML = success
    ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="white" stroke-width="2.5" stroke-linecap="round"/></svg>`;
}

function enableButtons() {
  autofillBtn.disabled = false;
  matchBtn.disabled = false;
}

function disableButtons() {
  autofillBtn.disabled = true;
  matchBtn.disabled = true;
}
