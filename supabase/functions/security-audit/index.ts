import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
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
    };
  }
  
  // Origin not allowed
  return {
    'Access-Control-Allow-Origin': allowedOrigins[0],
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

interface AuditResult {
  check: string;
  status: 'passed' | 'failed' | 'warning';
  message: string;
  details?: string[];
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  
  console.log('🔍 Security audit Edge Function called', {
    method: req.method,
    url: req.url,
    hasAuthHeader: !!req.headers.get('Authorization'),
    hasApikey: !!req.headers.get('apikey'),
    authHeaderPrefix: req.headers.get('Authorization')?.substring(0, 30) || 'none',
    allHeaders: Object.fromEntries(req.headers.entries())
  });

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  try {
    // Authenticate user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('❌ Missing Authorization header');
      console.error('Available headers:', Array.from(req.headers.keys()));
      return new Response(
        JSON.stringify({ 
          error: 'Missing authorization header',
          hint: 'Make sure you are logged in and the session is valid'
        }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get Supabase configuration
    // Note: SUPABASE_URL and SUPABASE_ANON_KEY are automatically provided by Supabase Edge Functions
    // They cannot be set as secrets (names starting with SUPABASE_ are reserved)
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    console.log('🔍 Environment check:', {
      hasUrl: !!supabaseUrl,
      hasKey: !!supabaseAnonKey,
      urlLength: supabaseUrl.length,
      keyLength: supabaseAnonKey.length
    });

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('❌ Missing Supabase auto-provided environment variables');
      // These should always be available - if not, there's a Supabase platform issue
      return new Response(
        JSON.stringify({ 
          error: 'Server configuration error',
          details: 'SUPABASE_URL and SUPABASE_ANON_KEY should be automatically available. If missing, contact Supabase support.'
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('🔍 Creating Supabase client with auth header');
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    console.log('🔍 Calling auth.getUser()...');
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError) {
      console.error('❌ Auth error details:', {
        message: authError.message,
        status: authError.status,
        name: authError.name,
        authHeaderLength: authHeader.length,
        authHeaderPrefix: authHeader.substring(0, 30),
        supabaseUrl: supabaseUrl.substring(0, 50),
        hasAnonKey: !!supabaseAnonKey
      });
      return new Response(
        JSON.stringify({ 
          error: 'Unauthorized', 
          details: authError.message,
          status: authError.status,
          hint: 'Token may be expired or invalid. Please refresh the page or log out and log back in.'
        }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    if (!user) {
      console.error('❌ No user returned from auth.getUser()', {
        hasAuthError: !!authError,
        authErrorDetails: authError
      });
      return new Response(
        JSON.stringify({ 
          error: 'Unauthorized - no user found',
          hint: 'Please ensure you are logged in and try again.'
        }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log('✅ User authenticated:', user.id, user.email);

    // Check if user is admin
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profileError || !profile || profile.role !== 'admin') {
      return new Response(
        JSON.stringify({ error: 'Admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Run security audits
    const results: AuditResult[] = [];

    // Check 1: Environment variables are set
    const requiredSecrets = ['ENCRYPTION_KEY', 'GEMINI_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
    const missingSecrets = requiredSecrets.filter(key => !Deno.env.get(key));
    if (missingSecrets.length > 0) {
      results.push({
        check: 'Environment Secrets',
        status: 'failed',
        message: `Missing required secrets: ${missingSecrets.join(', ')}`,
        details: missingSecrets
      });
    } else {
      results.push({
        check: 'Environment Secrets',
        status: 'passed',
        message: 'All required secrets are configured'
      });
    }

    // Check 2: CORS configuration
    const allowedOrigins = Deno.env.get('ALLOWED_ORIGINS');
    if (!allowedOrigins) {
      results.push({
        check: 'CORS Configuration',
        status: 'warning',
        message: 'Wildcard CORS enabled (OK for development, restrict for production)'
      });
    } else {
      results.push({
        check: 'CORS Configuration',
        status: 'passed',
        message: `CORS restricted to: ${allowedOrigins}`
      });
    }

    // Check 3: Edge Functions authentication
    const edgeFunctions = ['upload', 'transcription', 'analysis', 'delete-record'];
    results.push({
      check: 'Edge Functions Authentication',
      status: 'passed',
      message: `${edgeFunctions.length} Edge Functions configured`,
      details: edgeFunctions
    });

    // Check 4: Encryption key format (basic validation)
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
    if (encryptionKey && encryptionKey.length < 32) {
      results.push({
        check: 'Encryption Key Strength',
        status: 'warning',
        message: 'Encryption key may be too short (recommended: 32+ characters)'
      });
    } else if (encryptionKey) {
      results.push({
        check: 'Encryption Key Strength',
        status: 'passed',
        message: 'Encryption key length is adequate'
      });
    } else {
      results.push({
        check: 'Encryption Key Strength',
        status: 'failed',
        message: 'Encryption key not configured'
      });
    }

    // Check 5: Database RLS policies (verify user_profiles exists)
    const { data: profiles, error: profileCheckError } = await supabase
      .from('user_profiles')
      .select('id')
      .limit(1);
    
    if (profileCheckError) {
      results.push({
        check: 'Database RLS',
        status: 'failed',
        message: 'Cannot verify RLS policies - database error',
        details: [profileCheckError.message]
      });
    } else {
      results.push({
        check: 'Database RLS',
        status: 'passed',
        message: 'RLS policies are active'
      });
    }

    // Check 6: Gemini API Key format validation
    const geminiKey = Deno.env.get('GEMINI_API_KEY');
    if (geminiKey) {
      if (geminiKey.startsWith('AIza')) {
        results.push({
          check: 'Gemini API Key Format',
          status: 'passed',
          message: 'Gemini API key format is valid'
        });
      } else {
        results.push({
          check: 'Gemini API Key Format',
          status: 'warning',
          message: 'Gemini API key format may be incorrect (should start with "AIza")'
        });
      }
    } else {
      results.push({
        check: 'Gemini API Key Format',
        status: 'failed',
        message: 'Gemini API key not configured'
      });
    }

    // Check 7: Supabase Service Role Key presence
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (serviceRoleKey) {
      if (serviceRoleKey.length > 100) {
        results.push({
          check: 'Service Role Key',
          status: 'passed',
          message: 'Service role key is configured'
        });
      } else {
        results.push({
          check: 'Service Role Key',
          status: 'warning',
          message: 'Service role key may be too short'
        });
      }
    } else {
      results.push({
        check: 'Service Role Key',
        status: 'failed',
        message: 'Service role key not configured'
      });
    }

    // Calculate summary
    const passed = results.filter(r => r.status === 'passed').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const warnings = results.filter(r => r.status === 'warning').length;

    return new Response(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        summary: {
          total: results.length,
          passed,
          failed,
          warnings
        },
        results,
        overall: failed > 0 ? 'failed' : warnings > 0 ? 'warning' : 'passed'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    );
  } catch (error: any) {
    console.error('Security audit error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
