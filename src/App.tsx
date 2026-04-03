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
  Github,
  ArrowUpRight,
  PieChart,
  Activity,
  ChevronRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as RechartsTooltip 
} from 'recharts';
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

interface FAQItem {
  id: string;
  question: string;
  answer: string;
}

const DEFAULT_FAQ_ANSWERS: FAQItem[] = [
  {
    id: 'faq-0',
    question: "최근 사업부문별 주요 이슈",
    answer: "**[건자재]** 건축 시장 위축에 대응하여 반도체 클러스터나 데이터센터 등 상업용 물량과 공공 건설 수주 확대에 집중하고 있습니다.\n\n**[도료]** 자동차 및 선박도료의 견조한 실적을 바탕으로, 친환경 선박 도료 확대와 최근 유가 변동에 따른 원재료 리스크 관리에 주력하고 있습니다.\n\n**[실리콘]** 중국의 유기실리콘 감산, 경쟁사의 구조조정 이슈로 최근 실리콘 원재료 가격이 반등하였으며, 실리콘 적용 분야 확대와 장기적인 실적 개선을 추진 중입니다."
  },
  {
    id: 'faq-1',
    question: "최근 배당금 및 배당성향",
    answer: "KCC는 최근 3개년에서 다음과 같이 연간배당금을 지급하였으며, 주주 환원을 위해 배당금을 지속적으로 확대하고 있습니다.\n\n• **2023년(제66기)** : 8,000원/주\n• **2024년(제67기)** : 10,000원/주\n• **2025년(제68기)** : 15,000원/주"
  },
  {
    id: 'faq-2',
    question: "KCC의 ESG활동 및 평가",
    answer: "KCC는 '더 나은 삶을 위한 가치창조'라는 경영 이념 아래, 친환경 제품 개발 확대 및 수계 도료 전환 등 탄소중립 실현을 위한 환경 경영을 강화하고 있습니다. 매년 지속가능경영보고서를 통해 성과를 투명하게 공개하고 있으며, 한국ESG기준원(KCGS) 등 주요 평가 기관으로부터 업계 상위 수준의 등급을 유지하며 성과를 인정받고 있습니다."
  },
  {
    id: 'faq-3',
    question: "신규 사업 추진 현황",
    answer: "KCC는 세계적인 실리콘 기업인 모멘티브 인수를 통해 고부가가치 실리콘 소재를 차세대 먹거리로 확정하고 글로벌 시장 점유율을 높이고 있습니다. 또한, 전기차 배터리용 유기 절연재, 반도체 패키징 소재(EMC) 등 첨단 산업에 필수적인 유·무기 복합 소재 기술 개발에 박차를 가하고 있습니다."
  },
  {
    id: 'faq-4',
    question: "공시 정보 및 IR자료",
    answer: "KCC의 공시정보는 DART(전자공시시스템)을 통해 확인하실 수 있으며, 관련 IR자료는 [IR홈페이지](https://kccworld.irpage.co.kr/)를 참고하여 주시길 바랍니다."
  },
  {
    id: 'faq-5',
    question: "자사주 매입 및 소각 계획",
    answer: "KCC는 2026년 3월 9일 자사주 활용계획을 공시하였으며, 자기주식 1,532,300주(발행주식 총수의 17.2%)에서 임직원 보상 약 358,000주(발행주식 총수의 4.0%)를 제외한 나머지를 4회에 걸쳐 전량소각하기로 결정하였습니다."
  },
  {
    id: 'faq-6',
    question: "글로벌 시장 진출 전략",
    answer: "KCC는 중국, 동남아, 튀르키예 등 주요 거점 국가에 도료 및 소재 법인을 구축하여 물류 효율을 높이고, 현지 맞춤형 제품 공급을 통해 시장 지배력을 강화하고 있습니다. 또한 모멘티브와의 시너지를 극대화하여 실리콘 제품의 북미 및 유럽 시장 유통망을 확보하고, 시장의 환경 규제에 맞춘 친환경 솔루션으로 글로벌 브랜드 인지도를 높이고 있습니다."
  }
];

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
  const [faqAnswers, setFaqAnswers] = useState<FAQItem[]>(DEFAULT_FAQ_ANSWERS);

  // Fetch FAQ from backend on mount
  useEffect(() => {
    fetch('/api/faq')
      .then(res => {
        if (!res.ok) throw new Error('FAQ not found');
        return res.json();
      })
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setFaqAnswers(data);
        }
      })
      .catch(err => {
        console.log('Using default FAQs, backend fetch failed:', err);
        // Fallback to local storage if backend fails
        try {
          const saved = localStorage.getItem('kcc_faq_answers');
          const parsed = saved ? JSON.parse(saved) : null;
          if (parsed && Array.isArray(parsed)) {
            setFaqAnswers(parsed);
          }
        } catch (e) {}
      });
  }, []);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: 'KCC의 가치를 믿고 동행해 주시는 주주님, 진심으로 환영합니다. 우측의 [자주 찾는 질문]을 클릭하시거나, 하단에 궁금하신 내용을 직접 입력해 주세요.',
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
  const [activeTab, setActiveTab] = useState<'chat' | 'dashboard'>('chat');
  const [showSaveToast, setShowSaveToast] = useState(false);
  const [passwordError, setPasswordError] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(550);
  const [isDragging, setIsDragging] = useState(false);
  const [loadingTime, setLoadingTime] = useState(0);

  // Loading Timer Effect
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isLoading) {
      setLoadingTime(0);
      interval = setInterval(() => {
        setLoadingTime((prev) => prev + 1);
      }, 1000);
    } else {
      setLoadingTime(0);
    }
    return () => clearInterval(interval);
  }, [isLoading]);

  // Loading Messages
  const getLoadingMessage = (time: number) => {
    if (time < 3) return "내부 IR 데이터를 검색하고 있습니다...";
    if (time < 6) return "최신 외부 기사와 증권사 리포트를 분석 중입니다...";
    if (time < 9) return "데이터를 종합하여 답변을 생성하고 있습니다...";
    return "심층 분석 중입니다. 잠시만 기다려 주세요...";
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const newWidth = window.innerWidth - e.clientX - 16;
      if (newWidth >= 300 && newWidth <= 900) {
        setSidebarWidth(newWidth);
      }
    };
    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
    } else {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [isDragging]);
  
  // Mock debt ratio data (Last 3 years)
  const debtRatioData = [
    { name: '2023년', value: 140.8 },
    { name: '2024년', value: 135.5 },
    { name: '2025년', value: 128.2 },
  ];
  
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

  const handleSaveFaq = async () => {
    // Save to local storage as fallback
    localStorage.setItem('kcc_faq_answers', JSON.stringify(faqAnswers));
    
    // Save to backend permanently
    try {
      const res = await fetch('/api/faq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(faqAnswers)
      });
      
      if (res.ok) {
        setShowSaveToast(true);
        setTimeout(() => setShowSaveToast(false), 3000);
      } else {
        alert('서버 저장에 실패했습니다. 로컬에만 임시 저장됩니다.');
      }
    } catch (err) {
      console.error('FAQ save error:', err);
      alert('저장 중 오류가 발생했습니다. 로컬에만 임시 저장됩니다.');
    }
  };

  useEffect(() => {
    localStorage.setItem('kcc_admin_password', adminPassword);
  }, [adminPassword]);

  const handleAdminToggle = () => {
    if (isAdminMode) {
      setIsAdminMode(false);
    } else {
      setShowPasswordPrompt(true);
      setPasswordInput('');
      setPasswordError(false);
    }
  };

  const handlePasswordSubmit = () => {
    // 0815를 마스터 키로 항상 허용하여 잠김 방지
    if (passwordInput === '0815' || passwordInput === adminPassword) {
      setIsAdminMode(true);
      setShowPasswordPrompt(false);
      setPasswordInput('');
      setPasswordError(false);
    } else {
      setPasswordError(true);
      setPasswordInput('');
    }
  };

  const handleFAQClick = (faq: FAQItem) => {
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: faq.question,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);

    // Pre-defined answer
    setTimeout(() => {
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: faq.answer || "해당 질문에 대한 정보를 찾을 수 없습니다.",
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
    <div className="flex h-screen bg-[#F0F7FF] text-[#1A1A1A] font-sans overflow-hidden flex-col lg:flex-row">
      {/* Left Sidebar (Admin Only) - Hidden on mobile for simplicity, or could be a drawer */}
      {isAdminMode && (
        <aside className="hidden lg:flex w-72 bg-[#001A4D] text-white flex-col border-r border-white/10 shrink-0">
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
            <div className="px-2 py-6 border-t border-white/5 relative">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em]">Edit FAQ Answers</h2>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setFaqAnswers(DEFAULT_FAQ_ANSWERS)}
                    className="text-[9px] text-zinc-400 hover:text-white transition-colors"
                  >
                    초기화
                  </button>
                  <button 
                    onClick={handleSaveFaq}
                    className="text-[9px] bg-kcc-sky text-white px-2 py-1 rounded hover:bg-kcc-sky/80 transition-colors"
                  >
                    저장하기
                  </button>
                </div>
              </div>
              
              <AnimatePresence>
                {showSaveToast && (
                  <motion.div 
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="absolute top-2 left-1/2 -translate-x-1/2 bg-green-500 text-white text-[10px] px-3 py-1 rounded-full shadow-lg z-10"
                  >
                    저장되었습니다
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="space-y-6">
                {faqAnswers.map((faq, idx) => (
                  <div key={faq.id} className="space-y-2 p-3 bg-white/5 rounded-lg border border-white/5">
                    <div className="space-y-1">
                      <label className="text-[9px] text-zinc-500 uppercase font-bold">Question Title</label>
                      <input 
                        type="text"
                        value={faq.question}
                        onChange={(e) => {
                          const newFaqs = [...faqAnswers];
                          newFaqs[idx] = { ...newFaqs[idx], question: e.target.value };
                          setFaqAnswers(newFaqs);
                        }}
                        className="w-full bg-zinc-800/50 border border-white/10 rounded-md px-2 py-1 text-[10px] focus:outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] text-zinc-500 uppercase font-bold">Answer Content</label>
                      <textarea 
                        value={faq.answer}
                        onChange={(e) => {
                          const newFaqs = [...faqAnswers];
                          newFaqs[idx] = { ...newFaqs[idx], answer: e.target.value };
                          setFaqAnswers(newFaqs);
                        }}
                        className="w-full bg-zinc-800/50 border border-white/10 rounded-md px-2 py-1 text-[10px] focus:outline-none h-20 resize-none"
                      />
                    </div>
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
      <div className="flex-1 flex flex-col min-w-0 bg-white/50 backdrop-blur-xl lg:m-2 lg:rounded-2xl shadow-2xl border-x lg:border border-white/20 overflow-hidden">
        {/* Header */}
        <header className="h-14 lg:h-16 border-b border-black/5 bg-white/80 flex items-center justify-between px-4 lg:px-6 shrink-0">
          <div className="flex items-center gap-3 lg:gap-4">
            <div className="flex items-center justify-center">
              <span className="text-2xl lg:text-3xl font-black italic tracking-tighter text-kcc-navy">KCC</span>
            </div>
            <div className="h-5 lg:h-6 w-px bg-black/10" />
            <div className="min-w-0">
              <h1 className="text-sm lg:text-xl font-extrabold tracking-tight text-kcc-navy truncate">KCC IR AI 어시스턴트</h1>
              <p className="hidden lg:block text-[10px] text-zinc-500 font-medium">재무 및 사업 부문 정보를 쉽고 빠르게 검색하세요.</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2 lg:gap-4">
            {/* KCC IR Support Status (Desktop) */}
            <div className="hidden xl:flex items-center gap-3 bg-kcc-navy/5 px-4 py-1.5 rounded-full border border-kcc-navy/10 mr-2">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                <span className="text-[10px] font-bold text-kcc-navy uppercase tracking-wider">KCC IR Support</span>
              </div>
              <div className="w-px h-3 bg-kcc-navy/20" />
              <span className="text-[10px] font-medium text-zinc-600">실시간 분석 중</span>
            </div>

            {/* Mobile Tab Switcher */}
            <div className="flex lg:hidden bg-zinc-100 p-1 rounded-xl mr-2">
              <button 
                onClick={() => setActiveTab('chat')}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all",
                  activeTab === 'chat' ? "bg-white text-kcc-navy shadow-sm" : "text-zinc-400"
                )}
              >
                채팅
              </button>
              <button 
                onClick={() => setActiveTab('dashboard')}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all",
                  activeTab === 'dashboard' ? "bg-white text-kcc-navy shadow-sm" : "text-zinc-400"
                )}
              >
                대시보드
              </button>
            </div>

            <button 
              onClick={handleAdminToggle}
              className={cn(
                "p-2 rounded-full transition-all duration-300",
                isAdminMode ? "bg-kcc-sky text-white shadow-lg" : "hover:bg-zinc-100 text-zinc-400"
              )}
            >
              <Settings size={18} />
            </button>
          </div>
        </header>

        <div className="flex-1 flex min-h-0 relative">
          {/* Chat Area */}
          <div className={cn(
            "flex-1 flex flex-col min-w-0 border-r border-black/5 transition-all duration-300",
            activeTab !== 'chat' && "hidden lg:flex"
          )}>
            <div 
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-4 lg:space-y-5 scroll-smooth"
            >
              <AnimatePresence initial={false}>
                {messages.map((msg) => (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className={cn(
                      "flex gap-3 lg:gap-4 max-w-[90%] lg:max-w-[85%]",
                      msg.role === 'user' ? "ml-auto flex-row-reverse" : "mr-auto"
                    )}
                  >
                    <div className={cn(
                      "w-8 h-8 lg:w-10 lg:h-10 rounded-full flex items-center justify-center shrink-0 shadow-sm text-xs lg:text-base",
                      msg.role === 'user' ? "bg-kcc-sky text-white" : "bg-white border border-black/5 text-kcc-navy"
                    )}>
                      {msg.role === 'user' ? 'K' : <span className="font-black italic text-[10px] lg:text-xs">KCC</span>}
                    </div>
                    <div className="space-y-1">
                      <div className={cn(
                        "px-3 py-2 lg:px-5 lg:py-3 rounded-xl lg:rounded-2xl text-[13px] lg:text-[13.5px] leading-relaxed shadow-sm",
                        msg.role === 'user' 
                          ? "bg-kcc-navy text-white rounded-tr-none" 
                          : "bg-white border border-black/5 text-[#1A1A1A] rounded-tl-none"
                      )}>
                        {msg.role === 'user' ? (
                          msg.content.split('\n').map((line, i) => (
                            <p key={i} className={line.trim() === '' ? 'h-2' : 'mb-1 last:mb-0'}>
                              {line}
                            </p>
                          ))
                        ) : (
                          <div className="markdown-body">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {msg.content}
                            </ReactMarkdown>
                          </div>
                        )}
                        
                        {Array.isArray(msg.groundingMetadata?.groundingChunks) && (
                          <div className="mt-3 pt-2 border-t border-black/5">
                            <div className="flex flex-wrap gap-1.5">
                              {msg.groundingMetadata.groundingChunks.map((chunk: any, idx: number) => (
                                chunk.web && (
                                  <a 
                                    key={idx}
                                    href={chunk.web.uri}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[9px] lg:text-[10px] bg-kcc-navy/5 text-kcc-navy px-2 py-0.5 rounded border border-kcc-navy/10 hover:bg-kcc-navy/10 transition-colors"
                                  >
                                    {chunk.web.title || 'Source'}
                                  </a>
                                )
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      <p className="text-[9px] lg:text-[10px] text-zinc-400 px-2">
                        {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              {isLoading && (
                <div className="flex flex-col gap-2 bg-white/50 p-3 lg:p-4 rounded-xl border border-black/5 w-fit shadow-sm">
                  <div className="flex items-center gap-3 text-zinc-600 text-xs lg:text-sm">
                    <Loader2 size={16} className="animate-spin text-kcc-sky" />
                    <span className="font-bold">{getLoadingMessage(loadingTime)}</span>
                    <span className="text-[10px] bg-black/5 px-1.5 py-0.5 rounded text-zinc-500 font-mono">{loadingTime}s</span>
                  </div>
                  <div className="text-[10px] lg:text-[11px] text-zinc-500 pl-7 flex items-center gap-1.5">
                    <span className="inline-block w-1 h-1 bg-kcc-sky rounded-full animate-pulse" />
                    심층 분석 및 외부 데이터 검색으로 인해 <span className="font-bold text-kcc-navy">약 30초 ~ 1분</span> 정도 소요될 수 있습니다.
                  </div>
                </div>
              )}
            </div>

            {/* Input Area */}
            <div className="p-2 lg:p-4 pt-0">
              <div className="max-w-4xl mx-auto relative group">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                  placeholder="질문을 입력하세요..."
                  className="w-full bg-white border border-black/10 rounded-full pl-5 lg:pl-6 pr-12 lg:pr-14 py-2 lg:py-2.5 text-sm lg:text-sm shadow-md focus:outline-none focus:border-kcc-sky transition-all"
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || isLoading}
                  className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 lg:w-8 lg:h-8 bg-kcc-navy text-white rounded-full flex items-center justify-center hover:bg-kcc-navy/90 disabled:opacity-50 transition-all"
                >
                  <Search size={14} className="lg:w-4 lg:h-4" />
                </button>
              </div>
              <div className="max-w-4xl mx-auto mt-3 flex flex-wrap gap-2 justify-center">
                {["배당금", "실적 발표 자료", "기업가치제고계획", "IR 페이지", "주요지표", "KCC 챗봇"].map((q) => (
                  <button
                    key={q}
                    onClick={() => setInput(q)}
                    className="px-3 py-1.5 bg-white hover:bg-kcc-navy hover:text-white rounded-xl text-[10px] lg:text-[11px] font-bold text-kcc-navy transition-all border border-kcc-navy/10 shadow-sm hover:shadow-md"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-center text-[8px] lg:text-[10px] text-zinc-400 mb-2 lg:mb-3 font-medium uppercase tracking-widest px-4">
              Fact-based IR Assistant powered by KCC AI Data & Gemini 3.1 Pro
            </p>
          </div>

          {/* Resizer */}
          <div 
            className="hidden lg:flex w-1.5 hover:w-2 bg-transparent hover:bg-kcc-sky/50 cursor-col-resize transition-all z-10 shrink-0 items-center justify-center group"
            onMouseDown={() => setIsDragging(true)}
          >
            <div className="h-8 w-0.5 bg-black/10 group-hover:bg-white rounded-full" />
          </div>

          {/* Right Dashboard & FAQ Sidebar */}
          <aside 
            className={cn(
              "w-full bg-white/30 p-4 lg:p-5 flex flex-col shrink-0 overflow-y-auto border-l border-black/5 scrollbar-hide transition-all duration-300",
              activeTab !== 'dashboard' && "hidden lg:flex"
            )}
            style={{ width: typeof window !== 'undefined' && window.innerWidth >= 1024 ? sidebarWidth : '100%' }}
          >
            {/* Recent Performance Section */}
            <section className="mb-5">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-[11px] font-bold text-zinc-800 uppercase tracking-widest flex items-center gap-1.5">
                  <Activity size={12} className="text-kcc-sky" /> 2025년 주요 실적 지표
                </h2>
                <span className="text-[10px] bg-kcc-sky/10 text-kcc-sky px-2 py-0.5 rounded-full font-bold">연간 누계</span>
              </div>
              
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-white p-2.5 rounded-xl shadow-sm border border-black/5 flex flex-col items-center justify-center">
                  <p className="text-[9px] text-zinc-500 font-bold uppercase mb-1">매출액</p>
                  <span className="text-[14px] font-black text-kcc-navy">6.48조</span>
                  <span className="text-[9px] text-green-500 font-bold">-</span>
                </div>
                <div className="bg-white p-2.5 rounded-xl shadow-sm border border-black/5 flex flex-col items-center justify-center">
                  <p className="text-[9px] text-zinc-500 font-bold uppercase mb-1">영업이익</p>
                  <span className="text-[14px] font-black text-kcc-navy">4,276억</span>
                  <span className="text-[9px] text-green-500 font-bold">-</span>
                </div>
                <div className="bg-white p-2.5 rounded-xl shadow-sm border border-black/5 flex flex-col items-center justify-center">
                  <p className="text-[9px] text-zinc-500 font-bold uppercase mb-1">자산총계</p>
                  <span className="text-[14px] font-black text-kcc-navy">16.8조</span>
                  <span className="text-[9px] text-zinc-400 font-bold">-</span>
                </div>
              </div>
            </section>

            {/* FAQ Section */}
            <section className="flex-1 min-h-0 overflow-hidden flex flex-col">
              <h2 className="text-[11px] font-bold text-zinc-800 uppercase tracking-widest mb-3 flex items-center gap-2">
                <TrendingUp size={12} className="text-kcc-sky" /> 자주 하는 질문
              </h2>
              <div className="space-y-2 overflow-y-auto pr-1 scrollbar-hide flex-1">
                {faqAnswers.map((faq, idx) => (
                  <button
                    key={faq.id}
                    onClick={() => handleFAQClick(faq)}
                    className="w-full group bg-white hover:bg-kcc-navy border border-black/5 rounded-xl p-2.5 flex items-center justify-between transition-all hover:shadow-md"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 bg-kcc-sky/10 text-kcc-sky rounded-lg flex items-center justify-center group-hover:bg-white/20 group-hover:text-white transition-colors">
                        {[<Database size={12} key={1} />, <TrendingUp size={12} key={2} />, <BarChart3 size={12} key={3} />, <AlertCircle size={12} key={4} />, <Settings size={12} key={5} />, <Activity size={12} key={6} />, <FileText size={12} key={7} />][idx % 7]}
                      </div>
                      <span className="text-[12px] font-bold text-zinc-700 group-hover:text-white transition-colors text-left">{faq.question}</span>
                    </div>
                    <ChevronRight size={12} className="text-zinc-300 group-hover:text-white transition-colors shrink-0" />
                  </button>
                ))}
              </div>
            </section>
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
                      if (passwordError) setPasswordError(false);
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && handlePasswordSubmit()}
                    className={cn(
                      "w-full text-center text-3xl tracking-[1em] font-bold py-4 border-b-2 outline-none transition-colors",
                      passwordError ? "border-red-500 text-red-500" : "border-kcc-navy/20 focus:border-kcc-sky"
                    )}
                  />
                  {passwordError && (
                    <p className="text-xs text-red-500 mt-2 font-medium">비밀번호가 일치하지 않습니다.</p>
                  )}
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
