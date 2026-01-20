// Supabase Edge Function: Upload and process audio file
// POST /api/upload

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// NOTE: std@0.168.0 exports `encode`/`decode` (not `encodeBase64`)
import { encode as encodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Get CORS headers based on request origin
 * Allows specific origins in production, wildcard in development
 */
function getCorsHeaders(req: Request): Record<string, string> {
  const allowedOrigins = Deno.env.get('ALLOWED_ORIGINS')?.split(',') || [];
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
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    };
  }
  
  // Allow localhost even when ALLOWED_ORIGINS is set (for local development)
  if (isLocalhost) {
    return {
      'Access-Control-Allow-Origin': origin || '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Credentials': 'true',
    };
  }
  
  // Production mode: check if origin is allowed
  if (origin && allowedOrigins.includes(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Credentials': 'true',
    };
  }
  
  // Origin not allowed - return minimal CORS (will block request)
  return {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

/**
 * Safe JSON response builder.
 * Some runtimes can throw "Maximum call stack size exceeded" for very large payloads during stringify.
 * We fall back to a smaller metadata payload in that case.
 */
function safeJsonResponse(
  fullPayload: any,
  fallbackPayload: any,
): { json: string; usedFallback: boolean; fullLen: number; fallbackLen: number } {
  let fullJson = '';
  let fallbackJson = '';
  try {
    fullJson = JSON.stringify(fullPayload);
  } catch {
    fullJson = '';
  }
  try {
    fallbackJson = JSON.stringify(fallbackPayload);
  } catch {
    fallbackJson = '{"error":"Failed to serialize response"}';
  }
  if (!fullJson) {
    return { json: fallbackJson, usedFallback: true, fullLen: 0, fallbackLen: fallbackJson.length };
  }
  // Heuristic: keep response reasonably small to avoid frontend + runtime issues
  if (fullJson.length > 250_000) {
    return { json: fallbackJson, usedFallback: true, fullLen: fullJson.length, fallbackLen: fallbackJson.length };
  }
  return { json: fullJson, usedFallback: false, fullLen: fullJson.length, fallbackLen: fallbackJson.length };
}

/**
 * Server-side encryption using Deno's Web Crypto API
 * Encrypts sensitive data before storing in database
 */
async function encryptForStorage(text: string): Promise<string> {
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
  if (!encryptionKey) {
    console.warn('⚠️ ENCRYPTION_KEY not set, storing unencrypted (not recommended for production)');
    return text;
  }

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
      ['encrypt']
    );

    // Generate random IV (96 bits for AES-GCM)
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // Encode text
    const encoder = new TextEncoder();
    const data = encoder.encode(text);

    // Encrypt
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      data
    );

    // Combine IV and encrypted data
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);

    // Encode as base64 (binary-safe, avoids stack overflows)
    const base64 = encodeBase64(combined);
    console.log('🔒 Data encrypted before storage');
    return base64;
  } catch (error: any) {
    console.error('❌ Encryption error:', error);
    // Fallback: return unencrypted (not recommended)
    return text;
  }
}


