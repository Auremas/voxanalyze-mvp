-- ============================================
-- VoxAnalyze - Add User Authentication
-- ============================================
-- Run this SQL in Supabase SQL Editor
-- This migration adds user authentication support
-- ============================================

-- Step 1: Add user_id column to call_records table
ALTER TABLE call_records 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Step 2: Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_call_records_user_id ON call_records(user_id);

-- Step 3: Drop the old "allow all" policy
DROP POLICY IF EXISTS "Allow all operations for MVP" ON call_records;

-- Step 4: Create user role enum for admin/regular users
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('user', 'admin');
    END IF;
END $$;

-- Step 5: Create user_profiles table to store additional user info and roles
CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role user_role NOT NULL DEFAULT 'user',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Step 6: Enable RLS on user_profiles
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Step 7: Create policies for user_profiles
-- Users can read their own profile
CREATE POLICY "Users can read own profile" ON user_profiles
    FOR SELECT USING (auth.uid() = id);

-- Users can update their own profile (except role)
CREATE POLICY "Users can update own profile" ON user_profiles
    FOR UPDATE USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id AND role = (SELECT role FROM user_profiles WHERE id = auth.uid()));

-- Step 8: Create function to automatically create user profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.user_profiles (id, email, role)
    VALUES (NEW.id, NEW.email, 'user');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 9: Create trigger to call the function when a new user signs up
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Step 10: Row Level Security policies for call_records
-- Users can only SELECT their own records
CREATE POLICY "Users can select own records" ON call_records
    FOR SELECT USING (
        auth.uid() = user_id OR 
        EXISTS (
            SELECT 1 FROM user_profiles 
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

-- Users can only INSERT their own records
CREATE POLICY "Users can insert own records" ON call_records
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can only UPDATE their own records
CREATE POLICY "Users can update own records" ON call_records
    FOR UPDATE USING (
        auth.uid() = user_id OR 
        EXISTS (
            SELECT 1 FROM user_profiles 
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

-- Users can only DELETE their own records
CREATE POLICY "Users can delete own records" ON call_records
    FOR DELETE USING (
        auth.uid() = user_id OR 
        EXISTS (
            SELECT 1 FROM user_profiles 
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

-- Step 11: Function to get user role (useful for Edge Functions)
CREATE OR REPLACE FUNCTION public.get_user_role(user_uuid UUID)
RETURNS user_role AS $$
    SELECT role FROM user_profiles WHERE id = user_uuid;
$$ LANGUAGE sql SECURITY DEFINER;

-- Step 12: Migrate existing records (optional - assign to first admin or leave null)
-- Uncomment and modify if you have existing records:
-- UPDATE call_records SET user_id = (SELECT id FROM auth.users LIMIT 1) WHERE user_id IS NULL;

COMMENT ON TABLE user_profiles IS 'User profiles with roles for access control';
COMMENT ON FUNCTION public.handle_new_user() IS 'Automatically creates user profile when user signs up';
COMMENT ON FUNCTION public.get_user_role(UUID) IS 'Returns user role for authorization checks';
