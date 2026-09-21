const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const DATA_DIR = path.join(__dirname, '..', 'data');
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const LOCAL_DB_PATH = path.join(DATA_DIR, 'results.json');

// Ensure local directories exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Helper: Parse publish_at to UTC timestamp ms, defaulting to IST (+05:30)
function parsePublishAt(str) {
  if (!str) return null;
  let clean = String(str).trim();
  if (!clean) return null;
  if (!clean.endsWith('Z') && !/[+-]\d{2}(:?\d{2})?$/.test(clean)) {
    clean = clean.replace(' ', 'T') + '+05:30';
  }
  const t = new Date(clean).getTime();
  return isNaN(t) ? null : t;
}

// Helper: Check if a result is published (publish_at has passed or is not set)
function isPublished(result) {
  if (!result.publish_at) return true; // no schedule = immediately published
  const targetEpoch = parsePublishAt(result.publish_at);
  if (!targetEpoch) return true;
  return Date.now() >= targetEpoch;
}

class StorageService {
  constructor() {
    this.supabaseUrl = process.env.SUPABASE_URL || '';
    this.supabaseKey = process.env.SUPABASE_KEY || '';
    this.bucketName = process.env.SUPABASE_BUCKET || 'results';
    this.supabase = null;
    this.initSupabase();
  }

  initSupabase() {
    if (this.supabaseUrl && this.supabaseKey && this.supabaseUrl.startsWith('http')) {
      try {
        this.supabase = createClient(this.supabaseUrl, this.supabaseKey, {
          auth: { persistSession: false }
        });
        console.log('[StorageService] Supabase client initialized.');
      } catch (err) {
        console.error('[StorageService] Failed to initialize Supabase client:', err.message);
        this.supabase = null;
      }
    } else {
      console.log('[StorageService] Supabase credentials not set. Operating in Local Fallback mode.');
      this.supabase = null;
    }
  }

  isSupabaseActive() {
    return !!this.supabase;
  }

  getStatus() {
    if (this.supabase) {
      return {
        active: true,
        mode: 'supabase',
        badge: 'Supabase Cloud Connected',
        description: 'Using Supabase PostgreSQL and Supabase Storage bucket (' + this.bucketName + ')'
      };
    }
    return {
      active: true,
      mode: 'local',
      badge: 'Local Engine Active (Ready for Supabase)',
      description: 'Using local JSON database and disk uploads. Configure SUPABASE_URL & SUPABASE_KEY to switch to cloud.'
    };
  }

  // --- LOCAL JSON HELPERS ---
  readLocalResults() {
    try {
      if (!fs.existsSync(LOCAL_DB_PATH)) {
        return [];
      }
      const data = fs.readFileSync(LOCAL_DB_PATH, 'utf-8');
      return JSON.parse(data || '[]');
    } catch (err) {
      console.error('[StorageService] Error reading local results.json:', err);
      return [];
    }
  }

