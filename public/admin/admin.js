/**
 * MIZORAM STATE LOTTERY - ADMIN DASHBOARD CLIENT
 * Supports 2 Dedicated Upload Slots: Morning Result & Night Result
 */

const adminState = {
  token: localStorage.getItem('mizoram_admin_token') || '',
  results: [],
  selectedDate: getTodayDateString(),
  currentFilter: 'all',
  morningFile: null,
  nightFile: null
};

// Helper: Get today's date formatted as YYYY-MM-DD
function getTodayDateString() {
  const d = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(d.getTime() + (d.getTimezoneOffset() * 60000) + istOffset);
  return istDate.toISOString().split('T')[0];
}

// Helper: Format Date
function formatDateReadable(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00+05:30');
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

// -------------------------------------------------------------
// 1. AUTHENTICATION
// -------------------------------------------------------------
async function verifySession() {
  const loginSection = document.getElementById('login-section');
  const dashboardSection = document.getElementById('dashboard-section');

  if (!adminState.token) {
    if (loginSection) loginSection.style.display = 'flex';
    if (dashboardSection) dashboardSection.style.display = 'none';
    return false;
  }

  try {
    const res = await fetch('/api/admin/verify', {
      headers: {
        'Authorization': `Bearer ${adminState.token}`
      }
    });

    if (res.ok) {
      const data = await res.json();
      if (loginSection) loginSection.style.display = 'none';
      if (dashboardSection) dashboardSection.style.display = 'flex';
      
      const userEl = document.getElementById('stat-admin-user');
      if (userEl && data.admin && data.admin.username) {
        userEl.textContent = data.admin.username;
      }
      
      loadDashboardData();
      return true;
    } else {
      localStorage.removeItem('mizoram_admin_token');
      adminState.token = '';
      if (loginSection) loginSection.style.display = 'flex';
      if (dashboardSection) dashboardSection.style.display = 'none';
      return false;
    }
  } catch (e) {
    console.warn('Session verify failed:', e);
    return false;
  }
}

function setupLogin() {
  const form = document.getElementById('admin-login-form');
  const errorBanner = document.getElementById('login-error-banner');

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (errorBanner) errorBanner.style.display = 'none';

    const username = document.getElementById('admin-username').value.trim();
    const password = document.getElementById('admin-password').value.trim();

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();

      if (res.ok && data.success) {
        adminState.token = data.token;
        localStorage.setItem('mizoram_admin_token', data.token);
        verifySession();
      } else {
        if (errorBanner) {
          errorBanner.textContent = data.error || 'Authentication failed. Please check credentials.';
          errorBanner.style.display = 'block';
        }
      }
    } catch (err) {
      if (errorBanner) {
        errorBanner.textContent = 'Server connection error. Please try again.';
        errorBanner.style.display = 'block';
      }
    }
  });

  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem('mizoram_admin_token');
      adminState.token = '';
      verifySession();
    });
  }
}

// -------------------------------------------------------------
// 2. DASHBOARD DATA & STATUS
// -------------------------------------------------------------
async function loadDashboardData() {
  await loadStorageStatus();
  await loadRecentUploads();
  updateSlotStatusForSelectedDate();
}

async function loadStorageStatus() {
  const badge = document.getElementById('storage-health-badge');
  const text = document.getElementById('storage-health-text');
  const modeSub = document.getElementById('stat-storage-sub');
  const warningBanner = document.getElementById('storage-warning-banner');

  try {
    const res = await fetch('/api/status');
    const data = await res.json();

    if (data.success && data.storage) {
      const s = data.storage;
      if (text) text.textContent = s.badge;
      if (badge) {
        if (s.mode === 'supabase') {
          badge.classList.remove('local');
          if (warningBanner) warningBanner.style.display = 'none';
        } else {
          badge.classList.add('local');
          if (warningBanner) warningBanner.style.display = 'block';
        }
      }
      if (modeSub) modeSub.textContent = s.mode === 'supabase' ? 'Supabase Cloud' : 'Local Disk Engine';
    }
  } catch (err) {
    console.error('Failed to load status:', err);
  }
}

