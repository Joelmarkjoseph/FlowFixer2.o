-- FlowFixer Supabase Schema
-- Run this in Supabase SQL Editor

-- Create resent_messages table
CREATE TABLE IF NOT EXISTS resent_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_code TEXT NOT NULL,
  message_guid TEXT NOT NULL,
  iflow_name TEXT,
  status TEXT DEFAULT 'Resent',
  resent_at TIMESTAMP,
  resent_by TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT unique_company_message UNIQUE(company_code, message_guid)
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_company_code ON resent_messages(company_code);
CREATE INDEX IF NOT EXISTS idx_message_guid ON resent_messages(message_guid);
CREATE INDEX IF NOT EXISTS idx_status ON resent_messages(status);
CREATE INDEX IF NOT EXISTS idx_resent_at ON resent_messages(resent_at);

-- Enable Row Level Security
ALTER TABLE resent_messages ENABLE ROW LEVEL SECURITY;

-- Create policy to allow all operations (using anon key)
DROP POLICY IF EXISTS "Allow all operations" ON resent_messages;
CREATE POLICY "Allow all operations" ON resent_messages
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to call the function
DROP TRIGGER IF EXISTS update_resent_messages_updated_at ON resent_messages;
CREATE TRIGGER update_resent_messages_updated_at
    BEFORE UPDATE ON resent_messages
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Verify table creation
SELECT 'Table created successfully!' as status;
SELECT * FROM resent_messages LIMIT 1;
