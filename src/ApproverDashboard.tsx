import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle, FileSpreadsheet, FileText, Link2, Loader2, Mail, RefreshCw, Search, ShieldCheck } from 'lucide-react';
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
  amlResult?: string;
  amlComment?: string;
  rpResult?: string;
  rpComment?: string;
  relations?: RelationSummary[];
  attachmentWarnings?: AttachmentWarning[];
  formData?: Record<string, unknown>;
}

interface TicketBasic {
  id: string;
  createdAt: string;
  applicantName: string;
  dept: string;
  formType: string;
  status: string;
  subject: string;
}

interface RelationSummary {
  id: string;
  sourceTicketId: string;
  targetTicketId: string;
  relationType?: string;
  note?: string;
  direction: 'source' | 'target';
  linkedTicket?: TicketBasic | null;
}

interface AttachmentWarning {
  id?: string;
  fieldKey: string;
  url: string;
  versionNote?: string;
  warning?: string;
}

type Filters = {
  dept: string;
  formType: string;
  status: string;
  taxId: string;
  dateFrom: string;
  dateTo: string;
  relationId: string;
};

const statusLabels: Record<string, string> = {
  Submitted: '已送出',
  Checking: '查核中',
  ActionRequired: '需人工處理',
  Completed: '已完成',
  Cancelled: '已作廢',
  Pending: '舊資料：待處理',
  Approved: '舊資料：已結案',
  Rejected: '舊資料：退回補件',
};

const isCompletedStatus = (status: string) => status === 'Completed' || status === 'Approved';

function valueOf(ticket: Ticket, key: string) {
  const value = ticket.formData?.[key];
  return value == null || value === '' ? '-' : String(value);
}

