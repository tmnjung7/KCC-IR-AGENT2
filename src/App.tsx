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
import { fetchCSVData, formatContext, fetchAllCSVFromRepo, searchContext, IRData } from './services/dataService';
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

const DEFAULT_FAQ_ANSWERS: Record<string, string> = {
  "최근 배당금 및 배당 성향": "KCC는 주주가치 제고를 위해 안정적인 배당 정책을 유지하고 있습니다. 최근 3개년 평균 배당성향은 약 20~25% 수준이며, 향후에도 경영 실적과 현금 흐름을 고려하여 주주 환원을 지속적으로 확대할 계획입니다.",
  "KCC의 ESG 활동 및 평가": "KCC는 '지속가능한 미래 가치 창출'을 목표로 ESG 경영을 강화하고 있습니다. 환경(E) 부문에서는 친환경 제품 확대, 사회(S) 부문에서는 지역사회 상생, 지배구조(G) 부문에서는 투명한 공시 체계를 구축하여 외부 평가 기관으로부터 우수한 등급을 유지하고 있습니다.",
  "신규 사업 추진 현황": "KCC는 실리콘 부문의 고부가 가치 제품 포트폴리오 다변화와 친환경 건자재 및 도료 신제품 개발에 역량을 집중하고 있습니다. 특히 글로벌 시장 점유율 확대를 위한 해외 생산 거점 최적화와 R&D 투자를 지속적으로 강화하고 있습니다.",
  "공시 정보 및 주가 알림": "KCC의 최신 공시 정보는 금융감독원 전자공시시스템(DART) 및 당사 홈페이지 IR 섹션에서 확인하실 수 있습니다. 주가 관련 주요 변동 사항이나 실적 발표 일정은 등록된 주주님들께 뉴스레터 및 알림 서비스를 통해 신속히 전달해 드리고 있습니다."
};

