// Supabase Edge Function: Get analysis by record ID
// GET /api/analysis/:id

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

async function decryptFromStorage(payload: any): Promise<any> {
  // Supports either raw object transcription, or { encrypted: true, data: "<base64>" }
  if (!payload) return null;
  if (!payload.encrypted || !payload.data || typeof payload.data !== 'string') return payload;

  const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
  if (!encryptionKey) {
    throw new Error('ENCRYPTION_KEY not set on server; cannot decrypt transcription.');
  }

  // hex -> bytes
  const keyBuffer = Uint8Array.from(
    encryptionKey.match(/.{1,2}/g)?.map((byte: string) => parseInt(byte, 16)) || [],
  );

  const key = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );

  // Avoid std base64 decode import issues in Edge runtime: use built-in atob.
  const b64 = String(payload.data || '');
  const bin = atob(b64);
  const combined = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) combined[i] = bin.charCodeAt(i);
  if (combined.length < 13) {
    throw new Error('Invalid encrypted payload.');
  }

  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext,
  );
  const decoder = new TextDecoder();
  const text = decoder.decode(decrypted);
  return JSON.parse(text);
}

function redactSensitiveSummary(text: string): string {
  if (!text) return text;
  let out = text;
  // Emails
  out = out.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EL. PAŠTAS]');
  // Phone numbers
  out = out.replace(/(\+?\d[\d\s().-]{6,}\d)/g, '[TEL. NR.]');
  // Personal codes (11 digits)
  out = out.replace(/\b\d{11}\b/g, '[ASMENS KODAS]');
  // IBAN
  out = out.replace(/\bLT\d{2}[A-Z0-9]{10,30}\b/gi, '[IBAN]');
  // Personal names (Name Surname pattern) - but NOT clinic/hospital names
  // Common clinic/hospital name patterns to preserve:
  // - Single capitalized words (Kardiolita, Santara)
  // - "X ligoninė", "X klinika", "X centras"
  // - "Vilniaus universitetinė ligoninė" style
  // We only redact if it looks like a personal name (two words, both capitalized, not followed by "ligoninė", "klinika", etc.)
  out = out.replace(/\b([A-ZĄČĘĖĮŠŲŪŽ][a-ząčęėįšųūž]+) ([A-ZĄČĘĖĮŠŲŪŽ][a-ząčęėįšųūž]+)(?!\s+(ligoninė|klinika|centras|įmonė|organizacija|bendrovė|fondas))\b/g, '[VARDAS PAVARDĖ]');
  out = out.replace(/\s{2,}/g, ' ').trim();
  return out;
}

