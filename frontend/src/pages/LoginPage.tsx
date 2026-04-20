import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGoogleLogin } from '@react-oauth/google';
import { AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { api } from '../api/client';

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

export default function LoginPage() {
  const navigate = useNavigate();
  const { user, token, setAuth } = useAuthStore();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already authenticated — skip login
  useEffect(() => {
    if (token && user) navigate('/', { replace: true });
  }, [token, user, navigate]);

  const handleGoogleSuccess = async (tokenResponse: { access_token: string }) => {
    setIsLoading(true);
    setError(null);

    try {
      const { data } = await api.post<{
        token: string;
        user: { email: string; name: string; picture: string };
      }>('/auth/google', { accessToken: tokenResponse.access_token });

      setAuth(data.user, data.token);
      navigate('/', { replace: true });
    } catch (err: any) {
      const message: string =
        err.response?.data?.error ?? 'Authentication failed. Please try again.';
      setError(message);
      setIsLoading(false);
    }
  };

  const login = useGoogleLogin({
    onSuccess: handleGoogleSuccess,
    onError: () => {
      setError('Google sign-in failed. Please try again.');
      setIsLoading(false);
    },
    onNonOAuthError: (e) => {
      if (e.type !== 'popup_closed') {
        setError('Sign-in was cancelled or blocked by your browser.');
      }
      setIsLoading(false);
    },
  });

  const handleSignIn = () => {
    setError(null);
    setIsLoading(true);
    login();
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#08081a] relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-uh-purple/20 blur-[120px] pointer-events-none" />

      {/* Subtle dot grid */}
      <div
        className="absolute inset-0 opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle, #ffffff 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />

      <div className="relative w-full max-w-[380px]">
        {/* Logo mark */}
        <div className="flex justify-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-uh-purple to-[#4f35c2] flex items-center justify-center shadow-[0_8px_32px_rgba(109,77,245,0.45)]">
            <span className="text-white font-bold text-xl tracking-tight select-none">UH</span>
          </div>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.4)] p-8">
          {/* Header */}
          <div className="text-center mb-7">
            <h1 className="text-[22px] font-bold text-slate-800 tracking-tight">QA Console</h1>
            <p className="text-slate-400 text-sm mt-1">Sign in to access your dashboard</p>
          </div>

          {/* Error banner */}
          {error && (
            <div className="mb-5 flex items-start gap-2.5 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
              <AlertCircle size={15} className="shrink-0 mt-px" />
              <span>{error}</span>
            </div>
          )}

          {/* Google Sign-In button */}
          <button
            onClick={handleSignIn}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-700 text-sm font-medium shadow-elevation-1 hover:shadow-elevation-2 hover:border-slate-300 hover:-translate-y-px active:translate-y-0 transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-uh-purple/50"
          >
            {isLoading ? (
              <Loader2 size={18} className="animate-spin text-uh-purple" />
            ) : (
              <GoogleIcon />
            )}
            <span>{isLoading ? 'Signing in…' : 'Sign in with Google'}</span>
          </button>

          {/* Domain restriction notice */}
          <div className="mt-5 flex items-center justify-center gap-1.5 text-xs text-slate-400">
            <ShieldCheck size={13} className="text-uh-success shrink-0" />
            <span>
              Restricted to{' '}
              <span className="font-medium text-slate-500">@ultrahuman.com</span> accounts
            </span>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-white/20 text-xs mt-6">
          © {new Date().getFullYear()} Ultrahuman. Internal use only.
        </p>
      </div>
    </div>
  );
}
