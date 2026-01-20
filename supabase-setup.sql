-- ============================================
-- VoxAnalyze MVP - Supabase Database Setup
-- ============================================
-- Run this SQL in Supabase SQL Editor
-- ============================================

-- Create call_records table
CREATE TABLE IF NOT EXISTS call_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audio_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_format TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  upload_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL CHECK (status IN ('pending', 'transcribing', 'analyzing', 'completed', 'error')),
  error_message TEXT,
  
  -- Transcription data (stored as JSONB)
  transcription JSONB,
  
  -- Analysis data (stored as JSONB)
  analysis JSONB,
  
  -- Storage reference
  storage_path TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_call_records_upload_date ON call_records(upload_date DESC);
CREATE INDEX IF NOT EXISTS idx_call_records_status ON call_records(status);
CREATE INDEX IF NOT EXISTS idx_call_records_audio_id ON call_records(audio_id);

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to update updated_at on row update
CREATE TRIGGER update_call_records_updated_at 
    BEFORE UPDATE ON call_records 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security (RLS)
ALTER TABLE call_records ENABLE ROW LEVEL SECURITY;

-- Create policy to allow all operations (for MVP - adjust based on your auth needs)
-- For production, you should restrict based on user_id
CREATE POLICY "Allow all operations for MVP" ON call_records
  FOR ALL USING (true) WITH CHECK (true);

-- Optional: If you want to add user authentication later, uncomment and modify:
-- ALTER TABLE call_records ADD COLUMN user_id UUID REFERENCES auth.users(id);
-- CREATE INDEX idx_call_records_user_id ON call_records(user_id);
-- DROP POLICY "Allow all operations for MVP" ON call_records;
-- CREATE POLICY "Users can only see their own records" ON call_records
--   FOR SELECT USING (auth.uid() = user_id);
-- CREATE POLICY "Users can only insert their own records" ON call_records
--   FOR INSERT WITH CHECK (auth.uid() = user_id);
-- CREATE POLICY "Users can only update their own records" ON call_records
--   FOR UPDATE USING (auth.uid() = user_id);
