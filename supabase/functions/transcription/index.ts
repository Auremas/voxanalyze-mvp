// Supabase Edge Function: Get transcription by record ID
// GET /api/transcription/:id

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// NOTE: std@0.168.0 exports `encode`/`decode` (not `encodeBase64`/`decodeBase64`)
import { decode as decodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";

/**
 * Get CORS headers based on request origin
 * Allows specific origins in production, wildcard in development
 */
function getCorsHeaders(req: Request): Record<string, string> {
  const allowedOrigins = Deno.env.get('ALLOWED_ORIGINS')?.split(',') || [];
  const origin = req.headers.get('Origin');
  
  // If no allowed origins configured, allow all (development mode)
  if (allowedOrigins.length === 0) {
    return {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    };
  }
  
  // Production mode: check if origin is allowed
  if (origin && allowedOrigins.includes(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Credentials': 'true',
    };
  }
  
  // Origin not allowed - return minimal CORS (will block request)
  return {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

/**
 * Server-side decryption using Deno's Web Crypto API
 * Decrypts sensitive data after retrieving from database
 * SECURITY: Encryption key never exposed to frontend
 */
async function decryptForStorage(ciphertext: string, encryptionKey: string): Promise<string> {
  try {
    // Convert hex string to ArrayBuffer
    const keyBuffer = Uint8Array.from(
      encryptionKey.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []
    );

    // Import key for AES-GCM
    const key = await crypto.subtle.importKey(
      'raw',
      keyBuffer,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );

    // Decode base64 (binary-safe; avoids large atob() strings)
    const combined = decodeBase64(ciphertext);

    // Extract IV (first 12 bytes) and encrypted data
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);

    // Decrypt
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      encrypted
    );

    // Decode to string
    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch (error: any) {
    console.error('❌ Decryption error:', error);
    throw new Error(`Failed to decrypt data: ${error.message}`);
  }
}

serve(async (req) => {
  const startTime = Date.now();
  console.log(JSON.stringify({location:'transcription/index.ts:59',message:'Edge Function entry',data:{method:req.method,url:req.url,hasAuthHeader:!!req.headers.get('Authorization')},timestamp:Date.now(),sessionId:'debug-session',runId:'run-transcription',hypothesisId:'H1'}));
  
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    const corsHeaders = getCorsHeaders(req);
    // 204 responses must not include a body; some gateways/runtime will error otherwise.
    return new Response(null, { headers: corsHeaders, status: 204 });
  }
  
  const corsHeaders = getCorsHeaders(req);

  try {
    if (req.method !== 'GET') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    // Get auth token from request headers
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authorization header required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client with auth token
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } }
    });

    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized. Please log in.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get ID from URL path
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/');
    const recordId = pathParts[pathParts.length - 1];

    if (!recordId || recordId === 'transcription') {
      return new Response(
        JSON.stringify({ error: 'Record ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get record from Supabase
    const { data, error } = await supabase
      .from('call_records')
      .select('*')
      .eq('id', recordId)
      .single();

    if (error || !data) {
      return new Response(
        JSON.stringify({ error: 'Transcription not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!data.transcription) {
      return new Response(
        JSON.stringify({ error: 'Transcription not available for this record' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Decrypt transcription if encrypted (server-side only - encryption key never exposed to frontend)
    let transcriptionData = data.transcription;
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
    
    if (transcriptionData?.encrypted && transcriptionData?.data && encryptionKey) {
      try {
        // Decrypt using same logic as upload function
        const decrypted = await decryptForStorage(transcriptionData.data, encryptionKey);
        transcriptionData = JSON.parse(decrypted);
        console.log('🔓 Transcription decrypted server-side');
      } catch (decryptError: any) {
        console.error('❌ Decryption error:', decryptError.message);
        return new Response(
          JSON.stringify({ error: 'Failed to decrypt transcription' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Return decrypted transcription (or unencrypted if not encrypted)
    return new Response(
      JSON.stringify({
        id: transcriptionData.id,
        text: transcriptionData.text,
        language: transcriptionData.language,
        segments: transcriptionData.segments || [],
        timestamp: transcriptionData.timestamp,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Get transcription error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to retrieve transcription' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
