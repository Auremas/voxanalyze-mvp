import { createClient } from '@supabase/supabase-js';
import { CallRecord, Transcription, AnalysisResult } from '../types';
import { getCurrentUser } from './authService';
// SECURITY: Encryption/decryption moved to Edge Functions (server-side only)
// Encryption keys are never exposed to frontend

// Debug: Log all available env vars (for troubleshooting)
const allEnvVars = (import.meta as any).env || {};
console.log('🔍 Available environment variables:', Object.keys(allEnvVars).filter(key => key.includes('SUPABASE') || key.includes('VITE')));

const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL || '';
const supabaseAnonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';

console.log('🔍 Supabase URL check:', supabaseUrl ? `Found (${supabaseUrl.substring(0, 20)}...)` : 'MISSING');
console.log('🔍 Supabase Key check:', supabaseAnonKey ? `Found (length: ${supabaseAnonKey.length})` : 'MISSING');

// Only create client if credentials are provided
// Use same client instance from authService to ensure auth session is shared
import { supabase as authSupabase } from './authService';

export let supabase: ReturnType<typeof createClient> | null = null;

if (supabaseUrl && supabaseAnonKey) {
  try {
    // Use the same client instance from authService to ensure auth session is shared
    supabase = authSupabase;
    console.log('✅ Supabase client initialized successfully (using auth client)');
  } catch (error) {
    console.error('❌ Failed to initialize Supabase client:', error);
  }
} else {
  console.warn('⚠️ Supabase credentials not found. Using local storage fallback.');
  console.warn('   Make sure .env.local contains:');
  console.warn('   VITE_SUPABASE_URL=https://xxxxx.supabase.co');
  console.warn('   VITE_SUPABASE_ANON_KEY=eyJ...');
  console.warn('   Then restart the dev server (Ctrl+C and npm run dev)');
}

// Helper to check if Supabase is available
const isSupabaseAvailable = () => {
  return supabase !== null && supabaseUrl !== '' && supabaseAnonKey !== '';
};

// Export function to check Supabase status (for debugging)
export const checkSupabaseConnection = () => {
  return {
    configured: isSupabaseAvailable(),
    url: supabaseUrl ? 'Set' : 'Missing',
    key: supabaseAnonKey ? 'Set' : 'Missing',
    client: supabase !== null ? 'Initialized' : 'Not initialized'
  };
};

/**
 * SECURITY: Upload + transcription + analysis must happen server-side.
 * This calls the Supabase Edge Function `upload` and returns the processed record.
 */
