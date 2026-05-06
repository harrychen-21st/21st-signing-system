import React, { useState } from 'react';
import { Mail, Loader2, CheckCircle, XCircle, Clock, FileText, Activity, User, ArrowRight, ListFilter, Printer } from 'lucide-react';

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
  logs?: AuditLog[]; // We will load logs lazily
}

const PrintableTicket = ({ ticket }: { ticket: MyTicket }) => {
  const formFields = Object.entries(ticket.formData || {}).filter(([k]) => k !== 'ALWAYS');
  
  // A mapping to translate some known field keys to readable labels if we want, mostly they will show their real values
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
    'AP': '簽呈單 (AP)',
    'RD': '請款單 (RD)',
    'CS': '用印申請單 (CS)'
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
                  <td className="py-2 px-4 border border-gray-300 font-bold text-sm">
                    {log.action === 'Approved' ? '核准' : log.action === 'Rejected' ? '駁回' : log.action}
                  </td>
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

export default function TrackDashboard() {
  const [email, setEmail] = useState('');
  const [tickets, setTickets] = useState<MyTicket[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [expandedTicketId, setExpandedTicketId] = useState<string | null>(null);
  const [loadingLogs, setLoadingLogs] = useState<Record<string, boolean>>({});
  const [printingTicketId, setPrintingTicketId] = useState<string | null>(null);

  const handlePrint = (ticketId: string) => {
    setPrintingTicketId(ticketId);
    setTimeout(() => {
      window.print();
      setPrintingTicketId(null);
    }, 300);
  };

  const fetchTickets = async () => {
    const val = email.toLowerCase().trim();
    if (!val || !val.includes('@')) {
      alert('請輸入有效的 Email');
      return;
    }

    setIsFetching(true);
    setHasSearched(true);
    try {
      const res = await fetch(`/api/tickets/my/${encodeURIComponent(val)}`);
      const data = await res.json();
      setTickets(data.tickets || []);
    } catch (error) {
      console.error("Failed to fetch tickets", error);
      alert("無法取得申請紀錄，請稍後再試。");
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
    
    const ticketIndex = tickets.findIndex(t => t.id === ticketId);
    if (ticketIndex > -1 && tickets[ticketIndex].logs) {
      return; // Already loaded
    }

    setLoadingLogs(prev => ({ ...prev, [ticketId]: true }));
    try {
      const res = await fetch(`/api/tickets/${ticketId}/logs`);
      const data = await res.json();
      setTickets(prev => prev.map(t => 
        t.id === ticketId ? { ...t, logs: data.logs } : t
      ));
    } catch (error) {
      console.error("Failed to load logs", error);
    } finally {
      setLoadingLogs(prev => ({ ...prev, [ticketId]: false }));
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
      {/* 正常畫面 - 列印時隱藏 */}
      <div className={`glass-panel rounded-2xl md:rounded-3xl p-5 sm:p-8 md:p-12 w-full max-w-5xl animate-slide-up z-10 print:hidden ${printingTicketId ? 'hidden' : ''}`}>
        <div className="text-center mb-8 md:mb-10">
        <h2 className="text-2xl md:text-3xl font-bold text-amber-900 flex items-center justify-center gap-3 mb-2">
          <Activity className="text-amber-500 w-8 h-8" /> 我的申請單進度追蹤
        </h2>
        <p className="text-slate-500 text-sm md:text-base tracking-wide">
          請輸入您的申請信箱，查看您所有送出單據目前的簽核狀態與歷程
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 mb-8">
        <div className="relative flex-grow">
          <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
          <input 
            type="email" 
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchTickets()}
            placeholder="e.g. test@company.com" 
            className="form-input w-full !pl-11"
          />
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
          <h3 className="font-bold text-slate-700 flex items-center gap-2">
            共找到 {tickets.length} 筆歷史申請
          </h3>
          {tickets.map(ticket => (
            <div key={ticket.id} className="bg-white border border-slate-200 rounded-2xl transition-all shadow-sm hover:shadow-md overflow-hidden">
               
               {/* Main Ticket Row */}
               <div className="p-5 md:p-6 flex flex-col md:flex-row gap-6 items-start md:items-center cursor-pointer" onClick={() => loadLogsAndExpand(ticket.id)}>
                <div className="flex-grow space-y-3 w-full">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="px-3 py-1 bg-blue-100 text-blue-700 text-xs font-bold rounded-lg tracking-wider">
                      {ticket.formType}
                    </span>
                    <span className="font-mono text-slate-500 text-sm font-medium">{ticket.id}</span>
                    <span className="text-xs text-slate-400">
                      送出於 {new Date(ticket.createdAt).toLocaleString()}
                    </span>
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
  
                {/* Status Section */}
                <div className="w-full md:w-auto md:min-w-[200px] flex items-center justify-between md:justify-end border-t md:border-t-0 md:border-l border-slate-100 pt-4 md:pt-0 md:pl-6">
                  {getStatusDisplay(ticket.status, ticket.currentApprover)}
                  <button className="md:hidden p-2 text-slate-400 bg-slate-50 rounded-lg ml-2"><ListFilter className="w-4 h-4"/></button>
                </div>
              </div>

              {/* Logs Expanded View */}
              {expandedTicketId === ticket.id && (
                <div className="border-t border-slate-100 bg-slate-50 p-6 animate-slide-up">
                  <h5 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
                    <ListFilter className="w-4 h-4 text-slate-400"/>
                    簽核歷程 (Audit Logs)
                  </h5>
                  {loadingLogs[ticket.id] ? (
                    <div className="flex items-center gap-2 text-sm text-slate-500 py-4"><Loader2 className="w-4 h-4 animate-spin"/> 載入中...</div>
                  ) : ticket.logs && ticket.logs.length > 0 ? (
                    <div className="space-y-4">
                      {ticket.logs.map((log, index) => (
                        <div key={index} className="flex gap-4 items-start">
                           <div className="flex flex-col items-center mt-1">
                             <div className="w-2 h-2 rounded-full bg-slate-300"></div>
                             {index !== ticket.logs!.length - 1 && <div className="w-[1px] h-full bg-slate-200 mt-1 min-h-[1.5rem]"></div>}
                           </div>
                           <div className="bg-white p-3 rounded-xl border border-slate-200 text-sm flex-grow shadow-sm">
                             <div className="flex justify-between items-center mb-1">
                               <span className="font-bold text-slate-800">{log.action || 'Unknown'} <span className="text-slate-400 font-normal ml-2">關卡: {log.stage}</span></span>
                               <span className="text-xs text-slate-400">{new Date(log.timestamp).toLocaleString()}</span>
                             </div>
                             <div className="text-slate-600 mb-1">
                               <span className="font-medium mr-1">操作人:</span> {log.approver}
                             </div>
                             {log.comment && (
                               <div className="mt-2 text-slate-700 bg-slate-50 p-2 rounded-lg border border-slate-100 font-medium">
                                 " {log.comment} "
                               </div>
                             )}
                           </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-slate-500 text-sm py-2 italic text-center w-full">尚無任何簽核紀錄</p>
                  )}
                  {ticket.status === 'Approved' && (
                     <div className="mt-6 text-center">
                       <button 
                         onClick={() => handlePrint(ticket.id)}
                         className="bg-slate-800 hover:bg-slate-700 text-white px-6 py-2 rounded-lg font-medium shadow-md transition-colors inline-flex items-center gap-2"
                        >
                         <Printer className="w-4 h-4" />
                         列印 / 匯出 PDF
                       </button>
                     </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      </div>

      {/* 列印用畫面 */}
      {printingTicketId && tickets.find(t => t.id === printingTicketId) && (
        <PrintableTicket ticket={tickets.find(t => t.id === printingTicketId)!} />
      )}
    </div>
  );
}
