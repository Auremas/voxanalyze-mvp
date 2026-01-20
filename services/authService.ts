// Authentication service for Supabase Auth
import { createClient } from '@supabase/supabase-js';
import type { User, Session, AuthError } from '@supabase/supabase-js';

const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL || '';
const supabaseAnonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';

// Validate Supabase credentials before creating client
if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Supabase credentials not configured!');
  console.error('   Missing VITE_SUPABASE_URL:', !supabaseUrl);
  console.error('   Missing VITE_SUPABASE_ANON_KEY:', !supabaseAnonKey);
  console.error('   Please add these to .env.local and restart the dev server');
}

// Validate URL format
if (supabaseUrl && !supabaseUrl.startsWith('http')) {
  console.error('❌ Invalid Supabase URL format. Should start with https://');
}

// Validate key format (anon keys usually start with 'eyJ')
if (supabaseAnonKey && !supabaseAnonKey.startsWith('eyJ')) {
  console.warn('⚠️ Supabase anon key format looks incorrect (should start with "eyJ")');
}

export const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseAnonKey || 'placeholder-key', {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  }
});

export type { User, Session, AuthError };

// Get current user
export const getCurrentUser = async (): Promise<User | null> => {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) {
    console.error('Error getting current user:', error);
    return null;
  }
  return user;
};

// Get current session
export const getSession = async (): Promise<Session | null> => {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) {
    console.error('Error getting session:', error);
    return null;
  }
  return session;
};

// Sign up with email and password
export const signUp = async (email: string, password: string): Promise<{ user: User | null; error: AuthError | null }> => {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });
  
  if (error) {
    console.error('Sign up error:', error);
    return { user: null, error };
  }
  
  return { user: data.user, error: null };
};

// Sign in with email and password
export const signIn = async (email: string, password: string): Promise<{ user: User | null; error: AuthError | null }> => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  
  if (error) {
    console.error('Sign in error:', error);
    return { user: null, error };
  }
  
  return { user: data.user, error: null };
};

// Sign out
export const signOut = async (): Promise<{ error: AuthError | null }> => {
  const { error } = await supabase.auth.signOut();
  
  if (error) {
    console.error('Sign out error:', error);
    return { error };
  }
  
  return { error: null };
};

// Listen to auth state changes
export const onAuthStateChange = (callback: (user: User | null) => void) => {
  return supabase.auth.onAuthStateChange((event, session) => {
    callback(session?.user ?? null);
  });
};

// Get user role (admin or user)
export const getUserRole = async (userId: string): Promise<'admin' | 'user' | null> => {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', userId)
    .single();
  
  if (error || !data) {
    console.error('Error getting user role:', error);
    return null;
  }
  
  return data.role as 'admin' | 'user';
};

// Check if user is admin
export const isAdmin = async (userId: string): Promise<boolean> => {
  const role = await getUserRole(userId);
  return role === 'admin';
};