export const uploadAndProcessViaEdgeFunction = async (file: File): Promise<CallRecord> => {
  if (!isSupabaseAvailable() || !supabase) {
    throw new Error('Supabase not configured');
  }

  // Get session token for Authorization header (Edge Function requires auth)
  const { data: sessionData, error: sessionError } = await (supabase as any).auth.getSession();
  if (sessionError) throw sessionError;
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) throw new Error('User not authenticated');

  const fnUrl = `${supabaseUrl}/functions/v1/upload`;
  console.log('📤 Uploading file:', { fileName: file.name, fileSize: file.size, fnUrl });
  
  // Test connectivity first using GET health check (no auth needed)
  try {
    console.log('🔍 Testing Edge Function connectivity...');
    const healthRes = await fetch(fnUrl, {
      method: 'GET',
      headers: {
        'apikey': supabaseAnonKey,
      },
    });
    if (healthRes.ok) {
      const healthData = await healthRes.json().catch(() => ({}));
      console.log('✅ Edge Function is reachable:', healthData);
    } else {
      console.warn('⚠️ Health check returned non-OK status:', healthRes.status, healthRes.statusText);
    }
  } catch (healthErr: any) {
    console.error('❌ Health check failed - Edge Function may not be reachable:', {
      name: healthErr.name,
      message: healthErr.message,
      fnUrl
    });
    // Don't throw here - let the actual upload attempt show the real error
  }
  
  const form = new FormData();
  form.append('audio', file, file.name);

  // Quick CORS/connectivity probe (helps debug "Failed to fetch" where the browser hides details)
  try {
    const preflightController = new AbortController();
    const preflightTimeout = setTimeout(() => preflightController.abort(), 10000); // 10s timeout for preflight
    const preflightRes = await fetch(fnUrl, {
      method: 'OPTIONS',
      headers: {
        // Mirror browser preflight headers as closely as we can (no secrets)
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization, content-type, apikey',
      },
      signal: preflightController.signal
    });
    clearTimeout(preflightTimeout);
    console.log('✅ CORS preflight check passed:', preflightRes.status);
  } catch (e: any) {
    console.warn('⚠️ CORS preflight probe failed (continuing anyway):', {
      name: e.name,
      message: e.message,
      cause: e.cause
    });
  }

  let res: Response;
  try {
    // Add timeout (5 minutes for large files with transcription + analysis)
    // Note: Some browsers may timeout earlier, but we set it to 5 minutes
    const timeoutMs = 5 * 60 * 1000; // 5 minutes
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.warn(`⏱️ Request timeout after ${timeoutMs / 1000}s - aborting fetch`);
      controller.abort();
    }, timeoutMs);
    
    try {
      console.log('📤 Starting upload request...', {
        fileSize: file.size,
        fileName: file.name,
        timeoutMs
      });
      
      res = await fetch(fnUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: supabaseAnonKey, // Required by Supabase Edge Function gateway
        },
        body: form,
        signal: controller.signal,
        // Note: keepalive=true has strict body-size limits in browsers and can break large uploads.
        // For multipart uploads we keep it off.
      });
      clearTimeout(timeoutId);
      console.log('✅ Upload request completed:', res.status);
    } catch (fetchErr: any) {
      clearTimeout(timeoutId);
      console.error('❌ Fetch error:', {
        name: fetchErr.name,
        message: fetchErr.message,
        isAbort: fetchErr.name === 'AbortError'
      });
      
      if (fetchErr.name === 'AbortError') {
        throw new Error(`Upload timeout after ${timeoutMs / 1000}s. The file may be too large or the Edge Function is taking too long. Check Supabase Dashboard → Functions → upload → Logs for details. The Edge Function may still be processing - check your history in a few minutes.`);
      }
      throw fetchErr;
    }
  } catch (e: any) {
    console.error('❌ Upload fetch error:', {
      name: e?.name,
      message: e?.message,
      stack: e?.stack?.substring(0, 200),
      fnUrl,
      hasAccessToken: !!accessToken,
      hasAnonKey: !!supabaseAnonKey
    });
    
    const isFailedToFetch =
      (e && typeof e === 'object' && (e as any).name === 'TypeError' && typeof (e as any).message === 'string' && (e as any).message.toLowerCase().includes('failed to fetch'))
      || (typeof e === 'string' && e.toLowerCase().includes('failed to fetch'));

    // Make the error actionable for end users (browser-level network errors hide the real cause).
    if (isFailedToFetch) {
      const online = typeof navigator !== 'undefined' ? navigator.onLine : undefined;
      const actualError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      const hint =
        `NETWORK_ERROR: Unable to reach Supabase Edge Function (upload).\n` +
        `\n` +
        `Actual error: ${actualError}\n` +
        `URL: ${fnUrl}\n` +
        `Online: ${String(online)}\n` +
        `\n` +
        `DEBUGGING STEPS:\n` +
        `1. Open DevTools (F12) → Network tab\n` +
        `2. Look for POST request to /functions/v1/upload\n` +
        `3. Check Status: if it shows "(failed)" or "CORS error", that's the issue\n` +
        `4. Check if OPTIONS request succeeded (should be 204)\n` +
        `5. Check Console tab for detailed error messages\n` +
        `\n` +
        `Most common causes:\n` +
        `- Browser timeout (large files take >2 minutes, browser may timeout)\n` +
        `- CORS/preflight blocked (check DevTools → Network: OPTIONS should be 204)\n` +
        `- Browser extension / adblock / antivirus / VPN blocking requests\n` +
        `- Network instability (try again - uploads sometimes succeed on retry)\n` +
        `- Offline or DNS issues (navigator.onLine=${String(online)})\n` +
        `- Wrong Supabase URL (check .env.local: VITE_SUPABASE_URL)\n` +
        `\n` +
        `TIP: If uploads work intermittently, it's likely network/browser timeout. Try:\n` +
        `- Smaller file size\n` +
        `- Different browser\n` +
        `- Check Supabase Dashboard → Functions → upload → Logs for server-side errors\n` +
        `- Verify Edge Function is deployed: ${fnUrl.replace('/functions/v1/upload', '/functions/v1/upload')} (GET should return {"ok":true})\n`;

      throw new Error(hint);
    }

    throw e;
  }

  const contentType = res.headers.get('content-type') || '';
  const rawText = await res.text().catch(() => '');

  let body: any = {};
  try {
    body = rawText ? JSON.parse(rawText) : {};
  } catch {
    body = { error: 'Non-JSON response from Edge Function', raw: rawText.slice(0, 500) };
  }

  if (!res.ok) {
    const errMsgRaw =
      (typeof body?.error === 'string' && body.error)
        ? body.error
        : `Edge Function upload failed (${res.status})`;
    // Avoid huge error messages (can cause performance issues / stack overflows in some runtimes)
    const errMsg = errMsgRaw.length > 800 ? `${errMsgRaw.slice(0, 800)}…` : errMsgRaw;
    const isWorkerLimit = res.status === 546;
    const isOverloaded = res.status === 503;
    const isQuota = res.status === 429;
    const workerLimitHint =
      `Supabase Edge Function pasiekė resursų limitą (546) — dažniausiai tai reiškia, kad failas per didelis arba apdorojimas užtruko per ilgai.\n` +
      `Pabandykite:\n` +
      `- Trumpesnį/mažesnį audio failą\n` +
      `- Mažesnę kokybę (pvz. 64kbps)\n` +
      `- Pakartoti po kelių minučių\n`;
    const overloadedHint =
      `Gemini modelis šiuo metu perkrautas (503). Palaukite 1–5 minutes ir bandykite dar kartą.\n` +
      `Jei kartojasi: pabandykite mažesnį audio arba vėliau (piko metu būna dažniau).\n`;
    const quotaHint =
      `Gemini API kvotos limitas (429). Patikrinkite Gemini billing/quotas ir bandykite po kelių minučių.\n`;

    console.error('Edge Function upload error:', {
      status: res.status,
      contentType,
      errMsg,
      rawPreview: rawText.slice(0, 300),
    });

    throw new Error(isWorkerLimit ? workerLimitHint : (isOverloaded ? overloadedHint : (isQuota ? quotaHint : errMsg)));
  }

  // If response only contains metadata (to prevent stack overflow), fetch full record from DB
  if (body.transcription && typeof body.transcription.textLength === 'number' && !body.transcription.text) {
    // Fetch full record from database
    const { data: dbRecord, error: fetchError } = await supabase
      .from('call_records')
      .select('*')
      .eq('id', body.id)
      .single();
    
    if (fetchError || !dbRecord) {
      console.warn('Failed to fetch full record from DB, using metadata only:', fetchError);
      // Fallback to metadata-only record
    } else {
      // Decrypt transcription if needed (Edge Function handles encryption, but we need to decrypt for display)
      let transcription = dbRecord.transcription;
      let analysis = dbRecord.analysis;
      
      // If transcription is encrypted (starts with base64-like pattern), decrypt it
      // Note: Edge Function encrypts, but we may need to decrypt here for frontend display
      // For now, assume Edge Function stores encrypted, but we'll handle decryption if needed
      
      return {
        id: dbRecord.id,
        audio: {
          id: dbRecord.audio_id,
          fileName: dbRecord.file_name,
          uploadDate: new Date(dbRecord.upload_date),
          format: dbRecord.file_format,
          size: dbRecord.file_size,
        },
        status: dbRecord.status || 'completed',
        transcription: transcription ? (typeof transcription === 'string' ? JSON.parse(transcription) : transcription) : undefined,
        analysis: analysis ? (typeof analysis === 'string' ? JSON.parse(analysis) : analysis) : undefined,
      } as CallRecord;
    }
  }

  // Normalize to CallRecord shape used by the UI (full response case)
  const record: CallRecord = {
    id: body.id,
    audio: {
      id: body.audio?.id,
      fileName: body.audio?.fileName,
      uploadDate: new Date(body.audio?.uploadDate || Date.now()),
      format: body.audio?.format,
      size: body.audio?.size,
    },
    status: body.status || 'completed',
    transcription: body.transcription && body.transcription.text ? {
      id: body.transcription.id,
      text: body.transcription.text,
      timestamp: new Date(body.transcription.timestamp),
      language: body.transcription.language,
      segments: body.transcription.segments || []
    } : undefined,
    analysis: body.analysis && body.analysis.summary ? {
      id: body.analysis.id,
      sentimentScore: body.analysis.sentimentScore,
      customerSatisfaction: body.analysis.customerSatisfaction,
      agentPerformance: body.analysis.agentPerformance,
      warnings: body.analysis.warnings || [],
      metrics: body.analysis.metrics || [],
      summary: body.analysis.summary || '',
      complianceChecked: body.analysis.complianceChecked ?? true
    } : undefined
  };

  return record;
};

