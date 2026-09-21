require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const storageService = require('./services/storageService');

const app = express();
const PORT = process.env.PORT || 5000;

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'mizoramadmin2026';
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'mizoram_lottery_super_secret_jwt_key_2026';

// Multer memory storage for uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB max
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Static file hosting
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Authentication Middleware
function authenticateAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.cookies && req.cookies.admin_token) {
    token = req.cookies.admin_token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Admin authentication token required' });
  }

  try {
    const decoded = jwt.verify(token, ADMIN_JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
  }
}

// -------------------------------------------------------------
// PUBLIC API ROUTES
// -------------------------------------------------------------

// System Status & Storage Health
app.get('/api/status', (req, res) => {
  const status = storageService.getStatus();
  res.json({
    success: true,
    portal: process.env.PORTAL_NAME || 'MIZORAM STATE LOTTERY',
    slug: process.env.PORTAL_SLUG || 'mizoram-lottery',
    tagline: process.env.TAGLINE || 'Official Daily Lottery Result Publishing Portal',
    storage: status,
    serverTime: new Date().toISOString()
  });
});

// Latest Results (Morning & Night)
app.get('/api/results/latest', async (req, res) => {
  try {
    const data = await storageService.getLatestResults();
    res.json({
      success: true,
      morning: data.morning,
      night: data.night,
      day: data.day, // backwards compatibility
      latest: data.latest
    });
  } catch (err) {
    console.error('Error fetching latest results:', err);
    res.status(500).json({ error: 'Failed to retrieve latest lottery results' });
  }
});

// Search & Filter Results Archive (PUBLIC - only shows published results)
app.get('/api/results', async (req, res) => {
  try {
    const { date, slot, search, limit, offset } = req.query;
    const data = await storageService.getAllResults({ date, slot, search, limit, offset, publicOnly: true });
    res.json({
      success: true,
      results: data.results,
      total: data.total
    });
  } catch (err) {
    console.error('Error querying results:', err);
    res.status(500).json({ error: 'Failed to query results' });
  }
});

// Admin Results Archive (shows ALL results including scheduled)
app.get('/api/admin/results', authenticateAdmin, async (req, res) => {
  try {
    const { date, slot, search, limit, offset } = req.query;
    const data = await storageService.getAllResults({ date, slot, search, limit, offset, publicOnly: false });
    res.json({
      success: true,
      results: data.results,
      total: data.total
    });
  } catch (err) {
    console.error('Error querying admin results:', err);
    res.status(500).json({ error: 'Failed to query results' });
  }
});

// Get Single Result by ID
app.get('/api/results/:id', async (req, res) => {
  try {
    const result = await storageService.getResultById(req.params.id);
    if (!result) {
      return res.status(404).json({ error: 'Result sheet not found' });
    }
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve result' });
  }
});

// -------------------------------------------------------------
// ADMIN API ROUTES
// -------------------------------------------------------------

// Admin Login
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    const token = jwt.sign(
      { username, role: 'admin', timestamp: Date.now() },
      ADMIN_JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.cookie('admin_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000
    });

    return res.json({
      success: true,
      message: 'Authentication successful',
      token,
      admin: { username }
    });
  }

  return res.status(401).json({ error: 'Invalid admin username or password' });
});

// Verify Admin Token
app.get('/api/admin/verify', authenticateAdmin, (req, res) => {
  res.json({
    success: true,
    valid: true,
    admin: req.admin,
    storage: storageService.getStatus()
  });
});

// Admin Stats
app.get('/api/admin/stats', authenticateAdmin, async (req, res) => {
  try {
    const all = await storageService.getAllResults({ limit: 1000 });
    const today = new Date().toISOString().split('T')[0];
    const todayUploads = (all.results || []).filter(r => r.draw_date === today);

    res.json({
      success: true,
      totalCount: all.total,
      todayCount: todayUploads.length,
      storage: storageService.getStatus()
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch admin stats' });
  }
});

// Upload New Result Sheet
app.post('/api/admin/upload', authenticateAdmin, upload.single('file'), async (req, res) => {
  try {
    const { draw_date, draw_time, slot, draw_name, series, publish_at } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'Please select a result file (JPG, PNG, or PDF) to upload' });
    }

    if (!draw_date || !slot) {
      return res.status(400).json({ error: 'Draw date and draw slot (day/night) are required' });
    }

    const created = await storageService.createResult({
      draw_date,
      draw_time,
      slot,
      draw_name,
      series,
      file,
      publish_at
    });

    res.status(201).json({
      success: true,
      message: 'Lottery result sheet published successfully',
      result: created
    });
  } catch (err) {
    console.error('Error during result upload:', err);
    res.status(500).json({ error: err.message || 'Failed to upload result sheet' });
  }
});

// Update / Replace Result Sheet
app.put('/api/admin/results/:id', authenticateAdmin, upload.single('file'), async (req, res) => {
  try {
    const { id } = req.params;
    const { draw_date, draw_time, slot, draw_name, series, publish_at } = req.body;
    const file = req.file;

    const updated = await storageService.updateResult(id, {
      draw_date,
      draw_time,
      slot,
      draw_name,
      series,
      file,
      publish_at
    });

    res.json({
      success: true,
      message: 'Result sheet updated successfully',
      result: updated
    });
  } catch (err) {
    console.error('Error during result update:', err);
    res.status(500).json({ error: err.message || 'Failed to update result sheet' });
  }
});

// Immediately Publish a Scheduled Result
app.post('/api/admin/results/:id/publish-now', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await storageService.publishNow(id);
    res.json({
      success: true,
      message: 'Result sheet is now LIVE on the public portal',
      result: updated
    });
  } catch (err) {
    console.error('Error publishing result immediately:', err);
    res.status(500).json({ error: err.message || 'Failed to publish result' });
  }
});

// Delete Result Sheet
app.delete('/api/admin/results/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const outcome = await storageService.deleteResult(id);
    if (!outcome.success) {
      return res.status(404).json({ error: outcome.message || 'Result not found' });
    }

    res.json({
      success: true,
      message: 'Result sheet deleted successfully',
      id
    });
  } catch (err) {
    console.error('Error deleting result:', err);
    res.status(500).json({ error: 'Failed to delete result sheet' });
  }
});

// Admin Route Direct
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

// Fallback for user portal
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log('====================================================');
  console.log(` MIZORAM STATE LOTTERY PORTAL RUNNING ON PORT ${PORT}`);
  console.log(` User Portal:  http://localhost:${PORT}`);
  console.log(` Admin Portal: http://localhost:${PORT}/admin`);
  console.log(` Storage Mode: ${storageService.getStatus().badge}`);
  console.log('====================================================');
});
