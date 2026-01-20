import React, { useState, useEffect } from 'react';
import { ShieldCheck, AlertTriangle, CheckCircle, Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '../services/authService';

interface AuditResult {
  check: string;
  status: 'passed' | 'failed' | 'warning';
  message: string;
  details?: string[];
}

interface AuditResponse {
  timestamp: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    warnings: number;
  };
  results: AuditResult[];
  overall: 'passed' | 'failed' | 'warning';
}

export const SecurityAudit: React.FC = () => {
  const [auditData, setAuditData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runAudit = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Ensure we have a valid session before calling the Edge Function
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session) {
        // Try refreshing the session
        const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError || !refreshData?.session) {
          setError('Not authenticated - please log in again');
          setLoading(false);
          return;
        }
      }

      // Get the current session (use refreshed session if we just refreshed)
      const currentSession = session || (await supabase.auth.getSession()).data.session;
      if (!currentSession) {
        setError('Not authenticated - please log in again');
        setLoading(false);
        return;
      }

      console.log('🔍 Calling security-audit Edge Function...', {
        hasSession: !!currentSession,
        sessionExpiry: currentSession.expires_at
      });
      
      // Use direct fetch with explicit headers (more reliable than functions.invoke)
      const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL || '';
      const supabaseAnonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';
      
      const response = await fetch(`${supabaseUrl}/functions/v1/security-audit`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${currentSession.access_token}`,
          'apikey': supabaseAnonKey,
          'Content-Type': 'application/json'
        }
      });
      
      console.log('🔍 Edge Function response status:', response.status);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('❌ Edge Function error:', errorData);
        throw new Error(errorData.error || errorData.details || `HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('🔍 Edge Function response data:', data);

      if (!data) {
        throw new Error('No data returned from security audit');
      }

      const auditData: AuditResponse = data as AuditResponse;
      setAuditData(auditData);
    } catch (err: any) {
      console.error('Security audit error:', err);
      setError(err.message || 'Failed to run security audit');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runAudit();
  }, []);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'passed':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'failed':
        return <AlertTriangle className="w-5 h-5 text-red-500" />;
      case 'warning':
        return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
      default:
        return null;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'passed':
        return 'text-green-600 bg-green-50 border-green-200';
      case 'failed':
        return 'text-red-600 bg-red-50 border-red-200';
      case 'warning':
        return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      default:
        return '';
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-8 h-8 text-blue-600" />
          <h2 className="text-2xl font-bold text-gray-900">Saugumo auditas</h2>
        </div>
        <button
          onClick={runAudit}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          Atnaujinti
        </button>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {auditData && (
        <>
          {/* Summary */}
          <div className="mb-6 p-4 bg-gray-50 rounded-lg border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-600">Bendras rezultatas</span>
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                auditData.overall === 'passed' ? 'bg-green-100 text-green-800' :
                auditData.overall === 'failed' ? 'bg-red-100 text-red-800' :
                'bg-yellow-100 text-yellow-800'
              }`}>
                {auditData.overall === 'passed' ? 'Pavyko' :
                 auditData.overall === 'failed' ? 'Nepavyko' : 'Įspėjimai'}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-4 mt-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-900">{auditData.summary.total}</div>
                <div className="text-sm text-gray-600">Iš viso</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{auditData.summary.passed}</div>
                <div className="text-sm text-gray-600">Pavyko</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-600">{auditData.summary.failed}</div>
                <div className="text-sm text-gray-600">Nepavyko</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-yellow-600">{auditData.summary.warnings}</div>
                <div className="text-sm text-gray-600">Įspėjimai</div>
              </div>
            </div>
            <div className="mt-4 text-xs text-gray-500">
              Paskutinis patikrinimas: {new Date(auditData.timestamp).toLocaleString('lt-LT')}
            </div>
          </div>

          {/* Results */}
          <div className="space-y-3">
            {auditData.results.map((result, index) => (
              <div
                key={index}
                className={`p-4 rounded-lg border ${getStatusColor(result.status)}`}
              >
                <div className="flex items-start gap-3">
                  {getStatusIcon(result.status)}
                  <div className="flex-1">
                    <h3 className="font-semibold mb-1">{result.check}</h3>
                    <p className="text-sm">{result.message}</p>
                    {result.details && result.details.length > 0 && (
                      <ul className="mt-2 ml-4 list-disc text-sm">
                        {result.details.map((detail, i) => (
                          <li key={i}>{detail}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {loading && !auditData && (
        <div className="text-center py-12">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-blue-600 mb-4" />
          <p className="text-gray-600">Vykdomas saugumo auditas...</p>
        </div>
      )}
    </div>
  );
};