export default function App() {
  const [input, setInput] = useState('');
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [adminPassword, setAdminPassword] = useState(() => {
    try {
      // Always default to 0815 as requested, but allow saved password if it exists
      return localStorage.getItem('kcc_admin_password') || '0815';
    } catch (e) {
      return '0815';
    }
  });
  const [faqAnswers, setFaqAnswers] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem('kcc_faq_answers');
      const parsed = saved ? JSON.parse(saved) : null;
      return (parsed && typeof parsed === 'object') ? parsed : DEFAULT_FAQ_ANSWERS;
    } catch (e) {
      return DEFAULT_FAQ_ANSWERS;
    }
  });
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: '반갑습니다. KCC AI 주주지원 서비스입니다. \n\n주주님들의 궁금증을 신속하고 정확하게 해결해 드리기 위해 최선을 다하겠습니다. 우측의 [자주 찾는 질문]을 클릭하시거나, 하단에 궁금하신 내용을 직접 입력해 주세요.',
      timestamp: new Date(),
    }
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [repoPath, setRepoPath] = useState('tmnjung7/KCC-IR-AGENT2'); 
  const [allFileData, setAllFileData] = useState<{name: string, data: IRData[]}[]>([]);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<'pro' | 'flash'>('pro');
  
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

  useEffect(() => {
    localStorage.setItem('kcc_faq_answers', JSON.stringify(faqAnswers));
  }, [faqAnswers]);

  useEffect(() => {
    localStorage.setItem('kcc_admin_password', adminPassword);
  }, [adminPassword]);

  const handleAdminToggle = () => {
    if (isAdminMode) {
      setIsAdminMode(false);
    } else {
      setShowPasswordPrompt(true);
      setPasswordInput('');
    }
  };

  const handlePasswordSubmit = () => {
    if (passwordInput === adminPassword) {
      setIsAdminMode(true);
      setShowPasswordPrompt(false);
      setPasswordInput('');
    } else {
      alert('비밀번호가 일치하지 않습니다.');
      setPasswordInput('');
    }
  };

  const handleFAQClick = (question: string) => {
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: question,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);

    // Pre-defined answer
    setTimeout(() => {
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: faqAnswers[question] || "해당 질문에 대한 정보를 찾을 수 없습니다.",
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMessage]);
    }, 500);
  };

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
      const context = searchContext(allFileData, input);
      const responseData = await getGeminiResponse(input, context, selectedModel);
      
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
    <div className="flex h-screen bg-[#F0F7FF] text-[#1A1A1A] font-sans overflow-hidden">
      {/* Left Sidebar (Admin Only) */}
      {isAdminMode && (
        <aside className="w-72 bg-[#001A4D] text-white flex flex-col border-r border-white/10 shrink-0">
          <div className="p-6 border-b border-white/5">
            <h2 className="text-sm font-bold">Admin Settings</h2>
          </div>
          <nav className="flex-1 overflow-y-auto p-4 space-y-6">
            <div className="px-2 py-3">
              <h2 className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] mb-4 flex justify-between items-center">
                <span>Loaded Files ({allFileData.length})</span>
                <button onClick={loadRepoData} className="hover:text-kcc-sky transition-colors p-1">
                  <TrendingUp size={12} className={cn(isLoading && "animate-spin")} />
                </button>
              </h2>
              <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
                {allFileData.map((file, idx) => (
                  <div key={idx} className="flex items-center gap-3 text-[11px] text-zinc-300 bg-white/5 p-2 rounded border border-white/5">
                    <FileText size={12} className="text-kcc-sky shrink-0" />
                    <span className="truncate">{file.name}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="px-2 py-6 border-t border-white/5">
              <h2 className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] mb-4">Edit FAQ Answers</h2>
              <div className="space-y-4">
                {Object.keys(faqAnswers).map((q) => (
                  <div key={q} className="space-y-1">
                    <label className="text-[10px] text-zinc-400 block truncate">{q}</label>
                    <textarea 
                      value={faqAnswers[q]}
                      onChange={(e) => setFaqAnswers(prev => ({ ...prev, [q]: e.target.value }))}
                      className="w-full bg-zinc-800/50 border border-white/10 rounded-md px-2 py-1 text-[10px] focus:outline-none h-20 resize-none"
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="px-2 py-6 border-t border-white/5">
              <h2 className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] mb-4">Admin Security</h2>
              <div className="space-y-2">
                <label className="text-[11px] text-zinc-400 flex items-center gap-2">
                  Change Password (4 digits)
                </label>
                <input 
                  type="password" 
                  maxLength={4}
                  value={adminPassword}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^0-9]/g, '');
                    if (val.length <= 4) setAdminPassword(val);
                  }}
                  className="w-full bg-zinc-800/50 border border-white/10 rounded-md px-3 py-2 text-xs focus:outline-none tracking-[0.5em]"
                />
              </div>
            </div>
            <div className="px-2 py-6 border-t border-white/5">
              <label className="text-[11px] text-zinc-400 flex items-center gap-2 mb-2">
                <Github size={12} /> GitHub Repo
              </label>
              <input 
                type="text" 
                value={repoPath}
                onChange={(e) => setRepoPath(e.target.value)}
                className="w-full bg-zinc-800/50 border border-white/10 rounded-md px-3 py-2 text-xs focus:outline-none"
              />
            </div>
          </nav>
          <div className="p-6 border-t border-white/5 bg-black/20">
            <button onClick={() => setIsAdminMode(false)} className="text-xs text-white/30 hover:text-white/60 w-full text-left">
              Exit Admin Mode
            </button>
          </div>
        </aside>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-white/50 backdrop-blur-xl m-4 rounded-3xl shadow-2xl border border-white/20 overflow-hidden">
        {/* Header */}
        <header className="h-20 border-b border-black/5 bg-white/80 flex items-center justify-between px-10 shrink-0">
          <div className="flex items-center gap-6">
            <div className="w-28 h-12 flex items-center justify-center overflow-hidden">
              <img 
                src="https://upload.wikimedia.org/wikipedia/commons/thumb/d/d4/KCC_Logo.svg/512px-KCC_Logo.svg.png" 
                alt="KCC Logo" 
                className="w-full h-auto object-contain"
                referrerPolicy="no-referrer"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = "https://www.kccworld.co.kr/common/images/logo.png";
                }}
              />
            </div>
            <div className="h-8 w-px bg-black/10" />
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight text-kcc-navy">KCC AI 주주지원 서비스</h1>
              <p className="text-xs text-zinc-500 font-medium">재무 및 사업 부문 정보를 쉽고 빠르게 검색하세요.</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <button 
              onClick={handleAdminToggle}
              className={cn(
                "p-2 rounded-full transition-all duration-300",
                isAdminMode ? "bg-kcc-sky text-white shadow-lg" : "hover:bg-zinc-100 text-zinc-400"
              )}
            >
              <Settings size={20} />
            </button>
          </div>
        </header>

        <div className="flex-1 flex min-h-0">
          {/* Chat Area */}
          <div className="flex-1 flex flex-col min-w-0 border-r border-black/5">
            <div 
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-8 space-y-6 scroll-smooth"
            >
              <AnimatePresence initial={false}>
                {messages.map((msg) => (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className={cn(
                      "flex gap-4 max-w-[85%]",
                      msg.role === 'user' ? "ml-auto flex-row-reverse" : "mr-auto"
                    )}
                  >
                    <div className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center shrink-0 shadow-sm",
                      msg.role === 'user' ? "bg-kcc-sky text-white" : "bg-white border border-black/5 text-kcc-navy"
                    )}>
                      {msg.role === 'user' ? 'K' : <BarChart3 size={20} />}
                    </div>
                    <div className="space-y-1">
                      <div className={cn(
                        "px-6 py-4 rounded-3xl text-[15px] leading-relaxed shadow-sm",
                        msg.role === 'user' 
                          ? "bg-kcc-navy text-white rounded-tr-none" 
                          : "bg-white border border-black/5 text-[#1A1A1A] rounded-tl-none"
                      )}>
                        {msg.content.split('\n').map((line, i) => (
                          <p key={i} className={line.trim() === '' ? 'h-2' : 'mb-1 last:mb-0'}>
                            {line}
                          </p>
                        ))}
                        
                        {Array.isArray(msg.groundingMetadata?.groundingChunks) && (
                          <div className="mt-4 pt-3 border-t border-black/5">
                            <div className="flex flex-wrap gap-2">
                              {msg.groundingMetadata.groundingChunks.map((chunk: any, idx: number) => (
                                chunk.web && (
                                  <a 
                                    key={idx}
                                    href={chunk.web.uri}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[10px] bg-kcc-navy/5 text-kcc-navy px-2 py-1 rounded border border-kcc-navy/10 hover:bg-kcc-navy/10 transition-colors"
                                  >
                                    {chunk.web.title || 'Source'}
                                  </a>
                                )
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      <p className="text-[10px] text-zinc-400 px-2">
                        {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              {isLoading && (
                <div className="flex items-center gap-3 text-zinc-400 text-sm">
                  <Loader2 size={18} className="animate-spin text-kcc-sky" />
                  <span>분석 중...</span>
                </div>
              )}
            </div>

            {/* Input Area */}
            <div className="p-8 pt-0">
              <div className="max-w-4xl mx-auto relative group">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                  placeholder="질문을 입력하세요..."
                  className="w-full bg-white border border-black/10 rounded-full pl-8 pr-16 py-4 text-lg shadow-lg focus:outline-none focus:border-kcc-sky transition-all"
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || isLoading}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-12 h-12 bg-kcc-navy text-white rounded-full flex items-center justify-center hover:bg-kcc-navy/90 disabled:opacity-50 transition-all"
                >
                  <Search size={20} />
                </button>
              </div>
              <div className="max-w-4xl mx-auto mt-4 flex flex-wrap gap-2 justify-center">
                <span className="text-xs text-zinc-400 font-bold mr-2">추천 질문:</span>
                {["2024년 2분기 전망", "주주총회 일정", "자사주 매입 계획", "공시 정보 및 주가 알림"].map((q) => (
                  <button
                    key={q}
                    onClick={() => setInput(q)}
                    className="px-3 py-1 bg-zinc-100 hover:bg-zinc-200 rounded-full text-[11px] text-zinc-600 transition-colors border border-black/5"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-center text-[11px] text-zinc-400 mb-4 font-medium uppercase tracking-widest">
              Fact-based IR Assistant powered by KCC AI Data & Gemini 3.1 Pro
            </p>
          </div>

          {/* Right FAQ Sidebar */}
          <aside className="w-80 bg-white/30 p-8 flex flex-col shrink-0">
            <h2 className="text-xs font-bold text-zinc-800 uppercase tracking-widest mb-6 flex items-center gap-2">
              <TrendingUp size={14} className="text-kcc-sky" /> 반복되는 질문 (FAQS)
            </h2>
            <div className="grid grid-cols-2 gap-4">
              {Object.keys(faqAnswers).map((q, idx) => {
                const icons = [<Database key={1} />, <TrendingUp key={2} />, <BarChart3 key={3} />, <AlertCircle key={4} />];
                return (
                  <button
                    key={q}
                    onClick={() => handleFAQClick(q)}
                    className="aspect-square bg-white border border-black/5 rounded-2xl p-4 flex flex-col items-center justify-center text-center gap-3 hover:shadow-xl hover:border-kcc-sky/30 transition-all group shadow-sm"
                  >
                    <div className="w-10 h-10 bg-kcc-sky/10 text-kcc-sky rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
                      {icons[idx % icons.length]}
                    </div>
                    <span className="text-[11px] font-bold text-zinc-700 leading-tight">{q}</span>
                  </button>
                );
              })}
            </div>
            
            <div className="mt-auto p-4 bg-kcc-navy/5 rounded-2xl border border-kcc-navy/10">
              <p className="text-[10px] text-kcc-navy font-bold mb-1">KCC AI 주주지원 서비스</p>
              <p className="text-[9px] text-zinc-500 leading-relaxed">
                본 서비스는 주주님들께 신속하고 투명한 정보를 제공하기 위해 운영됩니다.
              </p>
            </div>
          </aside>
        </div>
      </div>

      {/* Password Prompt Modal */}
      <AnimatePresence>
        {showPasswordPrompt && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white rounded-3xl p-8 w-full max-w-sm shadow-2xl border border-white/20"
            >
              <div className="text-center space-y-4">
                <div className="w-16 h-16 bg-kcc-navy/5 text-kcc-navy rounded-2xl flex items-center justify-center mx-auto">
                  <Settings size={32} />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-kcc-navy">관리자 인증</h3>
                  <p className="text-sm text-zinc-500">비밀번호 4자리를 입력해 주세요.</p>
                </div>
                <div className="pt-4">
                  <input 
                    type="password" 
                    autoFocus
                    maxLength={4}
                    value={passwordInput}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9]/g, '');
                      if (val.length <= 4) setPasswordInput(val);
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && handlePasswordSubmit()}
                    className="w-full text-center text-3xl tracking-[1em] font-bold py-4 border-b-2 border-kcc-navy/20 focus:border-kcc-sky outline-none transition-colors"
                  />
                </div>
                <div className="flex gap-3 pt-6">
                  <button 
                    onClick={() => setShowPasswordPrompt(false)}
                    className="flex-1 py-3 rounded-xl text-sm font-bold text-zinc-500 hover:bg-zinc-100 transition-colors"
                  >
                    취소
                  </button>
                  <button 
                    onClick={handlePasswordSubmit}
                    className="flex-1 py-3 bg-kcc-navy text-white rounded-xl text-sm font-bold hover:bg-kcc-navy/90 transition-all shadow-lg shadow-kcc-navy/20"
                  >
                    확인
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
