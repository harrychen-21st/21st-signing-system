import React, { useEffect, useState } from 'react';
import { Mail, Loader2, CheckCircle, XCircle, Clock, AlertCircle, FileText, MessageSquare } from 'lucide-react';
import { apiGet, apiPost } from './lib/api';

interface Ticket {
  id: string;
  createdAt: string;
  applicantEmail: string;
  applicantName: string;
  dept: string;
  formType: string;
  status: string;
  stage: string;
  subject: string;
  amount: string;
  currentApprover?: string;
  complianceRequired?: boolean;
  compliance?: {
    aml_result?: string;
    aml_comment?: string;
    rp_result?: string;
    rp_comment?: string;
  };
}

export default function ApproverDashboard({ initialEmail = '' }: { initialEmail?: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Modal states
  const [activeModal, setActiveModal] = useState<{ticket: Ticket, action: 'approve' | 'reject'} | null>(null);
  const [commentText, setCommentText] = useState('');
  const [amlResult, setAmlResult] = useState('');
  const [amlComment, setAmlComment] = useState('');
  const [rpResult, setRpResult] = useState('');
  const [rpComment, setRpComment] = useState('');

  useEffect(() => {
    setEmail(initialEmail);
  }, [initialEmail]);

  useEffect(() => {
    if (initialEmail) {
      fetchTickets();
    }
  }, [initialEmail]);

  const fetchTickets = async () => {
    const val = email.toLowerCase().trim();
    if (!val || !val.includes('@')) {
      alert('請輸入有效的 Email');
      return;
    }

    setIsFetching(true);
    setHasSearched(true);
    try {
      const data = await apiGet<{ tickets: Ticket[] }>(`/api/tickets/pending/${encodeURIComponent(val)}`);
      setTickets(data.tickets || []);
    } catch (error) {
      console.error("Failed to fetch tickets", error);
      alert("無法取得簽核單，請稍後再試。");
    } finally {
      setIsFetching(false);
    }
  };

  const openActionModal = (ticket: Ticket, action: 'approve' | 'reject') => {
    setActiveModal({ ticket, action });
    setCommentText('');
    setAmlResult(ticket.compliance?.aml_result || '');
    setAmlComment(ticket.compliance?.aml_comment || '');
    setRpResult(ticket.compliance?.rp_result || '');
    setRpComment(ticket.compliance?.rp_comment || '');
  };

  const confirmAction = async () => {
    if (!activeModal) return;
    const { ticket, action } = activeModal;

    if (ticket.complianceRequired && !amlResult) {
      alert('請填寫 AML 盡職調查結果。');
      return;
    }

    if (ticket.complianceRequired && !rpResult) {
      alert('請填寫關係人交易調查結果。');
      return;
    }
    
    setActionLoading(ticket.id);
    setActiveModal(null); // Close modal right away

    try {
      await apiPost(`/api/tickets/${encodeURIComponent(ticket.id)}/action`, {
        action,
        approverEmail: email.toLowerCase().trim(),
        comment: commentText,
        compliance: ticket.complianceRequired ? {
          aml_result: amlResult,
          aml_comment: amlComment,
          rp_result: rpResult,
          rp_comment: rpComment,
        } : undefined,
      });
      await fetchTickets();
    } catch (error) {
      console.error("Action error", error);
      alert(error instanceof Error ? error.message : '操作失敗，請稍後再試。');
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <>
      <div className="glass-panel rounded-2xl md:rounded-3xl p-5 sm:p-8 md:p-12 w-full max-w-5xl animate-slide-up z-10">
        <div className="text-center mb-8 md:mb-10">
          <h2 className="text-2xl md:text-3xl font-bold text-emerald-900 flex items-center justify-center gap-3 mb-2">
            <CheckCircle className="text-emerald-500 w-8 h-8" /> 待簽核任務清單
          </h2>
          <p className="text-slate-500 text-sm md:text-base tracking-wide">
            系統將依照目前登入身份，自動撈取等待您簽核的單據
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 mb-8">
          <div className="relative flex-grow">
            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
            <div className="form-input w-full !pl-11 flex items-center text-slate-700 bg-slate-50">{email || '尚未登入'}</div>
          </div>
          <button 
            onClick={fetchTickets}
            disabled={isFetching}
            className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-500 text-white px-8 py-3 rounded-xl font-semibold transition-all disabled:opacity-70 flex items-center justify-center gap-2"
          >
            {isFetching ? <Loader2 className="w-5 h-5 animate-spin" /> : '查詢待辦'}
          </button>
        </div>

        {hasSearched && !isFetching && tickets.length === 0 && (
          <div className="text-center py-12 bg-slate-50/50 rounded-2xl border border-slate-200 border-dashed">
            <div className="w-16 h-16 bg-emerald-100 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-semibold text-slate-700 mb-1">目前沒有待簽核的單據</h3>
            <p className="text-slate-500">太棒了！您的待辦清單已經清空。</p>
          </div>
        )}

        {tickets.length > 0 && (
          <div className="space-y-4">
            {tickets.map(ticket => (
              <div key={ticket.id} className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all">
                <div className="flex flex-col md:flex-row justify-between gap-6">
                  
                  {/* Ticket Info */}
                  <div className="flex-grow space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="px-3 py-1 bg-blue-100 text-blue-700 text-xs font-bold rounded-lg tracking-wider">
                        {ticket.formType}
                      </span>
                      <span className="font-mono text-slate-500 text-sm">{ticket.id}</span>
                      <span className="flex items-center gap-1 text-amber-600 text-xs font-medium bg-amber-50 px-2 py-1 rounded-md">
                        <Clock className="w-3 h-3" /> 等待簽核
                      </span>
                    </div>
                    
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                      <FileText className="w-5 h-5 text-slate-400" />
                      {ticket.subject || '(未提供主旨)'}
                    </h3>
                    
                    <div className="grid grid-cols-2 gap-y-2 text-sm text-slate-600">
                      <div><span className="text-slate-400">申請人：</span> {ticket.applicantName} ({ticket.dept})</div>
                      <div><span className="text-slate-400">申請時間：</span> {new Date(ticket.createdAt).toLocaleDateString()}</div>
                      {ticket.amount && (
                        <div className="col-span-2 text-emerald-600 font-semibold">
                          <span className="text-slate-400 font-normal">預估金額：</span> TWD {Number(ticket.amount).toLocaleString()}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-row md:flex-col gap-3 justify-center md:border-l md:border-slate-100 md:pl-6 min-w-[140px]">
                    <button 
                      onClick={() => openActionModal(ticket, 'approve')}
                      disabled={actionLoading === ticket.id}
                      className="flex-1 flex items-center justify-center gap-2 bg-emerald-50 hover:bg-emerald-500 text-emerald-600 hover:text-white border border-emerald-200 hover:border-emerald-500 px-4 py-2.5 rounded-xl font-medium transition-all disabled:opacity-50"
                    >
                      {actionLoading === ticket.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                      核准
                    </button>
                    <button 
                      onClick={() => openActionModal(ticket, 'reject')}
                      disabled={actionLoading === ticket.id}
                      className="flex-1 flex items-center justify-center gap-2 bg-rose-50 hover:bg-rose-500 text-rose-600 hover:text-white border border-rose-200 hover:border-rose-500 px-4 py-2.5 rounded-xl font-medium transition-all disabled:opacity-50"
                    >
                      {actionLoading === ticket.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                      駁回
                    </button>
                  </div>

                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Action Modal */}
      {activeModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 md:p-8 w-full max-w-md shadow-2xl animate-pop-in">
            <h3 className={`text-xl font-bold flex items-center gap-2 mb-4 ${activeModal.action === 'approve' ? 'text-emerald-700' : 'text-rose-700'}`}>
              {activeModal.action === 'approve' ? <CheckCircle className="w-6 h-6" /> : <XCircle className="w-6 h-6" />}
              {activeModal.action === 'approve' ? '核准此申請' : '駁回此申請'}
            </h3>
            
            <p className="text-slate-600 text-sm mb-4">
              單號：<span className="font-mono font-bold text-slate-800">{activeModal.ticket.id}</span>
            </p>

            <div className="mb-6">
              <label className="block text-slate-700 font-semibold mb-2 flex items-center gap-2">
                <MessageSquare className="w-4 h-4" /> 
                留下您的簽核意見 {activeModal.action === 'approve' ? '(選填)' : '(必填)'}
              </label>
              <textarea 
                rows={4}
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder={activeModal.action === 'approve' ? "同意，辛苦了！" : "預算超支，請重新評估。"}
                className={`w-full p-3 border rounded-xl outline-none transition-all ${
                  activeModal.action === 'approve' 
                    ? 'border-emerald-200 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10' 
                    : 'border-rose-200 focus:border-rose-500 focus:ring-4 focus:ring-rose-500/10'
                }`}
              />
            </div>

            {activeModal.ticket.complianceRequired && (
              <div className="mb-6 space-y-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <div className="flex items-center gap-2 text-sm font-bold text-amber-700">
                  <AlertCircle className="w-4 h-4" /> AML / 關係人交易審查
                </div>
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">AML 盡職調查結果</label>
                  <select value={amlResult} onChange={(e) => setAmlResult(e.target.value)} className="form-input">
                    <option value="">請選擇</option>
                    <option value="正常">正常</option>
                    <option value="不正常">不正常</option>
                  </select>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">AML 備註</label>
                  <textarea rows={3} value={amlComment} onChange={(e) => setAmlComment(e.target.value)} className="form-input" />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">關係人交易調查結果</label>
                  <select value={rpResult} onChange={(e) => setRpResult(e.target.value)} className="form-input">
                    <option value="">請選擇</option>
                    <option value="非關係人交易">非關係人交易</option>
                    <option value="關係人交易且已經過董事會同意">關係人交易且已經過董事會同意</option>
                    <option value="關係人交易但未經過董事會同意">關係人交易但未經過董事會同意</option>
                  </select>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">關係人交易備註</label>
                  <textarea rows={3} value={rpComment} onChange={(e) => setRpComment(e.target.value)} className="form-input" />
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button 
                onClick={() => setActiveModal(null)}
                className="flex-1 px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-all"
              >
                取消
              </button>
              <button 
                onClick={confirmAction}
                disabled={activeModal.action === 'reject' && commentText.trim() === ''}
                className={`flex-1 px-4 py-3 font-semibold rounded-xl transition-all text-white disabled:opacity-50 disabled:cursor-not-allowed ${
                  activeModal.action === 'approve' 
                    ? 'bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-500/30' 
                    : 'bg-rose-600 hover:bg-rose-500 shadow-lg shadow-rose-500/30'
                }`}
              >
                {activeModal.action === 'approve' ? '確認核准' : '確認駁回'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