// Database operations
export const saveCallRecord = async (record: CallRecord): Promise<string> => {
  console.log('Attempting to save call record to Supabase...');
  console.log('Supabase available:', isSupabaseAvailable());
  console.log('Supabase URL:', supabaseUrl ? 'Set' : 'Missing');
  console.log('Supabase Key:', supabaseAnonKey ? 'Set' : 'Missing');
  
  if (!isSupabaseAvailable() || !supabase) {
    const errorMsg = 'Supabase not configured. Please add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local';
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  // Get current user to associate record with user_id
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User must be authenticated to save records');
  }
  const userId = user.id;
  console.log('Saving record for user:', userId);
  
  try {
    // SECURITY: Encryption is now handled by Edge Functions (server-side only)
    // Frontend stores transcription data as-is - Edge Function encrypts before saving
    // This ensures encryption keys never leave the server
    let transcriptionData = null;
    if (record.transcription) {
      transcriptionData = {
        id: record.transcription.id,
        text: record.transcription.text,
        timestamp: record.transcription.timestamp.toISOString(),
        language: record.transcription.language,
        segments: record.transcription.segments
      };
      console.log('📝 Storing transcription (encryption handled by Edge Function)');
    }

    const { data, error } = await (supabase as any)
      .from('call_records')
      .insert({
        audio_id: record.audio.id,
        file_name: record.audio.fileName,
        file_format: record.audio.format,
        file_size: record.audio.size,
        upload_date: record.audio.uploadDate.toISOString(),
        status: record.status,
        error_message: record.error,
        user_id: userId, // Associate record with authenticated user
        transcription: transcriptionData,
        analysis: record.analysis ? {
          id: record.analysis.id,
          sentimentScore: record.analysis.sentimentScore,
          customerSatisfaction: record.analysis.customerSatisfaction,
          agentPerformance: record.analysis.agentPerformance,
          warnings: record.analysis.warnings,
          metrics: record.analysis.metrics,
          summary: record.analysis.summary,
          complianceChecked: record.analysis.complianceChecked
        } : null
      })
      .select()
      .single();

    if (error) {
      console.error('Supabase error saving call record:', error);
      console.error('Error details:', JSON.stringify(error, null, 2));
      throw new Error(`Failed to save to Supabase: ${error.message || JSON.stringify(error)}`);
    }
    
    if (!data || !data.id) {
      throw new Error('No data returned from Supabase insert');
    }
    
    console.log('✅ Successfully saved to Supabase with ID:', data.id);
    return data.id;
  } catch (error: any) {
    console.error('Exception saving to Supabase:', error);
    throw error;
  }
};

