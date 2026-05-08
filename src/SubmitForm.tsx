import React, { useState, useEffect } from 'react';
import { Mail, Briefcase, User, Send, Loader2, FileSignature, CheckCircle, Upload, XCircle } from 'lucide-react';
import { apiGet, apiPost } from './lib/api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function SubmitForm({ initialEmail = '' }: { initialEmail?: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [user, setUser] = useState<{name: string; dept: string; manager: string; roles: string} | null>(null);
  const [isFetchingUser, setIsFetchingUser] = useState(false);
  const [userError, setUserError] = useState('');
  
  const [formType, setFormType] = useState('AP'); 
  const [formTypesData, setFormTypesData] = useState<{id: string, name: string}[]>([]);
  const [formDefinitions, setFormDefinitions] = useState<any[]>([]);
  const [dynamicData, setDynamicData] = useState<Record<string, any>>({});
  const [noticeBoard, setNoticeBoard] = useState<Array<{ id: string; title: string; content: string; publishedAt: string }>>([]);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [generatedTicketId, setGeneratedTicketId] = useState('');

  useEffect(() => {
    if (initialEmail && initialEmail !== email) {
      setEmail(initialEmail);
      fetchUser(initialEmail);
    }
  }, [initialEmail]);

  useEffect(() => {
    Promise.all([
      apiGet<{formTypes: {id: string; name: string}[]}>('/api/form-types', { action: 'getFormTypes' }),
      apiGet<any>('/api/form-definitions', { action: 'getData', sheet: 'FormDefinitions' })
    ]).then(([typesData, defsData]) => {
      if (typesData.formTypes && typesData.formTypes.length > 0) {
        setFormTypesData(typesData.formTypes);
        setFormType(typesData.formTypes[0].id);
      }
      const rows = defsData.data || defsData.definitions || [];
      const definitions = Array.isArray(rows) && rows.length > 0 && Array.isArray(rows[0])
        ? rows.slice(1).map((r: any) => ({
            formId: r[0],
            fieldsMarkdown: r[1],
            logicMarkdown: r[2],
            configJSON: r[3] ? JSON.parse(r[3]) : null,
          }))
        : rows;
      setFormDefinitions(definitions || []);
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    apiGet<{ success: boolean; value: string }>('/api/settings/NoticeBoard', { action: 'getSetting', key: 'NoticeBoard' })
      .then((data) => {
        try {
          const parsed = JSON.parse(data.value || '[]');
          setNoticeBoard(Array.isArray(parsed) ? parsed : []);
        } catch {
          setNoticeBoard(data.value ? [{ id: 'legacy', title: '公告欄', content: data.value, publishedAt: '' }] : []);
        }
      })
      .catch(() => setNoticeBoard([]));
  }, [user]);

  const currentDef = formDefinitions.find(d => d.formId === formType);

  // 1. AP 簽呈單欄位 (Legacy Support)
  const [apExternal, setApExternal] = useState(false);
  const [apExtName, setApExtName] = useState('');
  const [apExtOwner, setApExtOwner] = useState('');
  const [apExtTaxId, setApExtTaxId] = useState('');
  const [apSubject, setApSubject] = useState('');
  const [apDesc, setApDesc] = useState('');
  const [apAmount, setApAmount] = useState('');

  // 2. RD 請款單欄位 (Legacy Support)
  const [rdRefId, setRdRefId] = useState('');
  const [rdExpenseType, setRdExpenseType] = useState('代墊費用');
  const [rdAmount, setRdAmount] = useState('');
  const [rdPayMethod, setRdPayMethod] = useState('');
  const [rdDesc, setRdDesc] = useState('');
  const [rdFileCount, setRdFileCount] = useState(0);
  const [rdVendor, setRdVendor] = useState('');
  const [rdBoardApproved, setRdBoardApproved] = useState('NA');

  // 3. CS 用印申請單欄位 (Legacy Support)
  const [csRefId, setCsRefId] = useState('');
  const [csSealType, setCsSealType] = useState('經濟部章');
  const [csDesc, setCsDesc] = useState('');
  const [csExternalParty, setCsExternalParty] = useState('');

  const fetchUser = async (userEmail: string) => {
    setIsFetchingUser(true);
    setUserError('');
    try {
      const data = await apiGet<any>(`/api/users/${encodeURIComponent(userEmail.toLowerCase())}`, {
        action: 'getUser',
        email: userEmail.toLowerCase(),
      });
      if (data.success) {
        setUser(data.user);
      } else {
        setUser(null);
        setUserError('查無此信箱，請重新確認帳號資訊。');
      }
    } catch (err) {
      setUser(null);
      setUserError('系統連線發生錯誤');
    } finally {
      setIsFetchingUser(false);
    }
  };

  const handleEmailBlur = () => {
    if (email && email.includes('@')) fetchUser(email);
  }

  const handleDynamicChange = (fieldId: string, value: any) => {
    setDynamicData(prev => ({ ...prev, [fieldId]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
        alert('請先輸入有效的 Email 以載入員工資料');
        return;
    }
    
    setIsSubmitting(true);
    
    const today = new Date();
    const yyyymmdd = today.toISOString().split('T')[0].replace(/-/g, '');
    const deptCodeMatch = user.dept.match(/^([A-Za-z0-9]+)/);
    const deptCode = (deptCodeMatch?.[1] || 'GEN').toUpperCase();
    const randomSuffix = Math.random().toString(36).slice(2, 6);
    const ticketId = `${formType}${deptCode}${yyyymmdd}${randomSuffix}`;
    
    let subject = '';
    let amount = '';
    let formData: any = {};
    
    // 組裝資料 (優先使用動態規格)
    if (currentDef && currentDef.configJSON && !['AP', 'RD', 'CS'].includes(formType)) {
        subject = `${formTypesData.find(f => f.id === formType)?.name || formType} 申請 - ${user.name}`;
        formData = { ...dynamicData, ALWAYS: "TRUE" };
        if (dynamicData.amount) amount = dynamicData.amount.toString();
    } else {
        // Legacy Native logic
        if (formType === 'AP') {
            subject = apSubject;
            amount = apAmount;
            formData = { ALWAYS: "TRUE", apSubject, apDesc, amount: Number(apAmount || 0), external_collab: apExternal.toString(), ext_company_name: apExtName, ext_company_owner: apExtOwner, ext_tax_id: apExtTaxId };
        } else if (formType === 'RD') {
            subject = `請款單: ${rdExpenseType}`;
            amount = rdAmount;
            formData = { ALWAYS: "TRUE", rd_ref_id: rdRefId, rd_expense_type: rdExpenseType, amount: Number(rdAmount), pay_method: rdPayMethod, description: rdDesc, file_count: rdFileCount, vendor_name: rdVendor, board_approved: rdBoardApproved };
        } else if (formType === 'CS') {
            subject = `用印申請: ${csSealType}`;
            formData = { ALWAYS: "TRUE", cs_ref_id: csRefId, seal_type: csSealType, description: csDesc, external_party: csExternalParty };
        }
    }

    try {
        const result = await apiPost<{ success: boolean; generatedIds?: string[] }>('/api/submit-approval', {
            applicantEmail: email,
            applicantName: user.name,
            department: user.dept,
            tickets: [
              { id: ticketId, formType, subject, amount, formData }
            ]
        });
        setSubmitSuccess(true);
        setGeneratedTicketId(result.generatedIds?.[0] || ticketId);
    } catch (error) {
        console.error("Error submitting form", error);
        alert(`送出失敗: ${error instanceof Error ? error.message : '未知錯誤'}`);
    } finally {
        setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setSubmitSuccess(false);
    setDynamicData({});
    setApSubject(''); setApDesc(''); setRdAmount(''); setCsDesc('');
  };

  if (submitSuccess) {
    return (
      <div className="glass-panel p-12 text-center max-w-2xl w-full mx-auto animate-slide-up rounded-2xl md:rounded-3xl border border-emerald-100 shadow-xl">
        <CheckCircle className="w-16 h-16 text-emerald-500 mx-auto mb-6" />
        <h2 className="text-3xl font-bold text-slate-800 mb-4">申請已成功送出！</h2>
        <p className="text-slate-500 mb-8 text-lg">您的單號是 <span className="font-mono bg-slate-100 px-3 py-1 rounded-lg text-slate-700 font-bold">{generatedTicketId}</span></p>
        <button onClick={handleReset} className="bg-emerald-600 hover:bg-emerald-500 text-white px-8 py-3 rounded-xl font-bold">發起另一筆申請</button>
      </div>
    );
  }

  return (
    <div className="glass-panel rounded-2xl md:rounded-3xl p-5 sm:p-8 md:p-12 w-full max-w-4xl animate-slide-up relative z-10 mx-auto">
      <div className="text-center mb-8">
        <h2 className="text-2xl md:text-3xl font-bold text-slate-800 flex items-center justify-center gap-3">
          <FileSignature className="text-emerald-500 w-8 h-8" /> 線上表單申請系統
        </h2>
      </div>

      <div className="mb-10 bg-white/60 p-6 rounded-2xl border border-slate-200">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="form-input flex-grow !h-14 !text-lg flex items-center text-slate-700 bg-slate-50">{email || '尚未登入'}</div>
          <button onClick={() => fetchUser(email)} disabled={isFetchingUser || !email} className="bg-slate-800 text-white px-8 h-14 rounded-xl font-bold disabled:opacity-60">
            {isFetchingUser ? <Loader2 size={24} className="animate-spin" /> : '重新載入身份'}
          </button>
        </div>
        {userError && <p className="text-amber-600 mt-3 text-sm font-medium">{userError}</p>}
      </div>

      {user && (
        <form onSubmit={handleSubmit} className="space-y-10 animate-fade-in">
          {noticeBoard.length > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-5 text-sm text-slate-700">
              <div className="mb-3 text-sm font-bold text-amber-700">公告欄</div>
              <div className="space-y-4">
                {noticeBoard.map((notice) => (
                  <div key={notice.id} className="rounded-xl border border-amber-100 bg-white/70 p-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="font-bold text-slate-800">{notice.title}</div>
                      <div className="text-xs text-slate-400">{notice.publishedAt ? new Date(notice.publishedAt).toLocaleString() : ''}</div>
                    </div>
                    <div className="prose prose-sm max-w-none prose-p:my-2 prose-ul:my-2 prose-strong:text-slate-800 prose-a:text-amber-700">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{notice.content}</ReactMarkdown>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-emerald-50 border border-emerald-100 p-5 rounded-2xl flex items-center gap-4">
              <User className="text-emerald-500" />
              <div><span className="text-xs font-bold text-emerald-600 uppercase">申請人</span><p className="font-bold text-lg">{user.name}</p></div>
            </div>
            <div className="bg-emerald-50 border border-emerald-100 p-5 rounded-2xl flex items-center gap-4">
              <Briefcase className="text-emerald-500" />
              <div><span className="text-xs font-bold text-emerald-600 uppercase">部門</span><p className="font-bold text-lg">{user.dept}</p></div>
            </div>
          </div>

          <div className="space-y-4">
            <label className="block text-slate-800 font-bold text-lg">選擇表單種類</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {formTypesData.map(ft => (
                <button
                  key={ft.id} type="button" onClick={() => setFormType(ft.id)}
                  className={`p-5 rounded-2xl border-2 text-center transition-all ${formType === ft.id ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-600'}`}
                >
                  <span className="block font-bold text-xl">{ft.name.split(' (')[0]}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 表單內容 */}
          <div className="bg-white/40 p-8 rounded-3xl border border-slate-100 shadow-sm min-h-[200px]">
             {currentDef && !['AP', 'RD', 'CS'].includes(formType) ? (
               <div className="space-y-6">
                 <h3 className="text-xl font-bold text-slate-800 border-b pb-4 mb-6">{currentDef.formId} {formTypesData.find(f => f.id === formType)?.name}</h3>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {currentDef.configJSON?.fields?.map((f: any) => (
                      <div key={f.id} className={f.type === 'textarea' ? 'md:col-span-2' : ''}>
                        <label className="block text-slate-700 font-bold mb-2">{f.label}{f.required && ' *'}</label>
                        {f.type === 'select' ? (
                          <select className="form-input" required={f.required} onChange={e => handleDynamicChange(f.id, e.target.value)}>
                            <option value="">請選擇</option>
                            {f.options?.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
                          </select>
                        ) : f.type === 'textarea' ? (
                          <textarea className="form-input" rows={4} required={f.required} onChange={e => handleDynamicChange(f.id, e.target.value)} />
                        ) : (
                          <input type={f.type} className="form-input" required={f.required} onChange={e => handleDynamicChange(f.id, e.target.value)} />
                        )}
                      </div>
                    ))}
                 </div>
               </div>
             ) : (
               // Legacy Native Forms
                formType === 'AP' ? (
                  <div className="space-y-6">
                     <h3 className="text-xl font-bold">AP 簽呈單</h3>
                     <input className="form-input" placeholder="簽呈主旨" value={apSubject} onChange={e => setApSubject(e.target.value)} required />
                     <input className="form-input" placeholder="預估金額" type="number" value={apAmount} onChange={e => setApAmount(e.target.value)} />
                     <textarea className="form-input" rows={4} placeholder="簽呈內容說明" value={apDesc} onChange={e => setApDesc(e.target.value)} required />
                     <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
                       <input type="checkbox" checked={apExternal} onChange={e => setApExternal(e.target.checked)} />
                       是否涉及外部合作廠商 / 第三方對象
                     </label>
                     {apExternal && (
                       <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                         <input className="form-input" placeholder="合作廠商名稱" value={apExtName} onChange={e => setApExtName(e.target.value)} required />
                         <input className="form-input" placeholder="負責人 / 聯絡窗口" value={apExtOwner} onChange={e => setApExtOwner(e.target.value)} required />
                         <input className="form-input md:col-span-2" placeholder="統一編號 / 識別碼" value={apExtTaxId} onChange={e => setApExtTaxId(e.target.value)} />
                       </div>
                     )}
                  </div>
                ) : formType === 'RD' ? (
                  <div className="space-y-6">
                     <h3 className="text-xl font-bold">RD 請款單</h3>
                     <input className="form-input" placeholder="對應申請 / 專案單號" value={rdRefId} onChange={e => setRdRefId(e.target.value)} />
                     <select className="form-input" value={rdExpenseType} onChange={e => setRdExpenseType(e.target.value)}>
                       <option value="代墊費用">代墊費用</option>
                       <option value="採購付款">採購付款</option>
                       <option value="合作費用">合作費用</option>
                       <option value="顧問服務費">顧問服務費</option>
                     </select>
                     <input className="form-input" placeholder="請款金額" type="number" value={rdAmount} onChange={e => setRdAmount(e.target.value)} required />
                     <input className="form-input" placeholder="受款對象 / 廠商名稱" value={rdVendor} onChange={e => setRdVendor(e.target.value)} required />
                     <select className="form-input" value={rdPayMethod} onChange={e => setRdPayMethod(e.target.value)}>
                       <option value="">請選擇付款方式</option>
                       <option value="轉帳">轉帳</option>
                       <option value="匯款">匯款</option>
                       <option value="零用金">零用金</option>
                     </select>
                     <textarea className="form-input" rows={3} placeholder="用途說明" value={rdDesc} onChange={e => setRdDesc(e.target.value)} required />
                     <select className="form-input" value={rdBoardApproved} onChange={e => setRdBoardApproved(e.target.value)}>
                       <option value="NA">非關係人交易 / 不適用</option>
                       <option value="YES">關係人交易且已董事會同意</option>
                       <option value="NO">關係人交易但尚未董事會同意</option>
                     </select>
                  </div>
                ) : formType === 'CS' ? (
                  <div className="space-y-6">
                     <h3 className="text-xl font-bold">CS 用印申請單</h3>
                     <input className="form-input" placeholder="對應核准單號" value={csRefId} onChange={e => setCsRefId(e.target.value)} />
                     <select className="form-input" value={csSealType} onChange={e => setCsSealType(e.target.value)}>
                        <option value="經濟部章">經濟部章</option>
                        <option value="銀行用章">銀行用章</option>
                        <option value="法務章">法務章</option>
                        <option value="合約便章">合約便章</option>
                     </select>
                     <input className="form-input" placeholder="外部往來對象 / 文件相對人" value={csExternalParty} onChange={e => setCsExternalParty(e.target.value)} />
                     <textarea className="form-input" rows={4} placeholder="文件說明" value={csDesc} onChange={e => setCsDesc(e.target.value)} required />
                  </div>
               ) : <div className="text-slate-400 italic">尚未定義此表單規格</div>
             )}
          </div>

          <button type="submit" disabled={isSubmitting} className="w-full bg-slate-900 text-white py-4 rounded-xl font-bold text-lg">
             {isSubmitting ? '單據派送中...' : '送交系統執行簽核'}
          </button>
        </form>
      )}
    </div>
  );
}
