import React, { useState, useEffect } from 'react';
import { Settings, Plus, Trash2, Save, AlertCircle, GitMerge, Shield, Loader2, X, Sparkles, FileText, Code, Edit3, ChevronRight, Check, FileSignature, Megaphone } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { authFetch } from './authFetch';

interface Rule {
  id: string;
  stage: number;
  conditionField: string;
  conditionOp: string;
  conditionVal: string;
  approverType: 'MANAGER' | 'ROLE' | 'SPECIAL:AML_CHECK' | 'DEPT';
  approverValue: string;
}

interface FormType {
  id: string;
  name: string;
}

interface FormDefinition {
  formId: string;
  fieldsMarkdown: string;
  logicMarkdown: string;
  configJSON: any;
}

export default function AdminDashboard({ user }: { user: any }) {
  // A: Existing Forms, B: New Form, C: Notice Board
  const [mainMode, setMainMode] = useState<'A' | 'B' | 'C'>('A');

  // Mode C: Notice Board
  const [noticeContent, setNoticeContent] = useState('');
  const [isNoticeSaving, setIsNoticeSaving] = useState(false);
  const [noticeSaved, setNoticeSaved] = useState(false);
  
  const [formTypes, setFormTypes] = useState<FormType[]>([]);
  const [allDefinitions, setAllDefinitions] = useState<FormDefinition[]>([]);
  const [activeFormId, setActiveFormId] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Edit Mode for Tab A
  const [isEditingSpecs, setIsEditingSpecs] = useState(false);
  const [editedFieldsMd, setEditedFieldsMd] = useState('');
  const [editedLogicMd, setEditedLogicMd] = useState('');

  // Mode B: New Form State
  const [newFormName, setNewFormName] = useState('');
  const [newFormId, setNewFormId] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [tempRules, setTempRules] = useState<Rule[]>([]);
  const [tempSpecs, setTempSpecs] = useState<FormDefinition | null>(null);

  useEffect(() => {
    fetchInitialData();
    loadNoticeBoard();
  }, []);

  const loadNoticeBoard = async () => {
    try {
      const res = await authFetch('/api/settings/NoticeBoard');
      const data = await res.json();
      setNoticeContent(data.value || '');
    } catch (e) {
      console.error('Failed to load notice board', e);
    }
  };

  const handleSaveNotice = async () => {
    setIsNoticeSaving(true);
    setNoticeSaved(false);
    try {
      await authFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'NoticeBoard', value: noticeContent })
      });
      setNoticeSaved(true);
      setTimeout(() => setNoticeSaved(false), 3000);
    } catch (e) {
      alert('儲存失敗，請稍後再試。');
    } finally {
      setIsNoticeSaving(false);
    }
  };

  const fetchInitialData = async () => {
    setIsLoading(true);
    try {
      const [typesRes, defsRes] = await Promise.all([
        authFetch('/api/form-types'),
        authFetch('/api/form-definitions')
      ]);
      const typesData = await typesRes.json();
      const defsData = await defsRes.json();
      
      setFormTypes(typesData.formTypes || []);
      setAllDefinitions(defsData.definitions || []);
      
      if (typesData.formTypes?.length > 0 && !activeFormId) {
        setActiveFormId(typesData.formTypes[0].id);
      }
    } catch (error) {
      console.error("Failed to fetch admin data", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const spec = allDefinitions.find(d => d.formId === activeFormId);
    if (spec) {
      setEditedFieldsMd(spec.fieldsMarkdown);
      setEditedLogicMd(spec.logicMarkdown);
    } else {
      setEditedFieldsMd('');
      setEditedLogicMd('');
    }
    setIsEditingSpecs(false);
  }, [activeFormId, allDefinitions]);

  const handleAiGenerate = async () => {
    // 立即顯示 Loading，避免感覺沒反應
    setIsGenerating(true);

    try {
      if (!newFormName.trim() || !newFormId.trim() || !aiPrompt.trim()) {
        throw new Error('請填寫完整表單名稱、縮寫代號與需求內容');
      }

      const response = await authFetch('/api/ai-form-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formName: newFormName,
          formId: newFormId,
          requirement: aiPrompt
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'AI 產生過程中發生異常。');
      setTempSpecs({
        formId: result.formId,
        fieldsMarkdown: result.fieldsMarkdown,
        logicMarkdown: result.logicMarkdown,
        configJSON: { fields: result.fields }
      });
      setTempRules((result.rules || []).map((r: any, idx: number) => ({ ...r, id: r.id || `ai-${Date.now()}-${idx}` })));
      
    } catch (error: any) {
      console.error("AI Generation Error:", error);
      alert(error.message || 'AI 產生過程中發生異常，請確認 GEMINI_API_KEY 是否設定正確。');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCreateAndSync = async () => {
    if (!tempSpecs) return;
    setIsSaving(true);
    try {
      const formId = tempSpecs.formId;
      // 1. Create Form Type
      await authFetch('/api/form-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: formId, name: newFormName })
      });

      // 2. Sync Specs and Rules
      await Promise.all([
        authFetch(`/api/rules/${formId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rules: tempRules })
        }),
        authFetch(`/api/form-definitions/${formId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tempSpecs)
        })
      ]);

      alert('新表單已成功建立，並已同步到「原有表單」清單中！');
      setMainMode('A');
      setActiveFormId(formId);
      setTempSpecs(null);
      setNewFormName('');
      setNewFormId('');
      setAiPrompt('');
      await fetchInitialData();
    } catch (error) {
      alert('資料儲存失敗，請檢查網路連線。');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveExistingSpecs = async () => {
    if (!activeFormId) return;
    setIsSaving(true);
    try {
        const spec = allDefinitions.find(d => d.formId === activeFormId);
        const updatedSpec = {
            formId: activeFormId,
            fieldsMarkdown: editedFieldsMd,
            logicMarkdown: editedLogicMd,
            configJSON: spec?.configJSON || { fields: [] }
        };

        await authFetch(`/api/form-definitions/${activeFormId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedSpec)
        });

        alert('規格已更新成功！');
        await fetchInitialData();
        setIsEditingSpecs(false);
    } catch (error) {
        alert('儲存失敗');
    } finally {
        setIsSaving(false);
    }
  };

  const currentSpec = allDefinitions.find(d => d.formId === activeFormId);

  return (
    <div className="glass-panel rounded-2xl md:rounded-3xl p-5 sm:p-8 md:p-12 w-full max-w-6xl animate-slide-up z-10 mx-auto">
      <div className="text-center mb-10">
        <h2 className="text-2xl md:text-3xl font-bold text-slate-800 flex items-center justify-center gap-3">
          <Settings className="text-indigo-500 w-8 h-8" /> 智能表單管理中心
        </h2>
        
        {/* A/B/C 模式切換器 */}
        <div className="flex flex-wrap justify-center gap-4 mt-8">
          <button 
            onClick={() => setMainMode('A')}
            className={`flex items-center gap-2 px-8 py-3 rounded-2xl font-bold transition-all border-2 ${mainMode === 'A' ? 'bg-indigo-600 text-white border-indigo-600 shadow-xl scale-105' : 'bg-white text-slate-500 border-slate-100 hover:border-indigo-200'}`}
          >
            <Edit3 size={18} /> A. 原有表單規格調整
          </button>
          <button 
            onClick={() => setMainMode('B')}
            className={`flex items-center gap-2 px-8 py-3 rounded-2xl font-bold transition-all border-2 ${mainMode === 'B' ? 'bg-indigo-600 text-white border-indigo-600 shadow-xl scale-105' : 'bg-white text-slate-500 border-slate-100 hover:border-indigo-200'}`}
          >
            <Plus size={18} /> B. 新增表單 (AI 建模)
          </button>
          <button 
            onClick={() => setMainMode('C')}
            className={`flex items-center gap-2 px-8 py-3 rounded-2xl font-bold transition-all border-2 ${mainMode === 'C' ? 'bg-amber-500 text-white border-amber-500 shadow-xl scale-105' : 'bg-white text-slate-500 border-slate-100 hover:border-amber-200'}`}
          >
            <Megaphone size={18} /> C. 佈告欄管理
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-indigo-500">
          <Loader2 className="w-12 h-12 animate-spin" />
          <p className="font-bold tracking-widest uppercase text-sm">Synchronizing Data...</p>
        </div>
      ) : (
        <div className="animate-fade-in">
          
          {mainMode === 'C' ? (
            /* Option C: Notice Board Manager */
            <div className="max-w-3xl mx-auto animate-slide-up space-y-6">
              <div className="bg-white p-8 rounded-3xl border border-amber-100 shadow-xl">
                <h3 className="text-xl font-bold text-amber-700 flex items-center gap-2 mb-2">
                  <Megaphone size={20} /> 申請頁面佈告欄編輯
                </h3>
                <p className="text-sm text-slate-500 mb-6">支援 <strong>Markdown</strong> 語法，超連結格式為 <code className="bg-slate-100 px-1 rounded">[顯示文字](網址)</code>，修改後儲存即生效。</p>
                <textarea
                  className="form-input w-full font-mono text-sm p-4 leading-relaxed bg-slate-50 border-amber-200 focus:border-amber-400 focus:ring-amber-400/20"
                  rows={12}
                  placeholder="在此輸入公告內容，支援 Markdown 語法...&#10;例如：[點此查看規範](https://...)"
                  value={noticeContent}
                  onChange={e => setNoticeContent(e.target.value)}
                />
                <div className="mt-4 flex items-center justify-between">
                  {noticeSaved && (
                    <span className="text-emerald-600 font-semibold flex items-center gap-1 text-sm"><Check size={16}/> 已成功儲存！員工下次進入頁面即可看到更新內容。</span>
                  )}
                  {!noticeSaved && <span />}
                  <button
                    onClick={handleSaveNotice}
                    disabled={isNoticeSaving}
                    className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-white px-6 py-3 rounded-xl font-bold shadow-lg shadow-amber-200 transition-all disabled:opacity-60"
                  >
                    {isNoticeSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                    儲存並發布
                  </button>
                </div>
              </div>

              <div className="bg-amber-50 border border-amber-200 p-6 rounded-3xl">
                <h4 className="font-bold text-amber-700 mb-3 text-sm uppercase tracking-widest">預覽 (員工看到的效果)</h4>
                <div className="flex gap-3">
                  <Megaphone className="text-amber-500 w-5 h-5 flex-shrink-0 mt-1" />
                  <div className="prose prose-sm prose-amber max-w-none prose-a:text-amber-600 prose-a:font-bold">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{noticeContent || '*（尚未輸入公告內容）*'}</ReactMarkdown>
                  </div>
                </div>
              </div>
            </div>
          ) : mainMode === 'A' ? (
            /* Option A UI */
            <div className="flex flex-col md:flex-row gap-8">
              {/* 左側表單目錄 */}
              <div className="w-full md:w-72 space-y-2">
                <div className="flex items-center justify-between px-2 mb-4">
                  <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">系統表單庫</h3>
                  <span className="bg-slate-100 text-slate-500 px-2 py-0.5 rounded text-[10px] font-bold">{formTypes.length}</span>
                </div>
                <div className="space-y-1.5 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                  {formTypes.map(ft => (
                    <button
                      key={ft.id}
                      onClick={() => setActiveFormId(ft.id)}
                      className={`w-full flex items-center justify-between px-5 py-4 rounded-2xl transition-all group border ${activeFormId === ft.id ? 'bg-slate-900 text-white border-slate-900 shadow-2xl z-10' : 'bg-white text-slate-600 border-slate-100 hover:border-indigo-100 hover:bg-indigo-50/10'}`}
                    >
                      <div className="flex items-center gap-4">
                        <div className={`p-2 rounded-lg ${activeFormId === ft.id ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-400 group-hover:bg-indigo-100 group-hover:text-indigo-500'}`}>
                          <FileText size={18} />
                        </div>
                        <div className="text-left">
                          <span className="block font-bold text-sm leading-tight">{ft.name}</span>
                          <span className={`text-[10px] font-mono font-bold ${activeFormId === ft.id ? 'text-indigo-300' : 'text-slate-300'}`}>{ft.id}</span>
                        </div>
                      </div>
                      <ChevronRight size={14} className={`transition-all duration-300 ${activeFormId === ft.id ? 'translate-x-1 opacity-100' : 'opacity-0'}`} />
                    </button>
                  ))}
                </div>
              </div>

              {/* 右側規格說明區 */}
              <div className="flex-grow space-y-6">
                <div className="bg-white p-6 sm:p-10 rounded-3xl border border-slate-100 shadow-xl relative overflow-hidden min-h-[500px]">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8 border-b pb-6">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="bg-indigo-100 text-indigo-700 text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-tighter">Specs Sheet</span>
                        <h4 className="text-xl font-bold text-slate-800">{formTypes.find(f => f.id === activeFormId)?.name}</h4>
                      </div>
                      <p className="text-xs text-slate-400 font-medium tracking-wide">目前生效中的欄位定義與簽核邏輯</p>
                    </div>
                    {activeFormId && (
                        <button 
                            onClick={() => isEditingSpecs ? handleSaveExistingSpecs() : setIsEditingSpecs(true)}
                            disabled={isSaving}
                            className={`flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold transition-all ${isEditingSpecs ? 'bg-emerald-600 text-white shadow-xl shadow-emerald-200' : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'}`}
                        >
                            {isSaving ? <Loader2 size={14} className="animate-spin" /> : (isEditingSpecs ? <Check size={14} /> : <Edit3 size={14} />)}
                            {isEditingSpecs ? '完成並儲存' : '手動微調'}
                        </button>
                    )}
                  </div>

                  {currentSpec ? (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-10">
                      <div className="space-y-4">
                        <h5 className="text-[10px] uppercase font-black text-indigo-500 flex items-center gap-2 tracking-[0.2em] mb-4">
                          <FileText size={14} /> 欄位設計 (Field Definitions)
                        </h5>
                        {isEditingSpecs ? (
                            <textarea 
                                className="form-input w-full font-mono text-xs leading-relaxed p-4 h-[300px] border-indigo-200 focus:ring-indigo-500 bg-slate-50"
                                value={editedFieldsMd}
                                onChange={e => setEditedFieldsMd(e.target.value)}
                            />
                        ) : (
                            <div className="prose prose-sm max-w-none text-slate-600 bg-slate-50/50 p-6 rounded-2xl border border-slate-100 min-h-[200px]">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{currentSpec.fieldsMarkdown}</ReactMarkdown>
                            </div>
                        )}
                      </div>
                      <div className="space-y-4">
                        <h5 className="text-[10px] uppercase font-black text-indigo-500 flex items-center gap-2 tracking-[0.2em] mb-4">
                          <GitMerge size={14} /> 簽核邏輯 (Logic Matrix)
                        </h5>
                        {isEditingSpecs ? (
                            <textarea 
                                className="form-input w-full font-mono text-xs leading-relaxed p-4 h-[300px] border-indigo-200 focus:ring-indigo-500 bg-slate-50"
                                value={editedLogicMd}
                                onChange={e => setEditedLogicMd(e.target.value)}
                            />
                        ) : (
                            <div className="prose prose-sm max-w-none text-slate-600 bg-slate-50/50 p-6 rounded-2xl border border-slate-100 min-h-[200px]">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{currentSpec.logicMarkdown}</ReactMarkdown>
                            </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-28 text-slate-300">
                      <Code size={64} className="mb-6 opacity-10" />
                      <p className="font-bold">此表單尚未建立系統規格說明</p>
                      <p className="text-xs mt-3 bg-slate-100 px-3 py-1 rounded text-slate-400">請嘗試透過 Mode B 用 AI 建模，或按上方手動微調自行輸入資訊</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Option B UI: Focus on Creation */
            <div className="max-w-4xl mx-auto space-y-10 animate-slide-up">
               <div className="bg-white p-8 xs:p-12 rounded-[2.5rem] border border-slate-100 shadow-2xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-8">
                     <Sparkles className="text-indigo-100 w-24 h-24 rotate-12" />
                  </div>

                  <div className="relative space-y-10">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="space-y-3">
                        <label className="text-sm font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 px-1">
                            <FileSignature size={14} className="text-indigo-500"/> 表單全名
                        </label>
                        <input 
                            type="text" placeholder="例如：特殊採購申請單" value={newFormName}
                            onChange={e => setNewFormName(e.target.value)}
                            className="form-input text-xl font-bold h-16 rounded-2xl shadow-sm focus:scale-[1.01] transition-transform"
                        />
                        </div>
                        <div className="space-y-3">
                        <label className="text-sm font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 px-1">
                            <Code size={14} className="text-indigo-500"/> 表單縮寫代號
                        </label>
                        <input 
                            type="text" placeholder="例如：SPO (大寫)" value={newFormId}
                            onChange={e => setNewFormId(e.target.value)}
                            className="form-input text-xl font-mono uppercase font-black h-16 rounded-2xl shadow-sm focus:scale-[1.01] transition-transform tracking-widest"
                        />
                        </div>
                    </div>

                    <div className="space-y-4">
                        <label className="text-sm font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 px-1">
                            <Sparkles size={14} className="text-indigo-500"/> AI 快速建模需求描述 (自然語言)
                        </label>
                        <textarea 
                        rows={6}
                        placeholder="請詳細描述您的欄位要求、順序與簽核關卡邏輯...&#10;範例：欄位需要請假天數、職務代理人。簽核第一關給直屬主管，若天數超過三天要再給總經理。"
                        className="form-input text-base p-8 rounded-3xl !bg-indigo-50/20 !border-indigo-100 focus:!border-indigo-500 shadow-inner min-h-[220px]"
                        value={aiPrompt}
                        onChange={e => setAiPrompt(e.target.value)}
                        />
                    </div>

                    <button 
                        onClick={handleAiGenerate}
                        disabled={isGenerating || !aiPrompt.trim()}
                        className={`w-full py-6 rounded-3xl font-black text-2xl flex items-center justify-center gap-4 transition-all duration-300 shadow-2xl ${isGenerating ? 'bg-slate-100 text-slate-400' : 'bg-gradient-to-r from-indigo-600 to-indigo-500 text-white hover:shadow-indigo-500/40 active:scale-[0.98]'}`}
                    >
                        {isGenerating ? <><Loader2 className="animate-spin w-8 h-8" /> AI 思考中...</> : <><Sparkles size={28}/> 立即產生系統規劃</>}
                    </button>
                  </div>
               </div>

               {tempSpecs && (
                 <div className="space-y-10 animate-fade-in">
                    <div className="bg-indigo-900 p-10 rounded-[3rem] shadow-2xl relative overflow-hidden">
                       <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-400 to-emerald-400"></div>
                       <h4 className="text-2xl font-black text-white mb-10 flex items-center gap-4 uppercase tracking-widest">
                            <Sparkles className="text-indigo-300"/> AI 規劃成果預覽 (Preview)
                       </h4>
                       <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                          <div className="bg-white/95 backdrop-blur-xl p-8 rounded-3xl shadow-2xl prose prose-slate prose-sm max-w-none">
                             <h5 className="font-black text-indigo-600 mb-6 border-b border-indigo-50 pb-3 flex items-center gap-2">
                                <FileText size={16}/> 欄位規劃清單
                             </h5>
                             <ReactMarkdown remarkPlugins={[remarkGfm]}>{tempSpecs.fieldsMarkdown}</ReactMarkdown>
                          </div>
                          <div className="bg-white/95 backdrop-blur-xl p-8 rounded-3xl shadow-2xl prose prose-slate prose-sm max-w-none">
                             <h5 className="font-black text-indigo-600 mb-6 border-b border-indigo-50 pb-3 flex items-center gap-2">
                                <GitMerge size={16}/> 簽核邏輯分支
                             </h5>
                             <ReactMarkdown remarkPlugins={[remarkGfm]}>{tempSpecs.logicMarkdown}</ReactMarkdown>
                          </div>
                       </div>
                    </div>

                    <button 
                      onClick={handleCreateAndSync}
                      disabled={isSaving}
                      className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-8 rounded-[2rem] text-3xl font-black shadow-2xl flex items-center justify-center gap-6 transition-all active:scale-95 group"
                    >
                      {isSaving ? <Loader2 className="animate-spin w-10 h-10" /> : <Save size={40} className="group-hover:rotate-12 transition-transform" />}
                      確認規劃並一鍵建立系統
                    </button>
                    <p className="text-center text-slate-400 font-bold text-sm tracking-wide">按下按鈕後，系統會建立表單類型、欄位設定與後台處理提示；正式啟用前建議再檢查列印內容與權限需求。</p>
                 </div>
               )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
