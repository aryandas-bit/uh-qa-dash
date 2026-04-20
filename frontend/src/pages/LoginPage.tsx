import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GoogleLogin, type CredentialResponse } from '@react-oauth/google';
import { AlertCircle, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { api } from '../api/client';

export default function LoginPage() {
  const navigate = useNavigate();
  const { user, token, setAuth } = useAuthStore();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already authenticated — skip straight to dashboard
  useEffect(() => {
    if (token && user) navigate('/', { replace: true });
  }, [token, user, navigate]);

  const handleCredential = async (credentialResponse: CredentialResponse) => {
    if (!credentialResponse.credential) {
      setError('No credential received from Google. Please try again.');
      return;
    }
    setIsLoading(true);
    setError(null);

    try {
      const { data } = await api.post<{
        token: string;
        user: { email: string; name: string; picture: string };
      }>('/auth/google', { credential: credentialResponse.credential });

      setAuth(data.user, data.token);
      navigate('/', { replace: true });
    } catch (err: any) {
      const message: string =
        err.response?.data?.error ?? 'Authentication failed. Please try again.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleError = () => {
    setError('Google sign-in failed. Check your browser settings or try again.');
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#08081a] relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-uh-purple/20 blur-[120px] pointer-events-none" />

      {/* Dot grid */}
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
            <p className="text-slate-400 text-sm mt-1">Sign in with your Ultrahuman account</p>
          </div>

          {/* Error banner */}
          {error && (
            <div className="mb-5 flex items-start gap-2.5 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
              <AlertCircle size={15} className="shrink-0 mt-px" />
              <span>{error}</span>
            </div>
          )}

          {/* Google Sign-In button */}
          <div className={`flex justify-center transition-opacity duration-150 ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}>
            <GoogleLogin
              onSuccess={handleCredential}
              onError={handleGoogleError}
              useOneTap={false}
              theme="outline"
              size="large"
              width="320"
              text="signin_with"
              shape="rectangular"
            />
          </div>

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
