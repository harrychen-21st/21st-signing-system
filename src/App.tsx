import React, { useState } from 'react';
import { FileSignature, CheckCircle, Settings, Search } from 'lucide-react';
import SubmitForm from './SubmitForm';
import ApproverDashboard from './ApproverDashboard';
import AdminDashboard from './AdminDashboard';
import TrackDashboard from './TrackDashboard';

export default function App() {
  const [activeTab, setActiveTab] = useState<'submit' | 'track' | 'approve' | 'admin'>('submit');

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
          <button 
            onClick={() => setActiveTab('approve')}
            className={`flex-1 min-w-[160px] flex justify-center items-center gap-2 px-4 py-3 lg:py-4 rounded-xl md:rounded-2xl font-semibold transition-all duration-300 ${activeTab === 'approve' ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/30 scale-100 sm:scale-105' : 'bg-white/60 text-slate-600 hover:bg-white backdrop-blur-md'}`}
          >
            <CheckCircle className="w-5 h-5" /> 主管簽核區
          </button>
          <button 
            onClick={() => setActiveTab('admin')}
            className={`flex-1 min-w-[160px] flex justify-center items-center gap-2 px-4 py-3 lg:py-4 rounded-xl md:rounded-2xl font-semibold transition-all duration-300 ${activeTab === 'admin' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30 scale-100 sm:scale-105' : 'bg-white/60 text-slate-600 hover:bg-white backdrop-blur-md'}`}
          >
            <Settings className="w-5 h-5" /> 系統管理
          </button>
        </div>

        {activeTab === 'submit' && <SubmitForm />}
        {activeTab === 'track' && <TrackDashboard />}
        {activeTab === 'approve' && <ApproverDashboard />}
        {activeTab === 'admin' && <AdminDashboard />}
      </div>
    </>
  );
}
