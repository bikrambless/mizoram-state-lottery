/**
 * MIZORAM STATE LOTTERY - OFFICIAL PORTAL CLIENT SCRIPT
 * Updated: Dual Draws at 2:00 PM & 9:00 PM IST (Both displayed Full Frame)
 */

// State
const state = {
  currentDate: getTodayIST(),
  latestResults: { day: null, night: null },
  dayResult: null,
  nightResult: null,
  activeLightboxResult: null,
  lightbox: {
    scale: 1,
    rotation: 0,
    translateX: 0,
    translateY: 0,
    isDragging: false,
    startX: 0,
    startY: 0
  }
};

// Helper: Get today's date formatted as YYYY-MM-DD in IST
function getTodayIST() {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);
  return istDate.toISOString().split('T')[0];
}

// Helper: Format Date string to readable English
function formatDateReadable(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00+05:30');
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

// -------------------------------------------------------------
// 1. LIVE INDIAN STANDARD TIME (IST) CLOCK
// -------------------------------------------------------------
function startISTClock() {
  const clockEl = document.getElementById('ist-live-clock');
  if (!clockEl) return;

  function update() {
    const now = new Date();
    const istTimeStr = now.toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
    clockEl.textContent = `IST ${istTimeStr}`;
  }

  update();
  setInterval(update, 1000);
}

// -------------------------------------------------------------
// 2. DYNAMIC DRAW COUNTDOWN TIMER (MORNING & NIGHT)
// -------------------------------------------------------------
function startCountdownTimer() {
  const hoursEl = document.getElementById('hours');
  const minutesEl = document.getElementById('minutes');
  const secondsEl = document.getElementById('seconds');
  const upcomingTitleEl = document.getElementById('upcoming-draw-title');
  const statusBadgeEl = document.getElementById('countdown-status-indicator');

  function update() {
    const now = new Date();
    // Get IST time
    const istString = now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
    const istNow = new Date(istString);

    const nowHour = istNow.getHours();
    const nowMin = istNow.getMinutes();
    const nowSec = istNow.getSeconds();
    const nowTotalSeconds = (nowHour * 3600) + (nowMin * 60) + nowSec;

    // Slots in seconds from midnight: Morning 2:00 PM (50400) & Night 9:00 PM (75600)
    const morningDrawSeconds = 14 * 3600; // 02:00 PM (50400s)
    const nightDrawSeconds = 21 * 3600; // 09:00 PM (75600s)
    const dayEndSeconds = 24 * 3600;

    let targetSeconds = 0;
    let targetTitle = '';
    let isLiveNow = false;

    if (nowTotalSeconds < morningDrawSeconds) {
      targetSeconds = morningDrawSeconds;
      targetTitle = 'Morning Result (02:00 PM)';
      if (morningDrawSeconds - nowTotalSeconds <= 900) {
        isLiveNow = true;
      }
    } else if (nowTotalSeconds < nightDrawSeconds) {
      targetSeconds = nightDrawSeconds;
      targetTitle = 'Night Result (09:00 PM)';
      if (nightDrawSeconds - nowTotalSeconds <= 900) {
        isLiveNow = true;
      }
    } else {
      // Past 9:00 PM, next draw is tomorrow morning at 2:00 PM
      targetSeconds = dayEndSeconds + morningDrawSeconds;
      targetTitle = 'Tomorrow Morning Result (02:00 PM)';
    }

    const diffSeconds = targetSeconds - nowTotalSeconds;
    const hrs = Math.floor(diffSeconds / 3600);
    const mins = Math.floor((diffSeconds % 3600) / 60);
    const secs = Math.floor(diffSeconds % 60);

    if (hoursEl) hoursEl.textContent = String(hrs).padStart(2, '0');
    if (minutesEl) minutesEl.textContent = String(mins).padStart(2, '0');
    if (secondsEl) secondsEl.textContent = String(secs).padStart(2, '0');
    if (upcomingTitleEl) upcomingTitleEl.textContent = targetTitle;

    // Trigger instant check when countdown reaches exact draw second
    if (diffSeconds === 0 || diffSeconds === 1) {
      if (state.currentDate === getTodayIST()) {
        fetchLatestResults().then(() => loadBothResults());
      }
    }

    if (statusBadgeEl) {
      if (isLiveNow) {
        statusBadgeEl.innerHTML = '<span class="status-tag live">🔴 Live Draw In Progress</span>';
      } else {
        statusBadgeEl.innerHTML = '<span class="status-tag upcoming">Upcoming Draw</span>';
      }
    }
  }

  update();
  setInterval(update, 1000);
}

// -------------------------------------------------------------
// 3. FETCH & DISPLAY BOTH RESULTS IN FULL FRAME (MORNING & NIGHT)
// -------------------------------------------------------------
async function fetchLatestResults() {
  try {
    const res = await fetch('/api/results/latest');
    const data = await res.json();
    if (data.success) {
      state.latestResults = data;
    }
  } catch (err) {
    console.error('Failed to fetch latest results:', err);
  }
}

async function loadBothResults() {
  const displayDateText = document.getElementById('display-date-text');
  if (displayDateText) {
    displayDateText.textContent = formatDateReadable(state.currentDate);
  }

  // Load Morning and Night results simultaneously
  await Promise.all([
    loadSingleSlot('morning'),
    loadSingleSlot('night')
  ]);
}

async function loadSingleSlot(slot) {
  const isMorning = slot === 'morning' || slot === 'day';
  const prefix = isMorning ? 'day' : 'night';
  const slotName = isMorning ? 'Morning Result' : 'Night Result';

  const loader = document.getElementById(`${prefix}-loader`);
  const sheetImg = document.getElementById(`${prefix}-sheet-img`);
  const emptyView = document.getElementById(`${prefix}-empty`);
  const dateEl = document.getElementById(`${prefix}-draw-date`);
  const timeEl = document.getElementById(`${prefix}-draw-time`);
  const statusEl = document.getElementById(`${prefix}-draw-status`);
  const downloadBtn = document.getElementById(`btn-${prefix}-download`);

  if (loader) loader.style.display = 'flex';
  if (sheetImg) sheetImg.style.display = 'none';
  if (emptyView) emptyView.style.display = 'none';

  try {
    const url = `/api/results?date=${encodeURIComponent(state.currentDate)}&slot=${slot}&limit=1`;
    const res = await fetch(url);
    const data = await res.json();

    let result = null;
    if (data.success && data.results && data.results.length > 0) {
      result = data.results[0];
    } else if (state.currentDate === getTodayIST()) {
      if (isMorning) {
        result = state.latestResults.morning || state.latestResults.day;
      } else {
        result = state.latestResults.night;
      }
    }

    if (isMorning) state.dayResult = result;
    else state.nightResult = result;

    if (loader) loader.style.display = 'none';

    if (result) {
      if (dateEl) dateEl.textContent = formatDateReadable(result.draw_date);
      if (timeEl) timeEl.textContent = `${result.draw_time || (isMorning ? '02:00 PM' : '09:00 PM')} IST`;
      if (statusEl) {
        statusEl.textContent = 'Result Published • Official';
        statusEl.className = 'meta-val text-success';
      }

      if (sheetImg) {
        sheetImg.src = result.image_url;
        sheetImg.alt = `${slotName} Official Result Sheet`;
        sheetImg.style.display = 'block';
        sheetImg.onclick = () => openLightboxModal(result);
      }

      if (downloadBtn) {
        downloadBtn.href = result.image_url;
        downloadBtn.setAttribute('download', `Mizoram_${isMorning ? 'Morning' : 'Night'}_Result_${result.draw_date}.jpg`);
      }
    } else {
      // Empty state for this slot
      if (dateEl) dateEl.textContent = formatDateReadable(state.currentDate);
      if (timeEl) timeEl.textContent = isMorning ? '02:00 PM IST' : '09:00 PM IST';
      if (statusEl) {
        statusEl.textContent = 'Pending / Not Uploaded';
        statusEl.className = 'meta-val';
        statusEl.style.color = 'var(--text-muted)';
      }
      if (emptyView) emptyView.style.display = 'block';
    }
  } catch (err) {
    console.error(`Error loading ${slot} result:`, err);
    if (loader) loader.style.display = 'none';
    if (emptyView) emptyView.style.display = 'block';
  }
}

// -------------------------------------------------------------
// 4. FULLSCREEN LIGHTBOX VIEWER
// -------------------------------------------------------------
function setupLightbox() {
  const modal = document.getElementById('lightbox-modal');
  const backdrop = document.getElementById('lightbox-backdrop');
  const closeBtn = document.getElementById('tool-close-lightbox');
  const stage = document.getElementById('lightbox-stage');
  const layer = document.getElementById('lightbox-layer');
  const img = document.getElementById('lightbox-img');
  const titleEl = document.getElementById('lightbox-title');
  const badgeEl = document.getElementById('lightbox-slot-badge');
  const downloadBtn = document.getElementById('lightbox-download-btn');
  const zoomText = document.getElementById('zoom-level-text');

  const zoomInBtn = document.getElementById('tool-zoom-in');
  const zoomOutBtn = document.getElementById('tool-zoom-out');
  const resetBtn = document.getElementById('tool-reset');
  const rotateBtn = document.getElementById('tool-rotate');

  window.openLightboxModal = function(result) {
    if (!result) return;
    state.activeLightboxResult = result;
    const isMorning = result.slot === 'morning' || result.slot === 'day';
    const slotTitle = isMorning ? 'Morning Result' : 'Night Result';

    img.src = result.image_url;
    titleEl.textContent = `${slotTitle} (${formatDateReadable(result.draw_date)})`;
    badgeEl.textContent = `${isMorning ? 'MORNING' : 'NIGHT'} • ${result.draw_time || (isMorning ? '02:00 PM' : '09:00 PM')}`;
    downloadBtn.href = result.image_url;
    downloadBtn.setAttribute('download', `Mizoram_${isMorning ? 'Morning' : 'Night'}_Result_${result.draw_date}.jpg`);

    resetTransform();
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  };

  function closeModal() {
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function applyTransform() {
    if (!layer) return;
    layer.style.transform = `translate(${state.lightbox.translateX}px, ${state.lightbox.translateY}px) scale(${state.lightbox.scale}) rotate(${state.lightbox.rotation}deg)`;
    if (zoomText) {
      zoomText.textContent = `${Math.round(state.lightbox.scale * 100)}%`;
    }
  }

  function resetTransform() {
    state.lightbox.scale = 1;
    state.lightbox.rotation = 0;
    state.lightbox.translateX = 0;
    state.lightbox.translateY = 0;
    applyTransform();
  }

  function zoomIn() {
    state.lightbox.scale = Math.min(state.lightbox.scale + 0.25, 4);
    applyTransform();
  }

  function zoomOut() {
    state.lightbox.scale = Math.max(state.lightbox.scale - 0.25, 0.5);
    applyTransform();
  }

  function rotate() {
    state.lightbox.rotation = (state.lightbox.rotation + 90) % 360;
    applyTransform();
  }

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (backdrop) backdrop.addEventListener('click', closeModal);

  if (zoomInBtn) zoomInBtn.addEventListener('click', zoomIn);
  if (zoomOutBtn) zoomOutBtn.addEventListener('click', zoomOut);
  if (resetBtn) resetBtn.addEventListener('click', resetTransform);
  if (rotateBtn) rotateBtn.addEventListener('click', rotate);

  // Mouse wheel zoom
  if (stage) {
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.deltaY < 0) {
        state.lightbox.scale = Math.min(state.lightbox.scale + 0.15, 4);
      } else {
        state.lightbox.scale = Math.max(state.lightbox.scale - 0.15, 0.5);
      }
      applyTransform();
    }, { passive: false });

    // Drag / Pan mouse events
    stage.addEventListener('mousedown', (e) => {
      state.lightbox.isDragging = true;
      state.lightbox.startX = e.clientX - state.lightbox.translateX;
      state.lightbox.startY = e.clientY - state.lightbox.translateY;
      stage.classList.add('dragging');
    });

    window.addEventListener('mousemove', (e) => {
      if (!state.lightbox.isDragging) return;
      state.lightbox.translateX = e.clientX - state.lightbox.startX;
      state.lightbox.translateY = e.clientY - state.lightbox.startY;
      applyTransform();
    });

    window.addEventListener('mouseup', () => {
      state.lightbox.isDragging = false;
      stage.classList.remove('dragging');
    });

    // Touch events for Mobile Pinch & Drag
    let initialTouchDist = null;
    let initialScale = 1;

    stage.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        state.lightbox.isDragging = true;
        state.lightbox.startX = e.touches[0].clientX - state.lightbox.translateX;
        state.lightbox.startY = e.touches[0].clientY - state.lightbox.translateY;
      } else if (e.touches.length === 2) {
        state.lightbox.isDragging = false;
        initialTouchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        initialScale = state.lightbox.scale;
      }
    }, { passive: true });

    stage.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1 && state.lightbox.isDragging) {
        state.lightbox.translateX = e.touches[0].clientX - state.lightbox.startX;
        state.lightbox.translateY = e.touches[0].clientY - state.lightbox.startY;
        applyTransform();
      } else if (e.touches.length === 2 && initialTouchDist) {
        const currentDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const factor = currentDist / initialTouchDist;
        state.lightbox.scale = Math.min(Math.max(initialScale * factor, 0.5), 4);
        applyTransform();
      }
    }, { passive: true });

    stage.addEventListener('touchend', () => {
      state.lightbox.isDragging = false;
      initialTouchDist = null;
    });
  }

  // Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    if (!modal.classList.contains('active')) return;
    if (e.key === 'Escape') closeModal();
    if (e.key === '+' || e.key === '=') zoomIn();
    if (e.key === '-' || e.key === '_') zoomOut();
    if (e.key === '0') resetTransform();
    if (e.key === 'r' || e.key === 'R') rotate();
  });
}