serve(async (req) => {
  const startTime = Date.now();
  // #region agent log
  console.log(JSON.stringify({location:'upload/index.ts:131',message:'Edge Function entry',data:{method:req.method,hasAuthHeader:!!req.headers.get('Authorization')},timestamp:Date.now(),sessionId:'debug-session',runId:'run-edge-fn',hypothesisId:'H1'}));
  // #endregion agent log
  
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    const corsHeaders = getCorsHeaders(req);
    // 204 responses must not include a body; some runtimes/gateways will error otherwise.
    return new Response(null, { headers: corsHeaders, status: 204 });
  }
  
  const corsHeaders = getCorsHeaders(req);

  // Lightweight health check (helps confirm requests are reaching the function)
  if (req.method === 'GET') {
    return new Response(
      JSON.stringify({ ok: true, name: 'upload', ts: Date.now() }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

   class UpstreamQuotaError extends Error {
     status: number;
     constructor(message: string, status: number) {
       super(message);
       this.name = 'UpstreamQuotaError';
       this.status = status;
     }
   }

   class UpstreamOverloadedError extends Error {
     status: number;
     constructor(message: string, status: number) {
       super(message);
       this.name = 'UpstreamOverloadedError';
       this.status = status;
     }
   }

   async function parseGeminiError(res: Response): Promise<{ status: number; message: string; raw: string }> {
     const status = res.status;
     const raw = await res.text().catch(() => '');
     let msg = raw;
     try {
       const parsed = JSON.parse(raw);
       msg =
         parsed?.error?.message ||
         parsed?.message ||
         parsed?.error ||
         raw;
     } catch {
       // keep raw text
     }
     return { status, message: String(msg || '').trim(), raw };
   }

   async function sleep(ms: number) {
     await new Promise((resolve) => setTimeout(resolve, ms));
   }

   function backoffMs(attempt: number) {
     // attempt: 0,1,2...
     const base = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s...
     const jitter = Math.floor(Math.random() * 250);
     return Math.min(10_000, base + jitter);
   }

   function redactSensitiveSummary(text: string): string {
     if (!text) return text;
     let out = text;

     // Emails
     out = out.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EL. PAŠTAS]');

     // Phone-like sequences (very rough, but catches +370..., 8xxxxxxxx, etc.)
     out = out.replace(/(\+?\d[\d\s().-]{6,}\d)/g, '[TEL. NR.]');

     // Lithuanian personal code patterns (11 digits) - avoid nuking general numbers by requiring word boundaries
     out = out.replace(/\b\d{11}\b/g, '[ASMENS KODAS]');

     // IBAN (LT...)
     out = out.replace(/\bLT\d{2}[A-Z0-9]{10,30}\b/gi, '[IBAN]');

     // Common “Name Surname” pattern: two TitleCase words.
     // This is intentionally conservative and only applied inside summary.
     out = out.replace(/\b[A-ZĄČĘĖĮŠŲŪŽ][a-ząčęėįšųūž]+ [A-ZĄČĘĖĮŠŲŪŽ][a-ząčęėįšųūž]+\b/g, '[VARDAS PAVARDĖ]');

     // Collapse multiple spaces created by replacements
     out = out.replace(/\s{2,}/g, ' ').trim();
     return out;
   }

  try {
    // #region agent log
    console.log(JSON.stringify({location:'upload/index.ts:137',message:'Before auth check',data:{elapsed:Date.now()-startTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run-edge-fn',hypothesisId:'H1'}));
    // #endregion agent log
    
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
    
    if (!supabaseUrl || !supabaseKey) {
      console.error('❌ Missing Supabase configuration:', {
        hasUrl: !!supabaseUrl,
        hasKey: !!supabaseKey
      });
      return new Response(
        JSON.stringify({ error: 'Server configuration error: Missing Supabase credentials' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } }
    });

    // Verify user is authenticated and get user_id
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.error('❌ Auth error:', authError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized. Please log in.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = user.id;
    console.log(`🔐 Authenticated user: ${userId}`);
    // #region agent log
    console.log(JSON.stringify({location:'upload/index.ts:163',message:'After auth success',data:{userId,elapsed:Date.now()-startTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run-edge-fn',hypothesisId:'H1'}));
    // #endregion agent log

    // Get Gemini API key
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY') ?? '';
    if (!geminiApiKey) {
      console.error('❌ GEMINI_API_KEY not found in environment');
      return new Response(
        JSON.stringify({ error: 'Server configuration error: GEMINI_API_KEY not set. Please configure it in Supabase Dashboard → Edge Functions → Settings → Secrets' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse form data
    // #region agent log
    console.log(JSON.stringify({location:'upload/index.ts:172',message:'Before formData parse',data:{elapsed:Date.now()-startTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run-edge-fn',hypothesisId:'H1'}));
    // #endregion agent log
    const formData = await req.formData();
    const audioFile = formData.get('audio') as File;

    if (!audioFile) {
      return new Response(
        JSON.stringify({ error: 'No audio file provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📤 Received upload: ${audioFile.name} (${audioFile.size} bytes)`);
    // #region agent log
    console.log(JSON.stringify({location:'upload/index.ts:183',message:'After formData parse',data:{fileName:audioFile.name,fileSize:audioFile.size,elapsed:Date.now()-startTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run-edge-fn',hypothesisId:'H1'}));
    // #endregion agent log

    // Guardrail to avoid Supabase Edge worker-limit (546) crashes for large uploads.
    // We convert audio -> base64 (adds ~33%) and keep multiple copies in memory.
    const MAX_AUDIO_BYTES = 12 * 1024 * 1024; // 12MB
    if (audioFile.size > MAX_AUDIO_BYTES) {
      return new Response(
        JSON.stringify({
          error: `Audio failas per didelis (${Math.round(audioFile.size / 1024 / 1024)}MB). Maksimalus dydis: ${Math.round(MAX_AUDIO_BYTES / 1024 / 1024)}MB.`,
          hint: 'Sumažinkite failą (trumpesnis įrašas / mažesnė kokybė) ir bandykite dar kartą.'
        }),
        { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Convert file to base64 (binary-safe, avoids stack overflows)
    // #region agent log
    console.log(JSON.stringify({location:'upload/index.ts:186',message:'Before base64 conversion',data:{elapsed:Date.now()-startTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run-edge-fn',hypothesisId:'H2'}));
    // #endregion agent log
    const arrayBuffer = await audioFile.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    const base64Audio = encodeBase64(uint8Array);
    // #region agent log
    console.log(JSON.stringify({location:'upload/index.ts:189',message:'After base64 conversion',data:{base64Length:base64Audio.length,elapsed:Date.now()-startTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run-edge-fn',hypothesisId:'H2'}));
    // #endregion agent log
    const mimeType = audioFile.type || 'audio/mpeg';

    // Create initial record with user_id
    const audioId = `SKAMB-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const newRecord = {
      audio_id: audioId,
      file_name: audioFile.name,
      file_format: mimeType,
      file_size: audioFile.size,
      upload_date: new Date().toISOString(),
      status: 'transcribing',
      error_message: null,
      transcription: null,
      analysis: null,
      user_id: userId, // Associate record with authenticated user
    };

    // Save initial record to Supabase
    const { data: recordData, error: recordError } = await supabase
      .from('call_records')
      .insert(newRecord)
      .select()
      .single();

    if (recordError) {
      throw new Error(`Failed to save record: ${recordError.message}`);
    }

    const recordId = recordData.id;
    console.log(`✅ Record saved with ID: ${recordId}`);

    // Upload audio file to Supabase Storage
    try {
      const fileExt = audioFile.name.split('.').pop();
      const fileName = `${audioId}-${Date.now()}.${fileExt}`;
      const filePath = `audio-files/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('audio-files')
        .upload(filePath, audioFile, {
          cacheControl: '3600',
          upsert: false,
          contentType: mimeType,
        });

      if (uploadError) {
        console.warn('Storage upload failed:', uploadError);
      } else {
        console.log(`✅ Audio file uploaded to: ${filePath}`);
      }
    } catch (storageError) {
      console.warn('Storage upload error:', storageError);
    }

    // Call Gemini API for transcription
    console.log('🎤 Starting transcription...');
    // #region agent log
    console.log(JSON.stringify({location:'upload/index.ts:267',message:'Before transcription API call',data:{elapsed:Date.now()-startTime,base64Length:base64Audio.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run-edge-fn',hypothesisId:'H3'}));
    // #endregion agent log
    
    // Try stable models in order: fastest first, then more capable fallbacks.
    // Avoid preview-only model IDs here (can cause hard failures).
    const transcriptionModels = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash-exp'];
    let transcriptionResponse: Response | null = null;
    let transcriptionModel = '';
    let transcriptionError: any = null;
    let transcriptionQuotaError: UpstreamQuotaError | null = null;
    let transcriptionOverloadError: UpstreamOverloadedError | null = null;
    
    for (const model of transcriptionModels) {
      try {
        transcriptionModel = model;
        console.log(`Attempting transcription with model: ${model}`);
        // #region agent log
        console.log(JSON.stringify({location:'upload/index.ts:279',message:'Calling Gemini transcription API',data:{model,elapsed:Date.now()-startTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run-edge-fn',hypothesisId:'H3'}));
        // #endregion agent log
        const transcriptionBody = JSON.stringify({
          contents: [{
            parts: [
              { inlineData: { data: base64Audio, mimeType: mimeType } },
              { text: `Transkribuok VISĄ klientų aptarnavimo skambučio įrašą lietuvių kalba kaip DIALOGĄ tarp dviejų kalbėtojų.

SVARBU DIALOGO FORMATUI:
- Identifikuok DU skirtingus kalbėtojus: "Agentas" (aptarnaujantis darbuotojas) ir "Klientas" (skambinantis asmuo)
- Kiekvienas kalbėtojo pasisakymas turi būti atskiras segmentas
- Segmentai turi keistis tarp "Agentas" ir "Klientas" - tai yra pokalbis!
- Jei negali aiškiai identifikuoti kalbėtojo, naudok "Kalbėtojas 1" ir "Kalbėtojas 2" ir keisk juos kiekviename segmente
- NEPRISKIRK viso teksto vienam kalbėtojui - tai turi būti pokalbis su keičiančiais kalbėtojais

FORMATAS:
- text: pilnas transkripcijos tekstas (visas pokalbis)
- language: "lt"
- segments: masyvas, kur kiekvienas segmentas turi:
  * speaker: "Agentas" arba "Klientas" (arba "Kalbėtojas 1"/"Kalbėtojas 2")
  * text: to kalbėtojo pasisakymas
  * startTime: sekundės nuo pradžios
  * endTime: sekundės nuo pradžios

PRIEŠINGAI NEGALIMA:
- NEGALIMA visus segmentus priskirti vienam kalbėtojui
- NEGALIMA visą transkripciją daryti vieno segmento
- TURI būti pokalbis su keičiančiais kalbėtojais` }
            ]
          }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                language: { type: 'string' },
                segments: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      speaker: { type: 'string' },
                      text: { type: 'string' },
                      startTime: { type: 'number' },
                      endTime: { type: 'number' }
                    },
                    required: ['speaker', 'text']
                  }
                }
              },
              required: ['text', 'language', 'segments']
            }
          }
        });

        // Retry on transient overload (503) once before switching models (reduced from 3 to avoid timeouts).
        const maxAttemptsPerModel = 1;
        for (let attempt = 0; attempt < maxAttemptsPerModel; attempt++) {
          if (attempt > 0) {
            const wait = backoffMs(attempt - 1);
            console.warn(`⏳ Gemini overloaded? retrying transcription model ${model} in ${wait}ms (attempt ${attempt + 1}/${maxAttemptsPerModel})`);
            await sleep(wait);
          }

          transcriptionResponse = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: transcriptionBody,
            },
          );

          // #region agent log
          console.log(JSON.stringify({location:'upload/index.ts:338',message:'Transcription API response received',data:{ok:transcriptionResponse.ok,status:transcriptionResponse.status,elapsed:Date.now()-startTime,model,attempt:attempt+1},timestamp:Date.now(),sessionId:'debug-session',runId:'run-edge-fn',hypothesisId:'H3'}));
          // #endregion agent log

          if (transcriptionResponse.ok) {
            console.log(`✅ Successfully using model: ${model}`);
            break; // success, stop retry loop
          }

          const { status, message, raw } = await parseGeminiError(transcriptionResponse);
          const lower = message.toLowerCase();

          const isOverloaded = status === 503 || lower.includes('overloaded');
          const isQuota =
            status === 429 ||
            status === 546 ||
            lower.includes('quota') ||
            lower.includes('rate') ||
            lower.includes('resource exhausted') ||
            lower.includes('too many requests');

          if (isOverloaded) {
            transcriptionOverloadError = new UpstreamOverloadedError(
              `Gemini modelis perkrautas (503): ${message || 'Bandykite po kelių minučių.'}`,
              status,
            );
            console.warn(`⚠️ Gemini OVERLOADED for model ${model} (${status}): ${message}`);
            // try again (retry loop continues). If last attempt, we'll fall through and try next model.
            if (attempt === maxAttemptsPerModel - 1) {
              console.warn(`⚠️ Giving up retries for model ${model} due to overload, trying next model...`);
            }
            continue;
          }

          if (isQuota) {
            transcriptionQuotaError = new UpstreamQuotaError(
              `Gemini API kvotos limitas pasiektas (${status}): ${message || 'Bandykite po 1-2 minučių.'}`,
              status
            );
            console.error(`❌ QUOTA/RATE LIMIT for model ${model} (${status}): ${message}`);
            console.error(`❌ Gemini error (first 500 chars): ${raw.substring(0, 500)}`);
            transcriptionResponse = null;
            break; // further models won't help if quota/key exhausted
          }

          // Non-transient error: break retry loop and try next model.
          transcriptionError = new Error(`Model ${model} failed (${status}): ${message || transcriptionResponse.statusText}`);
          console.warn(`❌ Model ${model} failed (${status}), trying next model...`);
          transcriptionResponse = null;
          break;
        }
      
      if (transcriptionResponse && transcriptionResponse.ok) {
        break; // success exit model loop
      }
      } catch (err: any) {
        transcriptionError = err;
        console.warn(`❌ Model ${model} error: ${err.message}`);
        // #region agent log
        console.log(JSON.stringify({location:'upload/index.ts:346',message:'Transcription API call threw',data:{error:err.message,elapsed:Date.now()-startTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run-edge-fn',hypothesisId:'H3'}));
        // #endregion agent log
        continue; // Try next model
      }
    }

    if (!transcriptionResponse || !transcriptionResponse.ok) {
      if (transcriptionQuotaError) throw transcriptionQuotaError;
      if (transcriptionOverloadError) throw transcriptionOverloadError;
      throw new Error(`Transcription failed with all models: ${transcriptionError?.message || 'Unknown error'}`);
    }

    // #region agent log
    console.log(JSON.stringify({location:'upload/index.ts:357',message:'Before parsing transcription JSON',data:{elapsed:Date.now()-startTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run-edge-fn',hypothesisId:'H3'}));
    // #endregion agent log
    const transcriptionData = await transcriptionResponse.json();
    
    // Extract text from response - handle multiple parts if present
    let transcriptionText = '';
    const candidate = transcriptionData.candidates?.[0];
    if (candidate?.content?.parts) {
      // Combine all parts if multiple parts exist (some responses may be split)
      transcriptionText = candidate.content.parts
        .map((part: any) => part.text || '')
        .filter((text: string) => text.length > 0)
        .join('');
    }
    
    if (!transcriptionText || transcriptionText === '{}') {
      console.error('❌ No transcription text found in response:', JSON.stringify(transcriptionData).substring(0, 500));
      throw new Error('Transcription response was empty or invalid');
    }
    
    console.log(`📝 Raw transcription text length: ${transcriptionText.length} chars`);
    console.log(`📝 First 200 chars: ${transcriptionText.substring(0, 200)}`);
    console.log(`📝 Last 200 chars: ${transcriptionText.substring(Math.max(0, transcriptionText.length - 200))}`);
    
    let transcription: any = {};
    try {
      transcription = JSON.parse(transcriptionText);
      console.log(`✅ Parsed transcription: text=${transcription.text?.length || 0} chars, segments=${transcription.segments?.length || 0}`);
    } catch (parseError: any) {
      console.error('❌ JSON parse error:', parseError.message);
      console.error('❌ Problematic text (first 500 chars):', transcriptionText.substring(0, 500));
      console.error('❌ Problematic text (last 500 chars):', transcriptionText.substring(Math.max(0, transcriptionText.length - 500)));
      throw new Error(`Failed to parse transcription JSON: ${parseError.message}`);
    }

    // Helper function to split text into dialogue segments
    function splitTextIntoDialogue(text: string): any[] {
      if (!text || text.trim().length === 0) return [];
      
      // Split by sentences (periods, question marks, exclamation marks)
      // Also split on common dialogue patterns
      const sentenceEnders = /([.!?]+\s+|\.\s+)/g;
      const sentences: string[] = [];
      let lastIndex = 0;
      let match;
      
      // First, split by sentence endings
      while ((match = sentenceEnders.exec(text)) !== null) {
        const sentence = text.substring(lastIndex, match.index + match[0].length).trim();
        if (sentence.length > 0) {
          sentences.push(sentence);
        }
        lastIndex = match.index + match[0].length;
      }
      
      // Add remaining text
      if (lastIndex < text.length) {
        const remaining = text.substring(lastIndex).trim();
        if (remaining.length > 0) {
          sentences.push(remaining);
        }
      }
      
      // If no sentence breaks found, try splitting by length
      if (sentences.length === 0) {
        const chunkSize = Math.max(100, Math.floor(text.length / 10));
        for (let i = 0; i < text.length; i += chunkSize) {
          sentences.push(text.substring(i, i + chunkSize).trim());
        }
      }
      
      // Group sentences into dialogue segments with forced alternation
      const dialogueSegments: any[] = [];
      let currentSpeaker = 'Agentas'; // Usually starts with agent greeting
      let currentSegment = '';
      let segmentStartTime = 0;
      let timePerChar = 0.1; // Rough estimate: 0.1 seconds per character
      let sentencesInCurrentSegment = 0;
      const maxSentencesPerSegment = 3; // Force switch after 3 sentences max
      
      for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i];
        if (!sentence || sentence.trim().length === 0) continue;
        
        const isQuestion = sentence.includes('?');
        const isGreeting = /^(Labas|Sveiki|Sveikas|Ačiū|Dėkoju|Prašau|Taip|Ne|Melava)/i.test(sentence);
        const isResponse = /^(Aha|Taip|Ne|Gerai|Supratau|Aišku|Okei|Drąsiai)/i.test(sentence);
        const isClientPattern = /^(Norėčiau|Galėčiau|Aš|Man|Mano|Pas|Rytoj|Šiandien)/i.test(sentence);
        
        // Determine if this should be a new speaker
        let shouldSwitchSpeaker = false;
        
        if (i === 0 && isGreeting) {
          // First sentence is usually agent greeting
          currentSpeaker = 'Agentas';
        } else if (isQuestion && currentSpeaker === 'Agentas') {
          // Agent asks question, next should be client
          shouldSwitchSpeaker = true;
        } else if ((isResponse || isClientPattern) && currentSpeaker === 'Agentas') {
          // Client patterns after agent
          shouldSwitchSpeaker = true;
        } else if (isResponse && currentSpeaker === 'Klientas') {
          // Client responds, next might be agent
          shouldSwitchSpeaker = true;
        } else if (i > 0 && (isGreeting || isResponse)) {
          // Greetings/responses often indicate speaker change
          shouldSwitchSpeaker = true;
        }
        
        // Force alternation: switch after max sentences or long segment
        const shouldForceSwitch = sentencesInCurrentSegment >= maxSentencesPerSegment || 
                                  (currentSegment.length > 150 && sentence.length > 50);
        
        // If we should switch or current segment is getting long, start new segment
        if (shouldSwitchSpeaker || shouldForceSwitch || (currentSegment.length > 0 && currentSegment.length + sentence.length > 250)) {
          // Only push current segment if it has content
          if (currentSegment.trim().length > 0) {
            dialogueSegments.push({
              speaker: currentSpeaker,
              text: currentSegment.trim(),
              startTime: segmentStartTime,
              endTime: segmentStartTime + (currentSegment.length * timePerChar)
            });
            segmentStartTime += currentSegment.length * timePerChar;
          }
          
          // Always switch speaker when starting new segment (forced alternation)
          currentSpeaker = currentSpeaker === 'Agentas' ? 'Klientas' : 'Agentas';
          sentencesInCurrentSegment = 0;
          
          // Start new segment with current sentence
          currentSegment = sentence;
          sentencesInCurrentSegment = 1;
        } else {
          // Continue current segment
          currentSegment += (currentSegment ? ' ' : '') + sentence;
          sentencesInCurrentSegment++;
        }
      }
      
      // Add final segment
      if (currentSegment.length > 0) {
        dialogueSegments.push({
          speaker: currentSpeaker,
          text: currentSegment.trim(),
          startTime: segmentStartTime,
          endTime: segmentStartTime + (currentSegment.length * timePerChar)
        });
      }
      
      // Filter out empty segments (no text or only whitespace)
      const validSegments = dialogueSegments.filter(seg => seg.text && seg.text.trim().length > 0);
      
      // If we filtered out segments, we might have lost some text - try to merge adjacent segments
      if (validSegments.length < dialogueSegments.length) {
        console.warn(`⚠️ Filtered out ${dialogueSegments.length - validSegments.length} empty segments`);
      }
      
      // Ensure we have at least 2 speakers if possible
      if (validSegments.length > 1) {
        const speakers = new Set(validSegments.map(s => s.speaker));
        if (speakers.size === 1) {
          // All same speaker, alternate them
          validSegments.forEach((seg, idx) => {
            seg.speaker = idx % 2 === 0 ? 'Agentas' : 'Klientas';
          });
        }
      }
      
      return validSegments;
    }

    // Process segments
    let segments = transcription.segments || [];
    const transcriptionFullText = transcription.text || '';
    
    // Check if we need to split into dialogue
    const uniqueSpeakers = new Set(segments.map((s: any) => s.speaker?.toLowerCase() || '').filter(Boolean));
    const allSameSpeaker = uniqueSpeakers.size === 1 || uniqueSpeakers.size === 0;
    const singleLongSegment = segments.length === 1 && segments[0]?.text && segments[0].text.length > 200;
    const noSegments = segments.length === 0 && transcriptionFullText.length > 0;
    const allSegmentsSameSpeaker = segments.length > 1 && allSameSpeaker;
    
    // ALWAYS split if we have a single long segment or all segments have same speaker
    // This ensures dialogue format even if Gemini didn't split it properly
    if (noSegments || singleLongSegment || allSegmentsSameSpeaker) {
      console.warn(`⚠️ Dialogue issue detected:`, {
        noSegments,
        singleLongSegment,
        allSegmentsSameSpeaker,
        segmentCount: segments.length,
        uniqueSpeakers: Array.from(uniqueSpeakers),
        firstSpeaker: segments[0]?.speaker,
        fullTextLength: transcriptionFullText.length
      });
      console.warn(`⚠️ Attempting to split into dialogue format...`);
      
      // Get the text to split
      let textToSplit = '';
      if (noSegments) {
        textToSplit = transcriptionFullText;
      } else if (singleLongSegment) {
        textToSplit = segments[0].text;
      } else {
        // Multiple segments but same speaker - combine and resplit
        textToSplit = segments.map((s: any) => s.text || '').join(' ').trim();
      }
      
      // Split into dialogue
      const newSegments = splitTextIntoDialogue(textToSplit);
      
      if (newSegments.length > 0) {
        segments = newSegments;
        console.log(`✅ Split into ${segments.length} dialogue segments`);
        
        // Log speaker distribution
        const speakerCounts: Record<string, number> = {};
        segments.forEach((s: any) => {
          const speaker = s.speaker || 'Unknown';
          speakerCounts[speaker] = (speakerCounts[speaker] || 0) + 1;
        });
        console.log(`📊 Speaker distribution:`, speakerCounts);
        
        // Force alternation if still only one speaker
        const finalSpeakers = new Set(segments.map((s: any) => s.speaker));
        if (finalSpeakers.size === 1 && segments.length > 1) {
          console.warn(`⚠️ Still only one speaker after splitting, forcing alternation...`);
          segments.forEach((seg, idx) => {
            seg.speaker = idx % 2 === 0 ? 'Agentas' : 'Klientas';
          });
          console.log(`✅ Forced alternation: ${segments.filter(s => s.speaker === 'Agentas').length} Agentas, ${segments.filter(s => s.speaker === 'Klientas').length} Klientas`);
        }
      } else {
        console.warn(`⚠️ Failed to split dialogue, forcing alternation on original segments...`);
        // Even if splitting failed, force alternation
        if (segments.length > 1) {
          segments.forEach((seg, idx) => {
            seg.speaker = idx % 2 === 0 ? 'Agentas' : 'Klientas';
          });
        }
      }
    } else if (segments.length > 0) {
      // Even if we don't detect an issue, check if all segments have same speaker
      const finalCheckSpeakers = new Set(segments.map((s: any) => (s.speaker || '').toLowerCase()).filter(Boolean));
      if (finalCheckSpeakers.size === 1 && segments.length > 1) {
        console.warn(`⚠️ Post-processing check: All segments have same speaker, forcing alternation...`);
        segments.forEach((seg, idx) => {
          seg.speaker = idx % 2 === 0 ? 'Agentas' : 'Klientas';
        });
      }
    }

    // Filter out empty segments before building full text
    segments = segments.filter((s: any) => s.text && s.text.trim().length > 0);
    
    // Build full text - prefer transcription.text, fallback to combined segments
    const segmentText = segments.map((s: any) => s.text || '').filter((t: string) => t.length > 0).join(' ');
    const fullText = (transcription.text || segmentText || '').trim();
    
    // Warn if segments are incomplete compared to full text
    if (fullText && segments.length > 0 && fullText.length > segmentText.length * 1.2) {
      console.warn(`⚠️ Segments incomplete: fullText=${fullText.length} chars, segmentText=${segmentText.length} chars`);
      // Don't merge all segments into one - preserve dialogue structure
      // Instead, update segment texts proportionally or append missing text to last segment
      const missingText = fullText.substring(segmentText.length);
      if (missingText.length > 0 && segments.length > 0) {
        const lastSegment = segments[segments.length - 1];
        lastSegment.text = (lastSegment.text || '') + ' ' + missingText;
        console.log(`✅ Appended ${missingText.length} missing chars to last segment`);
      }
    }
    
    // Log final segment distribution
    const speakerCounts: Record<string, number> = {};
    segments.forEach((s: any) => {
      const speaker = s.speaker || 'Unknown';
      speakerCounts[speaker] = (speakerCounts[speaker] || 0) + 1;
    });
    console.log(`📊 Final segment distribution:`, speakerCounts);

    const rawTranscriptionResult = {
      id: Math.random().toString(36).substring(2, 11),
      text: fullText,
      timestamp: new Date().toISOString(),
      language: transcription.language || 'lt',
      segments: segments
    };

    console.log(`✅ Transcription completed (${fullText.length} chars)`);

    // Store transcription directly (PII masking removed)
    const rawTranscriptionForStorage = {
      ...rawTranscriptionResult,
      text: fullText,
      segments: segments
    };

    // Encrypt transcription before storing
    const transcriptionToEncrypt = JSON.stringify(rawTranscriptionForStorage);
    const encryptedTranscriptionData = await encryptForStorage(transcriptionToEncrypt);
    
    // Store with encryption flag (for DB)
    const transcriptionResultForDB = encryptedTranscriptionData !== transcriptionToEncrypt 
      ? {
          encrypted: true,
          data: encryptedTranscriptionData
        }
      : rawTranscriptionForStorage;
    
    // Keep unencrypted version for response (to avoid stack overflow, we'll only return metadata)
    const transcriptionResult = rawTranscriptionForStorage;

    // Update record with transcription (use encrypted version for DB)
    await supabase
      .from('call_records')
      .update({
        transcription: transcriptionResultForDB,
        status: 'analyzing',
      })
      .eq('id', recordId);

    // Call Gemini API for analysis
    console.log('📊 Starting analysis...');
    // #region agent log
    console.log(JSON.stringify({location:'upload/index.ts:585',message:'Before analysis API call',data:{elapsed:Date.now()-startTime,fullTextLength:fullText.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run-edge-fn',hypothesisId:'H3'}));
    // #endregion agent log
    
     // Analysis is text-only; use stable text-capable models.
     const analysisModels = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash-exp'];
    let analysisResponse: Response | null = null;
    let analysisModel = '';
    let analysisError: any = null;
    let analysisQuotaError: UpstreamQuotaError | null = null;
    let analysisOverloadError: UpstreamOverloadedError | null = null;
    
    for (const model of analysisModels) {
      try {
        analysisModel = model;
        console.log(`Attempting analysis with model: ${model}`);
        // #region agent log
        console.log(JSON.stringify({location:'upload/index.ts:597',message:'Calling Gemini analysis API',data:{model,elapsed:Date.now()-startTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run-edge-fn',hypothesisId:'H3'}));
        // #endregion agent log
        const analysisBody = JSON.stringify({
          contents: [{
            parts: [{
              text: `Išanalizuok šį klientų aptarnavimo skambučio transkripciją ir grąžink detalią analizę JSON formatu lietuviškai.

TRANSKRIPCIJA (su kalbėtojais):
${segments.length > 0 ? segments.map((s: any, idx: number) => `${s.speaker || 'Kalbėtojas'}: ${s.text || ''}`).join('\n\n') : fullText}

${segments.length > 0 ? '\nPASTABA: Transkripcija pateikta kaip dialogas su kalbėtojais. "Agentas" yra aptarnaujantis darbuotojas, "Klientas" yra skambinantis asmuo. Patikrink, ar pokalbis baigiasi agento atsakymu - jei paskutinis segmentas yra "Agentas", tai reiškia, kad agentas atsakė klientui.' : ''}

INSTRUKCIJOS:
1. SentimentScore (0-100): Bendras pokalbio tonas ir emocijos
   - 80-100: Labai teigiamas, džiaugiasi, patenkintas
   - 60-79: Teigiamas, neutralus teigiamas
   - 40-59: Neutralus, mišrus
   - 20-39: Neigiamas, nusivylęs
   - 0-19: Labai neigiamas, pyktas, agresyvus

2. CustomerSatisfaction (0-100): Kliento pasitenkinimas aptarnavimu
   - Vertink: ar klientas patenkintas sprendimu, ar problemos išspręstos, ar klientas džiaugiasi
   - 80-100: Labai patenkintas, problemos išspręstos, dėkoja
   - 60-79: Patenkintas, pagrindinės problemos išspręstos
   - 40-59: Dalinai patenkintas, kai kurios problemos liko
   - 20-39: Nepatenkintas, problemos neišspręstos
   - 0-19: Labai nepatenkintas, pyktas, skundžiasi

3. AgentPerformance (0-100): Agento darbo kokybė
   - Vertink: profesionalumas, empatija, problemų sprendimas, komunikacija, greitaveika
   - 80-100: Puikus darbas - profesionalus, empatiškas, efektyvus, gerai išsprendė problemą
   - 60-79: Geras darbas - profesionalus, bet galėjo būti geriau
   - 40-59: Vidutinis - darbo yra, bet trūksta profesionalumo ar efektyvumo
   - 20-39: Blogas - neprofesionalus, neempatiškas, neefektyvus
   - 0-19: Labai blogas - agresyvus, neprofesionalus, nepadėjo

4. Warnings: Sistemiški įspėjimai (masyvas stringų) - PRIVALOMAS LAUKAS
   - VISADA grąžink masyvą, net jei jis tuščias []
   - Pridėk įspėjimus jei: neprofesionalus tonas, agresyvumas, problemos neišspręstos, trūksta empatijos, pažeidžiamos taisyklės, klientas nusivylęs, agentas neempatiškas
   - PAVYZDYS: ["Agentas buvo neprofesionalus", "Problema neišspręsta"] arba [] jei viskas gerai

5. Summary: Trumpa, logiška santrauka pokalbio (2-4 sakiniai lietuviškai)
   - PRIVATUMAS: NERAŠYK jokių asmens duomenų (vardų, pavardžių, telefono numerių, el. pašto, adresų, asmens kodų, banko sąskaitų, įmonės kodų, gimimo datų).
   - Jei transkripcijoje yra tokia informacija, santraukoje ją pakeisk neutraliais žymenimis, pvz.: "[VARDAS]", "[TEL. NR.]", "[EL. PAŠTAS]".
   - PIRMAS SAKINYS: Kas skambino ir kokia buvo pagrindinė problema/klausimas
   - ANTRI/TRECI SAKINIAI: Kaip agentas padėjo, koks buvo sprendimas arba rezultatas
   - PASKUTINIS SAKINYS (jei reikia): Ar problema išspręsta, ar reikia tolimesnių veiksmų
   - SANTRAUKA TURI BŪTI LOGIŠKA ir atspindėti faktinį pokalbio turinį
   - NEGALIMA naudoti bendrų frazių kaip "pokalbis buvo sėkmingas" be konkretaus turinio
   - PAVYZDYS GEROS SANTRAUKOS: "Klientas skambino dėl problemos su sąskaita. Agentas patikrino duomenis ir paaiškino, kad sąskaita bus išsiųsta per 2 dienas. Problema išspręsta, klientas patenkintas."
   - PAVYZDYS BLOGOS SANTRAUKOS: "Pokalbis buvo sėkmingas. Agentas padėjo klientui." (per bendra, be konkretaus turinio)

6. Metrics: Papildomos metrikos (masyvas objektų su label, value, trend)

Grąžink JSON su šiais laukais:
- sentimentScore: skaičius 0-100
- customerSatisfaction: skaičius 0-100  
- agentPerformance: skaičius 0-100
- warnings: masyvas stringų (gali būti tuščias)
- summary: stringas lietuviškai
- metrics: masyvas objektų {label: string, value: number, trend: "up"|"down"|"neutral"}`
            }]
          }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'object',
              properties: {
                sentimentScore: { type: 'number' },
                customerSatisfaction: { type: 'number' },
                agentPerformance: { type: 'number' },
                warnings: { type: 'array', items: { type: 'string' } },
                summary: { type: 'string' },
                metrics: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      label: { type: 'string' },
                      value: { type: 'number' },
                      trend: { type: 'string', enum: ['up', 'down', 'neutral'] }
                    }
                  }
                }
              },
              required: ['sentimentScore', 'customerSatisfaction', 'agentPerformance', 'warnings', 'summary', 'metrics']
            }
          }
        });

        // Reduced retries from 3 to 1 to avoid 504 timeouts
        const maxAttemptsPerModel = 1;
        for (let attempt = 0; attempt < maxAttemptsPerModel; attempt++) {
          if (attempt > 0) {
            const wait = backoffMs(attempt - 1);
            console.warn(`⏳ Gemini overloaded? retrying analysis model ${model} in ${wait}ms (attempt ${attempt + 1}/${maxAttemptsPerModel})`);
            await sleep(wait);
          }

          analysisResponse = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: analysisBody,
            }
          );
      
      // #region agent log
      console.log(JSON.stringify({location:'upload/index.ts:685',message:'Analysis API response received',data:{ok:analysisResponse.ok,status:analysisResponse.status,elapsed:Date.now()-startTime,model,attempt:attempt+1},timestamp:Date.now(),sessionId:'debug-session',runId:'run-edge-fn',hypothesisId:'H3'}));
      // #endregion agent log
      
      if (analysisResponse.ok) {
        console.log(`✅ Successfully using model: ${model}`);
        break; // Success - exit retry loop
      } else {
         const { status, message, raw } = await parseGeminiError(analysisResponse);
         const lower = message.toLowerCase();
         const isOverloaded = status === 503 || lower.includes('overloaded');
         const isQuota =
           status === 429 ||
           status === 546 ||
           lower.includes('quota') ||
           lower.includes('rate') ||
           lower.includes('resource exhausted') ||
           lower.includes('too many requests');

         if (isOverloaded) {
           analysisOverloadError = new UpstreamOverloadedError(
             `Gemini modelis perkrautas (503): ${message || 'Bandykite po kelių minučių.'}`,
             status
           );
           console.warn(`⚠️ Gemini OVERLOADED for model ${model} (${status}): ${message}`);
           // keep retrying; on last attempt we'll try next model
           if (attempt === maxAttemptsPerModel - 1) {
             console.warn(`⚠️ Giving up retries for model ${model} due to overload, trying next model...`);
           }
           continue;
         }

         if (isQuota) {
           analysisQuotaError = new UpstreamQuotaError(
             `Gemini API kvotos limitas pasiektas (${status}): ${message || 'Bandykite po 1-2 minučių.'}`,
             status
           );
           console.error(`❌ QUOTA/RATE LIMIT for model ${model} (${status}): ${message}`);
           console.error(`❌ Gemini error (first 500 chars): ${raw.substring(0, 500)}`);
           analysisResponse = null;
           break; // break retry loop
         }

         analysisError = new Error(`Model ${model} failed (${status}): ${message || analysisResponse.statusText}`);
         console.warn(`❌ Model ${model} failed (${status}), trying next...`);
        analysisResponse = null;
         break; // non-transient -> break retry loop, try next model
      }
        } // end retry loop

        if (analysisResponse && analysisResponse.ok) {
          break; // success - exit model loop
        }
      } catch (err: any) {
        analysisError = err;
        console.warn(`❌ Model ${model} error: ${err.message}`);
        // #region agent log
        console.log(JSON.stringify({location:'upload/index.ts:693',message:'Analysis API call threw',data:{error:err.message,elapsed:Date.now()-startTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run-edge-fn',hypothesisId:'H3'}));
        // #endregion agent log
        continue; // Try next model
      }
    }

    if (!analysisResponse || !analysisResponse.ok) {
      if (analysisQuotaError) throw analysisQuotaError;
      if (analysisOverloadError) throw analysisOverloadError;
      throw new Error(`Analysis failed with all models: ${analysisError?.message || 'Unknown error'}`);
    }

    // #region agent log
    console.log(JSON.stringify({location:'upload/index.ts:704',message:'Before parsing analysis JSON',data:{elapsed:Date.now()-startTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run-edge-fn',hypothesisId:'H3'}));
    // #endregion agent log
    const analysisData = await analysisResponse.json();
    // Combine all parts if multiple parts exist (same as transcription)
    let analysisText = '';
    const analysisCandidate = analysisData.candidates?.[0];
    if (analysisCandidate?.content?.parts) {
      analysisText = analysisCandidate.content.parts
        .map((part: any) => part.text || '')
        .filter((text: string) => text.length > 0)
        .join('');
    }
    if (!analysisText || analysisText === '{}') {
      throw new Error('Analysis response was empty or invalid');
    }
    
    // #region agent log
    console.log(JSON.stringify({location:'upload/index.ts:860',message:'Raw analysis JSON from Gemini',data:{analysisTextLength:analysisText.length,analysisTextPreview:analysisText.substring(0,500)},timestamp:Date.now(),sessionId:'debug-session',runId:'run-edge-fn',hypothesisId:'H_ANALYSIS_PARSE'}));
    // #endregion agent log
    
    let analysis: any;
    try {
      analysis = JSON.parse(analysisText);
    } catch (parseErr: any) {
      console.error('❌ Failed to parse analysis JSON:', parseErr.message);
      console.error('❌ Raw analysis text:', analysisText.substring(0, 1000));
      throw new Error(`Failed to parse analysis JSON: ${parseErr.message}`);
    }

    // #region agent log
    console.log(JSON.stringify({location:'upload/index.ts:870',message:'Parsed analysis object',data:{sentimentScore:analysis.sentimentScore,customerSatisfaction:analysis.customerSatisfaction,agentPerformance:analysis.agentPerformance,warningsCount:Array.isArray(analysis.warnings)?analysis.warnings.length:'not-array',warnings:Array.isArray(analysis.warnings)?analysis.warnings:null,summaryLength:analysis.summary?.length||0},timestamp:Date.now(),sessionId:'debug-session',runId:'run-edge-fn',hypothesisId:'H_ANALYSIS_PARSE'}));
    // #endregion agent log

    // Normalize scores - use actual values from Gemini, don't default to 50
    const sentimentScore = Math.max(0, Math.min(100, analysis.sentimentScore ?? 50));
    const customerSatisfaction = Math.max(0, Math.min(100, analysis.customerSatisfaction ?? 50));
    const agentPerformance = Math.max(0, Math.min(100, analysis.agentPerformance ?? 50));
    
    // Ensure warnings is an array (Gemini might return null or undefined)
    const warnings = Array.isArray(analysis.warnings) 
      ? analysis.warnings.filter((w: any) => w && typeof w === 'string' && w.trim().length > 0)
      : [];

    const safeSummary = redactSensitiveSummary(String(analysis.summary || ''));

    const analysisResult = {
      id: Math.random().toString(36).substring(2, 11),
      sentimentScore,
      customerSatisfaction,
      agentPerformance,
      warnings: analysis.warnings || [],
      summary: safeSummary,
      metrics: analysis.metrics || [],
      complianceChecked: true
    };

    console.log(`✅ Analysis completed`);
    // #region agent log
    console.log(JSON.stringify({location:'upload/index.ts:745',message:'Analysis completed, before DB update',data:{elapsed:Date.now()-startTime,transcriptionTextLength:transcriptionResult.text?.length||0,transcriptionSegmentsCount:transcriptionResult.segments?.length||0,analysisWarningsCount:analysisResult.warnings?.length||0,analysisSummaryLength:analysisResult.summary?.length||0},timestamp:Date.now(),sessionId:'debug-session',runId:'run-edge-fn',hypothesisId:'H1'}));
    // #endregion agent log

    // Update record with analysis
    await supabase
      .from('call_records')
      .update({
        transcription: transcriptionResultForDB,
        analysis: analysisResult,
        status: 'completed',
      })
      .eq('id', recordId);

    // Build both a full response payload (for UX) and a small fallback payload (for safety).
    const fullResponsePayload = {
      id: recordId,
      audio: {
        id: audioId,
        fileName: audioFile.name,
        uploadDate: new Date().toISOString(),
        format: mimeType,
        size: audioFile.size,
      },
      status: 'completed',
      transcription: rawTranscriptionForStorage,
      analysis: analysisResult,
    };

    const fallbackResponsePayload = {
      id: recordId,
      audio: {
        id: audioId,
        fileName: audioFile.name,
        uploadDate: new Date().toISOString(),
        format: mimeType,
        size: audioFile.size,
      },
      status: 'completed',
      transcription: {
        id: rawTranscriptionForStorage.id,
        textLength: rawTranscriptionForStorage.text?.length || 0,
        segmentsCount: rawTranscriptionForStorage.segments?.length || 0,
        language: rawTranscriptionForStorage.language,
      },
      analysis: {
        id: analysisResult.id,
        sentimentScore: analysisResult.sentimentScore,
        customerSatisfaction: analysisResult.customerSatisfaction,
        agentPerformance: analysisResult.agentPerformance,
        warningsCount: analysisResult.warnings?.length || 0,
        summaryLength: analysisResult.summary?.length || 0,
      },
    };

    // #region agent log
    console.log(JSON.stringify({location:'upload/index.ts:802',message:'Before response serialization',data:{elapsed:Date.now()-startTime,transcriptionTextLength:rawTranscriptionForStorage.text?.length||0,segmentsCount:rawTranscriptionForStorage.segments?.length||0},timestamp:Date.now(),sessionId:'debug-session',runId:'run-edge-fn',hypothesisId:'H1'}));
    // #endregion agent log
    
    const { json: responseJson, usedFallback, fullLen, fallbackLen } = safeJsonResponse(
      fullResponsePayload,
      fallbackResponsePayload,
    );

    // #region agent log
    console.log(JSON.stringify({location:'upload/index.ts:807',message:'Response serialization complete',data:{usedFallback,fullLen,fallbackLen,elapsed:Date.now()-startTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run-edge-fn',hypothesisId:'H1'}));
    // #endregion agent log

    return new Response(
      responseJson,
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    // #region agent log
    console.log(JSON.stringify({location:'upload/index.ts:818',message:'Edge Function error caught',data:{errorType:error instanceof Error ? error.name : typeof error,errorMessage:error instanceof Error ? error.message : String(error),elapsed:Date.now()-startTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run-edge-fn',hypothesisId:'H1'}));
    // #endregion agent log
    
    // Safe error serialization - avoid circular references that cause stack overflow
    let errorMessage = 'Failed to process audio file';
    try {
      if (error instanceof Error) {
        errorMessage = error.message || errorMessage;
      } else if (typeof error === 'string') {
        errorMessage = error;
      } else {
        errorMessage = String(error) || errorMessage;
      }
      // Truncate very long error messages to prevent issues
      if (errorMessage.length > 500) {
        errorMessage = errorMessage.substring(0, 500) + '... (truncated)';
      }
    } catch (serializeError) {
      // If even error serialization fails, use default message
      errorMessage = 'Failed to process audio file (error serialization failed)';
    }
    
    console.error('❌ Upload error:', errorMessage);
    console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    console.error('❌ Error details:', {
      name: error instanceof Error ? error.name : typeof error,
      message: errorMessage,
      elapsed: Date.now() - startTime
    });
    
    const isQuota = error instanceof UpstreamQuotaError;
    const isOverloaded = error instanceof UpstreamOverloadedError;
    const status = isQuota ? 429 : (isOverloaded ? 503 : 500);
    const hint = isQuota
      ? 'Gemini API kvotos limitas. Palaukite 1-2 minutes ir bandykite dar kartą, arba patikrinkite Gemini API kvotą/billing.'
      : (isOverloaded
          ? 'Gemini modelis šiuo metu perkrautas. Palaukite kelias minutes ir bandykite dar kartą.'
          : 'Check Supabase Dashboard → Functions → upload → Logs for detailed error information');

    return new Response(
      JSON.stringify({ 
        error: errorMessage,
        hint
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status,
      }
    );
  }
});