function parseDateMs(value: string) {
  const match = String(value || '').match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (match) {
    const [, year, month, day, hour, minute, second = '0'] = match;
    return new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}:${second.padStart(2, '0')}+08:00`).getTime();
  }
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function displayCheckValue(value?: string) {
  const text = String(value || '').trim();
  return text || '尚無資料';
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
    ticket.amlResult,
    ticket.rpResult,
    ...(ticket.relations || []).map((relation) => `${relation.id} ${relation.sourceTicketId} ${relation.targetTicketId} ${relation.linkedTicket?.subject || ''}`),
    ...Object.values(ticket.formData || {}).map((value) => String(value ?? '')),
  ].join(' ').toLowerCase();

  return searchableText.includes(keyword);
}

function matchesFilters(ticket: Ticket, filters: Filters) {
  if (filters.dept && !ticket.dept.toLowerCase().includes(filters.dept.toLowerCase())) return false;
  if (filters.formType && ticket.formType !== filters.formType) return false;
  if (filters.status && ticket.status !== filters.status) return false;
  if (filters.taxId && !valueOf(ticket, 'ext_tax_id').toLowerCase().includes(filters.taxId.toLowerCase())) return false;
  if (filters.dateFrom && parseDateMs(ticket.createdAt) < new Date(`${filters.dateFrom}T00:00:00+08:00`).getTime()) return false;
  if (filters.dateTo && parseDateMs(ticket.createdAt) > new Date(`${filters.dateTo}T23:59:59+08:00`).getTime()) return false;
  if (filters.relationId) {
    const relationText = (ticket.relations || [])
      .map((relation) => `${relation.id} ${relation.sourceTicketId} ${relation.targetTicketId}`)
      .join(' ')
      .toLowerCase();
    if (!relationText.includes(filters.relationId.toLowerCase())) return false;
  }
  return true;
}

export default function ApproverDashboard({ user }: { user: any }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [filters, setFilters] = useState<Filters>({
    dept: '',
    formType: '',
    status: '',
    taxId: '',
    dateFrom: '',
    dateTo: '',
    relationId: '',
  });

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

  const filteredTickets = tickets.filter((ticket) => matchesTicketSearch(ticket, searchQuery) && matchesFilters(ticket, filters));
  const formTypeOptions = Array.from(new Set(tickets.map((ticket) => ticket.formType).filter(Boolean))).sort();
  const statusOptions = Array.from(new Set(tickets.map((ticket) => ticket.status).filter(Boolean))).sort();

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

  const updateFilter = (key: keyof Filters, value: string) => {
    setFilters((previous) => ({ ...previous, [key]: value }));
  };

  const exportAuditPackage = async () => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set('search', searchQuery.trim());
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
      const response = await authFetch(`/api/backoffice/audit-export?${params.toString()}`);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || '匯出失敗');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `audit-export-${new Date().toISOString().slice(0, 10)}.xls`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      console.error('Failed to export audit package', error);
      alert(error.message || '匯出稽核包失敗');
    } finally {
      setIsExporting(false);
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

      <div className="bg-white/70 border border-slate-200 rounded-2xl p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <input
            type="text"
            value={filters.dept}
            onChange={(event) => updateFilter('dept', event.target.value)}
            placeholder="部門"
            className="bg-white border border-slate-200 rounded-xl px-3 py-2.5 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
          />
          <select
            value={filters.formType}
            onChange={(event) => updateFilter('formType', event.target.value)}
            className="bg-white border border-slate-200 rounded-xl px-3 py-2.5 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
          >
            <option value="">全部表單</option>
            {formTypeOptions.map((formType) => (
              <option key={formType} value={formType}>{formType}</option>
            ))}
          </select>
          <select
            value={filters.status}
            onChange={(event) => updateFilter('status', event.target.value)}
            className="bg-white border border-slate-200 rounded-xl px-3 py-2.5 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
          >
            <option value="">全部狀態</option>
            {statusOptions.map((status) => (
              <option key={status} value={status}>{statusLabels[status] || status}</option>
            ))}
          </select>
          <input
            type="text"
            value={filters.taxId}
            onChange={(event) => updateFilter('taxId', event.target.value)}
            placeholder="統編"
            className="bg-white border border-slate-200 rounded-xl px-3 py-2.5 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
          />
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(event) => updateFilter('dateFrom', event.target.value)}
            className="bg-white border border-slate-200 rounded-xl px-3 py-2.5 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
          />
          <input
            type="date"
            value={filters.dateTo}
            onChange={(event) => updateFilter('dateTo', event.target.value)}
            className="bg-white border border-slate-200 rounded-xl px-3 py-2.5 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
          />
          <input
            type="text"
            value={filters.relationId}
            onChange={(event) => updateFilter('relationId', event.target.value)}
            placeholder="關聯 ID 或單號"
            className="bg-white border border-slate-200 rounded-xl px-3 py-2.5 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
          />
          <button
            onClick={exportAuditPackage}
            disabled={isExporting || filteredTickets.length === 0}
            className="bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl px-4 py-2.5 font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {isExporting ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileSpreadsheet className="w-5 h-5" />}
            匯出稽核包
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-500">目前篩選結果：{filteredTickets.length} / {tickets.length} 筆</p>
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
          <div
            key={ticket.id}
            className={`bg-white rounded-2xl p-6 shadow-sm border ${
              isCompletedStatus(ticket.status) ? 'border-emerald-200' : 'border-slate-200'
            }`}
          >
            <div className="flex flex-col lg:flex-row gap-6 justify-between">
              <div className="space-y-3 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-3 py-1 bg-blue-100 text-blue-700 text-xs font-bold rounded-lg">
                    {ticket.formType}
                  </span>
                  <span className="font-mono text-slate-500 text-sm">{ticket.id}</span>
                  <span
                    className={`px-3 py-1 text-xs font-bold rounded-lg ${
                      isCompletedStatus(ticket.status)
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-amber-50 text-amber-700'
                    }`}
                  >
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

                <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 pt-2">
                  <div className="rounded-xl border border-sky-100 bg-sky-50 p-3 text-sm">
                    <div className="flex items-center gap-2 font-bold text-sky-700 mb-2">
                      <ShieldCheck className="w-4 h-4" />
                      AML / 關係人
                    </div>
                    <p className="text-slate-700">AML：{displayCheckValue(ticket.amlResult)}</p>
                    <p className="text-slate-700">關係人：{displayCheckValue(ticket.rpResult)}</p>
                    {(ticket.amlComment || ticket.rpComment) && (
                      <p className="text-xs text-slate-500 mt-1 truncate">備註：{ticket.amlComment || ticket.rpComment}</p>
                    )}
                  </div>

                  <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-sm">
                    <div className="flex items-center gap-2 font-bold text-indigo-700 mb-2">
                      <Link2 className="w-4 h-4" />
                      關聯單號
                    </div>
                    {ticket.relations && ticket.relations.length > 0 ? (
                      <div className="space-y-1.5">
                        {ticket.relations.slice(0, 3).map((relation) => (
                          <div key={relation.id} className="text-slate-700">
                            <span className="font-mono font-semibold">{relation.linkedTicket?.id || (relation.direction === 'source' ? relation.targetTicketId : relation.sourceTicketId)}</span>
                            <span className="text-xs text-slate-500 ml-2">{relation.linkedTicket?.subject || ''}</span>
                          </div>
                        ))}
                        {ticket.relations.length > 3 && <p className="text-xs text-indigo-600">另有 {ticket.relations.length - 3} 筆</p>}
                      </div>
                    ) : (
                      <p className="text-slate-500">無關聯</p>
                    )}
                  </div>

                  <div className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-sm">
                    <div className="flex items-center gap-2 font-bold text-amber-700 mb-2">
                      <AlertTriangle className="w-4 h-4" />
                      附件警示
                    </div>
                    {ticket.attachmentWarnings && ticket.attachmentWarnings.length > 0 ? (
                      <ul className="space-y-1 list-disc pl-5 text-amber-800">
                        {ticket.attachmentWarnings.slice(0, 2).map((item, index) => (
                          <li key={`${item.fieldKey}-${index}`}>{item.warning || '請確認附件權限或網址'}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-slate-500">無警示</p>
                    )}
                  </div>
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
                  disabled={isCompletedStatus(ticket.status) || actionLoading === ticket.id}
                  className={`w-full px-4 py-3 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 ${
                    isCompletedStatus(ticket.status)
                      ? 'bg-slate-100 text-emerald-700 border border-emerald-200 cursor-not-allowed'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm shadow-emerald-500/20 disabled:opacity-70'
                  }`}
                >
                  {actionLoading === ticket.id ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
                  {isCompletedStatus(ticket.status) ? '已完成結案' : '完成結案'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