serve(async (req) => {
  const startTime = Date.now();
  console.log(JSON.stringify({location:'analysis/index.ts:13',message:'Edge Function entry',data:{method:req.method,url:req.url,hasAuthHeader:!!req.headers.get('Authorization')},timestamp:Date.now(),sessionId:'debug-session',runId:'run-analysis',hypothesisId:'H1'}));
  
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

    if (!recordId || recordId === 'analysis') {
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
        JSON.stringify({ error: 'Analysis not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // GET: just return if present
    if (req.method === 'GET') {
      if (!data.analysis) {
        return new Response(
          JSON.stringify({ error: 'Analysis not available for this record' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          id: data.analysis.id,
          sentimentScore: data.analysis.sentimentScore,
          customerSatisfaction: data.analysis.customerSatisfaction,
          agentPerformance: data.analysis.agentPerformance,
          warnings: data.analysis.warnings || [],
          summary: data.analysis.summary || '',
          metrics: data.analysis.metrics || [],
          complianceChecked: data.analysis.complianceChecked || false,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

    // POST: generate analysis if missing (or return existing)
    if (data.analysis) {
      return new Response(
        JSON.stringify({
          id: data.analysis.id,
          sentimentScore: data.analysis.sentimentScore,
          customerSatisfaction: data.analysis.customerSatisfaction,
          agentPerformance: data.analysis.agentPerformance,
          warnings: data.analysis.warnings || [],
          summary: data.analysis.summary || '',
          metrics: data.analysis.metrics || [],
          complianceChecked: data.analysis.complianceChecked || false,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

    if (!data.transcription) {
      return new Response(
        JSON.stringify({ error: 'Transcription not available for this record' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Mark analyzing
    await supabase.from('call_records').update({ status: 'analyzing' }).eq('id', recordId);

    const transcription = await decryptFromStorage(data.transcription);
    const segments = Array.isArray(transcription?.segments) ? transcription.segments : [];
    const fullText = String(transcription?.text || '').trim();

    const geminiApiKey = Deno.env.get('GEMINI_API_KEY') ?? '';
    if (!geminiApiKey) {
      throw new Error('GEMINI_API_KEY not set');
    }

    const model = 'gemini-2.5-flash';
    const prompt = `Išanalizuok šį klientų aptarnavimo skambučio transkripciją ir grąžink analizę JSON formatu lietuviškai.

TRANSKRIPCIJA (su kalbėtojais):
${segments.length > 0 ? segments.map((s: any) => `${s.speaker || 'Kalbėtojas'}: ${s.text || ''}`).join('\n\n') : fullText}

SVARBU APIE ĮSPĖJIMUS (warnings):
- Transkripcija gali turėti klaidų (neteisingai išgirsti vardai, vietos, faktai).
- NEGENERUOK įspėjimų apie faktinę informaciją (pvz., "agentas sakė X, bet X yra neteisinga").
- GENERUOK įspėjimus TIK apie aiškius elgesio/profesionalumo klausimus:
  * Neprofesionalus tonas, agresyvumas, neempatiškumas
  * Problema neišspręsta, klientas nusivylęs
  * Pažeidžiamos komunikacijos taisyklės
- Jei neaišku, ar tai transkripcijos klaida ar tikras elgesio klausimas - NEGENERUOK įspėjimo.

INSTRUKCIJOS:
- PRIVATUMAS: nerašyk asmeninių duomenų (vardų, pavardžių, tel., el. pašto, adresų, asmens kodų, IBAN ir pan.). Naudok [VARDAS], [TEL. NR.], [EL. PAŠTAS].
- GALIMA rašyti: įmonių, klinikų, ligoninių, organizacijų pavadinimus (pvz., "Kardiolita", "Santara", "Vilniaus universitetinė ligoninė").
- Grąžink JSON su laukais: sentimentScore (0-100), customerSatisfaction (0-100), agentPerformance (0-100), warnings (string[]), summary (string), metrics (array), complianceChecked (boolean).
- warnings masyvas turi būti tuščias [] jei nėra aiškių elgesio problemų.
`;

    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' }
    });

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }
    );

    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      throw new Error(`Gemini analysis failed (${res.status}): ${raw.substring(0, 300)}`);
    }

    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || '';
    if (!text) throw new Error('Empty analysis from Gemini');

    let parsed: any;
    try { parsed = JSON.parse(text); } catch (e: any) { throw new Error(`Failed to parse analysis JSON: ${e.message}`); }

    // Filter warnings: remove fact-checking warnings that might be from transcription errors
    const filterBadWarnings = (warnings: string[]): string[] => {
      const factCheckPatterns = [
        /yra klaidinanti/i,
        /yra neteisinga/i,
        /yra klaidinga/i,
        /faktas.*neteisingas/i,
        /informacija.*klaidinga/i,
        /misleading/i,
        /incorrect.*information/i,
        /wrong.*information/i,
      ];
      return warnings.filter((w: string) => {
        const lower = w.toLowerCase();
        // Remove warnings that look like fact-checking (might be transcription errors)
        if (factCheckPatterns.some(p => p.test(lower))) {
          return false;
        }
        // Keep warnings about behavior/professionalism
        return true;
      });
    };

    const analysisResult = {
      id: Math.random().toString(36).substring(2, 11),
      sentimentScore: Math.max(0, Math.min(100, Number(parsed.sentimentScore ?? 50))),
      customerSatisfaction: Math.max(0, Math.min(100, Number(parsed.customerSatisfaction ?? 50))),
      agentPerformance: Math.max(0, Math.min(100, Number(parsed.agentPerformance ?? 50))),
      warnings: filterBadWarnings(Array.isArray(parsed.warnings) ? parsed.warnings.filter((w: any) => typeof w === 'string' && w.trim()) : []),
      summary: redactSensitiveSummary(String(parsed.summary || '')),
      metrics: Array.isArray(parsed.metrics) ? parsed.metrics : [],
      complianceChecked: true,
    };

    await supabase
      .from('call_records')
      .update({ analysis: analysisResult, status: 'completed' })
      .eq('id', recordId);

    return new Response(
      JSON.stringify({
        id: analysisResult.id,
        sentimentScore: analysisResult.sentimentScore,
        customerSatisfaction: analysisResult.customerSatisfaction,
        agentPerformance: analysisResult.agentPerformance,
        warnings: analysisResult.warnings || [],
        summary: analysisResult.summary || '',
        metrics: analysisResult.metrics || [],
        complianceChecked: analysisResult.complianceChecked || false,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Get analysis error:', error);
    // Best-effort: mark record error if we can extract ID
    try {
      const url = new URL(req.url);
      const parts = url.pathname.split('/');
      const recordId = parts[parts.length - 1];
      if (recordId && recordId !== 'analysis') {
        const authHeader = req.headers.get('Authorization');
        if (authHeader) {
          const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
          const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
          const supabase = createClient(supabaseUrl, supabaseKey, {
            global: { headers: { Authorization: authHeader } }
          });
          await supabase.from('call_records').update({ status: 'error', error_message: String(error?.message || error) }).eq('id', recordId);
        }
      }
    } catch {}
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to retrieve analysis' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
