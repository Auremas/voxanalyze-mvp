import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, 
  History as HistoryIcon, 
  Settings, 
  Headphones, 
  Shield, 
  ShieldCheck,
  ChevronRight,
  Zap,
  CheckCircle,
  AlertTriangle,
  FileText,
  Search,
  Filter,
  Check,
  LogOut,
  Trash2,
  Loader2
} from 'lucide-react';
import FileUpload from './components/FileUpload';
import Dashboard from './components/Dashboard';
import Login from './components/Login';
import { SecurityAudit } from './components/SecurityAudit';
import { CallRecord } from './types';
import { fetchCallRecords, deleteCallRecord, checkSupabaseConnection, uploadAndProcessViaEdgeFunction } from './services/supabaseService';
import { getCurrentUser, onAuthStateChange, signOut, User, getUserRole } from './services/authService';

function NavItem({ icon, label, active, onClick, disabled = false }: any) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl text-sm font-bold transition-all
        ${active ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-600/30 translate-x-1' : 'text-slate-400 hover:text-white hover:bg-slate-800/80'}
        ${disabled ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      {icon} {label}
    </button>
  );
}

function CheckItem({ title, desc, white }: any) {
  return (
    <div className="flex items-start gap-4">
      <div className={`mt-1 p-1 rounded-full ${white ? 'bg-indigo-500 text-white' : 'bg-emerald-500 text-white'}`}>
        <Check className="w-3 h-3" />
      </div>
      <div>
        <p className={`font-bold ${white ? 'text-white' : 'text-slate-900'}`}>{title}</p>
        <p className={`text-sm ${white ? 'text-indigo-200' : 'text-slate-500'}`}>{desc}</p>
      </div>
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'upload' | 'dashboard' | 'history' | 'security'>('upload');
  const [currentRecord, setCurrentRecord] = useState<CallRecord | null>(null);
  const [history, setHistory] = useState<CallRecord[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<'admin' | 'user' | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [deletingRecordId, setDeletingRecordId] = useState<string | null>(null);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ total: 0, completed: 0, failed: 0 });

  // Auth effect
  useEffect(() => {
    // Check initial auth state
    getCurrentUser().then(setUser).finally(() => setLoadingAuth(false));

    // Listen for auth changes
    const { data: { subscription } } = onAuthStateChange(setUser);

    return () => subscription.unsubscribe();
  }, []);

  // Load history from Supabase on mount and when user changes
  useEffect(() => {
    const loadHistory = async () => {
      try {
        setIsLoadingHistory(true);
        
        // Check Supabase connection status
        const connectionStatus = checkSupabaseConnection();
        console.log('Supabase connection status:', connectionStatus);
        
        if (!connectionStatus.configured) {
          console.warn('⚠️ Supabase not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local');
          setIsLoadingHistory(false);
          return;
        }

        // Only load history if user is authenticated
        if (!user) {
          setHistory([]);
          setIsLoadingHistory(false);
          return;
        }
        
        const records = await fetchCallRecords(50);
        console.log(`✅ Loaded ${records.length} records from Supabase`);
        setHistory(records);
      } catch (error: any) {
        console.error('❌ Failed to load history from Supabase:', error);
        console.error('Error details:', error?.message || error);
        // Continue with empty history if Supabase is not configured
      } finally {
        setIsLoadingHistory(false);
      }
    };
    
    if (user) {
      loadHistory();
      // Fetch user role
      getUserRole(user.id).then(setUserRole).catch(() => setUserRole(null));
    } else {
      setHistory([]);
      setIsLoadingHistory(false);
      setUserRole(null);
    }
  }, [user]);

  const handleUpload = async (file: File, base64: string, skipUIUpdate: boolean = false) => {
    // In dev, React.StrictMode can double-invoke some flows. Also, the user can trigger
    // multiple events quickly (drop + click). Guard by a simple in-memory lock.
    // Key is based on file name + size + lastModified so re-selecting the same file later still works.
    const uploadKey = `${file.name}:${file.size}:${(file as any).lastModified || ''}`;
    (handleUpload as any)._inFlight = (handleUpload as any)._inFlight || new Set<string>();
    const inFlight: Set<string> = (handleUpload as any)._inFlight;
    if (inFlight.has(uploadKey)) {
      console.warn('⚠️ Duplicate upload prevented (in-flight):', uploadKey);
      return;
    }
    inFlight.add(uploadKey);

    const newRecord: CallRecord = {
      audio: {
        id: `SKAMB-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
        fileName: file.name,
        uploadDate: new Date(),
        format: file.type,
        size: file.size
      },
      status: 'transcribing',
      progress: 0,
      stage: 'uploading'
    };

    // Only update UI state if this is a single file upload
    // For multiple uploads, skip UI updates to avoid race conditions
    if (!skipUIUpdate) {
      setCurrentRecord(newRecord);
      setActiveTab('dashboard');
    }

    // Progress simulation - update progress over time
    // Match the actual timeout: 5 minutes (300 seconds)
    const startTime = Date.now();
    const estimatedDuration = 5 * 60 * 1000; // 5 minutes to match timeout
    let progressInterval: NodeJS.Timeout | null = null;
    
    const updateProgress = () => {
      if (skipUIUpdate) return;
      
      const elapsed = Date.now() - startTime;
      let progress = 0;
      let stage = 'uploading';
      
      // Simulate progress stages - slower and more realistic
      if (elapsed < 10000) {
        // Uploading: 0-5% (first 10 seconds)
        progress = Math.min(5, (elapsed / 10000) * 5);
        stage = 'uploading';
      } else if (elapsed < estimatedDuration * 0.65) {
        // Transcribing: 5-60% (most of the time)
        const transcribeElapsed = elapsed - 10000;
        const transcribeDuration = estimatedDuration * 0.65 - 10000;
        progress = 5 + Math.min(55, (transcribeElapsed / transcribeDuration) * 55);
        stage = 'transcribing';
      } else if (elapsed < estimatedDuration * 0.95) {
        // Analyzing: 60-95%
        const analyzeElapsed = elapsed - estimatedDuration * 0.65;
        const analyzeDuration = estimatedDuration * 0.3;
        progress = 60 + Math.min(35, (analyzeElapsed / analyzeDuration) * 35);
        stage = 'analyzing';
      } else {
        // Almost complete: 95-98% (don't go to 99% until actually done)
        const finalElapsed = elapsed - estimatedDuration * 0.95;
        const finalDuration = estimatedDuration * 0.05;
        progress = Math.min(98, 95 + (finalElapsed / finalDuration) * 3);
        stage = 'analyzing';
      }
      
      setCurrentRecord(prev => prev ? { ...prev, progress, stage } : null);
    };
    
    // Update progress every 500ms
    progressInterval = setInterval(updateProgress, 500);

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c367620c-4d11-4919-8fb3-80711e3854de',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.tsx:145',message:'handleUpload started',data:{fileName:file.name,fileSize:file.size,skipUIUpdate},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion

    let recordId: string | null = null;

    try {
      // SECURITY: Do ALL Gemini work server-side via Supabase Edge Function `upload`
      const completedRecord = await uploadAndProcessViaEdgeFunction(file);
      recordId = completedRecord.id || null;
      
      // Clear progress interval
      if (progressInterval) {
        clearInterval(progressInterval);
      }
      
      // NOTE: Storage upload happens inside the Edge Function `upload` already.
      // Doing it here would upload the same file twice.

      // Save in UI history (Edge Function already saved the DB record)
      if (!skipUIUpdate) {
        // Set to 100% complete
        setCurrentRecord({ ...completedRecord, progress: 100, stage: 'complete' });
        // After a brief moment, remove progress indicators
        setTimeout(() => {
          setCurrentRecord(completedRecord);
          // Prevent duplicates by checking if record with same ID already exists
          setHistory(prev => {
            const existingIds = new Set(prev.map(r => r.id).filter(Boolean));
            // Only add if it doesn't already exist
            if (completedRecord.id && existingIds.has(completedRecord.id)) {
              // Update existing record instead of adding duplicate
              return prev.map(r => r.id === completedRecord.id ? completedRecord : r);
            }
            return [completedRecord, ...prev.filter(r => r.id !== completedRecord.id)].slice(0, 50);
          });
        }, 1000);
      }
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c367620c-4d11-4919-8fb3-80711e3854de',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.tsx:237',message:'handleUpload completed',data:{fileName:file.name,recordId,skipUIUpdate},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      
      return completedRecord;
    } catch (err: any) {
      console.error(err);
      
      // Clear progress interval on error
      if (progressInterval) {
        clearInterval(progressInterval);
      }
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c367620c-4d11-4919-8fb3-80711e3854de',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.tsx:240',message:'handleUpload error',data:{fileName:file.name,errorMessage:err?.message,errorType:err?.constructor?.name,skipUIUpdate},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      
      const errorRecord = { ...newRecord, status: 'error' as const, error: err.message };
      
      // Only update UI if not skipping (single file upload)
      if (!skipUIUpdate) {
        setCurrentRecord(errorRecord);
      }
      
      // DB record + error handling is handled inside Edge Function `upload`.
      // If it fails, we keep UI-only error state here.
      
      throw err; // Re-throw so handleMultipleUpload can handle it
    } finally {
      // Release in-flight lock
      try { inFlight.delete(uploadKey); } catch {}
    }
  };

  const handleMultipleUpload = async (files: File[]) => {
    console.log(`📤 Processing ${files.length} file(s) in parallel...`);
    
    // Show batch processing UI immediately
    setIsBatchProcessing(true);
    setBatchProgress({ total: files.length, completed: 0, failed: 0 });
    setActiveTab('history'); // Switch to history to show progress
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c367620c-4d11-4919-8fb3-80711e3854de',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.tsx:251',message:'handleMultipleUpload started',data:{fileCount:files.length,fileNames:files.map(f=>f.name)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
    // #endregion
    
    // Process all files in parallel, but skip UI updates to avoid race conditions
    const uploadPromises = files.map(async (file, index) => {
      try {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/c367620c-4d11-4919-8fb3-80711e3854de',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.tsx:257',message:'Processing file in batch',data:{fileName:file.name,fileIndex:index,fileSize:file.size},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
        // #endregion
        
        // Convert to base64
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const base64String = (reader.result as string).split(',')[1];
            resolve(base64String);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        
        // Process each file using existing handleUpload, but skip UI updates
        // This prevents race conditions where multiple files update the same state
        const result = await handleUpload(file, base64, true); // true = skipUIUpdate
        
        // Update batch progress
        setBatchProgress(prev => ({ ...prev, completed: prev.completed + 1 }));
        
        return { success: true, fileName: file.name, record: result };
      } catch (error: any) {
        console.error(`Failed to process ${file.name}:`, error);
        
        // Update batch progress (failed)
        setBatchProgress(prev => ({ ...prev, failed: prev.failed + 1 }));
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/c367620c-4d11-4919-8fb3-80711e3854de',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.tsx:277',message:'File processing failed in batch',data:{fileName:file.name,errorMessage:error?.message,errorType:error?.constructor?.name},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H'})}).catch(()=>{});
        // #endregion
        
        return { success: false, fileName: file.name, error: error.message };
      }
    });

    // Wait for all uploads to complete
    const results = await Promise.allSettled(uploadPromises);
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c367620c-4d11-4919-8fb3-80711e3854de',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.tsx:283',message:'All batch uploads completed',data:{totalFiles:files.length,resultsCount:results.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'I'})}).catch(()=>{});
    // #endregion
    
    const successCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const failCount = results.length - successCount;
    
    console.log(`✅ Completed: ${successCount} successful, ${failCount} failed`);
    
    // Reload history after all uploads complete (single state update)
    try {
      const updatedHistory = await fetchCallRecords(50);
      setHistory(updatedHistory);
      console.log(`✅ History reloaded with ${updatedHistory.length} records`);
    } catch (error: any) {
      console.error('Failed to reload history:', error);
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c367620c-4d11-4919-8fb3-80711e3854de',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.tsx:293',message:'History reload failed',data:{errorMessage:error?.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'J'})}).catch(()=>{});
      // #endregion
    }

    // Hide batch processing indicator
    setIsBatchProcessing(false);
    
    // Ensure we're on history tab to show results
    setActiveTab('history');
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c367620c-4d11-4919-8fb3-80711e3854de',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.tsx:299',message:'handleMultipleUpload finished',data:{successCount,failCount},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'K'})}).catch(()=>{});
    // #endregion
  };

  if (loadingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-slate-500">Kraunama autentifikacija...</div>
      </div>
    );
  }

  if (!user) {
    return <Login onAuthSuccess={() => getCurrentUser().then(setUser)} />;
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
      <aside className="w-72 bg-slate-900 text-slate-300 flex flex-col hidden lg:flex border-r border-slate-800">
        <div className="p-8 flex items-center gap-4">
          <div className="bg-indigo-600 p-2.5 rounded-2xl shadow-xl shadow-indigo-600/20">
            <Headphones className="text-white w-7 h-7" />
          </div>
          <span className="text-2xl font-black text-white tracking-tighter">VoxAnalyze</span>
        </div>

        <nav className="flex-1 px-6 py-8 space-y-2">
          <NavItem active={activeTab === 'upload'} onClick={() => setActiveTab('upload')} icon={<Zap className="w-5 h-5" />} label="Garso įkėlimas" />
          <NavItem active={activeTab === 'dashboard'} onClick={() => currentRecord && setActiveTab('dashboard')} icon={<LayoutDashboard className="w-5 h-5" />} label="Analizės skydelis" disabled={!currentRecord} />
          <NavItem active={activeTab === 'history'} onClick={() => setActiveTab('history')} icon={<HistoryIcon className="w-5 h-5" />} label="Istorija" />
          {userRole === 'admin' && (
            <NavItem active={activeTab === 'security'} onClick={() => setActiveTab('security')} icon={<ShieldCheck className="w-5 h-5" />} label="Saugumo auditas" />
          )}
          <button
            onClick={async () => {
              await signOut();
              setUser(null);
            }}
            className="w-full flex items-center gap-4 px-5 py-4 rounded-2xl text-sm font-bold text-slate-400 hover:text-white hover:bg-slate-800/80 transition-all"
          >
            <LogOut className="w-5 h-5" /> Atsijungti
          </button>
        </nav>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-10 z-20">
          <div className="flex items-center gap-3 text-sm text-slate-400 font-medium">
            <span className="capitalize">
              {activeTab === 'upload' ? 'Įkėlimas' : 
               activeTab === 'security' ? 'Saugumo auditas' :
               'Analizė'}
            </span>
            {activeTab !== 'security' && (
              <>
                <ChevronRight className="w-4 h-4" />
                <span className="text-slate-900 font-bold">{currentRecord ? currentRecord.audio.fileName : 'Nauja sesija'}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-4">
            {user && (
              <div className="flex items-center gap-3 px-4 py-2 bg-slate-50 rounded-xl border border-slate-200">
                <div className="flex flex-col items-end">
                  <span className="text-sm font-bold text-slate-900">{user.email || 'Vartotojas'}</span>
                  <span className="text-xs text-slate-500 uppercase tracking-wider">
                    {userRole === 'admin' ? 'Administratorius' : userRole === 'user' ? 'Vartotojas' : 'Kraunama...'}
                  </span>
                </div>
                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-white font-bold text-sm ${
                  userRole === 'admin' ? 'bg-indigo-600' : 'bg-slate-400'
                }`}>
                  {user.email?.charAt(0).toUpperCase() || 'U'}
                </div>
              </div>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-10 custom-scrollbar">
          <div className="max-w-6xl mx-auto pb-20">
            {activeTab === 'upload' && (
              <div className="space-y-12 animate-in fade-in slide-in-from-top-4 duration-700">
                <div className="max-w-2xl">
                  <h1 className="text-5xl font-black text-slate-900 tracking-tight mb-4">Balso Ingestija</h1>
                  <p className="text-xl text-slate-500 leading-relaxed font-medium">Įkelkite klientų aptarnavimo įrašus giliai DI analizei ir atitikties auditui.</p>
                </div>
                <FileUpload 
                  onUpload={handleUpload} 
                  onMultipleUpload={handleMultipleUpload}
                  isProcessing={currentRecord?.status === 'transcribing' || currentRecord?.status === 'analyzing'} 
                />
              </div>
            )}

            {activeTab === 'dashboard' && currentRecord && (
              <Dashboard record={currentRecord} />
            )}

            {activeTab === 'security' && userRole === 'admin' && (
              <SecurityAudit />
            )}

            {activeTab === 'history' && (
              <div className="space-y-8 animate-in fade-in duration-500">
                <h1 className="text-4xl font-black text-slate-900 tracking-tight">Istorija</h1>
                
                {/* Batch processing indicator */}
                {isBatchProcessing && (
                  <div className="bg-indigo-50 border-2 border-indigo-200 p-6 rounded-[40px] shadow-sm animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-center gap-4">
                      <Loader2 className="w-6 h-6 text-indigo-600 animate-spin flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-indigo-900 font-bold text-lg mb-1">
                          Apdorojami failai...
                        </p>
                        <p className="text-indigo-700 text-sm">
                          Apdorota: {batchProgress.completed} / {batchProgress.total}
                          {batchProgress.failed > 0 && ` • Klaidos: ${batchProgress.failed}`}
                        </p>
                        <div className="mt-2 w-full bg-indigo-100 rounded-full h-2 overflow-hidden">
                          <div 
                            className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${(batchProgress.completed / batchProgress.total) * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                
                {isLoadingHistory ? (
                  <div className="bg-white border border-slate-200 p-20 rounded-[40px] text-center shadow-sm">
                    <Loader2 className="w-8 h-8 text-slate-400 animate-spin mx-auto mb-4" />
                    <p className="text-slate-500 font-bold text-xl">Kraunama istorija...</p>
                  </div>
                ) : history.length === 0 ? (
                  <div className="bg-white border border-slate-200 p-20 rounded-[40px] text-center shadow-sm">
                    <HistoryIcon className="w-16 h-16 text-slate-200 mx-auto mb-6" />
                    <p className="text-slate-500 font-bold text-xl">Istorija tuščia.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {history.map((h, index) => {
                      const handleDelete = async (e: React.MouseEvent) => {
                        e.stopPropagation(); // Prevent opening the record
                        if (!h.id) {
                          console.error('Cannot delete: record ID missing');
                          return;
                        }
                        
                        if (!confirm('Ar tikrai norite pašalinti šį įrašą? Šis veiksmas negrįžtamas.')) {
                          return;
                        }
                        
                        try {
                          setDeletingRecordId(h.id);
                          await deleteCallRecord(h.id);
                          // Reload history after deletion
                          const updatedHistory = await fetchCallRecords(50);
                          setHistory(updatedHistory);
                          // Clear current record if it was deleted, but stay in history tab
                          if (currentRecord?.id === h.id) {
                            setCurrentRecord(null);
                            // Stay in history tab instead of switching to upload
                            setActiveTab('history');
                          }
                        } catch (error: any) {
                          console.error('Failed to delete record:', error);
                          alert(`Klaida trinant įrašą: ${error.message || 'Nežinoma klaida'}`);
                        } finally {
                          setDeletingRecordId(null);
                        }
                      };
                      
                      // Use database ID as key (guaranteed unique), fallback to audio.id or index
                      const uniqueKey = h.id || h.audio.id || `record-${index}`;
                      return (
                        <div key={uniqueKey} className="bg-white p-6 rounded-3xl border border-slate-200 flex items-center justify-between hover:border-indigo-500 transition-all group shadow-sm">
                          <div 
                            onClick={() => {setCurrentRecord(h); setActiveTab('dashboard');}} 
                            className="flex items-center gap-6 flex-1 cursor-pointer"
                          >
                            <div className="w-14 h-14 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600 font-bold"><FileText /></div>
                            <div>
                              <h4 className="font-bold text-slate-900 group-hover:text-indigo-600 transition-colors text-lg">{h.audio.fileName}</h4>
                              <p className="text-sm text-slate-500 font-medium">{new Date(h.audio.uploadDate).toLocaleString('lt-LT')}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-8">
                            <div className="text-right">
                              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Sentimentas</p>
                              <p className="font-black text-indigo-600 text-lg">{h.analysis?.sentimentScore}%</p>
                            </div>
                            {h.id && (
                              <button
                                onClick={handleDelete}
                                disabled={deletingRecordId === h.id}
                                className="p-2 rounded-xl text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Pašalinti įrašą"
                              >
                                {deletingRecordId === h.id ? (
                                  <Loader2 className="w-5 h-5 animate-spin" />
                                ) : (
                                  <Trash2 className="w-5 h-5" />
                                )}
                              </button>
                            )}
                            <ChevronRight 
                              onClick={() => {setCurrentRecord(h); setActiveTab('dashboard');}} 
                              className="w-6 h-6 text-slate-300 group-hover:text-indigo-500 group-hover:translate-x-1 transition-all cursor-pointer" 
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      </main>
    </div>
  );
}