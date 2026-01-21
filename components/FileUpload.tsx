
import React, { useRef, useState } from 'react';
import { Upload, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

interface FileUploadProps {
  onUpload: (file: File, base64: string) => void;
  isProcessing: boolean;
  onMultipleUpload?: (files: File[]) => void; // Optional callback for multiple files
}

const FileUpload: React.FC<FileUploadProps> = ({ onUpload, isProcessing, onMultipleUpload }) => {
  const disableEdgeFunctions =
    (import.meta as any)?.env?.VITE_DISABLE_EDGE_FUNCTIONS === 'true';

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isProcessingRef = useRef(false); // Prevent duplicate calls

  const handleFiles = async (files: FileList | File[]) => {
    if (disableEdgeFunctions) {
      setError(
        'Vietinis režimas: Edge Functions išjungtos (VITE_DISABLE_EDGE_FUNCTIONS=true). ' +
          'Įkėlimui + transkripcijai + analizei reikia Supabase Edge Functions. ' +
          'Išjunkite šį nustatymą arba paleiskite Edge Functions.'
      );
      return;
    }

    // Prevent double-processing
    if (isProcessingRef.current || isProcessing) {
      console.warn('⚠️ Upload already in progress, ignoring duplicate call');
      return;
    }

    const fileArray = Array.from(files);
    const audioFiles = fileArray.filter(file => file.type.startsWith('audio/'));
    
    if (audioFiles.length === 0) {
      setError('Prašome įkelti garso failus (MP3, WAV ir kt.)');
      return;
    }
    
    if (fileArray.length > audioFiles.length) {
      setError(`${fileArray.length - audioFiles.length} failas(ai) buvo praleistas - nėra garso failai`);
    } else {
      setError(null);
    }

    isProcessingRef.current = true;

    try {
      // If multiple files and callback provided, use it
      if (audioFiles.length > 1 && onMultipleUpload) {
        await onMultipleUpload(audioFiles);
        return;
      }

      // Otherwise, process single file or first file (backward compatibility)
      const file = audioFiles[0];
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        onUpload(file, base64);
      };
      reader.onerror = () => {
        setError('Nepavyko nuskaityti failo');
        isProcessingRef.current = false;
      };
      reader.readAsDataURL(file);
    } catch (err) {
      isProcessingRef.current = false;
      throw err;
    } finally {
      // Reset processing ref after a delay to prevent rapid re-triggers
      setTimeout(() => {
        isProcessingRef.current = false;
      }, 2000);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
    else if (e.type === "dragleave") setDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  return (
    <div className="w-full">
      <div 
        className={`relative border-2 border-dashed rounded-2xl p-12 transition-all duration-300 flex flex-col items-center justify-center cursor-pointer
          ${dragActive ? 'border-indigo-500 bg-indigo-50/50 scale-[1.01]' : 'border-slate-300 hover:border-indigo-400 bg-white'}
          ${isProcessing || disableEdgeFunctions ? 'opacity-70 pointer-events-none' : ''}`}
        onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}
        onClick={() => !isProcessing && !disableEdgeFunctions && fileInputRef.current?.click()}
      >
        <input 
          type="file" 
          ref={fileInputRef} 
          className="hidden" 
          accept="audio/*" 
          multiple 
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              handleFiles(e.target.files);
              // Reset input to allow selecting the same file again
              e.target.value = '';
            }
          }} 
        />
        
        {isProcessing ? (
          <div className="flex flex-col items-center">
            <Loader2 className="w-16 h-16 text-indigo-600 animate-spin mb-6" />
            <p className="text-xl font-bold text-slate-800">Analizuojamas skambutis...</p>
            <p className="text-slate-500 mt-2">Atliekama transkripcija ir DI vertinimas</p>
          </div>
        ) : disableEdgeFunctions ? (
          <div className="flex flex-col items-center">
            <div className="w-20 h-20 bg-slate-100 rounded-2xl flex items-center justify-center mb-6 shadow-inner">
              <AlertCircle className="w-10 h-10 text-slate-500" />
            </div>
            <h3 className="text-2xl font-bold text-slate-800 mb-2">Įkėlimas išjungtas (vietinis režimas)</h3>
            <p className="text-slate-500 text-center max-w-sm mb-4">
              Norint įkelti ir apdoroti skambučius reikia Supabase Edge Functions.
            </p>
            <p className="text-slate-500 text-center max-w-sm">
              Sprendimai: nustatykite <span className="font-mono">VITE_DISABLE_EDGE_FUNCTIONS=false</span> arba paleiskite Edge Functions.
            </p>
          </div>
        ) : (
          <>
            <div className="w-20 h-20 bg-indigo-100 rounded-2xl flex items-center justify-center mb-6 shadow-inner">
              <Upload className="w-10 h-10 text-indigo-600" />
            </div>
            <h3 className="text-2xl font-bold text-slate-800 mb-2">Įkelkite skambučio įrašą(us)</h3>
            <p className="text-slate-500 text-center max-w-sm mb-8">
              Atitempkite failą arba kelis failus čia arba spustelėkite, kad pasirinktumėte. Palaikomi MP3, WAV ir M4A formatai.
            </p>
            <div className="flex gap-6">
               <span className="inline-flex items-center text-xs font-bold text-slate-400 uppercase tracking-widest">
                <CheckCircle2 className="w-4 h-4 mr-2 text-emerald-500" /> Šifruota saugykla
              </span>
               <span className="inline-flex items-center text-xs font-bold text-slate-400 uppercase tracking-widest">
                <CheckCircle2 className="w-4 h-4 mr-2 text-emerald-500" /> Duomenų anonimizavimas
              </span>
            </div>
          </>
        )}
      </div>

      {error && (
        <div className="mt-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-center gap-4 text-red-700 animate-in slide-in-from-top-2">
          <AlertCircle className="w-6 h-6 flex-shrink-0" />
          <p className="font-semibold">{error}</p>
        </div>
      )}
    </div>
  );
};

export default FileUpload;