// -------------------------------------------------------------
// 5. BUTTON BINDINGS (LIGHTBOX, WHATSAPP, PRINT FOR BOTH CARDS)
// -------------------------------------------------------------
function setupActionButtons() {
  // Day Draw Actions
  const dayLightboxBtn = document.getElementById('btn-day-lightbox');
  const dayPrintBtn = document.getElementById('btn-day-print');

  if (dayLightboxBtn) {
    dayLightboxBtn.addEventListener('click', () => {
      if (state.dayResult && window.openLightboxModal) {
        window.openLightboxModal(state.dayResult);
      }
    });
  }

  if (dayPrintBtn) {
    dayPrintBtn.addEventListener('click', () => {
      if (!state.dayResult) return;
      printSheet(state.dayResult);
    });
  }

  // Night Draw Actions
  const nightLightboxBtn = document.getElementById('btn-night-lightbox');
  const nightPrintBtn = document.getElementById('btn-night-print');

  if (nightLightboxBtn) {
    nightLightboxBtn.addEventListener('click', () => {
      if (state.nightResult && window.openLightboxModal) {
        window.openLightboxModal(state.nightResult);
      }
    });
  }

  if (nightPrintBtn) {
    nightPrintBtn.addEventListener('click', () => {
      if (!state.nightResult) return;
      printSheet(state.nightResult);
    });
  }
}

