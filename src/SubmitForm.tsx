import React, { useState, useEffect } from 'react';
import { Mail, Briefcase, User, Send, Loader2, FileSignature, CheckCircle, Upload, XCircle } from 'lucide-react';

export default function SubmitForm() {
  const [email, setEmail] = useState('');
  const [user, setUser] = useState<{name: string; dept: string; manager: string; roles: string} | null>(null);
  const [isFetchingUser, setIsFetchingUser] = useState(false);
  const [userError, setUserError] = useState('');
  
  const [formType, setFormType] = useState('AP'); 
  const [formTypesData, setFormTypesData] = useState<{id: string, name: string}[]>([]);
  const [formDefinitions, setFormDefinitions] = useState<any[]>([]);
  const [dynamicData, setDynamicData] = useState<Record<string, any>>({});
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [generatedTicketId, setGeneratedTicketId] = useState('');

  useEffect(() => {
    Promise.all([
      fetch('/api/form-types').then(res => res.json()),
      fetch('/api/form-definitions').then(res => res.json())
    ]).then(([typesData, defsData]) => {
      if (typesData.formTypes && typesData.formTypes.length > 0) {
        setFormTypesData(typesData.formTypes);
        setFormType(typesData.formTypes[0].id);
      }
      setFormDefinitions(defsData.definitions || []);
    });
  }, []);

  const currentDef = formDefinitions.find(d => d.formId === formType);

  // 1. AP 簽呈單欄位 (Legacy Support)
  const [apExternal, setApExternal] = useState(false);
  const [apExtName, setApExtName] = useState('');
  const [apExtOwner, setApExtOwner] = useState('');
  const [apExtTaxId, setApExtTaxId] = useState('');
  const [apSubject, setApSubject] = useState('');
  const [apDesc, setApDesc] = useState('');

  // 2. RD 請款單欄位 (Legacy Support)
  const [rdRefId, setRdRefId] = useState('');
  const [rdExpenseType, setRdExpenseType] = useState('代墊費用');
  const [rdAmount, setRdAmount] = useState('');
  const [rdPayMethod, setRdPayMethod] = useState('');
  const [rdDesc, setRdDesc] = useState('');
  const [rdFileCount, setRdFileCount] = useState(0);

  // 3. CS 用印申請單欄位 (Legacy Support)
  const [csRefId, setCsRefId] = useState('');
  const [csSealType, setCsSealType] = useState('經濟部章');
  const [csDesc, setCsDesc] = useState('');

  const fetchUser = async (userEmail: string) => {
    setIsFetchingUser(true);
    setUserError('');
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(userEmail.toLowerCase())}`);
      const data = await res.json();
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
    const randomSuffix = Math.floor(1000 + Math.random() * 9000).toString();
    const ticketId = `${formType}-${yyyymmdd}-${randomSuffix}`;
    
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
            formData = { ALWAYS: "TRUE", apSubject, apDesc, external_collab: apExternal.toString(), ext_company_name: apExtName, ext_company_owner: apExtOwner, ext_tax_id: apExtTaxId };
        } else if (formType === 'RD') {
            subject = `請款單: ${rdExpenseType}`;
            amount = rdAmount;
            formData = { ALWAYS: "TRUE", rd_ref_id: rdRefId, rd_expense_type: rdExpenseType, amount: Number(rdAmount), pay_method: rdPayMethod, description: rdDesc, file_count: rdFileCount };
        } else if (formType === 'CS') {
            subject = `用印申請: ${csSealType}`;
            formData = { ALWAYS: "TRUE", cs_ref_id: csRefId, cs_seal_type: csSealType, description: csDesc };
        }
    }

    try {
        const res = await fetch('/api/submit-approval', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                applicantEmail: email,
                applicantName: user.name,
                department: user.dept,
                tickets: [
                  { id: ticketId, formType, subject, amount, formData }
                ]
            })
        });

        if (!res.ok) throw new Error('Submission failed');
        setSubmitSuccess(true);
        setGeneratedTicketId(ticketId);
    } catch (error) {
        console.error("Error submitting form", error);
        alert("送出失敗");
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
          <input 
            type="email" value={email} onChange={(e) => setEmail(e.target.value)} onBlur={handleEmailBlur}
            placeholder="請輸入申請人 Email" className="form-input flex-grow !h-14 !text-lg"
          />
          <button onClick={() => fetchUser(email)} disabled={isFetchingUser} className="bg-slate-800 text-white px-8 h-14 rounded-xl font-bold">
            {isFetchingUser ? <Loader2 size={24} className="animate-spin" /> : '驗證身分'}
          </button>
        </div>
        {userError && <p className="text-amber-600 mt-3 text-sm font-medium">{userError}</p>}
      </div>

      {user && (
        <form onSubmit={handleSubmit} className="space-y-10 animate-fade-in">
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
                    <textarea className="form-input" rows={4} placeholder="簽呈內容說明" value={apDesc} onChange={e => setApDesc(e.target.value)} required />
                 </div>
               ) : formType === 'RD' ? (
                 <div className="space-y-6">
                    <h3 className="text-xl font-bold">RD 請款單</h3>
                    <input className="form-input" placeholder="請款金額" type="number" value={rdAmount} onChange={e => setRdAmount(e.target.value)} required />
                    <textarea className="form-input" rows={3} placeholder="用途說明" value={rdDesc} onChange={e => setRdDesc(e.target.value)} required />
                 </div>
               ) : formType === 'CS' ? (
                 <div className="space-y-6">
                    <h3 className="text-xl font-bold">CS 用印申請單</h3>
                    <select className="form-input" value={csSealType} onChange={e => setCsSealType(e.target.value)}>
                       <option value="經濟部章">經濟部章</option><option value="銀行用章">銀行用章</option>
                    </select>
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