  writeLocalResults(results) {
    try {
      fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify(results, null, 2), 'utf-8');
      return true;
    } catch (err) {
      console.error('[StorageService] Error writing to results.json:', err);
      return false;
    }
  }

  // --- QUERY RESULTS ---
  // publicOnly: if true, filters out scheduled (not-yet-published) results
  async getAllResults(query = {}) {
    const { date, slot, search, limit = 50, offset = 0, publicOnly = false } = query;

    if (this.supabase) {
      try {
        let dbQuery = this.supabase
          .from('results')
          .select('*', { count: 'exact' })
          .order('draw_date', { ascending: false })
          .order('draw_time', { ascending: false });

        if (date) {
          dbQuery = dbQuery.eq('draw_date', date);
        }
        if (slot && slot !== 'all') {
          const s = slot.toLowerCase();
          if (s === 'morning' || s === 'day') {
            dbQuery = dbQuery.in('slot', ['morning', 'day']);
          } else {
            dbQuery = dbQuery.eq('slot', s);
          }
        }
        if (search) {
          dbQuery = dbQuery.ilike('draw_name', `%${search}%`);
        }

        const start = parseInt(offset, 10) || 0;
        const end = start + (parseInt(limit, 10) || 50) - 1;
        dbQuery = dbQuery.range(start, end);

        const { data, count, error } = await dbQuery;
        if (!error && data) {
          let results = data;
          // Filter scheduled results for public API
          if (publicOnly) {
            results = results.filter(r => isPublished(r));
          }
          // Add is_published flag for admin
          results = results.map(r => ({ ...r, is_published: isPublished(r) }));
          return { results, total: count || results.length };
        }
        console.warn('[StorageService] Supabase query failed, falling back to local:', error?.message);
      } catch (err) {
        console.warn('[StorageService] Supabase error, using local fallback:', err.message);
      }
    }

    // Local JSON query
    let list = this.readLocalResults();
    if (date) {
      list = list.filter(r => r.draw_date === date);
    }
    if (slot && slot !== 'all') {
      const s = slot.toLowerCase();
      if (s === 'morning' || s === 'day') {
        list = list.filter(r => r.slot.toLowerCase() === 'morning' || r.slot.toLowerCase() === 'day');
      } else {
        list = list.filter(r => r.slot.toLowerCase() === s);
      }
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(r => (r.draw_name && r.draw_name.toLowerCase().includes(q)) || (r.series && r.series.toLowerCase().includes(q)));
    }

    // Sort by draw_date DESC, then draw_time DESC
    list.sort((a, b) => {
      const dDiff = new Date(b.draw_date).getTime() - new Date(a.draw_date).getTime();
      if (dDiff !== 0) return dDiff;
      return (b.draw_time || '').localeCompare(a.draw_time || '');
    });

    // Add is_published flag
    list = list.map(r => ({ ...r, is_published: isPublished(r) }));

    // Filter for public
    if (publicOnly) {
      list = list.filter(r => r.is_published);
    }

    const total = list.length;
    const start = parseInt(offset, 10) || 0;
    const count = parseInt(limit, 10) || 50;
    const paginated = list.slice(start, start + count);

    return { results: paginated, total };
  }

  async getLatestResults() {
    // Public latest: only show published results
    const all = await this.getAllResults({ limit: 20, publicOnly: true });
    const list = all.results || [];

    const morningResult = list.find(r => r.slot === 'morning' || r.slot === 'day') || null;
    const nightResult = list.find(r => r.slot === 'night') || null;

    return {
      morning: morningResult,
      day: morningResult, // backward compatibility
      night: nightResult,
      latest: list[0] || null
    };
  }

  async getResultById(id) {
    if (this.supabase) {
      try {
        const { data, error } = await this.supabase
          .from('results')
          .select('*')
          .eq('id', id)
          .single();

        if (!error && data) {
          return data;
        }
      } catch (err) {
        console.warn('[StorageService] Supabase getById failed, checking local:', err.message);
      }
    }

    const list = this.readLocalResults();
    return list.find(r => r.id === id) || null;
  }

  // --- CREATE / UPLOAD RESULT ---
  async createResult({ draw_date, draw_time, slot, draw_name, series, file, publish_at }) {
    const id = (Date.now().toString(36) + Math.random().toString(36).substring(2, 8));
    const rawSlot = (slot || 'morning').toLowerCase();
    const cleanSlot = (rawSlot === 'morning' || rawSlot === 'day') ? 'morning' : 'night';
    const cleanDate = draw_date || new Date().toISOString().split('T')[0];
    const timeFormatted = draw_time || (cleanSlot === 'morning' ? '02:00 PM' : '09:00 PM');
    const defaultName = draw_name || (cleanSlot === 'morning' ? 'Morning Result' : 'Night Result');
    // publish_at: ISO string or null (null = publish immediately)
    const scheduledPublishAt = publish_at || null;

    let imageUrl = '';
    let fileName = '';
    let fileType = file ? file.mimetype : 'image/jpeg';
    let fileSize = file ? file.size : 0;

    const fileExt = file ? path.extname(file.originalname).toLowerCase() || '.jpg' : '.jpg';
    const storageKey = `${cleanDate}_${cleanSlot}_${Date.now()}${fileExt}`;

    if (this.supabase && file && file.buffer) {
      try {
        const { data: uploadData, error: uploadErr } = await this.supabase.storage
          .from(this.bucketName)
          .upload(storageKey, file.buffer, {
            contentType: fileType,
            upsert: true
          });

        if (uploadErr) {
          throw new Error('Supabase storage upload failed: ' + uploadErr.message);
        }

        const { data: publicData } = this.supabase.storage
          .from(this.bucketName)
          .getPublicUrl(storageKey);

        imageUrl = publicData.publicUrl;
        fileName = storageKey;

        // Insert into Supabase DB
        const newRecord = {
          draw_date: cleanDate,
          draw_time: timeFormatted,
          slot: cleanSlot,
          draw_name: defaultName,
          series: series || (cleanSlot === 'day' ? 'Day Series' : 'Night Series'),
          image_url: imageUrl,
          file_name: fileName,
          file_type: fileType,
          file_size: fileSize,
          publish_at: scheduledPublishAt
        };

        const { data: inserted, error: insertErr } = await this.supabase
          .from('results')
          .insert([newRecord])
          .select()
          .single();

        if (insertErr) {
          throw new Error('Supabase DB insert failed: ' + insertErr.message);
        }

        return inserted;
      } catch (err) {
        console.error('[StorageService] Supabase upload error, falling back to local disk:', err.message);
      }
    }

    // Local Disk Fallback
    if (file && file.buffer) {
      const diskPath = path.join(UPLOADS_DIR, storageKey);
      fs.writeFileSync(diskPath, file.buffer);
      imageUrl = `/uploads/${storageKey}`;
      fileName = storageKey;
    } else if (file && file.path) {
      fileName = path.basename(file.path);
      imageUrl = `/uploads/${fileName}`;
    }

    const localRecord = {
      id,
      draw_date: cleanDate,
      draw_time: timeFormatted,
      slot: cleanSlot,
      draw_name: defaultName,
      series: series || (cleanSlot === 'day' ? 'Day Series' : 'Night Series'),
      image_url: imageUrl,
      file_name: fileName,
      file_type: fileType,
      file_size: fileSize,
      publish_at: scheduledPublishAt,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const list = this.readLocalResults();
    list.unshift(localRecord);
    this.writeLocalResults(list);

    return localRecord;
  }

  // --- UPDATE RESULT ---
  async updateResult(id, { draw_date, draw_time, slot, draw_name, series, file, publish_at }) {
    let existing = await this.getResultById(id);
    if (!existing) {
      throw new Error('Result sheet not found');
    }

    const rawSlot = (slot || existing.slot || 'morning').toLowerCase();
    const cleanSlot = (rawSlot === 'morning' || rawSlot === 'day') ? 'morning' : 'night';
    const cleanDate = draw_date || existing.draw_date;
    const timeFormatted = draw_time || existing.draw_time || (cleanSlot === 'morning' ? '02:00 PM' : '09:00 PM');
    const updatedName = draw_name || existing.draw_name || (cleanSlot === 'morning' ? 'Morning Result' : 'Night Result');
    const updatedSeries = series || existing.series || (cleanSlot === 'morning' ? 'Morning Series' : 'Night Series');
    const updatedPublishAt = publish_at !== undefined ? (publish_at || null) : (existing.publish_at || null);

    let imageUrl = existing.image_url;
    let fileName = existing.file_name;
    let fileType = existing.file_type;
    let fileSize = existing.file_size;

    if (file && file.buffer) {
      const fileExt = path.extname(file.originalname).toLowerCase() || '.jpg';
      const storageKey = `${cleanDate}_${cleanSlot}_${Date.now()}${fileExt}`;
      fileType = file.mimetype;
      fileSize = file.size;

      if (this.supabase) {
        try {
          // Remove old file from Supabase storage if it was stored there
          if (existing.file_name) {
            await this.supabase.storage.from(this.bucketName).remove([existing.file_name]);
          }

          const { error: uploadErr } = await this.supabase.storage
            .from(this.bucketName)
            .upload(storageKey, file.buffer, {
              contentType: fileType,
              upsert: true
            });

          if (!uploadErr) {
            const { data: publicData } = this.supabase.storage
              .from(this.bucketName)
              .getPublicUrl(storageKey);
            imageUrl = publicData.publicUrl;
            fileName = storageKey;
          }
        } catch (e) {
          console.warn('[StorageService] Supabase file replace failed:', e.message);
        }
      }

      // If Supabase didn't run or failed, write locally
      if (!imageUrl || imageUrl === existing.image_url) {
        const diskPath = path.join(UPLOADS_DIR, storageKey);
        fs.writeFileSync(diskPath, file.buffer);
        imageUrl = `/uploads/${storageKey}`;
        fileName = storageKey;

        // Try deleting previous local file
        if (existing.file_name) {
          const oldPath = path.join(UPLOADS_DIR, existing.file_name);
          if (fs.existsSync(oldPath)) {
            try { fs.unlinkSync(oldPath); } catch (_) {}
          }
        }
      }
    }

    if (this.supabase) {
      try {
        const { data, error } = await this.supabase
          .from('results')
          .update({
            draw_date: cleanDate,
            draw_time: timeFormatted,
            slot: cleanSlot,
            draw_name: updatedName,
            series: updatedSeries,
            image_url: imageUrl,
            file_name: fileName,
            file_type: fileType,
            publish_at: updatedPublishAt,
            file_size: fileSize,
            updated_at: new Date().toISOString()
          })
          .eq('id', id)
          .select()
          .single();

        if (!error && data) {
          return data;
        }
      } catch (err) {
        console.warn('[StorageService] Supabase update failed:', err.message);
      }
    }

    // Local JSON update
    const list = this.readLocalResults();
    const index = list.findIndex(r => r.id === id);
    if (index !== -1) {
      list[index] = {
        ...list[index],
        draw_date: cleanDate,
        draw_time: timeFormatted,
        slot: cleanSlot,
        draw_name: updatedName,
        series: updatedSeries,
        image_url: imageUrl,
        file_name: fileName,
        file_type: fileType,
        file_size: fileSize,
        publish_at: updatedPublishAt,
        updated_at: new Date().toISOString()
      };
      this.writeLocalResults(list);
      return list[index];
    }

    throw new Error('Result could not be updated');
  }

  // --- DELETE RESULT ---
  async deleteResult(id) {
    const existing = await this.getResultById(id);
    if (!existing) {
      return { success: false, message: 'Result sheet not found' };
    }

    // Supabase delete
    if (this.supabase) {
      try {
        if (existing.file_name) {
          await this.supabase.storage.from(this.bucketName).remove([existing.file_name]);
        }
        await this.supabase.from('results').delete().eq('id', id);
      } catch (err) {
        console.warn('[StorageService] Supabase delete error:', err.message);
      }
    }

    // Local file and JSON purge
    if (existing.file_name) {
      const localFilePath = path.join(UPLOADS_DIR, existing.file_name);
      if (fs.existsSync(localFilePath)) {
        try { fs.unlinkSync(localFilePath); } catch (_) {}
      }
    }

    const list = this.readLocalResults();
    const filtered = list.filter(r => r.id !== id);
    this.writeLocalResults(filtered);

    return { success: true, id };
  }

  // --- PUBLISH NOW (cancel schedule and release immediately) ---
  async publishNow(id) {
    return this.updateResult(id, { publish_at: null });
  }
}

module.exports = new StorageService();