// Helper: Check if an item is published (computes dynamically based on current time)
function isItemPublished(item) {
  if (!item) return false;
  if (!item.publish_at) return true;
  let clean = String(item.publish_at).trim();
  if (!clean.endsWith('Z') && !/[+-]\d{2}(:?\d{2})?$/.test(clean)) {
    clean = clean.replace(' ', 'T') + '+05:30';
  }
  const t = new Date(clean).getTime();
  return isNaN(t) || Date.now() >= t;
}

// Helper: Format scheduled remaining time notice
function formatScheduledNotice(publishAt) {
  if (!publishAt) return '';
  let clean = String(publishAt).trim();
  if (!clean.endsWith('Z') && !/[+-]\d{2}(:?\d{2})?$/.test(clean)) {
    clean = clean.replace(' ', 'T') + '+05:30';
  }
  const t = new Date(clean).getTime();
  if (isNaN(t)) return '';
  const diffMs = t - Date.now();
  if (diffMs <= 0) return 'Published';
  const diffMins = Math.ceil(diffMs / 60000);
  if (diffMins < 60) {
    return `Unlocks in ${diffMins}m`;
  }
  const hrs = Math.floor(diffMins / 60);
  const remMins = diffMins % 60;
  return `Unlocks in ${hrs}h ${remMins}m`;
}

async function loadRecentUploads() {
  const container = document.getElementById('results-list-container');
  const countBadge = document.getElementById('results-count-badge');
  const totalEl = document.getElementById('stat-total-count');

  if (container) {
    container.innerHTML = '<div style="color: var(--text-muted); padding: 25px; text-align: center;">Loading result sheets...</div>';
  }

  try {
    const res = await fetch('/api/admin/results?limit=100', {
      headers: { 'Authorization': `Bearer ${adminState.token}` }
    });
    const data = await res.json();

    if (res.ok && data.success && data.results) {
      adminState.results = data.results;
      if (countBadge) countBadge.textContent = `${data.results.length} sheet${data.results.length === 1 ? '' : 's'}`;
      if (totalEl) totalEl.textContent = data.results.length;

      renderFilteredUploads();
      updateTodayStats();
      updateSlotStatusForSelectedDate();
    } else {
      if (container) container.innerHTML = '<div style="color: var(--text-muted); padding: 25px; text-align: center;">No results uploaded yet.</div>';
    }
  } catch (err) {
    if (container) container.innerHTML = '<div style="color: #ef4444; padding: 25px; text-align: center;">Failed to load results.</div>';
  }
}

function updateTodayStats() {
  const today = getTodayDateString();
  const morningStat = document.getElementById('stat-morning-status');
  const nightStat = document.getElementById('stat-night-status');
  const morningDesc = document.getElementById('stat-morning-desc');
  const nightDesc = document.getElementById('stat-night-desc');

  const todayMorning = adminState.results.find(r => r.draw_date === today && (r.slot === 'morning' || r.slot === 'day'));
  const todayNight = adminState.results.find(r => r.draw_date === today && r.slot === 'night');

  if (morningStat) {
    if (todayMorning) {
      const pub = isItemPublished(todayMorning);
      if (pub) {
        morningStat.textContent = '✓ Live';
        morningStat.className = 'stat-value text-success';
        if (morningDesc) morningDesc.textContent = `${todayMorning.draw_time || 'Morning'} sheet active`;
      } else {
        morningStat.textContent = '⏳ Scheduled';
        morningStat.className = 'stat-value text-gold';
        if (morningDesc) morningDesc.textContent = `${formatScheduledNotice(todayMorning.publish_at)} (02:00 PM)`;
      }
    } else {
      morningStat.textContent = '⏳ Pending';
      morningStat.className = 'stat-value text-gold';
      if (morningDesc) morningDesc.textContent = 'Awaiting upload';
    }
  }

  if (nightStat) {
    if (todayNight) {
      const pub = isItemPublished(todayNight);
      if (pub) {
        nightStat.textContent = '✓ Live';
        nightStat.className = 'stat-value text-success';
        if (nightDesc) nightDesc.textContent = `${todayNight.draw_time || 'Night'} sheet active`;
      } else {
        nightStat.textContent = '⏳ Scheduled';
        nightStat.className = 'stat-value text-gold';
        if (nightDesc) nightDesc.textContent = `${formatScheduledNotice(todayNight.publish_at)} (09:00 PM)`;
      }
    } else {
      nightStat.textContent = '⏳ Pending';
      nightStat.className = 'stat-value text-cyan';
      if (nightDesc) nightDesc.textContent = 'Awaiting upload';
    }
  }
}

