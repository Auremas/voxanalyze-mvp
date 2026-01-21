
import React from 'react';
import { 
  AlertTriangle, 
  TrendingUp, 
  TrendingDown, 
  Smile, 
  Users, 
  FileText,
  Activity,
  CheckCircle,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';
import { CallRecord } from '../types';

interface DashboardProps {
  record: CallRecord;
  onGenerateAnalysis?: () => void;
  isGeneratingAnalysis?: boolean;
  onGenerateTranscription?: () => void;
  isGeneratingTranscription?: boolean;
}

const Dashboard: React.FC<DashboardProps> = ({ record, onGenerateAnalysis, isGeneratingAnalysis, onGenerateTranscription, isGeneratingTranscription }) => {
  const { analysis, transcription, status, error } = record;

  // Show loading state with progress bar
  if (status === 'transcribing' || status === 'analyzing') {
    const progress = record.progress || 0;
    const stage = record.stage || (status === 'transcribing' ? 'transcribing' : 'analyzing');
    
    const stageLabels: Record<string, { label: string; description: string }> = {
      uploading: { label: 'Įkeliamas failas', description: 'Garso failas įkeliamas į serverį...' },
      transcribing: { label: 'Transkribuojamas įrašas', description: 'Garso įrašas verčiamas į tekstą...' },
      analyzing: { label: 'Analizuojamas tekstas', description: 'Tekstas analizuojamas AI...' },
      complete: { label: 'Užbaigta', description: 'Analizė baigta!' }
    };
    
    const currentStage = stageLabels[stage] || stageLabels.transcribing;
    
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-8 p-8">
        <div className="w-full max-w-2xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-slate-800">{currentStage.label}</h3>
            <span className="text-sm font-semibold text-indigo-600">{Math.round(progress)}%</span>
          </div>
          
          {/* Progress bar */}
          <div className="w-full bg-slate-200 rounded-full h-3 mb-4 overflow-hidden">
            <div 
              className="bg-gradient-to-r from-indigo-500 to-indigo-600 h-3 rounded-full transition-all duration-500 ease-out relative"
              style={{ width: `${progress}%` }}
            >
              <div className="absolute inset-0 bg-white/30 animate-pulse"></div>
            </div>
          </div>
          
          <p className="text-slate-500 text-center">{currentStage.description}</p>
          
          {/* Stage indicators */}
          <div className="flex items-center justify-between mt-8">
            {['uploading', 'transcribing', 'analyzing', 'complete'].map((s, idx) => {
              const isActive = stage === s;
              const isCompleted = progress > (idx * 33.33);
              const stageInfo = stageLabels[s];
              
              return (
                <div key={s} className="flex flex-col items-center flex-1">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-2 transition-all ${
                    isCompleted 
                      ? 'bg-indigo-600 text-white' 
                      : isActive 
                        ? 'bg-indigo-100 text-indigo-600 border-2 border-indigo-600' 
                        : 'bg-slate-200 text-slate-400'
                  }`}>
                    {isCompleted ? (
                      <CheckCircle className="w-6 h-6" />
                    ) : (
                      <span className="text-sm font-bold">{idx + 1}</span>
                    )}
                  </div>
                  <span className={`text-xs font-medium text-center ${
                    isActive ? 'text-indigo-600' : isCompleted ? 'text-slate-600' : 'text-slate-400'
                  }`}>
                    {stageInfo.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // Show error state
  if (status === 'error' || error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-3xl p-8">
        <div className="flex items-start gap-4">
          <AlertCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-1" />
          <div>
            <h3 className="text-lg font-bold text-red-800 mb-2">Klaida</h3>
            <p className="text-red-700">{error || 'Įvyko nežinoma klaida'}</p>
            <p className="text-sm text-red-600 mt-4">Patikrinkite konsolę (F12) dėl daugiau informacijos.</p>
          </div>
        </div>
      </div>
    );
  }

  // If upload returned without transcription (upload-only mode), show a CTA.
  if (!transcription && !analysis) {
    return (
      <div className="space-y-8 animate-in fade-in duration-700">
        <div className="bg-slate-50 border border-slate-200 rounded-3xl p-6">
          <div className="flex items-start gap-4">
            <AlertCircle className="w-6 h-6 text-slate-600 flex-shrink-0 mt-1" />
            <div>
              <h3 className="text-lg font-black text-slate-900 mb-1">Failas įkeltas</h3>
              <p className="text-slate-600 text-sm font-medium">
                Toliau galite rankiniu būdu paleisti transkripciją, o po to – analizę (tai sumažina 546/504 klaidų tikimybę).
              </p>
              {onGenerateTranscription && (
                <button
                  onClick={onGenerateTranscription}
                  disabled={!!isGeneratingTranscription}
                  className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white font-bold text-sm hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isGeneratingTranscription ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Generuojama transkripcija...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4" />
                      Generuoti transkripciją
                    </>
                  )}
                </button>
              )}
              {onGenerateAnalysis && (
                <p className="text-xs text-slate-500 mt-3">
                  Analizė bus pasiekiama tik po transkripcijos.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // If transcription exists but analysis is missing, show transcription and a friendly message.
  if (transcription && !analysis) {
    return (
      <div className="space-y-8 animate-in fade-in duration-700">
        <div className="bg-amber-50 border border-amber-200 rounded-3xl p-6">
          <div className="flex items-start gap-4">
            <AlertTriangle className="w-6 h-6 text-amber-600 flex-shrink-0 mt-1" />
            <div>
              <h3 className="text-lg font-black text-amber-900 mb-1">Analizė dar negeneruota</h3>
              <p className="text-amber-800 text-sm font-medium">
                Kad sumažintume 546/504 klaidas, įkėlimo metu pirmiausia išsaugome transkripciją, o analizę galima generuoti atskirai.
              </p>
              {onGenerateAnalysis && (
                <button
                  onClick={onGenerateAnalysis}
                  disabled={!!isGeneratingAnalysis}
                  className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white font-bold text-sm hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isGeneratingAnalysis ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Generuojama analizė...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4" />
                      Generuoti analizę
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-8">
          <h3 className="text-xl font-bold text-slate-800 mb-6">Transkripcijos peržiūra</h3>
          {transcription.segments && transcription.segments.length > 0 ? (
            <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
              {transcription.segments
                .filter(seg => seg.text && seg.text.trim().length > 0)
                .map((seg, i) => (
                  <div key={i} className="p-4 rounded-2xl border bg-slate-50 border-slate-100">
                    <span className="text-[10px] font-black uppercase tracking-widest mb-2 block text-slate-500">
                      {seg.speaker || 'Kalbėtojas'}
                    </span>
                    <p className="text-sm text-slate-700 leading-relaxed font-medium whitespace-pre-wrap break-words">
                      {seg.text}
                    </p>
                  </div>
                ))}
            </div>
          ) : transcription.text ? (
            <div className="p-4 rounded-2xl border bg-slate-50 border-slate-100">
              <span className="text-[10px] font-black uppercase tracking-widest mb-2 block text-slate-500">
                Pilna transkripcija
              </span>
              <p className="text-sm text-slate-700 leading-relaxed font-medium whitespace-pre-wrap break-words">
                {transcription.text}
              </p>
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-slate-500 text-sm">Transkripcijos duomenų nėra</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Show message if no data yet
  if (!analysis || !transcription) {
    return (
      <div className="text-center py-12">
        <p className="text-slate-500">Duomenų nėra</p>
      </div>
    );
  }

  const scoreData = [
    { name: 'Sentimentas', value: analysis.sentimentScore },
    { name: 'Pasitenkinimas', value: analysis.customerSatisfaction },
    { name: 'Agento darbas', value: analysis.agentPerformance },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <MetricCard label="Klientų pasitenkinimas" value={`${analysis.customerSatisfaction}%`} icon={<Smile className="text-emerald-600" />} trend={analysis.customerSatisfaction > 70 ? 'up' : 'down'} />
        <MetricCard label="Agento vertinimas" value={`${analysis.agentPerformance}/100`} icon={<Users className="text-indigo-600" />} />
        <MetricCard label="Sentimento indeksas" value={`${analysis.sentimentScore}%`} icon={<Activity className="text-blue-600" />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-8">
            <h3 className="text-xl font-bold text-slate-800 mb-6 flex items-center">
              <FileText className="w-6 h-6 mr-3 text-indigo-500" />
              Skambučio santrauka
            </h3>
            <p className="text-slate-600 leading-relaxed text-lg italic">
              „{analysis.summary}“
            </p>
          </div>

          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-8">
            <h3 className="text-xl font-bold text-slate-800 mb-8">Veiklos metrikos</h3>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={scoreData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                  <YAxis axisLine={false} tickLine={false} domain={[0, 100]} tick={{fill: '#64748b', fontSize: 12}} />
                  <Tooltip cursor={{fill: '#f8fafc'}} contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                  <Bar dataKey="value" fill="#6366f1" radius={[8, 8, 0, 0]} barSize={50} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="space-y-8">
          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-8 overflow-hidden">
            <h3 className="text-xl font-bold text-slate-800 mb-6 flex items-center">
              <AlertTriangle className="w-6 h-6 mr-3 text-amber-500" />
              Sisteminiai įspėjimai
            </h3>
            <div className="space-y-4">
              {analysis.warnings.length > 0 ? (
                analysis.warnings.map((warning, i) => (
                  <div key={i} className="flex items-start gap-4 p-4 bg-amber-50 border border-amber-100 rounded-2xl text-amber-800 text-sm font-medium">
                    <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                    <span>{warning}</span>
                  </div>
                ))
              ) : (
                <p className="text-slate-500 text-sm italic">Kritinių įspėjimų nerasta.</p>
              )}
            </div>
          </div>

          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-8">
            <h3 className="text-xl font-bold text-slate-800 mb-6">Transkripcijos peržiūra</h3>
            {transcription.segments && transcription.segments.length > 0 ? (
            <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
              {transcription.segments
                .filter(seg => seg.text && seg.text.trim().length > 0) // Filter out empty segments
                .map((seg, i) => {
                // Determine speaker type for styling
                const speakerLower = seg.speaker?.toLowerCase() || '';
                const isAgent = speakerLower.includes('agent') || speakerLower.includes('operator') || speakerLower.includes('darbuotojas');
                const isClient = speakerLower.includes('klient') || speakerLower.includes('klientas');
                const isSpeaker1 = speakerLower.includes('kalbėtojas 1') || speakerLower.includes('speaker 1');
                const isSpeaker2 = speakerLower.includes('kalbėtojas 2') || speakerLower.includes('speaker 2');
                
                // Alternate colors if using generic speaker names
                const useLeftStyle = isAgent || (isSpeaker1 && i % 2 === 0) || (!isClient && !isSpeaker2 && i % 2 === 0);
                const useRightStyle = isClient || isSpeaker2 || (!isAgent && !isSpeaker1 && i % 2 === 1);
                
                return (
                  <div 
                    key={i} 
                    className={`p-4 rounded-2xl border transition-colors ${
                      useLeftStyle 
                        ? 'bg-indigo-50/50 border-indigo-100 ml-0' 
                        : useRightStyle
                        ? 'bg-emerald-50/50 border-emerald-100 mr-0'
                        : 'bg-slate-50 border-slate-100'
                    }`}
                  >
                    <span className={`text-[10px] font-black uppercase tracking-widest mb-2 block ${
                      useLeftStyle 
                        ? 'text-indigo-600' 
                        : useRightStyle
                        ? 'text-emerald-600'
                        : 'text-slate-500'
                    }`}>
                      {seg.speaker || 'Kalbėtojas'}
                    </span>
                    <p className="text-sm text-slate-700 leading-relaxed font-medium whitespace-pre-wrap break-words">{seg.text}</p>
                  </div>
                );
              })}
            </div>
            ) : transcription.text ? (
              <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                <div className="p-4 rounded-2xl border bg-slate-50 border-slate-100">
                  <span className="text-[10px] font-black uppercase tracking-widest mb-2 block text-slate-500">
                    Pilna transkripcija
                  </span>
                  <p className="text-sm text-slate-700 leading-relaxed font-medium whitespace-pre-wrap break-words">{transcription.text}</p>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-slate-500 text-sm">Transkripcijos duomenų nėra</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const MetricCard = ({ label, value, icon, trend }: { label: string, value: string, icon: React.ReactNode, trend?: 'up' | 'down' }) => (
  <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center justify-between transition-transform hover:scale-[1.02]">
    <div>
      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">{label}</p>
      <div className="flex items-center gap-2">
        <span className="text-3xl font-black text-slate-900 tracking-tight">{value}</span>
        {trend && (trend === 'up' ? <TrendingUp className="w-5 h-5 text-emerald-500" /> : <TrendingDown className="w-5 h-5 text-red-500" />)}
      </div>
    </div>
    <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center border border-slate-100 shadow-inner">
      {icon}
    </div>
  </div>
);

export default Dashboard;
