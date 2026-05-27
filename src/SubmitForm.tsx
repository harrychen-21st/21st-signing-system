import React, { useEffect, useMemo, useState } from 'react';
import { Briefcase, CheckCircle, FileSignature, Loader2, Megaphone, Printer, Send, User } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { authFetch } from './authFetch';

type FormField = {
  id: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select' | 'textarea';
  options?: string[];
  required?: boolean;
  showIf?: { field: string; value: string };
};

type FormDefinition = {
  formId: string;
  configJSON?: { fields?: FormField[] };
};

type SubmittedTicket = {
  id: string;
  formType: string;
  subject: string;
  applicantName: string;
  applicantEmail: string;
  department: string;
  createdAt: string;
  formData: Record<string, unknown>;
  amlStatus?: {
    needsInvestigation?: boolean;
    adminStatus?: string;
    riskStatus?: string;
    skipped?: boolean;
  };
};

type NoticeItem = {
  id?: string;
  title?: string;
  content?: string;
  publishedAt?: string;
};

const externalCompanyFields: FormField[] = [
  { id: 'external_collab', label: '是否涉及外部公司', type: 'select', options: ['否', '是'], required: true },
  { id: 'ext_tax_id', label: '統一編號', type: 'text', required: true, showIf: { field: 'external_collab', value: '是' } },
  { id: 'ext_company_name', label: '商家名稱', type: 'text', required: true, showIf: { field: 'external_collab', value: '是' } },
  { id: 'ext_company_owner', label: '負責人姓名', type: 'text', required: true, showIf: { field: 'external_collab', value: '是' } },
];

const fieldLabels: Record<string, string> = {
  subject: '主旨',
  description: '內容說明',
  attachment: '附件',
  related_ticket: '相關單號',
  expense_category: '支出科目',
  amount: '金額',
  vendor_name: '廠商名稱',
  payment_date: '付款期限',
  payment_method: '付款方式',
  seal_type: '用印類別',
  external_collab: '是否涉及外部公司',
  ext_tax_id: '統一編號',
  ext_company_name: '商家名稱',
  ext_company_owner: '負責人姓名',
};

function parseNoticeBoard(value: string): NoticeItem[] | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith('[')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .map((item) => ({
        id: String(item?.id || item?.publishedAt || item?.title || ''),
        title: String(item?.title || ''),
        content: String(item?.content || ''),
        publishedAt: String(item?.publishedAt || ''),
      }))
      .filter((item) => item.title || item.content);
  } catch {
    return null;
  }
}

function withExternalCompanyFields(fields: FormField[] = []) {
  const result = [...fields];
  externalCompanyFields.forEach((field) => {
    const index = result.findIndex((candidate) => candidate.id === field.id);
    if (index >= 0) {
      result[index] = { ...field, ...result[index], label: field.label };
    } else {
      result.push(field);
    }
  });
  return result;
}

function isVisible(field: FormField, formData: Record<string, unknown>) {
  if (!field.showIf) return true;
  return formData[field.showIf.field] === field.showIf.value;
}

function displayValue(value: unknown) {
  if (value == null || value === '') return '-';
  return String(value);
}

