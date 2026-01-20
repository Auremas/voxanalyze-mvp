import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // loadEnv with empty prefix '' loads all env vars, including those without VITE_ prefix
  const env = loadEnv(mode, process.cwd(), '');
  
  console.log('Loading environment variables...');
  console.log('VITE_SUPABASE_URL:', env.VITE_SUPABASE_URL ? 'YES' : 'NO');
  console.log('VITE_SUPABASE_ANON_KEY:', env.VITE_SUPABASE_ANON_KEY ? 'YES' : 'NO');
  console.log('⚠️  SECURITY: API keys and encryption keys are NOT exposed to frontend');
  console.log('⚠️  All sensitive operations use Edge Functions (server-side)');
  
  return {
  plugins: [react()],
  define: {
      // SECURITY: Only expose public keys (Supabase anon key is public by design, protected by RLS)
      // DO NOT expose: API_KEY, GEMINI_API_KEY, ENCRYPTION_KEY
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(env.VITE_SUPABASE_URL || ''),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(env.VITE_SUPABASE_ANON_KEY || ''),
    },
    server: {
      // Security headers for development
      headers: {
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'X-XSS-Protection': '1; mode=block',
        'Referrer-Policy': 'strict-origin-when-cross-origin'
      }
    },
    preview: {
      // Force HTTPS in preview mode
      https: mode === 'production',
      headers: {
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'X-XSS-Protection': '1; mode=block',
        'Referrer-Policy': 'strict-origin-when-cross-origin'
      }
    }
  };
});