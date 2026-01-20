// Supabase Edge Function: Delete a call record and associated audio files
// POST /functions/v1/delete-record  body: { id: string }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Get CORS headers based on request origin
 * Allows specific origins in production, wildcard in development
 */
function getCorsHeaders(req: Request): Record<string, string> {
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS")?.split(",") || [];
  const origin = req.headers.get("Origin");
  
  // Always allow localhost for local development
  const isLocalhost = origin && (
    origin.startsWith("http://localhost:") ||
    origin.startsWith("http://127.0.0.1:") ||
    origin.startsWith("http://0.0.0.0:")
  );
  
  // If no allowed origins configured, allow all (development mode)
  if (allowedOrigins.length === 0) {
    return {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    };
  }
  
  // Allow localhost even when ALLOWED_ORIGINS is set (for local development)
  if (isLocalhost) {
    return {
      "Access-Control-Allow-Origin": origin || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Credentials": "true",
    };
  }
  
  // Production mode: check if origin is allowed
  if (origin && allowedOrigins.includes(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Credentials": "true",
    };
  }
  
  // Origin not allowed - return minimal CORS (will block request)
  return {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    const corsHeaders = getCorsHeaders(req);
    return new Response(null, { headers: corsHeaders, status: 204 });
  }
  
  const corsHeaders = getCorsHeaders(req);

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    console.log('Delete request received:', { 
      hasAuthHeader: !!authHeader, 
      authHeaderPrefix: authHeader?.substring(0, 20) || 'none' 
    });
    
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Authorization header required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    
    if (!supabaseUrl || !anonKey) {
      throw new Error("Server misconfigured (missing SUPABASE_URL or SUPABASE_ANON_KEY)");
    }
    
    if (!serviceRoleKey) {
      console.warn("⚠️ SUPABASE_SERVICE_ROLE_KEY not set - Storage deletion will be skipped");
      // Continue without service role key - we'll only delete DB row, not storage
    }

    // Client bound to the caller session (for auth.getUser)
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    console.log('Calling auth.getUser()...');
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    
    if (authError) {
      console.error('Auth error details:', { 
        message: authError.message, 
        status: authError.status,
        name: authError.name 
      });
    }
    
    if (authError || !user) {
      console.error('Auth check failed:', { 
        authError: authError?.message, 
        authErrorStatus: authError?.status,
        hasUser: !!user 
      });
      return new Response(JSON.stringify({ error: `Unauthorized. Please log in. ${authError?.message || ''}` }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    console.log(`✅ Authenticated user: ${user.id} (${user.email || 'no email'})`);

    const { id } = await req.json().catch(() => ({ id: "" }));
    if (!id || typeof id !== "string") {
      return new Response(JSON.stringify({ error: "Record id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Admin client to bypass RLS for storage + record lookup (only if service role key is set)
    const admin = serviceRoleKey 
      ? createClient(supabaseUrl, serviceRoleKey)
      : createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });

    // Fetch record
    const { data: record, error: recErr } = await admin
      .from("call_records")
      .select("id,user_id,audio_id")
      .eq("id", id)
      .single();

    if (recErr || !record) {
      return new Response(JSON.stringify({ error: "Record not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Authorization: owner or admin
    let isAdmin = false;
    try {
      const { data: profile } = await admin
        .from("user_profiles")
        .select("role")
        .eq("id", user.id)
        .single();
      isAdmin = profile?.role === "admin";
    } catch {
      isAdmin = false;
    }

    if (record.user_id !== user.id && !isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Delete associated audio files from Storage bucket (only if service role key is available)
    // Upload function stores objects under `audio-files/<audioId>-<timestamp>.<ext>`.
    if (serviceRoleKey) {
      const audioId = record.audio_id as string;
      if (audioId) {
        try {
          const { data: files, error: listErr } = await admin.storage
            .from("audio-files")
            .list("audio-files", { limit: 100, search: `${audioId}-` });

          if (!listErr && files && files.length > 0) {
            const paths = files.map((f) => `audio-files/${f.name}`);
            const { error: removeErr } = await admin.storage.from("audio-files").remove(paths);
            if (removeErr) {
              console.warn("Storage remove failed:", removeErr.message);
            } else {
              console.log(`✅ Deleted ${files.length} storage file(s)`);
            }
          }
        } catch (storageErr: any) {
          console.warn("Storage deletion error (continuing with DB delete):", storageErr.message);
        }
      }
    } else {
      console.warn("⚠️ Skipping storage deletion - SUPABASE_SERVICE_ROLE_KEY not set");
    }

    // Delete DB row (use admin client if available, otherwise user client with RLS)
    const deleteClient = serviceRoleKey ? admin : userClient;
    
    console.log(`🗑️ Attempting to delete record ${id}...`);
    const { error: delErr, data: delData } = await deleteClient.from("call_records").delete().eq("id", id).select();
    
    if (delErr) {
      console.error('❌ Delete error:', delErr);
      throw new Error(`Failed to delete record: ${delErr.message}`);
    }
    
    if (!delData || delData.length === 0) {
      console.warn(`⚠️ No rows deleted - record may not exist or RLS blocked deletion`);
      // Check if record still exists
      const { data: checkRecord } = await admin.from("call_records").select("id").eq("id", id).single();
      if (checkRecord) {
        throw new Error(`Record exists but deletion was blocked. Check RLS policies.`);
      }
      // Record doesn't exist, consider it deleted
      console.log(`✅ Record ${id} does not exist (may have been already deleted)`);
    } else {
      console.log(`✅ Deleted DB record: ${id} (${delData.length} row(s))`);
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    const msg = e?.message ? String(e.message).slice(0, 500) : "Failed to delete";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

