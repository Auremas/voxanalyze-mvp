import React, { useState } from 'react';
import { LogIn, Mail, Lock, UserPlus, AlertCircle } from 'lucide-react';
import { signIn, signUp } from '../services/authService';

interface LoginProps {
  onAuthSuccess: () => void;
}

const Login: React.FC<LoginProps> = ({ onAuthSuccess }) => {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      if (isSignUp) {
        const { user, error: signUpError } = await signUp(email, password);
        
        if (signUpError) {
          setError(signUpError.message || 'Registracijos klaida');
        } else if (user) {
          setSuccess('Sėkmingai užsiregistravote! Patikrinkite el. paštą patvirtinimui.');
          // Wait a bit before trying to sign in (user profile needs to be created)
          setTimeout(() => {
            onAuthSuccess();
          }, 2000);
        }
      } else {
        const { user, error: signInError } = await signIn(email, password);
        
        if (signInError) {
          setError(signInError.message || 'Prisijungimo klaida');
        } else if (user) {
          setSuccess('Sėkmingai prisijungėte!');
          onAuthSuccess();
        }
      }
    } catch (err: any) {
      setError(err.message || 'Įvyko klaida');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-slate-50 p-4">
      <div className="max-w-md w-full space-y-8 animate-in fade-in slide-in-from-top-4 duration-700">
        <div className="text-center">
          <div className="flex justify-center mb-6">
            <div className="bg-indigo-600 p-4 rounded-3xl shadow-xl shadow-indigo-600/20">
              <LogIn className="text-white w-12 h-12" />
            </div>
          </div>
          <h2 className="text-4xl font-black text-slate-900 tracking-tight mb-2">
            {isSignUp ? 'Registracija' : 'Prisijungimas'}
          </h2>
          <p className="text-slate-500 font-medium">
            {isSignUp 
              ? 'Sukurkite naują paskyrą' 
              : 'Prisijunkite prie VoxAnalyze'}
          </p>
        </div>

        <div className="bg-white rounded-3xl shadow-xl border border-slate-200 p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-800 font-medium">{error}</p>
              </div>
            )}

            {success && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-emerald-800 font-medium">{success}</p>
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-bold text-slate-700 mb-2">
                El. paštas
              </label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                  placeholder="vardas@pavyzdys.lt"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-bold text-slate-700 mb-2">
                Slaptažodis
              </label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={6}
                  className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 text-white py-3 px-4 rounded-2xl font-bold hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-indigo-600/30"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  {isSignUp ? 'Registruojama...' : 'Prisijungiama...'}
                </span>
              ) : (
                isSignUp ? 'Registruotis' : 'Prisijungti'
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={() => {
                setIsSignUp(!isSignUp);
                setError(null);
                setSuccess(null);
              }}
              className="text-sm text-indigo-600 hover:text-indigo-700 font-bold flex items-center justify-center gap-2"
            >
              {isSignUp ? (
                <>
                  <LogIn className="w-4 h-4" />
                  Jau turite paskyrą? Prisijunkite
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4" />
                  Neturite paskyros? Registruokitės
                </>
              )}
            </button>
          </div>
        </div>

        <div className="text-center text-xs text-slate-400">
          <p>VoxAnalyze - Klientų aptarnavimo analizė</p>
        </div>
      </div>
    </div>
  );
};

export default Login;
