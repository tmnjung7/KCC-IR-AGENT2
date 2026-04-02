import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, 
  Send, 
  Database, 
  FileText, 
  AlertCircle, 
  Loader2, 
  BarChart3, 
  TrendingUp, 
  Settings,
  Github
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { fetchCSVData, formatContext, fetchAllCSVFromRepo, IRData } from './services/dataService';
import { getGeminiResponse } from './services/gemini';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  groundingMetadata?: any;
  model?: string;
}

export default function App() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: '안녕하세요, KCC IR 부서 AI 어시스턴트입니다. 저장소 내의 모든 CSV 데이터를 통합 분석할 준비가 되었습니다. 궁금하신 수치를 문의해 주세요.',
      timestamp: new Date(),
    }
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [repoPath, setRepoPath] = useState('tmnjung7/KCC-IR-AGENT2'); 
  const [allFileData, setAllFileData] = useState<{name: string, data: IRData[]}[]>([]);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // 저장소 데이터 로드
  const loadRepoData = async () => {
    setIsDataLoaded(false);
    setIsLoading(true); // 로딩 상태 표시
    setError(null);
    try {
      // URL에서 owner/repo 추출
      let cleanPath = repoPath.trim();
      if (cleanPath.includes('github.com/')) {
        const parts = cleanPath.split('github.com/')[1].split('/');
        if (parts.length >= 2) {
          cleanPath = `${parts[0]}/${parts[1]}`;
        }
      }
      
      console.log('Loading data from repo:', cleanPath);
      // fetchAllCSVFromRepo 내부에서 이미 Date.now()를 사용하지만, 
      // 여기서 한 번 더 명시적으로 로딩 상태를 관리합니다.
      const results = await fetchAllCSVFromRepo(cleanPath);
      
      if (results.length > 0) {
        setAllFileData(results);
        setIsDataLoaded(true);
        const now = new Date();
        setLastUpdated(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        console.log('Data loaded successfully:', results.length, 'files at', now.toISOString());
      } else {
        setError('CSV 파일을 찾을 수 없습니다. 저장소에 .csv 파일이 있는지 확인해 주세요.');
      }
    } catch (err: any) {
      console.error('Data load error:', err);
      setError(`데이터 로드 실패: ${err.message || '알 수 없는 오류'}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRepoData();
  }, [repoPath]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setError(null);
    setIsLoading(true);

    try {
      // 질문과 관련된 데이터만 추출하여 컨텍스트 구성 (대용량 데이터 대응)
      const context = await import('./services/dataService').then(m => m.searchContext(allFileData, input));
      const responseData = await getGeminiResponse(input, context);
      
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: responseData.text || "답변을 생성할 수 없습니다.",
        groundingMetadata: responseData.groundingMetadata,
        timestamp: new Date(),
        model: responseData.model // 서버에서 받은 모델 정보 저장
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (err: any) {
      console.error("Chat Error:", err);
      let errorMessage = "오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
      
      // 서버에서 온 에러 메시지가 JSON 형태일 수 있으므로 파싱 시도
      let rawError = err.message || "";
      let parsedError = rawError;
      try {
        // "AI 응답 중 오류가 발생했습니다: {"error":...}" 형태인 경우 JSON 부분만 추출 시도
        const jsonMatch = rawError.match(/\{.*\}/);
        if (jsonMatch) {
          const json = JSON.parse(jsonMatch[0]);
          if (json.error && typeof json.error === 'string') {
            parsedError = json.error;
          } else if (json.error && json.error.message) {
            parsedError = json.error.message;
          }
        }
      } catch (e) {
        console.warn("Error parsing error JSON:", e);
      }

      if (parsedError.includes('429') || parsedError.includes('quota')) {
        errorMessage = "현재 AI 요청량이 많아 일시적으로 제한되었습니다. 약 1분 정도 기다리신 후 다시 질문해 주시면 감사하겠습니다. (무료 티어 할당량 제한)";
      } else if (parsedError.includes('413')) {
        errorMessage = "데이터가 너무 방대하여 분석에 실패했습니다. 질문을 더 구체적으로(예: 특정 연도나 항목 지정) 해주세요.";
      } else if (parsedError.includes('404')) {
        errorMessage = "AI 모델을 찾을 수 없습니다. 시스템 설정을 확인 중입니다.";
      } else if (parsedError.includes('500')) {
        errorMessage = "AI 서버에 일시적인 문제가 발생했습니다. 다시 시도해 주세요.";
      }
      
      setError(errorMessage);
      
      // 사용자에게도 메시지로 표시
      const errorAssistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `⚠️ ${errorMessage}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorAssistantMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans">
      {/* Sidebar */}
      <aside className="w-72 bg-[#151619] text-white flex flex-col border-r border-white/10">
        <div className="p-6 border-bottom border-white/5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center">
              <BarChart3 size={20} className="text-black" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">KCC IR AGENT2</h1>
          </div>
          <p className="text-xs text-zinc-400 font-medium uppercase tracking-wider">Assistant v1.0</p>
        </div>

        <nav className="flex-1 overflow-y-auto p-4 space-y-2">
          <div className="px-2 py-3">
            <h2 className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] mb-4 flex justify-between items-center">
              <span>Loaded Files ({allFileData.length})</span>
              <div className="flex items-center gap-2">
                {lastUpdated && (
                  <span className="text-[9px] font-normal text-zinc-600 lowercase tracking-normal">
                    Sync: {lastUpdated}
                  </span>
                )}
                <button 
                  onClick={loadRepoData}
                  disabled={isLoading}
                  className="hover:text-emerald-500 transition-colors p-1"
                  title="Refresh Data"
                >
                  <TrendingUp size={12} className={cn(isLoading && "animate-spin")} />
                </button>
              </div>
            </h2>
            <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
              {allFileData.map((file, idx) => (
                <div key={idx} className="flex items-center gap-3 text-[11px] text-zinc-300 bg-white/5 p-2 rounded border border-white/5">
                  <FileText size={12} className="text-emerald-500 shrink-0" />
                  <span className="truncate">{file.name}</span>
                </div>
              ))}
              {allFileData.length === 0 && (
                <p className="text-[11px] text-zinc-500 italic">No files loaded</p>
              )}
            </div>
          </div>

          <div className="px-2 py-6 border-t border-white/5">
            <h2 className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] mb-4">Configuration</h2>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-[11px] text-zinc-400 flex items-center gap-2">
                  <Github size={12} /> GitHub Repo (Owner/Repo)
                </label>
                <div className="relative">
                  <input 
                    type="text" 
                    value={repoPath}
                    onChange={(e) => setRepoPath(e.target.value)}
                    className="w-full bg-zinc-800/50 border border-white/10 rounded-md pl-3 pr-8 py-2 text-xs focus:outline-none focus:border-emerald-500 transition-colors"
                    placeholder="tmnjung7/KCC-IR-AGENT2"
                  />
                  {isDataLoaded && (
                    <div className="absolute right-2 top-1/2 -translate-y-1/2">
                      <div className="w-2 h-2 bg-emerald-500 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                    </div>
                  )}
                </div>
                <p className="text-[9px] text-zinc-500 leading-relaxed">
                  * 저장소 경로를 입력하면 모든 CSV를 자동으로 불러옵니다.
                </p>
              </div>
              
              <div className="p-3 bg-emerald-500/5 border border-emerald-500/10 rounded-lg">
                <h3 className="text-[10px] font-bold text-emerald-500 uppercase mb-2 flex items-center gap-1">
                  <AlertCircle size={10} /> How to use & FAQ
                </h3>
                <ul className="text-[10px] text-zinc-400 space-y-1.5 list-disc pl-3">
                  <li className="text-amber-400 font-bold">엑셀(.xlsx)은 지원되지 않습니다. 반드시 CSV로 변환해 주세요.</li>
                  <li>
                    <strong>Gemini Advanced vs API:</strong> 
                    <p className="pl-2 mt-1 text-zinc-300">
                      • <strong>Advanced($20/월)</strong>: 개인 대화용 구독 서비스입니다.<br/>
                      • <strong>API(현재 앱)</strong>: 개발용 서비스로, AI Studio에서 별도의 <strong>결제 계정(Billing)</strong>을 연결해야 유료 티어(무제한급)로 작동합니다. 개인 구독과는 별개입니다.
                    </p>
                  </li>
                  <li><strong>할당량 초과(429) 해결:</strong> AI Studio에서 'Pay-as-you-go' 플랜을 활성화한 후 발급받은 API 키를 [Settings {'>'} Secrets]에 등록하세요.</li>
                  <li><strong>답변 능력 향상:</strong> 현재 최고 성능인 <span className="text-emerald-400">Gemini 3.1 Pro</span> 모델과 <span className="text-emerald-400">구글 검색</span>이 적용되어 있습니다.</li>
                </ul>
              </div>
            </div>
          </div>
        </nav>

        <div className="p-6 border-t border-white/5 bg-black/20">
          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <Settings size={14} />
            <span>Settings</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative overflow-hidden">
        {/* Header */}
        <header className="h-16 border-b border-black/5 bg-white flex items-center justify-between px-8 z-10">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1 bg-emerald-50 rounded-full text-emerald-700 text-xs font-semibold">
              <TrendingUp size={14} />
              <span>Real-time IR Support</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {error && (
              <div className="flex items-center gap-2 text-amber-600 text-sm bg-amber-50 px-3 py-1.5 rounded-md border border-amber-100">
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-zinc-400 text-sm">
              <Database size={16} />
              <span>{allFileData.reduce((acc, f) => acc + f.data.length, 0)} records loaded</span>
            </div>
          </div>
        </header>

        {/* Chat Area */}
        <div 
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-8 space-y-6 scroll-smooth"
        >
          <AnimatePresence initial={false}>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  "flex flex-col max-w-[80%]",
                  msg.role === 'user' ? "ml-auto items-end" : "mr-auto items-start"
                )}
              >
                <div className={cn(
                  "px-5 py-3.5 rounded-2xl text-[15px] leading-relaxed shadow-sm",
                  msg.role === 'user' 
                    ? "bg-[#151619] text-white rounded-tr-none" 
                    : "bg-white border border-black/5 text-[#1A1A1A] rounded-tl-none"
                )}>
                  {msg.content.split('\n').map((line, i) => (
                    <p key={i} className={line.trim() === '' ? 'h-2' : 'mb-1 last:mb-0'}>
                      {line}
                    </p>
                  ))}
                  
                  {/* Grounding Sources */}
                  {msg.groundingMetadata?.groundingChunks && (
                    <div className="mt-4 pt-3 border-t border-black/5">
                      <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                        <Search size={10} /> Search Sources
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {msg.groundingMetadata.groundingChunks.map((chunk: any, idx: number) => (
                          chunk.web && (
                            <a 
                              key={idx}
                              href={chunk.web.uri}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-1 rounded border border-emerald-100 hover:bg-emerald-100 transition-colors truncate max-w-[200px]"
                              title={chunk.web.title}
                            >
                              {chunk.web.title || chunk.web.uri}
                            </a>
                          )
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <span className="text-[10px] text-zinc-400 mt-1.5 font-medium uppercase tracking-wider">
                  {msg.role === 'user' ? 'Manager' : `AI Assistant ${msg.model ? `(${msg.model.includes('pro') ? 'PRO' : 'FLASH'})` : ''}`} • {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
          {isLoading && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-3 text-zinc-400 text-sm"
            >
              <Loader2 size={18} className="animate-spin text-emerald-500" />
              <span>데이터를 분석하여 답변을 생성하고 있습니다...</span>
            </motion.div>
          )}
        </div>

        {/* Input Area */}
        <div className="p-8 pt-0">
          <div className="max-w-4xl mx-auto relative group">
            <div className="absolute inset-y-0 left-5 flex items-center pointer-events-none text-zinc-400 group-focus-within:text-emerald-500 transition-colors">
              <Search size={20} />
            </div>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="사업부별 매출 추이나 부채비율에 대해 질문해 보세요..."
              className="w-full bg-white border border-black/10 rounded-2xl pl-14 pr-20 py-5 text-lg shadow-xl focus:outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/5 transition-all"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-12 h-12 bg-emerald-500 text-black rounded-xl flex items-center justify-center hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg"
            >
              <Send size={20} />
            </button>
          </div>
          <p className="text-center text-[11px] text-zinc-400 mt-4 font-medium uppercase tracking-widest">
            Fact-based IR Assistant powered by Gemini 3.1 Pro & Google Search
          </p>
        </div>
      </main>
    </div>
  );
}