function updateSlotStatusForSelectedDate() {
  const dateInput = document.getElementById('admin-draw-date');
  const selectedDate = dateInput ? dateInput.value : adminState.selectedDate;

  // Check existing uploads for this date
  const morningSheet = adminState.results.find(r => r.draw_date === selectedDate && (r.slot === 'morning' || r.slot === 'day'));
  const nightSheet = adminState.results.find(r => r.draw_date === selectedDate && r.slot === 'night');

  const morningPill = document.getElementById('morning-pill');
  const nightPill = document.getElementById('night-pill');

  if (morningPill) {
    if (morningSheet) {
      const pub = isItemPublished(morningSheet);
      if (pub) {
        morningPill.textContent = '✓ Live on Site';
        morningPill.className = 'slot-live-pill uploaded';
        morningPill.title = `Published at ${morningSheet.draw_time || 'Morning'}`;
      } else {
        morningPill.textContent = '⏳ Scheduled (02:00 PM)';
        morningPill.className = 'slot-live-pill scheduled';
        morningPill.title = `Auto-publishes at 02:00 PM IST (${formatScheduledNotice(morningSheet.publish_at)})`;
      }
    } else {
      morningPill.textContent = 'Pending Upload';
      morningPill.className = 'slot-live-pill pending';
      morningPill.title = 'No Morning sheet uploaded for this date';
    }
  }

  if (nightPill) {
    if (nightSheet) {
      const pub = isItemPublished(nightSheet);
      if (pub) {
        nightPill.textContent = '✓ Live on Site';
        nightPill.className = 'slot-live-pill uploaded';
        nightPill.title = `Published at ${nightSheet.draw_time || 'Night'}`;
      } else {
        nightPill.textContent = '⏳ Scheduled (09:00 PM)';
        nightPill.className = 'slot-live-pill scheduled';
        nightPill.title = `Auto-publishes at 09:00 PM IST (${formatScheduledNotice(nightSheet.publish_at)})`;
      }
    } else {
      nightPill.textContent = 'Pending Upload';
      nightPill.className = 'slot-live-pill pending';
      nightPill.title = 'No Night sheet uploaded for this date';
    }
  }
}