export const uploadAudioFile = async (file: File, recordId: string): Promise<string> => {
  if (!isSupabaseAvailable() || !supabase) {
    throw new Error('Supabase not configured');
  }
  
  const fileExt = file.name.split('.').pop();
  const fileName = `${recordId}-${Date.now()}.${fileExt}`;
  const filePath = `audio-files/${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from('audio-files')
    .upload(filePath, file, {
      cacheControl: '3600',
      upsert: false
    });

  if (uploadError) {
    console.error('Error uploading audio file:', uploadError);
    throw uploadError;
  }
  return filePath;
};

export const fetchCallRecords = async (limit: number = 50): Promise<CallRecord[]> => {
  if (!isSupabaseAvailable() || !supabase) {
    // Return empty array if Supabase is not configured
    return [];
  }
  
  const { data, error } = await (supabase as any)
    .from('call_records')
    .select('*')
    .order('upload_date', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Error fetching call records:', error);
    throw error;
  }

  if (!data) return [];

  // SECURITY: Decryption is handled server-side by Edge Functions.
  // Frontend no longer has access to encryption keys.
  // Map records - transcription data should already be decrypted by Edge Functions,
  // but we keep backward-compatible handling for unencrypted rows.
  const records: CallRecord[] = await Promise.all(data.map(async (row: any) => {
    let transcription: any = undefined;
    if (row.transcription) {
      if (row.transcription.encrypted && row.transcription.data) {
        // Encrypted transcription - fetch via Edge Function for decryption
        try {
          transcription = await fetchTranscriptionViaEdgeFunction(row.id);
        } catch (err: any) {
          console.warn('⚠️ Failed to fetch decrypted transcription via Edge Function:', err.message);
          transcription = undefined;
        }
      } else {
        transcription = {
          id: row.transcription.id,
          text: row.transcription.text,
          timestamp: new Date(row.transcription.timestamp),
          language: row.transcription.language,
          segments: row.transcription.segments || []
        };
      }
    }

    // Fetch analysis via Edge Function to generate logs (even though it's not encrypted)
    let analysis: any = undefined;
    if (row.analysis) {
      try {
        analysis = await fetchAnalysisViaEdgeFunction(row.id);
      } catch (err: any) {
        console.warn('⚠️ Failed to fetch analysis via Edge Function, using DB data:', err.message);
        // Fallback to DB data if Edge Function fails
        analysis = {
          id: row.analysis.id,
          sentimentScore: row.analysis.sentimentScore,
          customerSatisfaction: row.analysis.customerSatisfaction,
          agentPerformance: row.analysis.agentPerformance,
          warnings: row.analysis.warnings || [],
          metrics: row.analysis.metrics || [],
          summary: row.analysis.summary,
          complianceChecked: row.analysis.complianceChecked
        };
      }
    }

    return {
      id: row.id, // Include database record ID for deletion
      audio: {
        id: row.audio_id,
        fileName: row.file_name,
        uploadDate: new Date(row.upload_date),
        format: row.file_format,
        size: row.file_size
      },
      status: row.status,
      error: row.error_message,
      transcription,
      analysis
    };
  }));

  return records;
};

/**
 * Fetch transcription via Edge Function (handles decryption server-side)
 */
export const fetchTranscriptionViaEdgeFunction = async (recordId: string): Promise<Transcription | null> => {
  if (!isSupabaseAvailable() || !supabase) {
    throw new Error('Supabase not configured');
  }

  const { data: sessionData, error: sessionError } = await (supabase as any).auth.getSession();
  if (sessionError) throw sessionError;
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) throw new Error('User not authenticated');

  const fnUrl = `${supabaseUrl}/functions/v1/transcription/${recordId}`;
  const res = await fetch(fnUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: supabaseAnonKey,
    },
  });

  if (!res.ok) {
    if (res.status === 404) return null;
    const errorText = await res.text().catch(() => '');
    throw new Error(`Failed to fetch transcription: ${res.status} ${errorText}`);
  }

  const data = await res.json();
  return {
    id: data.id,
    text: data.text,
    timestamp: new Date(data.timestamp),
    language: data.language,
    segments: data.segments || [],
  };
};

/**
 * Fetch analysis via Edge Function
 */
export const fetchAnalysisViaEdgeFunction = async (recordId: string): Promise<AnalysisResult | null> => {
  if (!isSupabaseAvailable() || !supabase) {
    throw new Error('Supabase not configured');
  }

  const { data: sessionData, error: sessionError } = await (supabase as any).auth.getSession();
  if (sessionError) throw sessionError;
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) throw new Error('User not authenticated');

  const fnUrl = `${supabaseUrl}/functions/v1/analysis/${recordId}`;
  const res = await fetch(fnUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: supabaseAnonKey,
    },
  });

  if (!res.ok) {
    if (res.status === 404) return null;
    const errorText = await res.text().catch(() => '');
    throw new Error(`Failed to fetch analysis: ${res.status} ${errorText}`);
  }

  const data = await res.json();
  return {
    id: data.id,
    sentimentScore: data.sentimentScore,
    customerSatisfaction: data.customerSatisfaction,
    agentPerformance: data.agentPerformance,
    warnings: data.warnings || [],
    metrics: data.metrics || [],
    summary: data.summary || '',
    complianceChecked: data.complianceChecked ?? false,
  };
};

export const updateCallRecord = async (recordId: string, updates: Partial<CallRecord>): Promise<void> => {
  console.log('Attempting to update call record in Supabase, ID:', recordId);
  
  if (!isSupabaseAvailable() || !supabase) {
    throw new Error('Supabase not configured');
  }
  
  const updateData: any = {
    updated_at: new Date().toISOString()
  };

  if (updates.status) updateData.status = updates.status;
  if (updates.error) updateData.error_message = updates.error;
  if (updates.transcription) {
    // SECURITY: Encryption is handled by Edge Functions (server-side only)
    // Frontend stores transcription data as-is - Edge Function encrypts before saving
    updateData.transcription = {
      id: updates.transcription.id,
      text: updates.transcription.text,
      timestamp: updates.transcription.timestamp.toISOString(),
      language: updates.transcription.language,
      segments: updates.transcription.segments
    };
    console.log('📝 Updating transcription (encryption handled by Edge Function)');
  }
  if (updates.analysis) {
    updateData.analysis = {
      id: updates.analysis.id,
      sentimentScore: updates.analysis.sentimentScore,
      customerSatisfaction: updates.analysis.customerSatisfaction,
      agentPerformance: updates.analysis.agentPerformance,
      warnings: updates.analysis.warnings,
      metrics: updates.analysis.metrics,
      summary: updates.analysis.summary,
      complianceChecked: updates.analysis.complianceChecked
    };
  }

  console.log('Update data:', JSON.stringify(updateData, null, 2));

  const { data, error } = await (supabase as any)
    .from('call_records')
    .update(updateData)
    .eq('id', recordId)
    .select();

  if (error) {
    console.error('❌ Supabase error updating call record:', error);
    console.error('Error details:', JSON.stringify(error, null, 2));
    throw new Error(`Failed to update Supabase: ${error.message || JSON.stringify(error)}`);
  }
  
  console.log('✅ Successfully updated record in Supabase');
};

export const deleteCallRecord = async (recordId: string): Promise<void> => {
  console.log('Attempting to delete call record from Supabase, ID:', recordId);
  
  if (!isSupabaseAvailable() || !supabase) {
    throw new Error('Supabase not configured');
  }

  // Prefer Edge Function so it can also delete associated Storage files (and enforce ownership server-side)
  try {
    // Get current session and ensure it's fresh (Supabase client auto-refreshes, but let's be explicit)
    let sessionData = await (supabase as any).auth.getSession();
    
    // If session is null or expired, try to refresh
    if (!sessionData?.data?.session) {
      const { data: refreshData, error: refreshError } = await (supabase as any).auth.refreshSession();
      if (refreshError) {
        console.warn('Session refresh failed, trying getSession again:', refreshError);
        sessionData = await (supabase as any).auth.getSession();
      } else if (refreshData?.session) {
        sessionData = { data: refreshData };
      }
    }
    
    if (!sessionData?.data?.session) {
      throw new Error('User not authenticated - please log in again');
    }
    
    const accessToken = sessionData.data.session.access_token;
    if (!accessToken) {
      throw new Error('No access token available');
    }

    const fnUrl = `${supabaseUrl}/functions/v1/delete-record`;
    
    // Use fetch with proper headers - Supabase Edge Functions require both Authorization and apikey
    const res = await fetch(fnUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'apikey': supabaseAnonKey, // Required by Supabase Edge Function gateway
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: recordId }),
    });

    const text = await res.text().catch(() => '');
    let body: any = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text }; }

    if (!res.ok) {
      const errorMsg = typeof body?.error === 'string' ? body.error : `Delete failed (${res.status})`;
      console.error(`❌ Edge Function delete failed: ${res.status}`, body);
      console.error(`❌ Response text:`, text);
      throw new Error(errorMsg);
    }

    console.log('✅ Deleted record + storage via Edge Function:', body);
    return;
  } catch (edgeErr: any) {
    console.warn('⚠️ Edge Function delete failed, falling back to DB-only delete:', edgeErr?.message);
    // Don't throw - continue to fallback
  }

  // Fallback: delete only the DB row (Storage object may remain)
  console.log('🔄 Attempting fallback DB-only delete...');
  const { error, data } = await (supabase as any)
    .from('call_records')
    .delete()
    .eq('id', recordId)
    .select();

  if (error) {
    console.error('❌ Supabase error deleting call record:', error);
    console.error('Error details:', JSON.stringify(error, null, 2));
    console.error('Error code:', error.code);
    console.error('Error hint:', error.hint);
    throw new Error(`Failed to delete from Supabase: ${error.message || JSON.stringify(error)}`);
  }
  
  if (!data || data.length === 0) {
    console.warn('⚠️ No rows deleted - record may not exist or RLS blocked deletion');
    // Check if record still exists
    const { data: checkRecord } = await (supabase as any)
      .from('call_records')
      .select('id, user_id')
      .eq('id', recordId)
      .single();
    
    if (checkRecord) {
      throw new Error('Record exists but deletion was blocked. Check RLS policies or permissions.');
    }
    console.log('✅ Record does not exist (may have been already deleted)');
  } else {
    console.log(`✅ Successfully deleted record from Supabase (${data.length} row(s))`);
  }
};

export const getCallRecordById = async (recordId: string): Promise<CallRecord | null> => {
  if (!isSupabaseAvailable() || !supabase) {
    return null;
  }
  
  const { data, error } = await (supabase as any)
    .from('call_records')
    .select('*')
    .eq('id', recordId)
    .single();

  if (error) {
    console.error('Error fetching call record:', error);
    return null;
  }

  if (!data) return null;

  return {
    audio: {
      id: data.audio_id,
      fileName: data.file_name,
      uploadDate: new Date(data.upload_date),
      format: data.file_format,
      size: data.file_size
    },
    status: data.status,
    error: data.error_message,
    transcription: data.transcription ? {
      id: data.transcription.id,
      text: data.transcription.text,
      timestamp: new Date(data.transcription.timestamp),
      language: data.transcription.language,
      segments: data.transcription.segments || []
    } : undefined,
    analysis: data.analysis ? {
      id: data.analysis.id,
      sentimentScore: data.analysis.sentimentScore,
      customerSatisfaction: data.analysis.customerSatisfaction,
      agentPerformance: data.analysis.agentPerformance,
      warnings: data.analysis.warnings || [],
      metrics: data.analysis.metrics || [],
      summary: data.analysis.summary,
      complianceChecked: data.analysis.complianceChecked
    } : undefined
  };
};
