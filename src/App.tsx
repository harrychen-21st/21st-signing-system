import React, { useEffect, useState } from 'react';
import { CheckCircle, FileSignature, LogOut, Search, Settings } from 'lucide-react';
import SubmitForm from './SubmitForm';
import ApproverDashboard from './ApproverDashboard';
import AdminDashboard from './AdminDashboard';
import TrackDashboard from './TrackDashboard';
import LoginForm from './LoginForm';

type TabKey = 'submit' | 'track' | 'approve' | 'admin';

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('submit');

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    const token = localStorage.getItem('jwt');
    if (storedUser && token) {
      setUser(JSON.parse(storedUser));
    }

    const handleAuthExpired = () => {
      setUser(null);
      localStorage.removeItem('jwt');
      localStorage.removeItem('user');
    };
    window.addEventListener('auth-expired', handleAuthExpired);
    return () => window.removeEventListener('auth-expired', handleAuthExpired);
  }, []);

  const handleLogout = () => {
    window.dispatchEvent(new Event('auth-expired'));
  };

  if (!user) {
    return (
      <>
        <div className="orb orb-1"></div>
        <div className="orb orb-2"></div>
        <div className="orb orb-3"></div>
        <div className="relative z-10 w-full max-w-7xl mx-auto pt-12 px-4">
          <LoginForm onLoginSuccess={setUser} />
        </div>
      </>
    );
  }

  const hasRole = (role: string) => user?.roles?.includes(role) || user?.roles?.includes('ROLE:ADMIN');
  const showBackoffice =
    hasRole('ROLE:ADMIN') ||
    hasRole('ROLE:ADMIN_HEAD') ||
    hasRole('ROLE:ADMIN_DIRECTOR') ||
    hasRole('ROLE:FINANCE') ||
    hasRole('ROLE:RISK') ||
    hasRole('ROLE:DEPT_HEAD') ||
    hasRole('ROLE:GM');
  const showAdmin = hasRole('ROLE:ADMIN');

  const tabClass = (tab: TabKey, activeClass: string) =>
    `flex-1 min-w-[160px] flex justify-center items-center gap-2 px-4 py-3 lg:py-4 rounded-xl md:rounded-2xl font-semibold transition-all duration-300 ${
      activeTab === tab
        ? `${activeClass} text-white shadow-lg scale-100 sm:scale-105`
        : 'bg-white/60 text-slate-600 hover:bg-white backdrop-blur-md'
    }`;

  return (
    <>
      <div className="orb orb-1"></div>
      <div className="orb orb-2"></div>
      <div className="orb orb-3"></div>

      <div className="relative z-10 w-full max-w-7xl mx-auto pt-6 px-4 flex flex-col items-center">
        <div className="flex flex-col sm:flex-row flex-wrap justify-center gap-3 sm:gap-4 mb-6 md:mb-8 w-full max-w-5xl print:hidden">
          <button onClick={() => setActiveTab('submit')} className={tabClass('submit', 'bg-blue-600 shadow-blue-500/30')}>
            <FileSignature className="w-5 h-5" />
            填寫申請單
          </button>
          <button onClick={() => setActiveTab('track')} className={tabClass('track', 'bg-amber-600 shadow-amber-500/30')}>
            <Search className="w-5 h-5" />
            申請紀錄
          </button>
          {showBackoffice && (
            <button onClick={() => setActiveTab('approve')} className={tabClass('approve', 'bg-emerald-600 shadow-emerald-500/30')}>
              <CheckCircle className="w-5 h-5" />
              後台處理區
            </button>
          )}
          {showAdmin && (
            <button onClick={() => setActiveTab('admin')} className={tabClass('admin', 'bg-indigo-600 shadow-indigo-500/30')}>
              <Settings className="w-5 h-5" />
              系統設定
            </button>
          )}
        </div>

        {activeTab === 'submit' && <SubmitForm user={user} />}
        {activeTab === 'track' && <TrackDashboard user={user} />}
        {activeTab === 'approve' && <ApproverDashboard user={user} />}
        {activeTab === 'admin' && <AdminDashboard user={user} />}

        <div className="fixed bottom-6 right-6 bg-white/80 backdrop-blur-md shadow-lg border border-slate-200 p-3 rounded-2xl flex items-center gap-4 z-50 print:hidden">
          <div className="text-sm">
            <p className="font-semibold text-slate-800">{user.name}</p>
            <p className="text-slate-500 text-xs">{user.dept}</p>
          </div>
          <button onClick={handleLogout} className="p-2 hover:bg-red-50 text-red-500 rounded-xl transition-colors" title="登出">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </div>
    </>
  );
}
