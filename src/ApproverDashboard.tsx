import React, { useEffect, useState } from 'react';
import { CheckCircle, FileText, Loader2, Mail, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { authFetch } from './authFetch';

interface Ticket {
  id: string;
  createdAt: string;
  applicantEmail: string;
  applicantName: string;
  dept: string;
  formType: string;
  status: string;
  subject: string;
  amount: string;
  formData?: Record<string, unknown>;
}

const statusLabels: Record<string, string> = {
  Submitted: '已送出',
  Checking: '查核中',
  ActionRequired: '需人工處理',
  Completed: '已完成',
  Cancelled: '已作廢',
  Pending: '舊資料：待處理',
  Approved: '舊資料：已核准',
  Rejected: '舊資料：已駁回',
};

function valueOf(ticket: Ticket, key: string) {
  const value = ticket.formData?.[key];
  return value == null || value === '' ? '-' : String(value);
}

function matchesTicketSearch(ticket: Ticket, query: string) {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return true;

  const searchableText = [
    ticket.id,
    ticket.createdAt,
    ticket.applicantEmail,
    ticket.applicantName,
    ticket.dept,
    ticket.formType,
    ticket.status,
    statusLabels[ticket.status],
    ticket.subject,
    ticket.amount,
    ...Object.values(ticket.formData || {}).map((value) => String(value ?? '')),
  ].join(' ').toLowerCase();

  return searchableText.includes(keyword);
}

export default function ApproverDashboard({ user }: { user: any }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState('');

  const fetchTickets = async () => {
    setIsFetching(true);
    try {
      const response = await authFetch('/api/backoffice/tickets');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to fetch tickets');
      setTickets(data.tickets || []);
    } catch (error: any) {
      console.error('Failed to fetch backoffice tickets', error);
      alert(error.message || '無法讀取後台資料');
    } finally {
      setIsFetching(false);
    }
  };

  const filteredTickets = tickets.filter((ticket) => matchesTicketSearch(ticket, searchQuery));

  useEffect(() => {
    fetchTickets();
  }, []);

  const completeTicket = async (ticketId: string) => {
    setActionLoading(ticketId);
    try {
      const response = await authFetch(`/api/tickets/${ticketId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note[ticketId] || '' }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Failed to complete ticket');
      setTickets((previous) =>
        previous.map((ticket) => (ticket.id === ticketId ? { ...ticket, status: 'Completed' } : ticket))
      );
    } catch (error: any) {
      console.error('Failed to complete ticket', error);
      alert(error.message || '完成結案失敗');
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="glass-panel rounded-2xl p-5 sm:p-8 md:p-12 w-full max-w-6xl animate-slide-up z-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold text-slate-900 flex items-center gap-3 mb-2">
            <ShieldCheck className="text-emerald-500 w-8 h-8" />
            後台處理區
          </h2>
          <p className="text-slate-500">檢視申請、追蹤 AML/關係人狀態，並在處理完成後結案。</p>
        </div>
        <button
          onClick={fetchTickets}
          disabled={isFetching}
          className="bg-slate-900 hover:bg-slate-700 text-white px-5 py-3 rounded-xl font-semibold transition-all disabled:opacity-70 flex items-center justify-center gap-2"
        >
          {isFetching ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
          重新整理
        </button>
      </div>

      <div className="relative bg-white/60 p-4 rounded-xl border border-slate-200 flex items-center gap-3 mb-6">
        <Mail className="text-emerald-600 w-5 h-5" />
        <span className="font-semibold text-slate-700">{user.email}</span>
      </div>

      <div className="relative mb-6">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="搜尋單號、表單類型、主旨、申請人、部門、統編或商家名稱"
          className="w-full bg-white/80 border border-slate-200 rounded-xl py-3 pl-12 pr-4 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
        />
      </div>

      {!isFetching && tickets.length === 0 && (
        <div className="text-center py-12 bg-slate-50/50 rounded-2xl border border-slate-200 border-dashed">
          <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-slate-700">目前沒有待檢視資料</h3>
        </div>
      )}

      {!isFetching && tickets.length > 0 && filteredTickets.length === 0 && (
        <div className="text-center py-12 bg-slate-50/50 rounded-2xl border border-slate-200 border-dashed">
          <Search className="w-12 h-12 text-slate-400 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-slate-700">找不到符合條件的資料</h3>
          <p className="text-slate-500 mt-1">請換一個關鍵字再試試看。</p>
        </div>
      )}

      <div className="space-y-4">
        {filteredTickets.map((ticket) => (
          <div key={ticket.id} className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <div className="flex flex-col lg:flex-row gap-6 justify-between">
              <div className="space-y-3 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-3 py-1 bg-blue-100 text-blue-700 text-xs font-bold rounded-lg">
                    {ticket.formType}
                  </span>
                  <span className="font-mono text-slate-500 text-sm">{ticket.id}</span>
                  <span className="px-3 py-1 bg-amber-50 text-amber-700 text-xs font-bold rounded-lg">
                    {statusLabels[ticket.status] || ticket.status}
                  </span>
                </div>

                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-slate-400" />
                  {ticket.subject || '(未填主旨)'}
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-slate-600">
                  <div>申請人：{ticket.applicantName} ({ticket.applicantEmail})</div>
                  <div>需求單位：{ticket.dept}</div>
                  <div>填表日期：{new Date(ticket.createdAt).toLocaleString()}</div>
                  <div>金額：{ticket.amount || '-'}</div>
                  <div>統編：{valueOf(ticket, 'ext_tax_id')}</div>
                  <div>商家名稱：{valueOf(ticket, 'ext_company_name')}</div>
                  <div>負責人姓名：{valueOf(ticket, 'ext_company_owner')}</div>
                  <div>是否涉及外部公司：{valueOf(ticket, 'external_collab')}</div>
                </div>
              </div>

              <div className="lg:w-72 space-y-3">
                <textarea
                  rows={3}
                  value={note[ticket.id] || ''}
                  onChange={(event) => setNote((previous) => ({ ...previous, [ticket.id]: event.target.value }))}
                  placeholder="處理備註"
                  className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                />
                <button
                  onClick={() => completeTicket(ticket.id)}
                  disabled={ticket.status === 'Completed' || actionLoading === ticket.id}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-3 rounded-xl font-semibold transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {actionLoading === ticket.id ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
                  {ticket.status === 'Completed' ? '已完成' : '完成結案'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