function renderFilteredUploads() {
  const container = document.getElementById('results-list-container');
  if (!container) return;

  let items = adminState.results;
  if (adminState.currentFilter === 'morning') {
    items = items.filter(r => r.slot === 'morning' || r.slot === 'day');
  } else if (adminState.currentFilter === 'night') {
    items = items.filter(r => r.slot === 'night');
  }

  if (items.length === 0) {
    container.innerHTML = '<div style="color: var(--text-muted); padding: 30px; text-align: center;">No lottery sheets found for this filter.</div>';
    return;
  }

  container.innerHTML = '';
  items.forEach(item => {
    const isMorning = item.slot === 'morning' || item.slot === 'day';
    const slotTitle = isMorning ? '🌅 Morning Result' : '🌙 Night Result';
    const slotBadgeClass = isMorning ? 'morning' : 'night';
    const slotBadgeText = isMorning ? 'MORNING' : 'NIGHT';
    const isPublished = isItemPublished(item);

    const isPdf = item.file_type === 'application/pdf' || 
                  (item.image_url && item.image_url.toLowerCase().includes('.pdf')) ||
                  (item.file_name && item.file_name.toLowerCase().endsWith('.pdf'));

    const thumbHtml = isPdf
      ? `<div class="item-thumb pdf-thumb" onclick="window.open('${item.image_url}', '_blank')" title="Click to view PDF document">
          <span style="font-size: 1.8rem; line-height: 1;">📄</span>
          <span style="font-size: 0.68rem; font-weight: 700; color: #f59e0b; margin-top: 4px;">PDF DOC</span>
         </div>`
      : `<img src="${item.image_url}" alt="Sheet Thumbnail" class="item-thumb" onclick="window.open('${item.image_url}', '_blank')">`;

    const card = document.createElement('div');
    card.className = 'result-item-card';
    card.innerHTML = `
      <div class="thumb-wrapper">
        ${thumbHtml}
        ${!isPublished ? '<span class="thumb-scheduled-tag">SCHEDULED</span>' : ''}
      </div>
      <div class="item-details">
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <span class="item-title">${slotTitle}</span>
          ${isPublished
            ? '<span class="item-badge live">🟢 LIVE</span>'
            : `<span class="item-badge scheduled">⏳ SCHEDULED</span>`
          }
        </div>
        <div class="item-meta">
          <span class="item-badge ${slotBadgeClass}">${slotBadgeText}</span>
          <span>📅 ${formatDateReadable(item.draw_date)}</span>
          <span>⏰ ${item.draw_time || (isMorning ? '02:00 PM' : '09:00 PM')}</span>
          ${!isPublished && item.publish_at ? `<span style="color: var(--color-gold-bright); font-family: var(--font-mono); font-size: 0.72rem; font-weight: 600;">• ${formatScheduledNotice(item.publish_at)}</span>` : ''}
        </div>
      </div>
      <div class="item-actions">
        ${!isPublished ? `
          <button class="btn-publish-now" data-id="${item.id}" title="Publish immediately on public portal">
            ⚡ Publish Now
          </button>
        ` : ''}
        <a href="${item.image_url}" target="_blank" class="btn-action-icon" title="View Sheet Fullscreen">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
        </a>
        <button class="btn-action-icon btn-edit" data-id="${item.id}" title="Edit / Replace">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
        </button>
        <button class="btn-action-icon btn-delete" data-id="${item.id}" title="Delete Sheet">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    `;

    const publishNowBtn = card.querySelector('.btn-publish-now');
    if (publishNowBtn) {
      publishNowBtn.addEventListener('click', async () => {
        publishNowBtn.disabled = true;
        publishNowBtn.textContent = 'Publishing...';
        try {
          const res = await fetch(`/api/admin/results/${item.id}/publish-now`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${adminState.token}` }
          });
          const data = await res.json();
          if (res.ok && data.success) {
            loadDashboardData();
          } else {
            alert(data.error || 'Failed to publish now');
          }
        } catch (e) {
          alert('Network error publishing sheet');
        }
      });
    }

    const editBtn = card.querySelector('.btn-edit');
    editBtn.addEventListener('click', () => openEditModal(item));

    const deleteBtn = card.querySelector('.btn-delete');
    deleteBtn.addEventListener('click', () => openDeleteModal(item.id));

    container.appendChild(card);
  });
}

// -------------------------------------------------------------
// 3. TWO DEDICATED UPLOAD SLOTS (MORNING & NIGHT)
// -------------------------------------------------------------
function setupUploadSlots() {
  const commonDateInput = document.getElementById('admin-draw-date');
  if (commonDateInput) {
    commonDateInput.value = adminState.selectedDate;
    commonDateInput.addEventListener('change', (e) => {
      adminState.selectedDate = e.target.value;
      updateSlotStatusForSelectedDate();
    });
  }

  // Configure Slot 1: Morning Result
  setupSlotUploader({
    slot: 'morning',
    formId: 'upload-morning-form',
    fileInputId: 'morning-file-input',
    dropzoneId: 'morning-dropzone',
    dropContentId: 'morning-drop-content',
    fileInfoId: 'morning-file-info',
    fileNameId: 'morning-file-name',
    fileSizeId: 'morning-file-size',
    removeBtnId: 'btn-remove-morning-file',
    progressWrapperId: 'morning-progress-wrapper',
    progressFillId: 'morning-progress-fill',
    progressPercentId: 'morning-progress-percent',
    progressTextId: 'morning-progress-text',
    alertId: 'morning-alert'
  });

  // Configure Slot 2: Night Result
  setupSlotUploader({
    slot: 'night',
    formId: 'upload-night-form',
    fileInputId: 'night-file-input',
    dropzoneId: 'night-dropzone',
    dropContentId: 'night-drop-content',
    fileInfoId: 'night-file-info',
    fileNameId: 'night-file-name',
    fileSizeId: 'night-file-size',
    removeBtnId: 'btn-remove-night-file',
    progressWrapperId: 'night-progress-wrapper',
    progressFillId: 'night-progress-fill',
    progressPercentId: 'night-progress-percent',
    progressTextId: 'night-progress-text',
    alertId: 'night-alert'
  });

  // Filter Tabs
  const filterTabs = document.querySelectorAll('.filter-tab');
  filterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      filterTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      adminState.currentFilter = tab.dataset.filter;
      renderFilteredUploads();
    });
  });

  const refreshBtn = document.getElementById('btn-refresh-results');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      loadDashboardData();
    });
  }
}

// =============================================================
// PDF TO HIGH-RES JPG CONVERSION ENGINE (Client-Side HTML5 Canvas)
// =============================================================
async function convertPdfToJpg(pdfFile, statusCallback) {
  if (statusCallback) statusCallback('Reading PDF document...');

  if (!window.pdfjsLib) {
    throw new Error('PDF conversion engine not loaded. Please ensure an internet connection is available.');
  }

  const arrayBuffer = await pdfFile.arrayBuffer();
  const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;

  if (statusCallback) statusCallback('Rendering Page 1 in High Definition...');
  const page = await pdf.getPage(1);

  // Scale 2.2 for ultra-sharp text and clear lottery numbers (approx 250-300 DPI)
  const viewport = page.getViewport({ scale: 2.2 });

  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');

  await page.render({
    canvasContext: ctx,
    viewport: viewport
  }).promise;

  if (statusCallback) statusCallback('Encoding to high-res JPG...');

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to generate image from PDF.'));
        return;
      }
      const newName = pdfFile.name.replace(/\.pdf$/i, '') + '.jpg';
      const jpgFile = new File([blob], newName, { type: 'image/jpeg', lastModified: Date.now() });
      resolve({ file: jpgFile, previewUrl: canvas.toDataURL('image/jpeg', 0.92) });
    }, 'image/jpeg', 0.92);
  });
}

function setupSlotUploader(cfg) {
  const form = document.getElementById(cfg.formId);
  const fileInput = document.getElementById(cfg.fileInputId);
  const dropzone = document.getElementById(cfg.dropzoneId);
  const dropContent = document.getElementById(cfg.dropContentId);
  const fileInfo = document.getElementById(cfg.fileInfoId);
  const fileName = document.getElementById(cfg.fileNameId);
  const fileSize = document.getElementById(cfg.fileSizeId);
  const removeBtn = document.getElementById(cfg.removeBtnId);

  const progressWrapper = document.getElementById(cfg.progressWrapperId);
  const progressFill = document.getElementById(cfg.progressFillId);
  const progressPercent = document.getElementById(cfg.progressPercentId);
  const progressText = document.getElementById(cfg.progressTextId);
  const alertBox = document.getElementById(cfg.alertId);

  let slotSelectedFile = null;

  function showAlert(msg, type) {
    if (!alertBox) return;
    alertBox.textContent = msg;
    alertBox.className = `form-alert ${type}`;
    alertBox.style.display = 'block';
  }

  function hideAlert() {
    if (alertBox) alertBox.style.display = 'none';
  }

  const submitBtn = form ? form.querySelector('button[type="submit"]') : null;

  async function handleFile(file) {
    hideAlert();

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (isPdf) {
      if (dropContent) dropContent.style.display = 'none';
      if (fileInfo) fileInfo.style.display = 'flex';
      if (fileName) fileName.textContent = `📄 Converting ${file.name} to JPG...`;
      if (fileSize) fileSize.textContent = 'Processing PDF...';
      if (submitBtn) {
        submitBtn.disabled = true;
        if (submitText) submitText.textContent = '📄 Converting PDF to High-Res JPG...';
      }

      try {
        const converted = await convertPdfToJpg(file, (msg) => {
          if (fileName) fileName.textContent = `📄 ${msg}`;
        });

        slotSelectedFile = converted.file;
        if (fileName) fileName.textContent = `✓ ${converted.file.name}`;
        if (fileSize) fileSize.textContent = `${(converted.file.size / (1024 * 1024)).toFixed(2)} MB • Converted from PDF`;
        showAlert(`✓ PDF automatically converted to High-Resolution JPG (${converted.file.name})! Ready to upload.`, 'success');
      } catch (err) {
        console.error('PDF conversion error:', err);
        showAlert(`Could not convert PDF: ${err.message}. Please upload a JPG or PNG instead.`, 'error');
        clearFile();
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          const checkedMode = document.querySelector(`input[name="${cfg.slot}_publish_mode"]:checked`)?.value || 'scheduled';
          updateModeUI(checkedMode);
        }
      }
      return;
    }

    slotSelectedFile = file;
    if (dropContent) dropContent.style.display = 'none';
    if (fileInfo) fileInfo.style.display = 'flex';
    if (fileName) fileName.textContent = file.name;
    if (fileSize) fileSize.textContent = `${(file.size / (1024 * 1024)).toFixed(2)} MB`;
  }

  function clearFile() {
    slotSelectedFile = null;
    if (fileInput) fileInput.value = '';
    if (fileInfo) fileInfo.style.display = 'none';
    if (dropContent) dropContent.style.display = 'block';
  }

  if (dropzone) {
    ['dragenter', 'dragover'].forEach(ev => {
      dropzone.addEventListener(ev, (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(ev => {
      dropzone.addEventListener(ev, (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
      });
    });

    dropzone.addEventListener('drop', (e) => {
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        fileInput.files = e.dataTransfer.files;
        handleFile(e.dataTransfer.files[0]);
      }
    });
  }

  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        handleFile(e.target.files[0]);
      }
    });
  }

  if (removeBtn) {
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      clearFile();
    });
  }

  // Handle Timing Mode Selection
  const modeRadios = document.querySelectorAll(`input[name="${cfg.slot}_publish_mode"]`);
  const modeBadge = document.getElementById(`${cfg.slot}-mode-badge`);
  const customTimeRow = document.getElementById(`${cfg.slot}-custom-time-row`);
  const customTimeInput = document.getElementById(`${cfg.slot}-custom-time`);
  const submitText = document.getElementById(`${cfg.slot}-submit-text`);
  const isMorning = cfg.slot === 'morning';
  const defaultSlotTime = isMorning ? '02:00 PM' : '09:00 PM';
  const defaultSlotTimeValue = isMorning ? '14:00' : '21:00';

  function updateModeUI(mode) {
    if (mode === 'scheduled') {
      if (modeBadge) modeBadge.textContent = `Auto at ${defaultSlotTime}`;
      if (customTimeRow) customTimeRow.style.display = 'none';
      if (submitText) submitText.textContent = `Schedule ${isMorning ? 'Morning' : 'Night'} Result (${defaultSlotTime})`;
    } else if (mode === 'instant') {
      if (modeBadge) modeBadge.textContent = 'Instant Live';
      if (customTimeRow) customTimeRow.style.display = 'none';
      if (submitText) submitText.textContent = `⚡ Publish ${isMorning ? 'Morning' : 'Night'} Result Now`;
    } else if (mode === 'custom') {
      if (modeBadge) modeBadge.textContent = 'Custom Timing';
      if (customTimeRow) customTimeRow.style.display = 'flex';
      const custTime = customTimeInput && customTimeInput.value ? customTimeInput.value : defaultSlotTimeValue;
      if (submitText) submitText.textContent = `Schedule ${isMorning ? 'Morning' : 'Night'} (${custTime} IST)`;
    }
  }

  modeRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      updateModeUI(e.target.value);
    });
  });

  if (customTimeInput) {
    customTimeInput.addEventListener('input', () => {
      const checkedMode = document.querySelector(`input[name="${cfg.slot}_publish_mode"]:checked`)?.value;
      if (checkedMode === 'custom') {
        updateModeUI('custom');
      }
    });
  }

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();

      if (!slotSelectedFile) {
        showAlert('Please select a result sheet image or PDF to upload.', 'error');
        return;
      }

      const commonDateInput = document.getElementById('admin-draw-date');
      const drawDate = commonDateInput ? commonDateInput.value : getTodayDateString();

      const checkedMode = document.querySelector(`input[name="${cfg.slot}_publish_mode"]:checked`)?.value || 'scheduled';
      let publishAtVal = '';
      if (checkedMode === 'scheduled') {
        publishAtVal = `${drawDate}T${defaultSlotTimeValue}:00+05:30`;
      } else if (checkedMode === 'custom') {
        const cTime = (customTimeInput && customTimeInput.value) ? customTimeInput.value : defaultSlotTimeValue;
        publishAtVal = `${drawDate}T${cTime}:00+05:30`;
      } else {
        publishAtVal = '';
      }

      const formData = new FormData();
      formData.append('slot', cfg.slot);
      formData.append('draw_date', drawDate);
      formData.append('draw_time', defaultSlotTime);
      formData.append('file', slotSelectedFile);
      if (publishAtVal) {
        formData.append('publish_at', publishAtVal);
      }

      // Show Progress & Disable Button
      if (submitBtn) submitBtn.disabled = true;
      if (progressWrapper) progressWrapper.style.display = 'block';
      if (progressFill) progressFill.style.width = '0%';
      if (progressPercent) progressPercent.textContent = '0%';
      if (progressText) progressText.textContent = `Uploading ${cfg.slot} result sheet...`;
      hideAlert();

      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/admin/upload');
      xhr.setRequestHeader('Authorization', `Bearer ${adminState.token}`);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          if (progressFill) progressFill.style.width = `${percent}%`;
          if (progressPercent) progressPercent.textContent = `${percent}%`;
          if (percent === 100 && progressText) {
            progressText.textContent = publishAtVal ? 'Scheduling sheet for draw time...' : 'Publishing sheet to public portal...';
          }
        }
      };

      xhr.onload = () => {
        if (submitBtn) submitBtn.disabled = false;
        if (progressWrapper) progressWrapper.style.display = 'none';
        try {
          const res = JSON.parse(xhr.responseText);
          if (xhr.status === 201 && res.success) {
            const isSched = !!publishAtVal;
            const targetTimeStr = checkedMode === 'custom' ? (customTimeInput?.value || defaultSlotTime) : defaultSlotTime;
            const successMsg = isSched
              ? `✓ ${isMorning ? 'Morning' : 'Night'} result scheduled! It will automatically go LIVE at ${targetTimeStr} IST.`
              : `✓ ${isMorning ? 'Morning' : 'Night'} result published live to public portal!`;
            showAlert(successMsg, 'success');
            clearFile();
            loadDashboardData();
          } else {
            showAlert(res.error || 'Upload failed. Please check connection.', 'error');
          }
        } catch (err) {
          showAlert('Unexpected response from server during upload.', 'error');
        }
      };

      xhr.onerror = () => {
        if (submitBtn) submitBtn.disabled = false;
        if (progressWrapper) progressWrapper.style.display = 'none';
        showAlert('Network error occurred during upload.', 'error');
      };

      xhr.send(formData);
    });
  }
}

// -------------------------------------------------------------
// 4. EDIT & DELETE MODALS
// -------------------------------------------------------------
function openEditModal(item) {
  const modal = document.getElementById('edit-modal');
  const idInput = document.getElementById('edit-id');
  const dateInput = document.getElementById('edit-date');
  const slotInput = document.getElementById('edit-slot');
  const fileInput = document.getElementById('edit-file-input');
  const modeSelect = document.getElementById('edit-publish-mode');
  const customRow = document.getElementById('edit-custom-time-row');

  if (idInput) idInput.value = item.id;
  if (dateInput) dateInput.value = item.draw_date;
  if (slotInput) slotInput.value = (item.slot === 'morning' || item.slot === 'day') ? 'morning' : 'night';
  if (fileInput) fileInput.value = '';
  if (modeSelect) modeSelect.value = 'keep';
  if (customRow) customRow.style.display = 'none';

  if (modal) modal.style.display = 'flex';
}

function openDeleteModal(id) {
  const modal = document.getElementById('delete-modal');
  const idInput = document.getElementById('delete-id');
  if (idInput) idInput.value = id;
  if (modal) modal.style.display = 'flex';
}

function setupModals() {
  // Edit Modal
  const editModal = document.getElementById('edit-modal');
  const closeEditBtn = document.getElementById('btn-close-edit-modal');
  const cancelEditBtn = document.getElementById('btn-cancel-edit');
  const editForm = document.getElementById('edit-result-form');
  const editModeSelect = document.getElementById('edit-publish-mode');
  const editCustomRow = document.getElementById('edit-custom-time-row');

  if (editModeSelect && editCustomRow) {
    editModeSelect.addEventListener('change', (e) => {
      editCustomRow.style.display = e.target.value === 'custom' ? 'block' : 'none';
    });
  }

  [closeEditBtn, cancelEditBtn].forEach(b => {
    if (b) b.addEventListener('click', () => { if (editModal) editModal.style.display = 'none'; });
  });

  if (editForm) {
    editForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('edit-id').value;
      const date = document.getElementById('edit-date').value;
      const slot = document.getElementById('edit-slot').value;
      const fileInput = document.getElementById('edit-file-input');
      const mode = editModeSelect ? editModeSelect.value : 'keep';

      const formData = new FormData();
      formData.append('draw_date', date);
      formData.append('slot', slot);
      formData.append('draw_time', slot === 'morning' ? '02:00 PM' : '09:00 PM');
      if (fileInput && fileInput.files && fileInput.files[0]) {
        let uploadFile = fileInput.files[0];
        if (uploadFile.type === 'application/pdf' || uploadFile.name.toLowerCase().endsWith('.pdf')) {
          try {
            const converted = await convertPdfToJpg(uploadFile);
            uploadFile = converted.file;
          } catch (e) {
            console.warn('PDF conversion in edit modal failed:', e);
          }
        }
        formData.append('file', uploadFile);
      }

      if (mode === 'instant') {
        formData.append('publish_at', '');
      } else if (mode === 'scheduled') {
        const slotTime = slot === 'morning' ? '14:00:00' : '21:00:00';
        formData.append('publish_at', `${date}T${slotTime}+05:30`);
      } else if (mode === 'custom') {
        const cTime = document.getElementById('edit-custom-time')?.value || (slot === 'morning' ? '14:00' : '21:00');
        formData.append('publish_at', `${date}T${cTime}:00+05:30`);
      }

      try {
        const res = await fetch(`/api/admin/results/${id}`, {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${adminState.token}` },
          body: formData
        });

        if (res.ok) {
          if (editModal) editModal.style.display = 'none';
          loadDashboardData();
        } else {
          alert('Failed to update result sheet');
        }
      } catch (err) {
        alert('Network error updating sheet');
      }
    });
  }

  // Delete Modal
  const deleteModal = document.getElementById('delete-modal');
  const closeDelBtn = document.getElementById('btn-close-delete-modal');
  const cancelDelBtn = document.getElementById('btn-cancel-delete');
  const confirmDelBtn = document.getElementById('btn-confirm-delete');

  [closeDelBtn, cancelDelBtn].forEach(b => {
    if (b) b.addEventListener('click', () => { if (deleteModal) deleteModal.style.display = 'none'; });
  });

  if (confirmDelBtn) {
    confirmDelBtn.addEventListener('click', async () => {
      const id = document.getElementById('delete-id').value;
      try {
        const res = await fetch(`/api/admin/results/${id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${adminState.token}` }
        });

        if (res.ok) {
          if (deleteModal) deleteModal.style.display = 'none';
          loadDashboardData();
        } else {
          alert('Failed to delete result sheet');
        }
      } catch (e) {
        alert('Error communicating with server');
      }
    });
  }
}

// -------------------------------------------------------------
// 5. INITIALIZE
// -------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  setupLogin();
  setupUploadSlots();
  setupModals();
  verifySession();

  // Auto-refresh scheduled/live status badges in admin dashboard every 15 seconds
  setInterval(() => {
    if (adminState.token && adminState.results && adminState.results.length > 0) {
      updateTodayStats();
      updateSlotStatusForSelectedDate();
      renderFilteredUploads();
    }
  }, 15000);
});
