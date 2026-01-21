// Supabase Edge Function: Get transcription by record ID
// GET /api/transcription/:id

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// NOTE: std@0.168.0 exports `encode`/`decode` (not `encodeBase64`/`decodeBase64`)
import { decode as decodeBase64, encode as encodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";

/**
 * Get CORS headers based on request origin
 * Allows specific origins in production, wildcard in development
 */
function getCorsHeaders(req: Request): Record<string, string> {
  const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const origin = req.headers.get('Origin');
  
  // Always allow localhost for local development
  const isLocalhost = origin && (
    origin.startsWith('http://localhost:') ||
    origin.startsWith('http://127.0.0.1:') ||
    origin.startsWith('http://0.0.0.0:')
  );
  
  // If no allowed origins configured, allow all (development mode)
  if (allowedOrigins.length === 0) {
    return {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    };
  }
  
  // Allow localhost even when ALLOWED_ORIGINS is set (for local development)
  if (isLocalhost) {
    return {
      'Access-Control-Allow-Origin': origin || '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Credentials': 'true',
    };
  }
  
  // Production mode: check if origin is allowed
  if (origin && allowedOrigins.includes(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Credentials': 'true',
    };
  }
  
  // Origin not allowed - return minimal CORS (will block request)
  return {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

async function encryptForStorage(text: string): Promise<string> {
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
  if (!encryptionKey) return text;

  const keyBuffer = Uint8Array.from(
    encryptionKey.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []
  );

  const key = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return encodeBase64(combined);
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
    if (req.method !== 'GET' && req.method !== 'POST') {
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
      if (req.method === 'GET') {
        return new Response(
          JSON.stringify({ error: 'Transcription not available for this record' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // POST: generate transcription if missing (or return existing)
    if (req.method === 'POST') {
      if (data.transcription) {
        // fall through to return (decrypt if needed)
      } else {
        // Mark transcribing (and fail fast if update is blocked by RLS)
        const { error: markErr } = await supabase
          .from('call_records')
          .update({ status: 'transcribing' })
          .eq('id', recordId);
        if (markErr) {
          throw new Error(`Failed to set status=transcribing: ${markErr.message}`);
        }

        const safeName = String(data.file_name || 'audio')
          .replace(/[^\w.\-]+/g, '_')
          .slice(0, 120);
        const filePath = `audio-files/${recordId}-${safeName}`;

        const { data: dl, error: dlErr } = await supabase.storage.from('audio-files').download(filePath);
        if (dlErr || !dl) {
          throw new Error(`Failed to download audio from Storage: ${dlErr?.message || 'missing file'}`);
        }

        const buf = new Uint8Array(await dl.arrayBuffer());
        const base64Audio = encodeBase64(buf);
        const mimeType = data.file_format || 'audio/mpeg';

        const geminiApiKey = Deno.env.get('GEMINI_API_KEY') ?? '';
        if (!geminiApiKey) throw new Error('GEMINI_API_KEY not set');

        // Try models in order: fastest first, then fallbacks
        const models = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash-exp'];
        let transcriptionText = '';
        let parsed: any = null;
        let lastError: Error | null = null;

        for (const model of models) {
          try {
            console.log(`Attempting transcription with model: ${model}`);
            const transcriptionBody = JSON.stringify({
              contents: [{
                parts: [
                  { inlineData: { data: base64Audio, mimeType } },
                  { text: `Transkribuok VISĄ klientų aptarnavimo skambučio įrašą lietuvių kalba kaip DIALOGĄ tarp dviejų kalbėtojų.

SVARBU:
- Naudok kalbėtojus: "Agentas" ir "Klientas"
- Segmentai privalo keistis (dialogas), venk tuščių segmentų.

Grąžink JSON su laukais: text, language ("lt"), segments [{speaker,text,startTime,endTime}].` }
                ]
              }],
              generationConfig: { responseMimeType: 'application/json' }
            });

            const res = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`,
              { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: transcriptionBody }
            );

            if (!res.ok) {
              const raw = await res.text().catch(() => '');
              lastError = new Error(`Gemini transcription failed (${res.status}): ${raw.substring(0, 300)}`);
              console.warn(`Model ${model} failed:`, lastError.message);
              continue; // Try next model
            }

            const json = await res.json();
            
            // Check for safety filter blocks
            if (json?.promptFeedback?.blockReason) {
              lastError = new Error(`Gemini blocked content: ${json.promptFeedback.blockReason}. Audio may contain blocked content.`);
              console.warn(`Model ${model} blocked:`, lastError.message);
              continue; // Try next model
            }
            
            // Check for finish reason (safety/other)
            const finishReason = json?.candidates?.[0]?.finishReason;
            if (finishReason && finishReason !== 'STOP') {
              console.warn(`Gemini finish reason: ${finishReason}`);
              if (finishReason === 'SAFETY') {
                lastError = new Error('Gemini blocked transcription due to safety filters. Audio may contain inappropriate content.');
                console.warn(`Model ${model} safety block:`, lastError.message);
                continue; // Try next model
              }
            }
            
            transcriptionText = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || '';
            if (!transcriptionText) {
              console.warn(`Model ${model} returned empty text. Response:`, JSON.stringify(json, null, 2).substring(0, 500));
              lastError = new Error(`Empty transcription from Gemini (model: ${model})`);
              continue; // Try next model
            }

            // Successfully got transcription text
            try { 
              parsed = JSON.parse(transcriptionText);
              console.log(`✅ Successfully transcribed with model: ${model}`);
              break; // Exit model loop
            } catch (e: any) { 
              lastError = new Error(`Failed to parse transcription JSON from ${model}: ${e.message}`);
              console.warn(`Model ${model} parse error:`, lastError.message);
              continue; // Try next model
            }
          } catch (err: any) {
            lastError = err;
            console.warn(`Model ${model} error:`, err.message);
            continue; // Try next model
          }
        }

        if (!parsed) {
          throw lastError || new Error('All transcription models failed');
        }

        const segments = Array.isArray(parsed.segments)
          ? parsed.segments.filter((s: any) => s && typeof s.text === 'string' && s.text.trim().length > 0)
          : [];

        const transcriptionObj = {
          id: Math.random().toString(36).substring(2, 11),
          text: String(parsed.text || ''),
          language: parsed.language || 'lt',
          segments,
          timestamp: new Date().toISOString(),
        };

        const toEncrypt = JSON.stringify(transcriptionObj);
        const encrypted = await encryptForStorage(toEncrypt);
        const transcriptionForDB =
          encrypted !== toEncrypt ? { encrypted: true, data: encrypted } : transcriptionObj;

        const { error: saveErr } = await supabase
          .from('call_records')
          .update({ transcription: transcriptionForDB, status: 'completed' })
          .eq('id', recordId);
        if (saveErr) {
          throw new Error(`Failed to save transcription to DB (RLS?): ${saveErr.message}`);
        }

        // Return unencrypted payload to client
        return new Response(
          JSON.stringify(transcriptionObj),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        );
      }
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
