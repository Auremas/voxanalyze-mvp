// Supabase Edge Function: Get analysis by record ID
// GET /api/analysis/:id

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

    if (!data.analysis) {
      return new Response(
        JSON.stringify({ error: 'Analysis not available for this record' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Return analysis
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
  } catch (error) {
    console.error('Get analysis error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to retrieve analysis' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
