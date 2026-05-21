import React, { useState, useEffect } from 'react';
import { Mail, Briefcase, User, Send, Loader2, FileSignature, CheckCircle, Upload, XCircle, Megaphone } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { authFetch } from './authFetch';

export default function SubmitForm({ user }: { user: any }) {
  const [formType, setFormType] = useState('AP'); 
  const [formTypesData, setFormTypesData] = useState<{id: string, name: string}[]>([]);
  const [formDefinitions, setFormDefinitions] = useState<any[]>([]);
  const [dynamicData, setDynamicData] = useState<Record<string, any>>({});
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [generatedTicketId, setGeneratedTicketId] = useState('');
  const [noticeBoard, setNoticeBoard] = useState('');

  const [ubnLoading, setUbnLoading] = useState(false);
  const [ubnSuccess, setUbnSuccess] = useState(false);

  useEffect(() => {
    Promise.all([
      authFetch('/api/form-types').then(res => res.json()),
      authFetch('/api/form-definitions').then(res => res.json()),
      authFetch('/api/settings/NoticeBoard').then(res => res.json()).catch(() => ({ value: '' }))
    ]).then(([typesData, defsData, noticeData]) => {
      if (typesData.formTypes && typesData.formTypes.length > 0) {
        setFormTypesData(typesData.formTypes);
        setFormType(typesData.formTypes[0].id);
      }
      setFormDefinitions(defsData.definitions || []);
      setNoticeBoard(noticeData.value || '');
    });
  }, []);

  const currentDef = formDefinitions.find(d => d.formId === formType);

  const handleDynamicChange = (fieldId: string, value: any) => {
    setDynamicData(prev => {
      const next = { ...prev, [fieldId]: value };
      if (fieldId === 'external_collab') {
        if (value === '是') {
          delete next.vendor_name;
        } else {
          delete next.ext_tax_id;
          delete next.ext_company_name;
          delete next.ext_company_owner;
          setUbnSuccess(false);
        }
      }
      return next;
    });

    if (fieldId === 'ext_tax_id') {
      const taxId = value.trim();
      if (/^\d{8}$/.test(taxId)) {
        setUbnLoading(true);
        setUbnSuccess(false);
        authFetch(`/api/company/${taxId}`)
          .then(res => {
            if (!res.ok) throw new Error('API error');
            return res.json();
          })
          .then(data => {
            if (data.success) {
              setDynamicData(prev => ({
                ...prev,
                ext_company_name: data.name,
                ext_company_owner: data.owner
              }));
              setUbnSuccess(true);
            }
          })
          .catch(err => {
            console.error("UBN lookup failed:", err);
          })
          .finally(() => {
            setUbnLoading(false);
          });
      } else {
        setUbnSuccess(false);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    setIsSubmitting(true);
    
    const today = new Date();
    const yyyymmdd = today.toISOString().split('T')[0].replace(/-/g, '');
    // 提取部門代號，例如 "MK;行銷企劃部" -> "MK"
    const deptCode = user.dept.split(';')[0].toUpperCase().trim() || 'XX';
    // 使用 3 碼隨機數作為偽流水號 (001~999)
    const randomSeq = Math.floor(1 + Math.random() * 999).toString().padStart(3, '0');
    const ticketId = `${formType}${deptCode}${yyyymmdd}${randomSeq}`;
    
    let subject = '';
    let amount = '';
    let formData: any = {};
    
    // 組裝資料 (全面使用動態規格)
    if (currentDef && currentDef.configJSON) {
        subject = formData.subject || `${formTypesData.find(f => f.id === formType)?.name || formType} 申請 - ${user.name}`;
        formData = { ...dynamicData, ALWAYS: "TRUE" };
        if (dynamicData.amount) amount = dynamicData.amount.toString();
        // 如果動態表單內有 subject 欄位，優先拿來當標題
        if (dynamicData.subject) subject = dynamicData.subject;
    } else {
        alert("找不到此表單的定義設定！");
        setIsSubmitting(false);
        return;
    }

    try {
        const res = await authFetch('/api/submit-approval', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                applicantEmail: user.email,
                applicantName: user.name,
                department: user.dept,
                tickets: [
                  { id: ticketId, formType, subject, amount, formData }
                ]
            })
        });

        if (!res.ok) throw new Error('Submission failed');
        const data = await res.json();
        setSubmitSuccess(true);
        setGeneratedTicketId(data.generatedIds ? data.generatedIds[0] : ticketId);
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
    setUbnSuccess(false);
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

      {/* 系統公告佈告欄 */}
      {noticeBoard && (
        <div className="bg-amber-50/80 border border-amber-200 p-5 rounded-2xl mb-8 flex gap-4 animate-fade-in shadow-sm">
          <Megaphone className="text-amber-500 w-6 h-6 flex-shrink-0 mt-1" />
          <div className="prose prose-sm prose-amber max-w-none prose-a:text-amber-600 prose-a:font-bold prose-p:my-1 prose-ul:my-1">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{noticeBoard}</ReactMarkdown>
          </div>
        </div>
      )}

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
                  key={ft.id} type="button" onClick={() => {
                    setFormType(ft.id);
                    setDynamicData({});
                    setUbnSuccess(false);
                  }}
                  className={`p-5 rounded-2xl border-2 text-center transition-all ${formType === ft.id ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-600'}`}
                >
                  <span className="block font-bold text-xl">{ft.name.split(' (')[0]}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 表單內容 */}
          <div className="bg-white/40 p-8 rounded-3xl border border-slate-100 shadow-sm min-h-[200px]">
             {currentDef ? (
                <div className="space-y-6">
                  <h3 className="text-xl font-bold text-slate-800 border-b pb-4 mb-6">{currentDef.formId} {formTypesData.find(f => f.id === formType)?.name}</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                     {currentDef.configJSON?.fields?.filter((f: any) => {
                        if (f.showIf) {
                           const parentVal = dynamicData[f.showIf.field];
                           if (f.showIf.value === '否') {
                              return parentVal === '否' || !parentVal;
                           }
                           return parentVal === f.showIf.value;
                        }
                        return true;
                     }).map((f: any) => (
                      <div key={f.id} className={f.type === 'textarea' ? 'md:col-span-2' : ''}>
                        <label className="block text-slate-700 font-bold mb-2">{f.label}{f.required && ' *'}</label>
                        {f.type === 'select' ? (
                          <select 
                            className="form-input !pl-4" 
                            required={f.required} 
                            value={dynamicData[f.id] || ''} 
                            onChange={e => handleDynamicChange(f.id, e.target.value)}
                          >
                            <option value="">請選擇</option>
                            {f.options?.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
                          </select>
                        ) : f.type === 'textarea' ? (
                          <textarea 
                            className="form-input !pl-4" 
                            rows={4} 
                            required={f.required} 
                            value={dynamicData[f.id] || ''} 
                            onChange={e => handleDynamicChange(f.id, e.target.value)} 
                          />
                        ) : (
                          <div className="relative">
                            <input 
                              type={f.type} 
                              className={`form-input ${f.id === 'ext_tax_id' ? '!pl-4 !pr-12' : '!pl-4'}`} 
                              required={f.required} 
                              value={dynamicData[f.id] || ''} 
                              onChange={e => handleDynamicChange(f.id, e.target.value)} 
                            />
                            {f.id === 'ext_tax_id' && (ubnLoading || ubnSuccess) && (
                              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center">
                                {ubnLoading && <Loader2 className="w-5 h-5 text-emerald-500 animate-spin" />}
                                {ubnSuccess && <CheckCircle className="w-5 h-5 text-emerald-500 animate-pop-in" />}
                              </div>
                            )}
                          </div>
                        )}
                        {f.id === 'ext_tax_id' && ubnSuccess && (
                          <p className="text-xs text-emerald-600 mt-1.5 flex items-center gap-1 animate-fade-in font-medium">
                             已自動帶入公司與負責人資料 (可修改)
                          </p>
                        )}
                      </div>
                     ))}
                  </div>
                </div>
             ) : (
               <div className="text-slate-400 italic">尚未定義此表單規格</div>
             )}
          </div>

          <button type="submit" disabled={isSubmitting} className="w-full bg-slate-900 text-white py-4 rounded-xl font-bold text-lg">
             {isSubmitting ? '單據派送中...' : '送交系統執行簽核'}
          </button>
        </form>
    </div>
  );
}
