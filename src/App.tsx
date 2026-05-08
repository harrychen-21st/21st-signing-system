import React, { useMemo, useState } from 'react';
import { FileSignature, CheckCircle, Settings, Search, LogIn, LogOut } from 'lucide-react';
import SubmitForm from './SubmitForm';
import ApproverDashboard from './ApproverDashboard';
import AdminDashboard from './AdminDashboard';
import TrackDashboard from './TrackDashboard';
import { apiPost } from './lib/api';

type SessionUser = {
  email: string;
  name: string;
  dept: string;
  manager: string;
  roles: string[];
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'submit' | 'track' | 'approve' | 'admin'>('submit');
  const [loginEmail, setLoginEmail] = useState('');
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState('');
  const appVersion = (process as any).env?.APP_VERSION || 'local';

  const canApprove = useMemo(() => {
    if (!sessionUser) return false;
    return sessionUser.roles.some((role) => role !== 'ROLE:EMPLOYEE') || !!sessionUser.manager;
  }, [sessionUser]);

  const isAdmin = sessionUser?.roles.includes('ROLE:ADMIN') || false;

  const handleLogin = async () => {
    const email = loginEmail.toLowerCase().trim();
    if (!email || !email.includes('@')) {
      setLoginError('請輸入有效的公司 Email。');
      return;
    }

    setIsLoggingIn(true);
    setLoginError('');
    try {
      const data = await apiPost<{ success: boolean; user: SessionUser }>('/api/auth/login', { email });
      setSessionUser({ ...data.user, email });
      setActiveTab('submit');
    } catch (error) {
      setSessionUser(null);
      setLoginError(error instanceof Error ? error.message : '登入失敗');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    setSessionUser(null);
    setLoginEmail('');
    setLoginError('');
    setActiveTab('submit');
  };

  return (
    <>
      <div className="orb orb-1"></div>
      <div className="orb orb-2"></div>
      <div className="orb orb-3"></div>

      <div className="relative z-10 w-full max-w-7xl mx-auto pt-6 px-4 flex flex-col items-center">
        <div className="mb-6 w-full max-w-5xl rounded-2xl border border-slate-200 bg-white/70 p-4 backdrop-blur-md">
          {!sessionUser ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                placeholder="請先登入公司 Email"
                className="form-input flex-1"
              />
              <button
                onClick={handleLogin}
                disabled={isLoggingIn}
                className="flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-6 py-3 font-semibold text-white disabled:opacity-60"
              >
                <LogIn className="h-4 w-4" /> {isLoggingIn ? '登入中...' : '登入'}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-slate-700">
                <span className="font-bold">已登入：</span>
                {sessionUser.name} ({sessionUser.email}) / {sessionUser.dept}
              </div>
              <button
                onClick={handleLogout}
                className="flex items-center justify-center gap-2 rounded-xl bg-slate-100 px-4 py-2 font-semibold text-slate-700"
              >
                <LogOut className="h-4 w-4" /> 登出
              </button>
            </div>
          )}
          {loginError && <div className="mt-2 text-sm text-rose-600">{loginError}</div>}
        </div>

        <div className="flex flex-col sm:flex-row flex-wrap justify-center gap-3 sm:gap-4 mb-6 md:mb-8 w-full max-w-5xl">
          <button 
            onClick={() => setActiveTab('submit')}
            className={`flex-1 min-w-[160px] flex justify-center items-center gap-2 px-4 py-3 lg:py-4 rounded-xl md:rounded-2xl font-semibold transition-all duration-300 ${activeTab === 'submit' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30 scale-100 sm:scale-105' : 'bg-white/60 text-slate-600 hover:bg-white backdrop-blur-md'}`}
          >
            <FileSignature className="w-5 h-5" /> 填寫申請單
          </button>
          <button 
            onClick={() => setActiveTab('track')}
            className={`flex-1 min-w-[160px] flex justify-center items-center gap-2 px-4 py-3 lg:py-4 rounded-xl md:rounded-2xl font-semibold transition-all duration-300 ${activeTab === 'track' ? 'bg-amber-600 text-white shadow-lg shadow-amber-500/30 scale-100 sm:scale-105' : 'bg-white/60 text-slate-600 hover:bg-white backdrop-blur-md'}`}
          >
            <Search className="w-5 h-5" /> 我的申請紀錄
          </button>
          {canApprove && (
            <button 
              onClick={() => setActiveTab('approve')}
              className={`flex-1 min-w-[160px] flex justify-center items-center gap-2 px-4 py-3 lg:py-4 rounded-xl md:rounded-2xl font-semibold transition-all duration-300 ${activeTab === 'approve' ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/30 scale-100 sm:scale-105' : 'bg-white/60 text-slate-600 hover:bg-white backdrop-blur-md'}`}
            >
              <CheckCircle className="w-5 h-5" /> 主管簽核區
            </button>
          )}
          {isAdmin && (
            <button 
              onClick={() => setActiveTab('admin')}
              className={`flex-1 min-w-[160px] flex justify-center items-center gap-2 px-4 py-3 lg:py-4 rounded-xl md:rounded-2xl font-semibold transition-all duration-300 ${activeTab === 'admin' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30 scale-100 sm:scale-105' : 'bg-white/60 text-slate-600 hover:bg-white backdrop-blur-md'}`}
            >
              <Settings className="w-5 h-5" /> 系統管理
            </button>
          )}
        </div>

        <div className="mb-4 text-[11px] text-slate-400 font-mono">build: {appVersion}</div>

        {activeTab === 'submit' && <SubmitForm initialEmail={sessionUser?.email || ''} />}
        {activeTab === 'track' && <TrackDashboard initialEmail={sessionUser?.email || ''} />}
        {activeTab === 'approve' && canApprove && <ApproverDashboard initialEmail={sessionUser?.email || ''} />}
        {activeTab === 'admin' && isAdmin && <AdminDashboard />}
      </div>
    </>
  );
}
