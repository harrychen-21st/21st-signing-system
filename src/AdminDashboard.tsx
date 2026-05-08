import React, { useState, useEffect } from 'react';
import { Settings, Plus, Trash2, Save, AlertCircle, GitMerge, Shield, Loader2, X, Sparkles, FileText, Code, Edit3, ChevronRight, Check, FileSignature } from 'lucide-react';
import { GoogleGenAI, Type } from "@google/genai";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { apiGet, apiPost, USE_APPS_SCRIPT_DIRECT } from './lib/api';

interface Rule {
  id: string;
  stage: number;
  conditionField: string;
  conditionOp: string;
  conditionVal: string;
  approverType: 'HIERARCHY' | 'ROLE' | 'DEPT';
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

export default function AdminDashboard() {
  const [mainMode, setMainMode] = useState<'A' | 'B' | 'C'>('A');
  
  const [formTypes, setFormTypes] = useState<FormType[]>([]);
  const [allDefinitions, setAllDefinitions] = useState<FormDefinition[]>([]);
  const [activeFormId, setActiveFormId] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [notices, setNotices] = useState<Array<{ id: string; title: string; content: string; publishedAt: string }>>([]);

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
  }, []);

  const fetchInitialData = async () => {
    setIsLoading(true);
    try {
      const [typesData, defsRaw, noticeData] = await Promise.all([
        apiGet<{formTypes: FormType[]}>('/api/form-types', { action: 'getFormTypes' }),
        apiGet<any>('/api/form-definitions', { action: 'getData', sheet: 'FormDefinitions' }),
        apiGet<{ value: string }>('/api/settings/NoticeBoard', { action: 'getSetting', key: 'NoticeBoard' })
      ]);

      const defsRows = defsRaw.data || defsRaw.definitions || [];
      const definitions = Array.isArray(defsRows) && defsRows.length > 0 && Array.isArray(defsRows[0])
        ? defsRows.slice(1).map((r: any) => ({
            formId: r[0],
            fieldsMarkdown: r[1],
            logicMarkdown: r[2],
            configJSON: r[3] ? JSON.parse(r[3]) : null,
          }))
        : defsRows;
      
      setFormTypes(typesData.formTypes || []);
      setAllDefinitions(definitions || []);
      try {
        const parsed = JSON.parse((noticeData as any)?.value || '[]');
        setNotices(Array.isArray(parsed) ? parsed : []);
      } catch {
        setNotices([]);
      }
      
      if (typesData.formTypes?.length > 0 && !activeFormId) {
        setActiveFormId(typesData.formTypes[0].id);
      }
    } catch (error) {
      console.error("Failed to fetch admin data", error);
      if (USE_APPS_SCRIPT_DIRECT) {
        alert('系統管理目前無法從 Apps Script 讀取資料。請先確認 Apps Script 支援 getFormTypes 與 getData(FormDefinitions)。');
      }
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

      // 取得 API Key 的安全寫法
      const apiKey = (process as any).env?.GEMINI_API_KEY || (window as any).process?.env?.GEMINI_API_KEY;
      
      if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
        throw new Error('尚未偵測到 GEMINI_API_KEY。GitHub Pages 版本請改用 VITE_GEMINI_API_KEY，或先不要使用 AI 建模。');
      }

      const ai = new GoogleGenAI({ apiKey });
      const prompt = `你是一個專業的企業流程與系統架構顧問。
      任務：將使用者的自然語言描述轉換為結構化的表單規格。
      表單名稱: ${newFormName}
      表單代號: ${newFormId}
      需求描述: ${aiPrompt}

      請嚴格回傳 JSON 格式，內容必須包含：
      1. fields: 欄位陣列 (id, label, type [text, number, date, select, textarea], options [陣列, 僅 select 用], required [boolean])
      2. rules: 簽核規則陣列 (stage, conditionField [若為必經關卡填 ALWAYS], conditionOp [==, >, <, IN], conditionVal, approverType [HIERARCHY, ROLE], approverValue [1~5 或 ROLE:CODE])
      3. fieldsMarkdown: 給人類看的 Markdown 欄位清單說明
      4. logicMarkdown: 給人類看的 Markdown 簽核路徑說明
      `;

      // 使用 2.0 Flash 或是 1.5 Pro 都可以，這裡使用 instructions 推薦的最佳型號
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              fields: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { id: { type: Type.STRING }, label: { type: Type.STRING }, type: { type: Type.STRING }, options: { type: Type.ARRAY, items: { type: Type.STRING } }, required: { type: Type.BOOLEAN } } } },
              rules: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { stage: { type: Type.NUMBER }, conditionField: { type: Type.STRING }, conditionOp: { type: Type.STRING }, conditionVal: { type: Type.STRING }, approverType: { type: Type.STRING }, approverValue: { type: Type.STRING } } } },
              fieldsMarkdown: { type: Type.STRING },
              logicMarkdown: { type: Type.STRING }
            }
          }
        }
      });

      const result = JSON.parse(response.text);
      setTempSpecs({
        formId: newFormId.toUpperCase(),
        fieldsMarkdown: result.fieldsMarkdown,
        logicMarkdown: result.logicMarkdown,
        configJSON: { fields: result.fields }
      });
      setTempRules(result.rules.map((r: any, idx: number) => ({ ...r, id: `ai-${Date.now()}-${idx}` })));
      
    } catch (error: any) {
      console.error("AI Generation Error:", error);
      alert(error.message || 'AI 產生過程中發生異常，請確認 API Key 是否設定正確。');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCreateAndSync = async () => {
    if (!tempSpecs) return;
    setIsSaving(true);
    try {
      // 1. Create Form Type
      await apiPost('/api/form-types', {
        action: 'addFormType',
        formId: newFormId.toUpperCase(),
        formName: newFormName,
      });

      // 2. Sync Specs and Rules
      await Promise.all([
        apiPost(`/api/rules/${newFormId.toUpperCase()}`, {
          action: 'saveRules',
          formType: newFormId.toUpperCase(),
          rows: tempRules.map(r => [
            r.id,
            newFormId.toUpperCase(),
            r.stage,
            r.conditionField,
            r.conditionOp,
            r.conditionVal,
            r.approverType,
            r.approverValue,
          ]),
        }),
        apiPost(`/api/form-definitions/${newFormId.toUpperCase()}`, {
          action: 'saveData',
          sheet: 'FormDefinitions',
          matchColumn: 1,
          matchValue: newFormId.toUpperCase(),
          row: [
            newFormId.toUpperCase(),
            tempSpecs.fieldsMarkdown,
            tempSpecs.logicMarkdown,
            JSON.stringify(tempSpecs.configJSON),
          ],
        })
      ]);

      alert('新表單已成功建立，並已同步到「原有表單」清單中！');
      setMainMode('A');
      setActiveFormId(newFormId.toUpperCase());
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
        await apiPost(`/api/form-definitions/${activeFormId}`, {
            action: 'saveData',
            sheet: 'FormDefinitions',
            matchColumn: 1,
            matchValue: activeFormId,
            row: [
              activeFormId,
              editedFieldsMd,
              editedLogicMd,
              JSON.stringify(spec?.configJSON || { fields: [] }),
            ]
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

  const handleSaveNoticeBoard = async () => {
    setIsSaving(true);
    try {
      await apiPost('/api/settings', { key: 'NoticeBoard', value: JSON.stringify(notices) });
      alert('公告欄已更新');
    } catch (error) {
      alert('公告欄儲存失敗');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddNotice = () => {
    setNotices(prev => [{ id: `notice-${Date.now()}`, title: '新公告', content: '', publishedAt: new Date().toISOString() }, ...prev]);
  };

  const handleNoticeChange = (id: string, key: 'title' | 'content', value: string) => {
    setNotices(prev => prev.map(notice => notice.id === id ? { ...notice, [key]: value } : notice));
  };

  const handleDeleteNotice = (id: string) => {
    setNotices(prev => prev.filter(notice => notice.id !== id));
  };

  const currentSpec = allDefinitions.find(d => d.formId === activeFormId);

  return (
    <div className="glass-panel rounded-2xl md:rounded-3xl p-5 sm:p-8 md:p-12 w-full max-w-6xl animate-slide-up z-10 mx-auto">
      <div className="text-center mb-10">
        <h2 className="text-2xl md:text-3xl font-bold text-slate-800 flex items-center justify-center gap-3">
          <Settings className="text-indigo-500 w-8 h-8" /> 智能表單管理中心
        </h2>
        
        {/* A/B 模式切換器 */}
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
            className={`flex items-center gap-2 px-8 py-3 rounded-2xl font-bold transition-all border-2 ${mainMode === 'C' ? 'bg-indigo-600 text-white border-indigo-600 shadow-xl scale-105' : 'bg-white text-slate-500 border-slate-100 hover:border-indigo-200'}`}
          >
            <AlertCircle size={18} /> C. 公告欄設定
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
          {mainMode === 'A' ? (
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
          ) : mainMode === 'B' ? (
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
                    <p className="text-center text-slate-400 font-bold text-sm tracking-wide">按下按鈕後，系統將自動配置 API 路由、資料庫欄位映射與簽核角色權限。</p>
                 </div>
               )}
             </div>
           ) : (
            <div className="max-w-5xl mx-auto space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-bold text-slate-800">公告欄設定</h3>
                  <p className="text-sm text-slate-500">可設定多筆公告，發布時間會一併顯示在前台。</p>
                </div>
                <div className="flex gap-3">
                  <button onClick={handleAddNotice} className="rounded-xl bg-slate-900 px-5 py-2 font-bold text-white">新增公告</button>
                  <button onClick={handleSaveNoticeBoard} disabled={isSaving} className="rounded-xl bg-amber-600 px-5 py-2 font-bold text-white disabled:opacity-60">{isSaving ? '儲存中...' : '儲存全部公告'}</button>
                </div>
              </div>
              <div className="space-y-4">
                {notices.map((notice) => (
                  <div key={notice.id} className="rounded-3xl border border-amber-200 bg-amber-50/70 p-6">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="text-xs font-mono text-slate-400">發布時間：{notice.publishedAt ? new Date(notice.publishedAt).toLocaleString() : ''}</div>
                      <button onClick={() => handleDeleteNotice(notice.id)} className="rounded-lg bg-rose-100 px-3 py-1 text-sm font-bold text-rose-700">刪除</button>
                    </div>
                    <input value={notice.title} onChange={(e) => handleNoticeChange(notice.id, 'title', e.target.value)} className="form-input mb-3 w-full" placeholder="公告標題" />
                    <textarea value={notice.content} onChange={(e) => handleNoticeChange(notice.id, 'content', e.target.value)} rows={6} className="form-input w-full font-mono text-sm" placeholder={'**系統公告**\n- 請填寫內容'} />
                  </div>
                ))}
              </div>
            </div>
            )}
        </div>
      )}
    </div>
  );
}
