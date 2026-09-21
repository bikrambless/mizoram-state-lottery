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
        // Auto-sync any local JSON results and upload files to Supabase cloud
        this.syncLocalToSupabase();
      } catch (err) {
        console.error('[StorageService] Failed to initialize Supabase client:', err.message);
        this.supabase = null;
      }
    } else {
      console.log('[StorageService] Supabase credentials not set. Operating in Local Fallback mode.');
      this.supabase = null;
    }
  }

  // Synchronize local JSON and image files into Supabase Cloud on startup
  async syncLocalToSupabase() {
    if (!this.supabase) return;
    try {
      const localResults = this.readLocalResults();
      if (!localResults || localResults.length === 0) return;

      const { data: remoteResults, error: fetchErr } = await this.supabase
        .from('results')
        .select('draw_date, slot');

      if (fetchErr) {
        console.warn('[StorageService] Failed to query existing remote records for sync:', fetchErr.message);
        return;
      }

      for (const local of localResults) {
        const cleanSlot = (local.slot === 'day' ? 'morning' : local.slot).toLowerCase();
        const exists = remoteResults && remoteResults.some(r =>
          r.draw_date === local.draw_date &&
          (r.slot.toLowerCase() === cleanSlot || (r.slot.toLowerCase() === 'morning' && cleanSlot === 'day'))
        );

        if (!exists) {
          console.log(`[StorageService] Migrating local result to Supabase Cloud: ${local.draw_date} (${cleanSlot})`);
          let publicUrl = local.image_url;
          let fileName = local.file_name;

          if (fileName) {
            const localFilePath = path.join(UPLOADS_DIR, fileName);
            if (fs.existsSync(localFilePath)) {
              try {
                const buf = fs.readFileSync(localFilePath);
                const { error: upErr } = await this.supabase.storage
                  .from(this.bucketName)
                  .upload(fileName, buf, { contentType: local.file_type || 'image/jpeg', upsert: true });

                if (!upErr) {
                  const { data: pubData } = this.supabase.storage.from(this.bucketName).getPublicUrl(fileName);
                  publicUrl = pubData.publicUrl;
                }
              } catch (e) {
                console.warn(`[StorageService] Failed to upload local file ${fileName} to Supabase:`, e.message);
              }
            }
          }

          const record = {
            draw_date: local.draw_date,
            draw_time: local.draw_time,
            slot: cleanSlot,
            draw_name: local.draw_name || (cleanSlot === 'morning' ? 'Morning Result' : 'Night Result'),
            series: local.series || (cleanSlot === 'morning' ? 'Morning Series' : 'Night Series'),
            image_url: publicUrl,
            file_name: fileName,
            file_type: local.file_type || 'image/jpeg',
            file_size: local.file_size || 0,
            publish_at: local.publish_at || null
          };

          await this.supabase.from('results').insert([record]);
        }
      }
    } catch (err) {
      console.warn('[StorageService] syncLocalToSupabase error:', err.message);
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
        description: 'Using Supabase PostgreSQL and Supabase Storage bucket (' + this.bucketName + '). Results are permanently preserved.'
      };
    }
    return {
      active: true,
      mode: 'local',
      badge: 'Local Disk Engine (Ephemeral)',
      description: 'Using local JSON database and disk uploads. Note: If hosted on Render, uploads will be lost on container restart. Configure SUPABASE_URL & SUPABASE_KEY to persist results permanently.'
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
  // Merges Supabase cloud results with local results to ensure zero data loss
  async getAllResults(query = {}) {
    const { date, slot, search, limit = 50, offset = 0, publicOnly = false } = query;

    let combined = [];

    if (this.supabase) {
      try {
        let dbQuery = this.supabase
          .from('results')
          .select('*', { count: 'exact' })
          .order('draw_date', { ascending: false })
          .order('draw_time', { ascending: false })
          .order('created_at', { ascending: false });

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

        const { data, error } = await dbQuery;
        if (!error && data) {
          combined = data;
        } else if (error) {
          console.warn('[StorageService] Supabase query failed, falling back to local:', error?.message);
        }
      } catch (err) {
        console.warn('[StorageService] Supabase error, using local fallback:', err.message);
      }
    }

    // Always merge local results for any items not yet in cloud
    let localList = this.readLocalResults();
    if (date) {
      localList = localList.filter(r => r.draw_date === date);
    }
    if (slot && slot !== 'all') {
      const s = slot.toLowerCase();
      if (s === 'morning' || s === 'day') {
        localList = localList.filter(r => r.slot.toLowerCase() === 'morning' || r.slot.toLowerCase() === 'day');
      } else {
        localList = localList.filter(r => r.slot.toLowerCase() === s);
      }
    }
    if (search) {
      const q = search.toLowerCase();
      localList = localList.filter(r => (r.draw_name && r.draw_name.toLowerCase().includes(q)) || (r.series && r.series.toLowerCase().includes(q)));
    }

    // Merge: add local records that aren't already represented in cloud results
    for (const loc of localList) {
      const cleanLocSlot = (loc.slot === 'day' ? 'morning' : loc.slot).toLowerCase();
      const exists = combined.some(c =>
        c.draw_date === loc.draw_date &&
        (c.slot.toLowerCase() === cleanLocSlot || (c.slot.toLowerCase() === 'morning' && cleanLocSlot === 'day'))
      );
      if (!exists) {
        combined.push(loc);
      }
    }

    // Sort by draw_date DESC, draw_time DESC, then newest updated_at/created_at first
    combined.sort((a, b) => {
      const dDiff = new Date(b.draw_date).getTime() - new Date(a.draw_date).getTime();
      if (dDiff !== 0) return dDiff;
      const tDiff = (b.draw_time || '').localeCompare(a.draw_time || '');
      if (tDiff !== 0) return tDiff;
      const bTime = new Date(b.updated_at || b.created_at || 0).getTime();
      const aTime = new Date(a.updated_at || a.created_at || 0).getTime();
      return bTime - aTime;
    });

    // Deduplicate: Keep only the freshest sheet for each (draw_date, slot)
    const seenSlots = new Set();
    const deduplicated = [];
    for (const item of combined) {
      const slotKey = `${item.draw_date}_${(item.slot === 'day' ? 'morning' : item.slot).toLowerCase()}`;
      if (!seenSlots.has(slotKey)) {
        seenSlots.add(slotKey);
        deduplicated.push(item);
      }
    }
    combined = deduplicated;

    // Add is_published flag
    combined = combined.map(r => ({ ...r, is_published: isPublished(r) }));

    // Filter for public API
    if (publicOnly) {
      combined = combined.filter(r => r.is_published);
    }

    const total = combined.length;
    const start = parseInt(offset, 10) || 0;
    const count = parseInt(limit, 10) || 50;
    const paginated = combined.slice(start, start + count);

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
  // Dual persistence: Stores in Supabase Cloud AND maintains local cache
  async createResult({ draw_date, draw_time, slot, draw_name, series, file, publish_at }) {
    const id = (Date.now().toString(36) + Math.random().toString(36).substring(2, 8));
    const rawSlot = (slot || 'morning').toLowerCase();
    const cleanSlot = (rawSlot === 'morning' || rawSlot === 'day') ? 'morning' : 'night';
    const cleanDate = draw_date || new Date().toISOString().split('T')[0];
    const timeFormatted = draw_time || (cleanSlot === 'morning' ? '02:00 PM' : '09:00 PM');
    const defaultName = draw_name || (cleanSlot === 'morning' ? 'Morning Result' : 'Night Result');
    const defaultSeries = series || (cleanSlot === 'morning' ? 'Morning Series' : 'Night Series');
    const scheduledPublishAt = publish_at || null;

    let imageUrl = '';
    let fileName = '';
    let fileType = file ? file.mimetype : 'image/jpeg';
    let fileSize = file ? file.size : 0;
    const fileExt = file ? path.extname(file.originalname).toLowerCase() || '.jpg' : '.jpg';
    const storageKey = `${cleanDate}_${cleanSlot}_${Date.now()}${fileExt}`;

    // 1. Save local copy to disk
    if (file && file.buffer) {
      const diskPath = path.join(UPLOADS_DIR, storageKey);
      fs.writeFileSync(diskPath, file.buffer);
      imageUrl = `/uploads/${storageKey}`;
      fileName = storageKey;
    } else if (file && file.path) {
      fileName = path.basename(file.path);
      imageUrl = `/uploads/${fileName}`;
    }

    let insertedRecord = null;

    // 2. Upload to Supabase Cloud if available (with auto-replace for same date & slot)
    if (this.supabase && file && file.buffer) {
      try {
        const { data: uploadData, error: uploadErr } = await this.supabase.storage
          .from(this.bucketName)
          .upload(storageKey, file.buffer, {
            contentType: fileType,
            upsert: true
          });

        if (uploadErr) {
          console.warn('[StorageService] Supabase storage upload failed:', uploadErr.message);
        } else {
          const { data: publicData } = this.supabase.storage
            .from(this.bucketName)
            .getPublicUrl(storageKey);

          imageUrl = publicData.publicUrl;
          fileName = storageKey;

          // Check if a record already exists for this draw_date and slot
          const slotQuery = (cleanSlot === 'morning') ? ['morning', 'day'] : ['night'];
          const { data: existingRows } = await this.supabase
            .from('results')
            .select('id, file_name')
            .eq('draw_date', cleanDate)
            .in('slot', slotQuery);

          if (existingRows && existingRows.length > 0) {
            // Update the primary existing record
            const primaryExisting = existingRows[0];
            const { data: updated, error: updateErr } = await this.supabase
              .from('results')
              .update({
                draw_time: timeFormatted,
                slot: cleanSlot,
                draw_name: defaultName,
                series: defaultSeries,
                image_url: imageUrl,
                file_name: fileName,
                file_type: fileType,
                file_size: fileSize,
                publish_at: scheduledPublishAt,
                updated_at: new Date().toISOString()
              })
              .eq('id', primaryExisting.id)
              .select()
              .single();

            if (!updateErr && updated) {
              insertedRecord = updated;
            }

            // Remove previous file from Supabase storage if different
            if (primaryExisting.file_name && primaryExisting.file_name !== fileName) {
              await this.supabase.storage.from(this.bucketName).remove([primaryExisting.file_name]);
            }

            // Remove any redundant duplicates for this slot & date
            if (existingRows.length > 1) {
              const extraIds = existingRows.slice(1).map(r => r.id);
              const extraFiles = existingRows.slice(1).map(r => r.file_name).filter(Boolean);
              await this.supabase.from('results').delete().in('id', extraIds);
              if (extraFiles.length > 0) {
                await this.supabase.storage.from(this.bucketName).remove(extraFiles);
              }
            }
          } else {
            // Insert brand new record
            const newRecord = {
              draw_date: cleanDate,
              draw_time: timeFormatted,
              slot: cleanSlot,
              draw_name: defaultName,
              series: defaultSeries,
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
              console.warn('[StorageService] Supabase DB insert failed:', insertErr.message);
            } else {
              insertedRecord = inserted;
            }
          }
        }
      } catch (err) {
        console.error('[StorageService] Supabase upload error:', err.message);
      }
    }

    // 3. Save to local JSON database for local redundancy
    const localRecord = {
      id: (insertedRecord && insertedRecord.id) ? insertedRecord.id : id,
      draw_date: cleanDate,
      draw_time: timeFormatted,
      slot: cleanSlot,
      draw_name: defaultName,
      series: defaultSeries,
      image_url: imageUrl,
      file_name: fileName,
      file_type: fileType,
      file_size: fileSize,
      publish_at: scheduledPublishAt,
      created_at: (insertedRecord && insertedRecord.created_at) ? insertedRecord.created_at : new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const list = this.readLocalResults();
    const existingIdx = list.findIndex(r => r.draw_date === cleanDate && (r.slot === cleanSlot || (r.slot === 'day' && cleanSlot === 'morning')));
    if (existingIdx !== -1) {
      list[existingIdx] = localRecord;
    } else {
      list.unshift(localRecord);
    }
    this.writeLocalResults(list);

    return insertedRecord || localRecord;
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

      // Local write
      const diskPath = path.join(UPLOADS_DIR, storageKey);
      fs.writeFileSync(diskPath, file.buffer);
      imageUrl = `/uploads/${storageKey}`;
      fileName = storageKey;

      if (this.supabase) {
        try {
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
          }
        } catch (e) {
          console.warn('[StorageService] Supabase file replace failed:', e.message);
        }
      }
    }

    let updatedFromSupabase = null;
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
          updatedFromSupabase = data;
        }
      } catch (err) {
        console.warn('[StorageService] Supabase update failed:', err.message);
      }
    }

    // Local JSON update
    const list = this.readLocalResults();
    const index = list.findIndex(r => r.id === id || (r.draw_date === cleanDate && r.slot === cleanSlot));
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
      return updatedFromSupabase || list[index];
    }

    return updatedFromSupabase || { id, draw_date: cleanDate, slot: cleanSlot };
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
    const filtered = list.filter(r => r.id !== id && !(r.draw_date === existing.draw_date && r.slot === existing.slot));
    this.writeLocalResults(filtered);

    return { success: true, id };
  }

  // --- PUBLISH NOW (cancel schedule and release immediately) ---
  async publishNow(id) {
    return this.updateResult(id, { publish_at: null });
  }
}

module.exports = new StorageService();
