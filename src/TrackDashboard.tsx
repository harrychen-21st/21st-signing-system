import React, { useEffect, useState } from 'react';
import { Mail, Loader2, CheckCircle, XCircle, Clock, FileText, Activity, ListFilter, Printer } from 'lucide-react';
import { apiGet } from './lib/api';
import { SessionUser } from './lib/session';

interface AuditLog {
  ticketId: string;
  action: string;
  approver: string;
  stage: string;
  comment: string;
  timestamp: string;
}

interface MyTicket {
  id: string;
  createdAt: string;
  applicantEmail: string;
  applicantName: string;
  dept: string;
  formType: string;
  subject: string;
  amount: string;
  status: string;
  stage: string;
  currentApprover: string;
  formData?: any;
  logs?: AuditLog[];
}

const PrintableTicket = ({ ticket }: { ticket: MyTicket }) => {
  const formFields = Object.entries(ticket.formData || {}).filter(([k]) => k !== 'ALWAYS');

  const getLabel = (key: string) => {
    const labels: Record<string, string> = {
      apSubject: '主旨',
      apDesc: '說明',
      external_collab: '是否與外部合作',
      ext_company_name: '外部公司名稱',
      ext_company_owner: '外部公司負責人',
      ext_tax_id: '統編',
      rd_ref_id: '對應案號/簽呈單號',
      rd_expense_type: '請款項目',
      amount: '請款金額',
      rd_vendor: '受款對象/廠商名',
      rd_deadline: '期望付款日期',
      rd_pay_method: '付款方式',
      rd_desc: '用途說明',
      rd_file_count: '附件數量',
      cs_ref_id: '對應核准單號',
      seal_type: '印章種類',
      cs_desc: '用印內容與說明'
    };
    return labels[key] || key;
  };

  const formNameMapping: Record<string, string> = {
    AP: '簽呈單 (AP)',
    RD: '請款單 (RD)',
    CS: '用印申請單 (CS)'
  };

  return (
    <div className="hidden print:block p-8 bg-white text-black min-h-screen">
      <div className="text-center mb-8 border-b-2 border-black pb-4">
        <h1 className="text-3xl font-bold">{formNameMapping[ticket.formType] || ticket.formType}</h1>
        <p className="text-sm mt-2 text-gray-600">系統單號：{ticket.id}</p>
      </div>

      <div className="mb-8">
        <h2 className="text-xl font-bold border-b border-gray-300 pb-2 mb-4">申請人資訊</h2>
        <div className="grid grid-cols-2 gap-4">
          <div><span className="font-bold">申請人：</span> {ticket.applicantName} ({ticket.applicantEmail})</div>
          <div><span className="font-bold">所屬部門：</span> {ticket.dept}</div>
          <div><span className="font-bold">申請時間：</span> {new Date(ticket.createdAt).toLocaleString()}</div>
          <div><span className="font-bold">表單狀態：</span> {ticket.status === 'Approved' ? '已結案 (核准)' : ticket.status}</div>
        </div>
      </div>

      <div className="mb-8 p-4 bg-gray-50 border border-gray-200">
        <h2 className="text-xl font-bold border-b border-gray-300 pb-2 mb-4">表單內容</h2>
        <table className="w-full text-left border-collapse">
          <tbody>
            {formFields.map(([key, value]) => (
              <tr key={key} className="border-b border-gray-200">
                <td className="py-2 px-4 font-bold bg-gray-100 w-1/3">{getLabel(key)}</td>
                <td className="py-2 px-4">{String(value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h2 className="text-xl font-bold border-b border-gray-300 pb-2 mb-4">簽核歷程</h2>
        {ticket.logs && ticket.logs.length > 0 ? (
          <table className="w-full text-left border-collapse border border-gray-300">
            <thead>
              <tr className="bg-gray-100 text-gray-700">
                <th className="py-2 px-4 border border-gray-300">時間</th>
                <th className="py-2 px-4 border border-gray-300">簽核人</th>
                <th className="py-2 px-4 border border-gray-300">動作</th>
                <th className="py-2 px-4 border border-gray-300">意見</th>
              </tr>
            </thead>
            <tbody>
              {ticket.logs.map((log, index) => (
                <tr key={index}>
                  <td className="py-2 px-4 border border-gray-300 text-sm">{new Date(log.timestamp).toLocaleString()}</td>
                  <td className="py-2 px-4 border border-gray-300 text-sm">{log.approver}</td>
                  <td className="py-2 px-4 border border-gray-300 font-bold text-sm">{log.action === 'Approved' ? '核准' : log.action === 'Rejected' ? '駁回' : log.action}</td>
                  <td className="py-2 px-4 border border-gray-300 text-sm whitespace-pre-wrap">{log.comment || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-gray-500">尚無紀錄</p>
        )}
      </div>

      <div className="mt-16 pt-8 border-t border-gray-400 text-center text-sm text-gray-500">
        此為系統自動產生之數位軌跡證明・列印時間：{new Date().toLocaleString()}
      </div>
    </div>
  );
};

export default function TrackDashboard({ sessionUser }: { sessionUser: SessionUser | null }) {
  const [tickets, setTickets] = useState<MyTicket[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [expandedTicketId, setExpandedTicketId] = useState<string | null>(null);
  const [loadingLogs, setLoadingLogs] = useState<Record<string, boolean>>({});
  const [printingTicketId, setPrintingTicketId] = useState<string | null>(null);

  useEffect(() => {
    if (sessionUser?.email) {
      fetchTickets();
    }
  }, [sessionUser?.email]);

  const handlePrint = (ticketId: string) => {
    setPrintingTicketId(ticketId);
    setTimeout(() => {
      window.print();
      setPrintingTicketId(null);
    }, 300);
  };

  const fetchTickets = async () => {
    const val = String(sessionUser?.email || '').toLowerCase().trim();
    if (!val || !val.includes('@')) {
      alert('請先登入公司 Email');
      return;
    }

    setIsFetching(true);
    setHasSearched(true);
    try {
      const data = await apiGet<{ tickets: MyTicket[] }>(`/api/tickets/my/${encodeURIComponent(val)}`);
      setTickets(data.tickets || []);
    } catch (error) {
      console.error('Failed to fetch tickets', error);
      alert('無法取得申請紀錄，請稍後再試。');
    } finally {
      setIsFetching(false);
    }
  };

  const loadLogsAndExpand = async (ticketId: string) => {
    if (expandedTicketId === ticketId) {
      setExpandedTicketId(null);
      return;
    }

    setExpandedTicketId(ticketId);

    const ticketIndex = tickets.findIndex((t) => t.id === ticketId);
    if (ticketIndex > -1 && tickets[ticketIndex].logs) {
      return;
    }

    setLoadingLogs((prev) => ({ ...prev, [ticketId]: true }));
    try {
      const data = await apiGet<{ logs: AuditLog[] }>(`/api/tickets/${encodeURIComponent(ticketId)}/logs`);
      setTickets((prev) => prev.map((ticket) => (ticket.id === ticketId ? { ...ticket, logs: data.logs || [] } : ticket)));
    } catch (error) {
      console.error('Failed to load logs', error);
    } finally {
      setLoadingLogs((prev) => ({ ...prev, [ticketId]: false }));
    }
  };

  const getStatusDisplay = (status: string, approver: string) => {
    if (status === 'Approved') {
      return (
        <span className="flex items-center gap-1.5 text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-lg font-medium text-sm">
          <CheckCircle className="w-4 h-4" /> 審核通過 (已結案)
        </span>
      );
    }
    if (status === 'Rejected') {
      return (
        <span className="flex items-center gap-1.5 text-rose-600 bg-rose-50 px-3 py-1.5 rounded-lg font-medium text-sm">
          <XCircle className="w-4 h-4" /> 已被駁回
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1.5 text-amber-600 bg-amber-50 px-3 py-1.5 rounded-lg font-medium text-sm">
        <Clock className="w-4 h-4" /> 簽核中 (目前關卡: {approver || '系統判定中'})
      </span>
    );
  };

  return (
    <div className="w-full">
      <div className={`glass-panel rounded-2xl md:rounded-3xl p-5 sm:p-8 md:p-12 w-full max-w-5xl animate-slide-up z-10 print:hidden ${printingTicketId ? 'hidden' : ''}`}>
        <div className="text-center mb-8 md:mb-10">
          <h2 className="text-2xl md:text-3xl font-bold text-amber-900 flex items-center justify-center gap-3 mb-2">
            <Activity className="text-amber-500 w-8 h-8" /> 我的申請單進度追蹤
          </h2>
          <p className="text-slate-500 text-sm md:text-base tracking-wide">
            系統將依照目前登入身份，查看您所有送出單據目前的簽核狀態與歷程
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 mb-8">
          <div className="relative flex-grow">
            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
            <div className="form-input w-full !pl-11 flex items-center text-slate-700 bg-slate-50">{sessionUser?.email || '尚未登入'}</div>
          </div>
          <button
            onClick={fetchTickets}
            disabled={isFetching}
            className="w-full sm:w-auto bg-amber-600 hover:bg-amber-500 text-white px-8 py-3 rounded-xl font-semibold transition-all disabled:opacity-70 flex items-center justify-center gap-2"
          >
            {isFetching ? <Loader2 className="w-5 h-5 animate-spin" /> : '查詢紀錄'}
          </button>
        </div>

        {hasSearched && !isFetching && tickets.length === 0 && (
          <div className="text-center py-12 bg-slate-50/50 rounded-2xl border border-slate-200 border-dashed">
            <div className="w-16 h-16 bg-amber-100 text-amber-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <FileText className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-semibold text-slate-700 mb-1">找不到任何申請紀錄</h3>
            <p className="text-slate-500">此信箱目前沒有送出過任何單據。</p>
          </div>
        )}

        {tickets.length > 0 && (
          <div className="space-y-4">
            <h3 className="font-bold text-slate-700 flex items-center gap-2">共找到 {tickets.length} 筆歷史申請</h3>
            {tickets.map((ticket) => (
              <div key={ticket.id} className="bg-white border border-slate-200 rounded-2xl transition-all shadow-sm hover:shadow-md overflow-hidden">
                <div className="p-5 md:p-6 flex flex-col md:flex-row gap-6 items-start md:items-center cursor-pointer" onClick={() => loadLogsAndExpand(ticket.id)}>
                  <div className="flex-grow space-y-3 w-full">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="px-3 py-1 bg-blue-100 text-blue-700 text-xs font-bold rounded-lg tracking-wider">{ticket.formType}</span>
                      <span className="font-mono text-slate-500 text-sm font-medium">{ticket.id}</span>
                      <span className="text-xs text-slate-400">送出於 {new Date(ticket.createdAt).toLocaleString()}</span>
                    </div>

                    <h4 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                      <FileText className="w-5 h-5 text-slate-400" />
                      {ticket.subject || '(未提供主旨)'}
                      {ticket.amount && (
                        <span className="text-sm font-medium text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-md ml-2 border border-emerald-100/50">
                          TWD {Number(ticket.amount).toLocaleString()}
                        </span>
                      )}
                    </h4>
                  </div>

                  <div className="w-full md:w-auto md:min-w-[200px] flex items-center justify-between md:justify-end border-t md:border-t-0 md:border-l border-slate-100 pt-4 md:pt-0 md:pl-6">
                    {getStatusDisplay(ticket.status, ticket.currentApprover)}
                    <button className="md:hidden p-2 text-slate-400 bg-slate-50 rounded-lg ml-2"><ListFilter className="w-4 h-4" /></button>
                  </div>
                </div>

                {expandedTicketId === ticket.id && (
                  <div className="border-t border-slate-100 bg-slate-50 p-6 animate-slide-up">
                    <h5 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
                      <ListFilter className="w-4 h-4 text-slate-400" />
                      簽核歷程 (Audit Logs)
                    </h5>
                    {loadingLogs[ticket.id] ? (
                      <div className="text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> 讀取中...</div>
                    ) : (
                      <div className="space-y-3">
                        {(ticket.logs || []).map((log, index) => (
                          <div key={index} className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                            <div className="font-semibold text-slate-800">{log.action}</div>
                            <div>{log.approver}</div>
                            <div>{new Date(log.timestamp).toLocaleString()}</div>
                            <div className="whitespace-pre-wrap">{log.comment || '-'}</div>
                          </div>
                        ))}
                        {(!ticket.logs || ticket.logs.length === 0) && <div className="text-slate-500">尚無簽核紀錄</div>}
                      </div>
                    )}
                    <div className="mt-4 flex justify-end">
                      <button onClick={() => handlePrint(ticket.id)} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
                        <Printer className="w-4 h-4" /> 列印
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {printingTicketId && (() => {
        const ticket = tickets.find((item) => item.id === printingTicketId);
        return ticket ? <PrintableTicket ticket={ticket} /> : null;
      })()}
    </div>
  );
}