function PrintableApplication({ ticket }: { ticket: SubmittedTicket }) {
  const hiddenPrintFields = new Set(['ALWAYS', 'email', 'Email', 'EMAIL', 'applicantEmail', 'applicant_email']);
  const visibleEntries = Object.entries(ticket.formData).filter(([key]) => !hiddenPrintFields.has(key));
  const signers = ['董事長', '總經理', '管理本部長', '單位本部長', '單位處主管', '申請人'];
  const needsAdminCountersign = ticket.formData.external_collab === '是';

  return (
    <div className="print-page hidden print:block bg-white text-slate-950 text-[12px] leading-relaxed">
      <header className="mb-5 border-b-2 border-slate-950 pb-3">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-500">21CD Internal Request</p>
            <h1 className="mt-1 text-2xl font-bold tracking-wide text-slate-950">二十一世紀數位 內部申請單</h1>
          </div>
          <div className="shrink-0 rounded-md border border-slate-300 px-4 py-2 text-right leading-6">
            <div className="text-slate-500">表單編號</div>
            <div className="font-mono text-base font-bold text-slate-950">{ticket.id}</div>
            <div className="mt-1 text-slate-500">表單類型 <span className="font-semibold text-slate-800">{ticket.formType}</span></div>
          </div>
        </div>
      </header>

      <section className="print-section mb-4">
        <h2 className="mb-2 text-sm font-bold text-slate-900">申請資訊</h2>
        <div className="grid grid-cols-4 gap-x-4 gap-y-2 border-y border-slate-200 py-3">
          <div>
            <div className="text-[10px] font-semibold text-slate-500">申請人</div>
            <div className="font-semibold">{ticket.applicantName}</div>
          </div>
          <div>
            <div className="text-[10px] font-semibold text-slate-500">需求單位</div>
            <div className="font-semibold">{ticket.department}</div>
          </div>
          <div className="col-span-2">
            <div className="text-[10px] font-semibold text-slate-500">填表日期</div>
            <div className="font-semibold">{new Date(ticket.createdAt).toLocaleString()}</div>
          </div>
          <div className="col-span-4">
            <div className="text-[10px] font-semibold text-slate-500">主旨</div>
            <div className="font-semibold">{ticket.subject || '-'}</div>
          </div>
        </div>
      </section>

      <section className="print-section mb-4">
        <h2 className="mb-2 text-sm font-bold text-slate-900">申請內容</h2>
        <div className="grid grid-cols-2 gap-x-5 gap-y-2">
          {visibleEntries.map(([key, value]) => (
            <div key={key} className="border-b border-slate-200 pb-1.5">
              <div className="text-[10px] font-semibold text-slate-500">{fieldLabels[key] || key}</div>
              <div className="min-h-5 whitespace-pre-wrap font-medium text-slate-900">{displayValue(value)}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="print-section mb-4">
        <h2 className="mb-2 text-sm font-bold text-slate-900">會簽紀錄</h2>
        <div className="grid grid-cols-[96px_1fr] overflow-hidden rounded-md border border-slate-300">
          <div className="border-r border-slate-300 bg-slate-100 px-3 py-2 font-semibold">會簽單位</div>
          <div className="px-3 py-2 min-h-8"></div>
          <div className="border-r border-t border-slate-300 bg-slate-100 px-3 py-2 font-semibold">簽核與日期</div>
          <div className="border-t border-slate-300 px-3 py-2 min-h-10"></div>
        </div>
      </section>

      {needsAdminCountersign && (
        <section className="print-section mb-4 rounded-md border border-slate-300 p-3">
          <div className="mb-2 flex items-center justify-between border-b border-slate-200 pb-2">
            <h2 className="text-sm font-bold text-slate-900">AML / 關係人調查會簽</h2>
            <div className="font-semibold text-slate-700">會簽單位：管理處</div>
          </div>
          <div className="space-y-1.5 text-[11px] leading-5">
            <label className="flex items-start gap-2">
              <span className="mt-0.5 inline-block h-3.5 w-3.5 shrink-0 border border-slate-500"></span>
              <span>經管理處查核非屬關係人交易，且經第三方確認查無反社會或暴力團體相關負面新聞</span>
            </label>
            <label className="flex items-start gap-2">
              <span className="mt-0.5 inline-block h-3.5 w-3.5 shrink-0 border border-slate-500"></span>
              <span>其他：</span>
              <span className="mt-4 block flex-1 border-b border-slate-400"></span>
            </label>
          </div>
          <div className="mt-3 grid grid-cols-[96px_1fr] overflow-hidden rounded-md border border-slate-300">
            <div className="border-r border-slate-300 bg-slate-100 px-3 py-2 font-semibold">簽核與日期</div>
            <div className="min-h-10 px-3 py-2"></div>
          </div>
        </section>
      )}

      <section className="print-section">
        <h2 className="mb-2 text-sm font-bold text-slate-900">簽核欄位</h2>
        <table className="w-full border-collapse text-sm table-fixed">
          <thead>
            <tr>
              {signers.map((signer) => (
                <th key={signer} className="border border-slate-300 bg-slate-900 px-2 py-2 text-[11px] font-semibold text-white">
                  {signer}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {signers.map((signer) => (
                <td key={signer} className="h-16 border border-slate-300 px-2 pb-1.5 text-center align-bottom text-[10px] text-slate-400">
                  簽核 / 日期
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}

export default function SubmitForm({ user }: { user: any }) {
  const [formType, setFormType] = useState('AP');
  const [formTypesData, setFormTypesData] = useState<{ id: string; name: string }[]>([]);
  const [formDefinitions, setFormDefinitions] = useState<FormDefinition[]>([]);
  const [dynamicData, setDynamicData] = useState<Record<string, unknown>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedTicket, setSubmittedTicket] = useState<SubmittedTicket | null>(null);
  const [noticeBoard, setNoticeBoard] = useState('');
  const [ubnLoading, setUbnLoading] = useState(false);
  const [ubnSuccess, setUbnSuccess] = useState(false);

  useEffect(() => {
    Promise.all([
      authFetch('/api/form-types').then((res) => res.json()),
      authFetch('/api/form-definitions').then((res) => res.json()),
      authFetch('/api/settings/NoticeBoard').then((res) => res.json()).catch(() => ({ value: '' })),
    ]).then(([typesData, defsData, noticeData]) => {
      if (typesData.formTypes?.length) {
        setFormTypesData(typesData.formTypes);
        setFormType(typesData.formTypes[0].id);
      }
      setFormDefinitions(defsData.definitions || []);
      setNoticeBoard(noticeData.value || '');
    });
  }, []);

  const currentDef = formDefinitions.find((definition) => definition.formId === formType);
  const currentFields = useMemo(
    () => withExternalCompanyFields(currentDef?.configJSON?.fields || []),
    [currentDef]
  );
  const noticeItems = useMemo(() => parseNoticeBoard(noticeBoard), [noticeBoard]);

  const handleDynamicChange = (fieldId: string, value: string) => {
    setDynamicData((previous) => {
      const next = { ...previous, [fieldId]: value };
      if (fieldId === 'external_collab' && value !== '是') {
        delete next.ext_tax_id;
        delete next.ext_company_name;
        delete next.ext_company_owner;
        setUbnSuccess(false);
      }
      return next;
    });

    if (fieldId === 'ext_tax_id') {
      const taxId = value.trim();
      if (/^\d{8}$/.test(taxId)) {
        setUbnLoading(true);
        setUbnSuccess(false);
        authFetch(`/api/company/${taxId}`)
          .then((res) => {
            if (!res.ok) throw new Error('Company lookup failed');
            return res.json();
          })
          .then((data) => {
            if (data.success) {
              setDynamicData((previous) => ({
                ...previous,
                ext_company_name: data.name,
                ext_company_owner: data.owner,
              }));
              setUbnSuccess(true);
            }
          })
          .catch((error) => console.error('Company lookup failed:', error))
          .finally(() => setUbnLoading(false));
      } else {
        setUbnSuccess(false);
      }
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);

    const formData = { ...dynamicData, ALWAYS: 'TRUE' };
    const subject =
      String(dynamicData.subject || '').trim() ||
      `${formTypesData.find((form) => form.id === formType)?.name || formType} - ${user.name}`;
    const amount = dynamicData.amount ? String(dynamicData.amount) : '';

    try {
      const response = await authFetch('/api/submit-approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          applicantEmail: user.email,
          applicantName: user.name,
          department: user.dept,
          tickets: [{ formType, subject, amount, formData }],
        }),
      });

      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Submission failed');

      setSubmittedTicket({
        id: result.generatedIds?.[0] || result.applicationNumber,
        formType,
        subject,
        applicantName: user.name,
        applicantEmail: user.email,
        department: user.dept,
        createdAt: new Date().toISOString(),
        formData,
        amlStatus: result.amlStatus,
      });
    } catch (error) {
      console.error('Error submitting form', error);
      alert('送出失敗，請稍後再試或聯繫系統管理員。');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (submittedTicket) {
    return (
      <>
        <PrintableApplication ticket={submittedTicket} />
        <div className="glass-panel p-10 text-center max-w-2xl w-full mx-auto animate-slide-up rounded-2xl border border-emerald-100 shadow-xl print:hidden">
          <CheckCircle className="w-16 h-16 text-emerald-500 mx-auto mb-6" />
          <h2 className="text-3xl font-bold text-slate-800 mb-4">申請已送出</h2>
          <p className="text-slate-500 mb-8 text-lg">
            表單編號：
            <span className="font-mono bg-slate-100 px-3 py-1 rounded-lg text-slate-700 font-bold">
              {submittedTicket.id}
            </span>
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={() => window.print()}
              className="bg-slate-900 hover:bg-slate-700 text-white px-6 py-3 rounded-xl font-bold flex items-center justify-center gap-2"
            >
              <Printer className="w-5 h-5" />
              列印申請單
            </button>
            <button
              onClick={() => {
                setSubmittedTicket(null);
                setDynamicData({});
                setUbnSuccess(false);
              }}
              className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-3 rounded-xl font-bold"
            >
              填寫下一張
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="glass-panel rounded-2xl p-5 sm:p-8 md:p-12 w-full max-w-4xl animate-slide-up relative z-10 mx-auto">
      <div className="text-center mb-8">
        <h2 className="text-2xl md:text-3xl font-bold text-slate-800 flex items-center justify-center gap-3">
          <FileSignature className="text-emerald-500 w-8 h-8" />
          填寫申請單
        </h2>
      </div>

      {noticeBoard && (
        <div className="bg-amber-50/80 border border-amber-200 p-5 rounded-2xl mb-8 flex gap-4 animate-fade-in shadow-sm">
          <Megaphone className="text-amber-500 w-6 h-6 flex-shrink-0 mt-1" />
          {noticeItems ? (
            <div className="space-y-3 text-sm text-slate-700">
              {noticeItems.map((notice, index) => (
                <article key={notice.id || index} className="border-b border-amber-200/70 last:border-b-0 pb-3 last:pb-0">
                  {notice.title && <h3 className="font-bold text-amber-900 mb-1">{notice.title}</h3>}
                  {notice.content && (
                    <div className="prose prose-sm prose-amber max-w-none prose-a:text-amber-600 prose-a:font-bold prose-p:my-1">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{notice.content}</ReactMarkdown>
                    </div>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <div className="prose prose-sm prose-amber max-w-none prose-a:text-amber-600 prose-a:font-bold prose-p:my-1 prose-ul:my-1">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{noticeBoard}</ReactMarkdown>
            </div>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-10 animate-fade-in">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-emerald-50 border border-emerald-100 p-5 rounded-2xl flex items-center gap-4">
            <User className="text-emerald-500" />
            <div>
              <span className="text-xs font-bold text-emerald-600 uppercase">申請人</span>
              <p className="font-bold text-lg">{user.name}</p>
            </div>
          </div>
          <div className="bg-emerald-50 border border-emerald-100 p-5 rounded-2xl flex items-center gap-4">
            <Briefcase className="text-emerald-500" />
            <div>
              <span className="text-xs font-bold text-emerald-600 uppercase">需求單位</span>
              <p className="font-bold text-lg">{user.dept}</p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <label className="block text-slate-800 font-bold text-lg">選擇表單類型</label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {formTypesData.map((form) => (
              <button
                key={form.id}
                type="button"
                onClick={() => {
                  setFormType(form.id);
                  setDynamicData({});
                  setUbnSuccess(false);
                }}
                className={`p-5 rounded-2xl border-2 text-center transition-all ${
                  formType === form.id
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                    : 'border-slate-200 bg-white text-slate-600'
                }`}
              >
                <span className="block font-bold text-xl">{form.name.split(' (')[0]}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white/40 p-8 rounded-3xl border border-slate-100 shadow-sm min-h-[200px]">
          <div className="space-y-6">
            <h3 className="text-xl font-bold text-slate-800 border-b pb-4 mb-6">
              {formType} {formTypesData.find((form) => form.id === formType)?.name}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {currentFields.filter((field) => isVisible(field, dynamicData)).map((field) => (
                <div key={field.id} className={field.type === 'textarea' ? 'md:col-span-2' : ''}>
                  <label className="block text-slate-700 font-bold mb-2">
                    {field.label}
                    {field.required && ' *'}
                  </label>
                  {field.type === 'select' ? (
                    <select
                      className="form-input !pl-4"
                      required={field.required}
                      value={String(dynamicData[field.id] || '')}
                      onChange={(event) => handleDynamicChange(field.id, event.target.value)}
                    >
                      <option value="">請選擇</option>
                      {field.options?.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : field.type === 'textarea' ? (
                    <textarea
                      className="form-input !pl-4"
                      rows={4}
                      required={field.required}
                      value={String(dynamicData[field.id] || '')}
                      onChange={(event) => handleDynamicChange(field.id, event.target.value)}
                    />
                  ) : (
                    <div className="relative">
                      <input
                        type={field.type}
                        className={`form-input ${field.id === 'ext_tax_id' ? '!pl-4 !pr-12' : '!pl-4'}`}
                        required={field.required}
                        value={String(dynamicData[field.id] || '')}
                        onChange={(event) => handleDynamicChange(field.id, event.target.value)}
                      />
                      {field.id === 'ext_tax_id' && (ubnLoading || ubnSuccess) && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center">
                          {ubnLoading && <Loader2 className="w-5 h-5 text-emerald-500 animate-spin" />}
                          {ubnSuccess && <CheckCircle className="w-5 h-5 text-emerald-500 animate-pop-in" />}
                        </div>
                      )}
                    </div>
                  )}
                  {field.id === 'ext_tax_id' && ubnSuccess && (
                    <p className="text-xs text-emerald-600 mt-1.5 font-medium">
                      已帶入公司名稱與負責人姓名，可依實際資料修正。
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full bg-slate-900 hover:bg-slate-700 text-white py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-2 disabled:opacity-70"
        >
          {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          {isSubmitting ? '送出中...' : '送出申請'}
        </button>
      </form>
    </div>
  );
}
