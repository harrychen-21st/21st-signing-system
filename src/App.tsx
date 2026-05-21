import React, { useState, useEffect } from 'react';
import { FileSignature, CheckCircle, Settings, Search, LogOut } from 'lucide-react';
import SubmitForm from './SubmitForm';
import ApproverDashboard from './ApproverDashboard';
import AdminDashboard from './AdminDashboard';
import TrackDashboard from './TrackDashboard';
import LoginForm from './LoginForm';

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'submit' | 'track' | 'approve' | 'admin'>('submit');
  
  useEffect(() => {
    // 檢查本地是否已有登入資訊
    const storedUser = localStorage.getItem('user');
    const token = localStorage.getItem('jwt');
    if (storedUser && token) {
      setUser(JSON.parse(storedUser));
    }

    // 監聽登出事件
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
  const showApprove = hasRole('ROLE:DEPT_HEAD') || hasRole('ROLE:ADMIN') || hasRole('ROLE:GM') || hasRole('ROLE:LEGAL') || hasRole('ROLE:ADMIN_VP');
  const showAdmin = hasRole('ROLE:ADMIN');

  return (
    <>
      <div className="orb orb-1"></div>
      <div className="orb orb-2"></div>
      <div className="orb orb-3"></div>

      <div className="relative z-10 w-full max-w-7xl mx-auto pt-6 px-4 flex flex-col items-center">
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
          {showApprove && (
            <button 
              onClick={() => setActiveTab('approve')}
              className={`flex-1 min-w-[160px] flex justify-center items-center gap-2 px-4 py-3 lg:py-4 rounded-xl md:rounded-2xl font-semibold transition-all duration-300 ${activeTab === 'approve' ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/30 scale-100 sm:scale-105' : 'bg-white/60 text-slate-600 hover:bg-white backdrop-blur-md'}`}
            >
              <CheckCircle className="w-5 h-5" /> 主管簽核區
            </button>
          )}
          {showAdmin && (
            <button 
              onClick={() => setActiveTab('admin')}
              className={`flex-1 min-w-[160px] flex justify-center items-center gap-2 px-4 py-3 lg:py-4 rounded-xl md:rounded-2xl font-semibold transition-all duration-300 ${activeTab === 'admin' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30 scale-100 sm:scale-105' : 'bg-white/60 text-slate-600 hover:bg-white backdrop-blur-md'}`}
            >
              <Settings className="w-5 h-5" /> 系統管理
            </button>
          )}
        </div>

        {activeTab === 'submit' && <SubmitForm user={user} />}
        {activeTab === 'track' && <TrackDashboard user={user} />}
        {activeTab === 'approve' && <ApproverDashboard user={user} />}
        {activeTab === 'admin' && <AdminDashboard user={user} />}
        
        {/* User Profile & Logout Widget */}
        <div className="fixed bottom-6 right-6 bg-white/80 backdrop-blur-md shadow-lg border border-slate-200 p-3 rounded-2xl flex items-center gap-4 z-50">
          <div className="text-sm">
            <p className="font-semibold text-slate-800">{user.name}</p>
            <p className="text-slate-500 text-xs">{user.dept}</p>
          </div>
          <button 
            onClick={handleLogout}
            className="p-2 hover:bg-red-50 text-red-500 rounded-xl transition-colors"
            title="登出"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </div>
    </>
  );
}
