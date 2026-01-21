
export interface AudioFile {
  id: string;
  fileName: string;
  uploadDate: Date;
  format: string;
  size: number;
}

export interface Transcription {
  id: string;
  text: string;
  timestamp: Date;
  language: string;
  segments: TranscriptionSegment[];
}

export interface TranscriptionSegment {
  speaker: string;
  text: string;
  startTime: number;
  endTime: number;
}

export interface AnalysisResult {
  id: string;
  sentimentScore: number; // 0-100
  customerSatisfaction: number; // 0-100
  agentPerformance: number; // 0-100
  warnings: string[];
  metrics: {
    label: string;
    value: number;
    trend: 'up' | 'down' | 'neutral';
  }[];
  summary: string;
  complianceChecked: boolean;
}

export interface CallRecord {
  id?: string; // Database record ID (UUID from Supabase)
  audio: AudioFile;
  transcription?: Transcription;
  analysis?: AnalysisResult;
  status: 'pending' | 'uploaded' | 'transcribing' | 'analyzing' | 'completed' | 'error';
  error?: string;
  progress?: number; // 0-100 for progress bar
  stage?: 'uploading' | 'transcribing' | 'analyzing' | 'complete'; // Current processing stage
}
