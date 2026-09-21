-- ==========================================================
-- MIZORAM STATE LOTTERY - Supabase Database & Storage Setup
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)
-- ==========================================================

-- 1. Create the `results` table
CREATE TABLE IF NOT EXISTS public.results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    draw_date DATE NOT NULL,
    draw_time VARCHAR(20) NOT NULL, -- e.g. "02:00 PM", "09:00 PM"
    slot VARCHAR(20) NOT NULL,      -- "morning" or "night"
    draw_name VARCHAR(255) NOT NULL DEFAULT 'Mizoram State Lottery',
    series VARCHAR(50) DEFAULT 'Morning/Night Series',
    image_url TEXT NOT NULL,
    file_name VARCHAR(255),
    file_type VARCHAR(50) DEFAULT 'image/jpeg',
    file_size BIGINT DEFAULT 0,
    publish_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexing for fast search and filtering by date and slot
CREATE INDEX IF NOT EXISTS idx_results_draw_date ON public.results (draw_date DESC);
CREATE INDEX IF NOT EXISTS idx_results_slot ON public.results (slot);
CREATE INDEX IF NOT EXISTS idx_results_date_slot ON public.results (draw_date DESC, slot);

-- 2. Enable Row Level Security (RLS)
ALTER TABLE public.results ENABLE ROW LEVEL SECURITY;

-- Allow public read access to all users (anyone can see lottery results)
DROP POLICY IF EXISTS "Public results are viewable by everyone" ON public.results;
CREATE POLICY "Public results are viewable by everyone" 
ON public.results FOR SELECT 
USING (true);

-- Allow insert, update, and delete for admin operations
DROP POLICY IF EXISTS "Allow lottery sheet insert" ON public.results;
CREATE POLICY "Allow lottery sheet insert" 
ON public.results FOR INSERT 
WITH CHECK (true);

DROP POLICY IF EXISTS "Allow lottery sheet update" ON public.results;
CREATE POLICY "Allow lottery sheet update" 
ON public.results FOR UPDATE 
USING (true);

DROP POLICY IF EXISTS "Allow lottery sheet delete" ON public.results;
CREATE POLICY "Allow lottery sheet delete" 
ON public.results FOR DELETE 
USING (true);

-- 3. Create Storage Bucket for Result Images
-- Note: 'results' bucket with public read access
INSERT INTO storage.buckets (id, name, public)
VALUES ('results', 'results', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Storage Policies for 'results' bucket
DROP POLICY IF EXISTS "Public can view lottery result sheets" ON storage.objects;
CREATE POLICY "Public can view lottery result sheets" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'results');

DROP POLICY IF EXISTS "Allow upload to results bucket" ON storage.objects;
CREATE POLICY "Allow upload to results bucket" 
ON storage.objects FOR INSERT 
WITH CHECK (bucket_id = 'results');

DROP POLICY IF EXISTS "Allow update in results bucket" ON storage.objects;
CREATE POLICY "Allow update in results bucket" 
ON storage.objects FOR UPDATE 
USING (bucket_id = 'results');

DROP POLICY IF EXISTS "Allow delete in results bucket" ON storage.objects;
CREATE POLICY "Allow delete in results bucket" 
ON storage.objects FOR DELETE 
USING (bucket_id = 'results');