function printSheet(res) {
  const printWindow = window.open('', '_blank');
  const slotTitle = (res.slot === 'morning' || res.slot === 'day') ? 'Morning Result' : 'Night Result';
  printWindow.document.write(`
    <html>
      <head>
        <title>Print Mizoram Lottery Result</title>
        <style>
          body { margin: 0; padding: 20px; text-align: center; font-family: sans-serif; }
          img { max-width: 100%; height: auto; }
          .header { margin-bottom: 15px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h2>MIZORAM STATE LOTTERY</h2>
          <p>${slotTitle} - ${formatDateReadable(res.draw_date)} (${res.draw_time || ''})</p>
        </div>
        <img src="${res.image_url}" onload="window.print(); window.close();" />
      </body>
    </html>
  `);
  printWindow.document.close();
}

// -------------------------------------------------------------
// 6. INITIALIZATION & EVENT BINDINGS
// -------------------------------------------------------------
function startAutoRefresh() {
  setInterval(async () => {
    // Only auto-poll if user is viewing today's draws and any slot is not yet loaded
    if (state.currentDate === getTodayIST()) {
      if (!state.dayResult || !state.nightResult) {
        await fetchLatestResults();
        await loadBothResults();
      }
    }
  }, 15000); // 15-second polling around draw times
}

document.addEventListener('DOMContentLoaded', async () => {
  const yearEl = document.getElementById('current-year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // Start clocks & lightbox
  startISTClock();
  startCountdownTimer();
  startAutoRefresh();
  setupLightbox();
  setupActionButtons();

  // Initialize current day results
  state.currentDate = getTodayIST();
  const displayDateText = document.getElementById('display-date-text');
  if (displayDateText) {
    displayDateText.textContent = formatDateReadable(state.currentDate);
  }

  // Load initial results
  await fetchLatestResults();
  await loadBothResults();
});
