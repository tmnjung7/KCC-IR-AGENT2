/**
 * KCC IR:ON 개선판 (v2)
 *
 * 목표 UI 레퍼런스(IR_ON_개선초안_v2.html)의 구조·동작을 기존 스택(React+Tailwind) 위에서 구현:
 *  - 답변 카드: 본문 접힘/펼침 → 출처 3계층 블록 → 후속 질문 칩 → 푸터
 *  - 출처 3계층(DART/KCC IR/참고 보도) + 블랙리스트 필터, 공식 출처 없으면 경고 배지
 *  - FAQ 즉답(LLM 호출 없음) + "더 자세한 답변 요청" 버튼
 *  - 시작 카드 4개, Enter 전송(Shift+Enter 줄바꿈), 대기 점 3개 애니메이션
 *  - 모바일(<1024px): 채팅 단일 화면 + 상단 주가 1줄 바 + FAQ 하단 시트
 *  - CI 컬러: 남색 #253983 / 레드 #ED272D 포인트
 *  - 최초 방문 1회 고지 모달, 하단 고정 면책 1줄
 *
 * 오리지널(App.tsx)은 그대로 유지되며 / 경로에서 제공된다. 이 컴포넌트는 /v2 전용.
 */
import React, { useState, useEffect, useRef } from 'react';
import {
  Search, Loader2, Settings, Globe, Mail, CalendarDays, Newspaper, Activity,
  BarChart3, TrendingUp, Landmark, ChevronRight, ChevronDown, ChevronUp,
  AlertCircle, MessageCircleQuestion, X, Target, Coins, Factory, Rocket,
  Globe2, FileText, Sparkles
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, LabelList
} from 'recharts';
import { fetchAllCSVFromRepo, searchContext, fetchDartData, DartSummary } from './services/dataService';
import {
  getAIResponse, fetchProviderAvailability, Provider, ModelTier, ProviderAvailability,
  classifySources, ClassifiedSource
} from './services/llm';
import defaultFaqData from './data/faq.json';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

// ── CI 컬러 토큰 ─────────────────────────────────────────────────────────────
const CI = { navy: '#253983', red: '#ED272D', blue: '#0B57D0' };

interface FAQItem { id: string; question: string; answer: string }
const FAQ_LIST: FAQItem[] = defaultFaqData as FAQItem[];

// FAQ 메타 (아이콘·한 줄 설명·후속 질문)
const FAQ_META: Record<string, { icon: React.ReactNode; desc: string; follow: string[] }> = {
  '주주환원·기업가치 제고 계획 (밸류업)': {
    icon: <Target size={15} />, desc: '2030 PBR 1배 · 영업이익률 10% 목표',
    follow: ['최근 배당금 및 배당정책', '자사주 매입 및 소각 계획'],
  },
  '최근 배당금 및 배당정책': {
    icon: <Coins size={15} />, desc: 'DPS 15,000원 · 특별배당 연동 3단 구조',
    follow: ['주주환원·기업가치 제고 계획 (밸류업)', '자사주 매입 및 소각 계획'],
  },
  '자사주 매입 및 소각 계획': {
    icon: <TrendingUp size={15} />, desc: '117만주 4회 분할 소각 · 2027년 9월 완료',
    follow: ['주주환원·기업가치 제고 계획 (밸류업)', '최근 배당금 및 배당정책'],
  },
  '최근 사업부문별 주요 이슈': {
    icon: <Factory size={15} />, desc: '실리콘·도료·건자재 부문별 실적과 이슈',
    follow: ['신규 사업 추진 현황', '글로벌 시장 진출 전략'],
  },
  '신규 사업 추진 현황': {
    icon: <Rocket size={15} />, desc: '전력반도체 · AI 데이터센터 소재 공략',
    follow: ['최근 사업부문별 주요 이슈', '글로벌 시장 진출 전략'],
  },
  '글로벌 시장 진출 전략': {
    icon: <Globe2 size={15} />, desc: '13개국 36개 법인 · 모멘티브 시너지',
    follow: ['신규 사업 추진 현황', '최근 사업부문별 주요 이슈'],
  },
  '공시 정보 및 IR 자료': {
    icon: <FileText size={15} />, desc: 'DART · IR 홈페이지 바로가기',
    follow: ['주주환원·기업가치 제고 계획 (밸류업)'],
  },
};

const findFaq = (question: string): FAQItem | undefined =>
  FAQ_LIST.find(f => f.question === question || f.question.includes(question) || question.includes(f.question));

// 시작 카드 4개 (레퍼런스 HTML 구조)
const START_CARDS = [
  { icon: <Factory size={16} />, title: '2026년 2분기 실적 한눈에', desc: '매출 · 영업이익 · 부문별 실적', faq: '최근 사업부문별 주요 이슈' },
  { icon: <Coins size={16} />, title: '배당 · 자사주 정책', desc: 'DPS 15,000원 · 특별배당 연동 · 소각', faq: '최근 배당금 및 배당정책' },
  { icon: <Target size={16} />, title: '기업가치 제고 계획(밸류업)', desc: '2030 PBR 1배 · 영업이익률 10%', faq: '주주환원·기업가치 제고 계획 (밸류업)' },
  { icon: <FileText size={16} />, title: '공시 · IR 자료 찾기', desc: 'DART · IR 홈페이지 바로가기', faq: '공시 정보 및 IR 자료' },
];

const HINT_CHIPS: { label: string; faq?: string; ai?: string }[] = [
  { label: '배당금', faq: '최근 배당금 및 배당정책' },
  { label: '2분기 실적', faq: '최근 사업부문별 주요 이슈' },
  { label: '자사주 소각', faq: '자사주 매입 및 소각 계획' },
  { label: '밸류업', faq: '주주환원·기업가치 제고 계획 (밸류업)' },
  { label: '신규사업', faq: '신규 사업 추진 현황' },
  { label: '최근 공시', faq: '공시 정보 및 IR 자료' },
];

interface QuoteData { name: string; code: string; price: number; change: number; changePct: number; updatedAt: string; source: string }
interface NewsItemData { title: string; link: string; date: string; source: string }
interface Disclosure { date: string; title: string; filer: string; url: string }

interface V2Message {
  id: string;
  role: 'user' | 'assistant';
  kind: 'welcome' | 'faq' | 'ai' | 'error';
  content: string;
  question?: string;      // faq/ai: 원 질문
  sources?: ClassifiedSource[];
  hasOfficial?: boolean;  // ai: DART/KCC 공식 출처 포함 여부
  followUps?: string[];
  timestamp: Date;
}

const nowTime = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// ── 답변 카드 하위 컴포넌트 ─────────────────────────────────────────────────
const SourceBlock = ({ sources }: { sources: ClassifiedSource[] }) => {
  if (!sources.length) return null;
  const levelStyle: Record<string, string> = {
    dart: 'bg-[#E8F0FE] text-[#0B57D0]',
    kcc: 'bg-emerald-50 text-emerald-700',
    news: 'bg-zinc-100 text-zinc-500',
  };
  const levelLabel: Record<string, string> = { dart: 'DART', kcc: 'KCC IR', news: '참고 보도' };
  return (
    <div className="mt-3 bg-[#F4F6FA] rounded-lg px-3 py-2.5">
      <p className="text-[10px] font-bold text-zinc-500 mb-1">출처</p>
      {sources.map((s, i) => (
        <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-2 py-1 text-[12px] text-zinc-700 hover:text-[#0B57D0] transition-colors">
          <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0', levelStyle[s.level])}>
            {levelLabel[s.level]}
          </span>
          <span className="truncate">{s.title}</span>
          <span className="text-[10px] text-zinc-400 shrink-0 ml-auto hidden sm:inline">{s.host}</span>
        </a>
      ))}
    </div>
  );
};

const CollapsibleBody = ({ content }: { content: string }) => {
  const isLong = content.length > 500;
  const [open, setOpen] = useState(!isLong);
  return (
    <div>
      <div className={cn('markdown-body relative', !open && 'max-h-[150px] overflow-hidden')}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        {!open && <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-white to-transparent" />}
      </div>
      {isLong && (
        <button onClick={() => setOpen(o => !o)}
          className="mt-1 text-[12px] font-bold text-[#0B57D0] flex items-center gap-0.5 hover:underline">
          {open ? <>접기 <ChevronUp size={12} /></> : <>자세히 보기 <ChevronDown size={12} /></>}
        </button>
      )}
    </div>
  );
};

export default function AppV2() {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isDataLoading, setIsDataLoading] = useState(false);
  const [allFileData, setAllFileData] = useState<{ name: string, data: any[] }[]>([]);
  const [dartSummary, setDartSummary] = useState<DartSummary | null>(null);
  const [dartStatus, setDartStatus] = useState<'loading' | 'ok' | 'off'>('loading');
  const [disclosures, setDisclosures] = useState<Disclosure[]>([]);
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [news, setNews] = useState<NewsItemData[]>([]);
  const [feedTab, setFeedTab] = useState<'news' | 'dart'>('news');
  const [provider, setProvider] = useState<Provider>('gemini');
  const [providerAvail, setProviderAvail] = useState<ProviderAvailability>({ gemini: true, claude: false, dart: false });
  const [tier, setTier] = useState<ModelTier>('flash'); // 오리지널과 동일 (상세 답변 = FLASH)
  const [isEnglishMode, setIsEnglishMode] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [showNotice, setShowNotice] = useState(() => {
    try { return !localStorage.getItem('kcc_v2_notice_seen'); } catch { return false; }
  });

  const [messages, setMessages] = useState<V2Message[]>([
    { id: 'welcome', role: 'assistant', kind: 'welcome', content: '', timestamp: new Date() },
  ]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const isStreamingRef = useRef(false);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isLoading]);

  // ── 데이터 로드 (DART + CSV 병합, 주가/뉴스) ────────────────────────────
  useEffect(() => {
    (async () => {
      setIsDataLoading(true);
      const [dartResult, csvResult] = await Promise.allSettled([
        fetchDartData(),
        fetchAllCSVFromRepo('tmnjung7/KCC-IR-AGENT2'),
      ]);
      const merged: { name: string, data: any[] }[] = [];
      if (dartResult.status === 'fulfilled') {
        merged.push(...dartResult.value.files);
        setDartSummary(dartResult.value.summary);
        setDartStatus('ok');
        // 최근 공시 목록 추출
        const discFile = dartResult.value.files.find(f => f.name.startsWith('DART_최근공시목록'));
        if (discFile) {
          const rows = discFile.data.slice(1, 8).map((r: string[]) => ({
            date: String(r[0] || '').replace(/(\d{4})(\d{2})(\d{2})/, '$1.$2.$3'),
            title: String(r[1] || ''),
            filer: String(r[2] || ''),
            url: String(r[3] || ''),
          })).filter(d => d.title);
          setDisclosures(rows);
        }
      } else {
        setDartStatus('off');
      }
      if (csvResult.status === 'fulfilled') merged.push(...csvResult.value);
      setAllFileData(merged);
      setIsDataLoading(false);
    })();

    fetchProviderAvailability().then(a => {
      setProviderAvail(a);
      if (!a.claude) setProvider('gemini');
    });

    const loadQuote = () => fetch('/api/quote').then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.price) setQuote(d); }).catch(() => {});
    loadQuote();
    const iv = setInterval(loadQuote, 60000);
    fetch('/api/news').then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!Array.isArray(d?.items)) return;
        // 최근 2일 뉴스만 표시, 없으면 최신 5건 폴백
        const cutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const recent = d.items.filter((n: NewsItemData) => n.date && n.date >= cutoff);
        setNews(recent.length > 0 ? recent : d.items.slice(0, 5));
      }).catch(() => {});
    return () => clearInterval(iv);
  }, []);

  // ── FAQ 즉답 (LLM 호출 없음) ────────────────────────────────────────────
  const answerFaq = (question: string) => {
    const faq = findFaq(question);
    if (!faq) { sendToAI(question); return; }
    setSheetOpen(false);
    const meta = FAQ_META[faq.question];
    setMessages(prev => [...prev,
      { id: `u-${Date.now()}`, role: 'user', kind: 'ai', content: faq.question, timestamp: new Date() },
      {
        id: `f-${Date.now()}`, role: 'assistant', kind: 'faq', content: faq.answer,
        question: faq.question, followUps: meta?.follow || [], timestamp: new Date(),
      },
    ]);
  };

  // ── AI 질의 (strict 모드: 전망치·추정치 차단) ───────────────────────────
  const sendToAI = async (question: string) => {
    if (isStreamingRef.current) return;
    setSheetOpen(false);
    const assistantId = `a-${Date.now()}`;
    setMessages(prev => [...prev,
      { id: `u-${Date.now()}`, role: 'user', kind: 'ai', content: question, timestamp: new Date() },
      { id: assistantId, role: 'assistant', kind: 'ai', content: '', question, timestamp: new Date() },
    ]);
    setIsLoading(true);
    isStreamingRef.current = true;

    try {
      const context = searchContext(allFileData, question);
      let chunkCount = 0;
      const responseData = await getAIResponse(
        question, context, provider, tier, isEnglishMode,
        (chunk: string) => {
          chunkCount++;
          if (chunkCount === 1) setIsLoading(false);
          setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: m.content + chunk } : m));
        },
        false // 답변 로직은 오리지널과 동일하게 유지 (디자인만 개선)
      );
      const { sources, hasOfficial } = classifySources(responseData?.groundingMetadata);
      setMessages(prev => prev.map(m => m.id === assistantId ? {
        ...m,
        content: responseData?.text || m.content || '일시적인 오류로 응답을 받지 못했습니다. 다시 시도해 주세요.',
        sources, hasOfficial: sources.length === 0 ? true : hasOfficial,
      } : m));
    } catch (err: any) {
      // 서버가 보낸 실제 오류 문구를 최대한 그대로 노출 (진단 용이)
      let raw = String(err?.message || '');
      try {
        const jsonMatch = raw.match(/\{.*\}/);
        if (jsonMatch) {
          const j = JSON.parse(jsonMatch[0]);
          raw = (typeof j.error === 'string' ? j.error : j.error?.message) || raw;
        }
      } catch { /* 무시 */ }
      const friendly =
        raw.includes('429') || raw.includes('quota') ? '현재 AI 요청이 일시적으로 제한되었습니다. 잠시 후 다시 시도해 주세요.'
        : raw.includes('404') || raw.includes('not found') ? 'AI 모델 연결에 문제가 있습니다. 상단에서 "상세 답변"으로 전환해 다시 시도해 주세요.'
        : raw && raw.length < 250 ? raw
        : '오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, kind: 'error', content: `⚠️ ${friendly}` } : m));
    } finally {
      setIsLoading(false);
      isStreamingRef.current = false;
    }
  };

  const handleSend = () => {
    const q = input.trim();
    if (!q || isStreamingRef.current) return;
    setInput('');
    // 자유 입력이 FAQ 제목과 겹치면 즉답 우선
    const faq = FAQ_LIST.find(f => f.question === q);
    if (faq) answerFaq(faq.question);
    else sendToAI(q);
  };

  // KPI 계산 (연간, DART)
  const opMargin = dartSummary?.revenue && dartSummary?.operatingProfit
    ? Math.round((dartSummary.operatingProfit / dartSummary.revenue) * 1000) / 10 : null;
  const prevMargin = (() => {
    const s = dartSummary;
    if (!s?.revenue || !s?.operatingProfit || s.yoy.revenue === null || s.yoy.operatingProfit === null) return null;
    const pr = s.revenue / (1 + s.yoy.revenue / 100);
    const po = s.operatingProfit / (1 + s.yoy.operatingProfit / 100);
    return pr ? Math.round((po / pr) * 1000) / 10 : null;
  })();
  const marginDelta = opMargin !== null && prevMargin !== null ? Math.round((opMargin - prevMargin) * 10) / 10 : null;

  const fmtKrw = (m: number | null) => {
    if (m === null) return '—';
    const abs = Math.abs(m);
    if (abs >= 1_000_000) return `${(m / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}조`;
    if (abs >= 100) return `${Math.round(m / 100).toLocaleString()}억`;
    return `${m.toLocaleString()}백만`;
  };

  const Delta = ({ v, suffix = '% YoY' }: { v: number | null; suffix?: string }) => {
    if (v === null) return <span className="text-[11px] text-zinc-400 font-semibold">—</span>;
    const up = v >= 0;
    return (
      <span className={cn('text-[11px] font-bold', up ? 'text-[#D93025]' : 'text-[#0B57D0]')}>
        {up ? '▲' : '▼'} {Math.abs(v)}{suffix}
      </span>
    );
  };

  const VersionSwitch = () => (
    <div className="flex items-center bg-zinc-100 p-0.5 rounded-full border border-black/5 text-[11px] font-bold shrink-0">
      <a href="/" className="px-2.5 py-1 rounded-full text-zinc-400 hover:text-zinc-600">오리지널</a>
      <span className="px-2.5 py-1 rounded-full bg-[#253983] text-white shadow-sm">개선판</span>
    </div>
  );

  // ── 렌더링 ──────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-[#F4F6FA] text-[#1F2937] font-sans overflow-hidden">
      {/* 헤더 */}
      <header className="bg-white border-b border-[#E5E7EB] flex items-center justify-between px-4 lg:px-6 h-14 lg:h-[72px] shrink-0 gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <img src="/kcc-logo.png" alt="KCC" className="h-8 lg:h-10 w-auto shrink-0 select-none" draggable={false} />
          <div className="min-w-0">
            <h1 className="text-[17px] lg:text-[21px] font-extrabold tracking-tight leading-tight whitespace-nowrap" style={{ color: CI.navy }}>
              KCC IR<span style={{ color: CI.red }}>:</span>ON
            </h1>
            <p className="hidden lg:block text-[11px] text-zinc-500">DART 공시 데이터 기반 AI 투자자 소통 서비스</p>
          </div>
          <nav className="hidden xl:flex items-center gap-1 ml-4">
            <a href="https://kccworld.irpage.co.kr/" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[12px] font-semibold text-zinc-600 hover:text-[#253983] hover:bg-[#F4F6FA] rounded-lg px-2.5 py-1.5 transition-colors">
              <Globe size={13} /> IR 홈페이지
            </a>
            <a href="mailto:ygjung@kccworld.co.kr"
              className="flex items-center gap-1.5 text-[12px] font-semibold text-zinc-600 hover:text-[#253983] hover:bg-[#F4F6FA] rounded-lg px-2.5 py-1.5 transition-colors">
              <Mail size={13} /> IR 문의
            </a>
            <a href="https://kccworld.irpage.co.kr/ermt01/meeting" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[12px] font-semibold text-zinc-600 hover:text-[#253983] hover:bg-[#F4F6FA] rounded-lg px-2.5 py-1.5 transition-colors">
              <CalendarDays size={13} /> IR 미팅 예약
            </a>
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {dartStatus === 'ok' && dartSummary && (
            <span className="hidden lg:flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 px-2 py-1 rounded-full"
              title={`마지막 동기화: ${new Date(dartSummary.lastSync).toLocaleString()}`}>
              <Landmark size={10} /> DART 연동 · {new Date(dartSummary.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <div className="hidden md:flex items-center bg-zinc-100 p-1 rounded-full text-[11px] font-bold"
            title="빠른 답변: FAQ·공시 기반 즉답 / 상세 답변: 여러 공시를 종합해 답변">
            <button onClick={() => setTier('lite')}
              className={cn('px-3 py-1.5 rounded-full transition-all', tier === 'lite' ? 'bg-white text-[#253983] shadow-sm' : 'text-zinc-400')}>
              빠른 답변
            </button>
            <button onClick={() => setTier('flash')}
              className={cn('px-3 py-1.5 rounded-full transition-all', tier === 'flash' ? 'bg-white text-[#253983] shadow-sm' : 'text-zinc-400')}>
              상세 답변
            </button>
          </div>
          {providerAvail.claude && (
            <div className="hidden md:flex items-center bg-zinc-100 p-1 rounded-full text-[11px] font-bold">
              <button onClick={() => setProvider('gemini')}
                className={cn('px-2.5 py-1.5 rounded-full', provider === 'gemini' ? 'bg-white text-[#1a73e8] shadow-sm' : 'text-zinc-400')}>Gemini</button>
              <button onClick={() => setProvider('claude')}
                className={cn('flex items-center gap-1 px-2.5 py-1.5 rounded-full', provider === 'claude' ? 'bg-[#CC7C5E] text-white shadow-sm' : 'text-zinc-400')}>
                <Sparkles size={10} />Claude</button>
            </div>
          )}
          <div className="hidden sm:flex items-center bg-zinc-100 p-1 rounded-full text-[11px] font-bold">
            <button onClick={() => setIsEnglishMode(false)}
              className={cn('px-2.5 py-1.5 rounded-full', !isEnglishMode ? 'bg-white text-[#253983] shadow-sm' : 'text-zinc-400')}>KOR</button>
            <button onClick={() => setIsEnglishMode(true)}
              className={cn('px-2.5 py-1.5 rounded-full', isEnglishMode ? 'bg-[#253983] text-white shadow-sm' : 'text-zinc-400')}>ENG</button>
          </div>
          <VersionSwitch />
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* ── 채팅 영역 ── */}
        <section className="flex-1 flex flex-col min-w-0 bg-white lg:border-r border-[#E5E7EB]">
          {/* 모바일 주가 1줄 바 */}
          {quote && (
            <div className="lg:hidden flex items-center justify-between text-[12px] px-4 py-2 text-white" style={{ background: CI.navy }}>
              <span className="font-bold">{quote.name} {quote.code}</span>
              <span>
                <b>{quote.price.toLocaleString()}원</b>{' '}
                <span className="opacity-85">{quote.change >= 0 ? '▲' : '▼'}{Math.abs(quote.change).toLocaleString()} ({quote.changePct >= 0 ? '+' : ''}{quote.changePct}%)</span>
              </span>
            </div>
          )}

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 lg:px-6 py-5 space-y-5 scroll-smooth">
            {messages.map(msg => (
              <motion.div key={msg.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className={cn('flex gap-3', msg.role === 'user' ? 'justify-end' : '')}>
                {msg.role === 'assistant' && (
                  <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-white font-black italic text-[10px]"
                    style={{ background: CI.navy }}>KCC</div>
                )}
                <div className={cn('min-w-0', msg.role === 'assistant' && 'flex-1 max-w-[720px]')}>
                  {msg.role === 'user' ? (
                    <div className="px-4 py-2.5 rounded-2xl rounded-tr-md text-[14px] text-white max-w-[85vw] lg:max-w-[560px]"
                      style={{ background: CI.blue }}>
                      {msg.content}
                    </div>
                  ) : msg.kind === 'welcome' ? (
                    <div className="bg-[#F4F6FA] rounded-2xl rounded-tl-md px-4 py-4 text-[14px] leading-relaxed">
                      안녕하세요, <b style={{ color: CI.navy }}>KCC IR:ON</b>입니다. DART 공시와 KCC 공식 IR 자료를 바탕으로 답변드리며, 미공개 정보나 전망치는 제공하지 않습니다.
                      <br />아래 카드를 누르거나 질문을 입력해 주세요.
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-3.5">
                        {START_CARDS.map(c => (
                          <button key={c.title} onClick={() => answerFaq(c.faq)}
                            className="text-left bg-white border border-[#E5E7EB] rounded-xl px-3.5 py-3 hover:border-[#0B57D0] hover:shadow-[0_2px_10px_rgba(11,87,208,.10)] transition-all">
                            <div className="w-8 h-8 rounded-lg bg-[#E8F0FE] text-[#0B57D0] flex items-center justify-center mb-2">{c.icon}</div>
                            <b className="block text-[13.5px]" style={{ color: CI.navy }}>{c.title}</b>
                            <span className="text-[12px] text-zinc-500">{c.desc}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="bg-white border border-[#E5E7EB] rounded-2xl rounded-tl-md px-4 lg:px-5 py-4 text-[14px] leading-relaxed shadow-sm">
                      {/* 공식 출처 부재 경고 */}
                      {msg.kind === 'ai' && msg.hasOfficial === false && (
                        <div className="flex items-center gap-2 bg-amber-50 text-amber-700 rounded-lg px-3 py-2 text-[12px] font-semibold mb-3">
                          <AlertCircle size={13} className="shrink-0" /> 공시 자료 외 정보 기반 답변입니다. 정확한 내용은 DART 공시를 확인해 주세요.
                        </div>
                      )}
                      {msg.content === '' && msg.kind === 'ai' ? (
                        <span className="inline-flex gap-1.5 py-1">
                          {[0, 1, 2].map(i => (
                            <motion.i key={i} className="w-2 h-2 rounded-full bg-[#C7D2FE] inline-block"
                              animate={{ y: [0, -5, 0] }} transition={{ repeat: Infinity, duration: 1, delay: i * 0.15 }} />
                          ))}
                        </span>
                      ) : (
                        <CollapsibleBody content={msg.content} />
                      )}

                      {msg.sources && msg.sources.length > 0 && <SourceBlock sources={msg.sources} />}

                      {msg.kind === 'faq' && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          <button onClick={() => sendToAI(`${msg.question}에 대해 최신 공시 기준으로 더 자세히 설명해줘`)}
                            className="text-[12px] font-semibold px-3 py-1.5 rounded-full border border-[#0B57D0] text-[#0B57D0] hover:bg-[#E8F0FE] transition-colors">
                            더 자세한 답변 요청 (AI)
                          </button>
                        </div>
                      )}
                      {msg.followUps && msg.followUps.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {msg.followUps.map(f => (
                            <button key={f} onClick={() => answerFaq(f)}
                              className="text-[12px] px-3 py-1.5 rounded-full bg-[#F4F6FA] border border-[#E5E7EB] text-zinc-600 hover:border-[#0B57D0] hover:text-[#0B57D0] transition-colors">
                              {f}
                            </button>
                          ))}
                        </div>
                      )}

                      {msg.content !== '' && msg.kind !== 'error' && (
                        <div className="mt-3 pt-2.5 border-t border-[#E5E7EB] flex items-center justify-between flex-wrap gap-2 text-[11px] text-zinc-400">
                          <span>{msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · 공시 기준 답변</span>
                          <a href="mailto:ygjung@kccworld.co.kr"
                            className="font-semibold text-[#0B57D0] border border-[#0B57D0]/40 rounded-lg px-2.5 py-1 hover:bg-[#E8F0FE] transition-colors">
                            IR 담당자 문의
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                  {msg.kind === 'welcome' && (
                    <p className="text-[11px] text-zinc-400 mt-1.5 px-1">{nowTime()}</p>
                  )}
                </div>
              </motion.div>
            ))}
          </div>

          {/* 입력 영역 */}
          <div className="border-t border-[#E5E7EB] bg-white px-4 lg:px-6 pt-3 pb-2">
            <div className="max-w-[860px] mx-auto">
              <div className="flex items-end gap-2 border-[1.5px] border-[#E5E7EB] focus-within:border-[#0B57D0] focus-within:shadow-[0_0_0_3px_rgba(11,87,208,.12)] rounded-2xl px-4 py-1.5 transition-all">
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
                  }}
                  rows={1}
                  disabled={isStreamingRef.current && isLoading}
                  placeholder={isEnglishMode ? 'Ask a question (Enter to send)' : '질문을 입력하세요 (Enter 전송)'}
                  className="flex-1 resize-none outline-none text-[14px] py-2 max-h-28 bg-transparent"
                />
                <button onClick={handleSend} disabled={!input.trim() || isLoading}
                  className="w-10 h-10 rounded-xl text-white flex items-center justify-center disabled:opacity-40 transition-opacity shrink-0 mb-0.5"
                  style={{ background: CI.blue }}>
                  <Search size={16} />
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2 justify-center">
                {HINT_CHIPS.map(h => (
                  <button key={h.label} onClick={() => h.faq ? answerFaq(h.faq) : sendToAI(h.label)}
                    className="text-[12px] px-3 py-1 rounded-full border border-[#E5E7EB] bg-white text-zinc-600 hover:border-[#0B57D0] hover:text-[#0B57D0] transition-colors">
                    {h.label}
                  </button>
                ))}
              </div>
              <p className="text-center text-[11px] text-zinc-400 mt-2 mb-1">
                본 답변은 공시된 정보를 바탕으로 제공되며 투자 권유가 아닙니다.
              </p>
            </div>
          </div>
        </section>

        {/* ── 대시보드 (데스크톱 전용, 40%) ── */}
        <aside className="hidden lg:flex flex-col gap-4 overflow-y-auto scrollbar-hide p-4 shrink-0"
          style={{ width: 'clamp(520px, 40vw, 760px)' }}>
          {/* 주가 카드 */}
          <div className="rounded-2xl text-white px-5 py-4 shadow-md shrink-0"
            style={{ background: `linear-gradient(135deg, ${CI.navy}, ${CI.blue})` }}>
            {quote ? (
              <>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="bg-white rounded-md px-1.5 py-1"><img src="/kcc-logo.png" alt="" className="h-4 w-auto" /></div>
                    <div>
                      <p className="text-[13px] font-bold leading-tight">{quote.name} <span className="text-white/50 font-medium">{quote.code}</span></p>
                      <p className="text-[10px] text-white/50">{new Date(quote.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} 기준 · {quote.source}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[26px] font-black leading-tight">{quote.price.toLocaleString()}<span className="text-[12px] font-medium text-white/60 ml-0.5">원</span></p>
                    <p className={cn('text-[12px] font-bold', quote.change >= 0 ? 'text-red-300' : 'text-sky-300')}>
                      {quote.change >= 0 ? '▲' : '▼'} {Math.abs(quote.change).toLocaleString()} ({quote.changePct >= 0 ? '+' : ''}{quote.changePct}%)
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-white/15 text-[11px] text-white/60">
                  <div>시가총액<br /><b className="text-white text-[12.5px]">—</b></div>
                  <div>52주 고/저<br /><b className="text-white text-[12.5px]">—</b></div>
                  <div>외국인 지분율<br /><b className="text-white text-[12.5px]">—</b></div>
                </div>
              </>
            ) : (
              <p className="text-[13px] text-white/70 py-3">주가 데이터 연결 중…</p>
            )}
          </div>

          {/* KPI 카드 */}
          <div className="bg-white border border-[#E5E7EB] rounded-2xl p-5 shrink-0">
            <h3 className="text-[15.5px] font-extrabold flex items-center gap-2 mb-3.5" style={{ color: CI.navy }}>
              <Activity size={16} className="text-[#0B57D0]" /> 주요 실적 지표
              <span className="ml-auto text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-[#E8F0FE] text-[#0B57D0]">
                {dartSummary ? `${dartSummary.latestYear}년 연간` : '—'}
              </span>
              {isDataLoading && <Loader2 size={12} className="animate-spin text-zinc-300" />}
            </h3>
            <div className="grid grid-cols-3 gap-2.5">
              {[
                { label: '매출액', value: fmtKrw(dartSummary?.revenue ?? null), delta: dartSummary?.yoy.revenue ?? null, suffix: '% YoY' },
                { label: '영업이익', value: fmtKrw(dartSummary?.operatingProfit ?? null), delta: dartSummary?.yoy.operatingProfit ?? null, suffix: '% YoY' },
                { label: '영업이익률', value: opMargin !== null ? `${opMargin}%` : '—', delta: marginDelta, suffix: '%p YoY' },
              ].map(k => (
                <div key={k.label} className="bg-[#F4F6FA] rounded-xl px-3 py-3 text-center">
                  <p className="text-[12px] text-zinc-500">{k.label}</p>
                  <p className="text-[24px] font-extrabold my-0.5" style={{ color: CI.navy }}>{k.value}</p>
                  <Delta v={k.delta} suffix={k.suffix} />
                </div>
              ))}
            </div>
            {/* 부채비율 차트 */}
            <div className="mt-3 bg-[#F4F6FA] rounded-xl px-4 py-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[12px] font-bold text-zinc-600 flex items-center gap-1"><BarChart3 size={12} className="text-[#0B57D0]" /> 부채비율 추이 (연결·연간)</span>
                {dartSummary && dartSummary.debtRatioTrend.length > 0 && (
                  <b className="text-[14px]" style={{ color: CI.navy }}>{dartSummary.debtRatioTrend[dartSummary.debtRatioTrend.length - 1].value}%</b>
                )}
              </div>
              {dartSummary && dartSummary.debtRatioTrend.length >= 2 ? (
                <div className="h-24">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={dartSummary.debtRatioTrend} margin={{ top: 14, right: 8, bottom: 0, left: -18 }}>
                      <defs>
                        <linearGradient id="debtGradV2" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={CI.blue} stopOpacity={0.25} />
                          <stop offset="100%" stopColor={CI.blue} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="2 3" stroke="#E5E7EB" vertical={false} />
                      <XAxis dataKey="year" tick={{ fontSize: 10, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} domain={['auto', 'auto']} allowDecimals={false} />
                      <RechartsTooltip formatter={(v: any) => [`${v}%`, '부채비율']} contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E5E7EB' }} />
                      <Area type="monotone" dataKey="value" stroke={CI.blue} strokeWidth={2} fill="url(#debtGradV2)"
                        dot={{ r: 3, fill: CI.blue }}>
                        <LabelList dataKey="value" position="top" style={{ fontSize: 9.5, fill: '#6B7280' }} formatter={(v: any) => `${v}%`} />
                      </Area>
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-[12px] text-zinc-400 py-4 text-center">데이터 연결 필요</p>
              )}
            </div>
          </div>

          {/* 뉴스 · 공시 */}
          <div className="bg-white border border-[#E5E7EB] rounded-2xl p-5 shrink-0">
            <h3 className="text-[15.5px] font-extrabold flex items-center gap-2 mb-3" style={{ color: CI.navy }}>
              <Newspaper size={16} className="text-[#0B57D0]" /> 뉴스 · 공시
            </h3>
            <div className="flex bg-[#F4F6FA] p-1 rounded-xl text-[12px] font-bold mb-2">
              <button onClick={() => setFeedTab('news')}
                className={cn('flex-1 py-1.5 rounded-lg transition-all', feedTab === 'news' ? 'bg-white shadow-sm' : 'text-zinc-400')}
                style={feedTab === 'news' ? { color: CI.navy } : undefined}>주요 뉴스</button>
              <button onClick={() => setFeedTab('dart')}
                className={cn('flex-1 py-1.5 rounded-lg transition-all', feedTab === 'dart' ? 'bg-white shadow-sm' : 'text-zinc-400')}
                style={feedTab === 'dart' ? { color: CI.navy } : undefined}>DART 공시</button>
            </div>
            <div className="max-h-48 overflow-y-auto scrollbar-hide divide-y divide-black/[0.04]">
              {feedTab === 'news' ? (
                news.length > 0 ? news.map((n, i) => (
                  <a key={i} href={n.link} target="_blank" rel="noopener noreferrer"
                    className="flex items-baseline gap-2 px-1 py-2 rounded-lg hover:bg-[#F4F6FA] transition-colors">
                    <span className="text-[10px] text-zinc-400 font-mono shrink-0">{n.date ? n.date.slice(5).replace('-', '.') : ''}</span>
                    <span className="text-[12.5px] font-semibold text-zinc-700 leading-snug truncate flex-1">{n.title}</span>
                    <span className="text-[10px] text-zinc-400 shrink-0 hidden xl:inline">{n.source}</span>
                  </a>
                )) : <p className="text-[12px] text-zinc-400 py-4 text-center">뉴스 데이터 연결 필요</p>
              ) : (
                disclosures.length > 0 ? disclosures.map((d, i) => (
                  <a key={i} href={d.url} target="_blank" rel="noopener noreferrer"
                    className="flex items-baseline gap-2 px-1 py-2 rounded-lg hover:bg-[#F4F6FA] transition-colors">
                    <span className="text-[10px] text-zinc-400 font-mono shrink-0">{d.date.slice(5)}</span>
                    <span className="text-[12.5px] font-semibold text-zinc-700 leading-snug truncate flex-1">{d.title}</span>
                    <span className="text-[10px] text-zinc-400 shrink-0 hidden xl:inline">{d.filer}</span>
                  </a>
                )) : <p className="text-[12px] text-zinc-400 py-4 text-center">{dartStatus === 'ok' ? '최근 공시가 없습니다' : '데이터 연결 필요'}</p>
              )}
            </div>
          </div>

          {/* FAQ */}
          <div className="bg-white border border-[#E5E7EB] rounded-2xl p-5 shrink-0">
            <h3 className="text-[15.5px] font-extrabold flex items-center gap-2 mb-3" style={{ color: CI.navy }}>
              <MessageCircleQuestion size={16} className="text-[#0B57D0]" /> 자주 하는 질문
            </h3>
            <div className="space-y-1.5">
              {FAQ_LIST.map(f => {
                const meta = FAQ_META[f.question];
                return (
                  <button key={f.id} onClick={() => answerFaq(f.question)}
                    className="w-full group flex items-center gap-3 text-left bg-white border border-[#E5E7EB] rounded-xl px-3.5 py-2.5 hover:border-[#0B57D0] hover:shadow-[0_2px_10px_rgba(11,87,208,.08)] transition-all">
                    <span className="w-8 h-8 rounded-lg bg-[#E8F0FE] text-[#0B57D0] flex items-center justify-center shrink-0">
                      {meta?.icon || <FileText size={15} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <b className="block text-[14px] text-zinc-800 group-hover:text-[#0B57D0] truncate transition-colors">{f.question}</b>
                      <span className="text-[12px] text-zinc-500 truncate block">{meta?.desc || ''}</span>
                    </span>
                    <ChevronRight size={14} className="text-zinc-300 group-hover:text-[#0B57D0] shrink-0 transition-colors" />
                  </button>
                );
              })}
            </div>
          </div>
        </aside>
      </div>

      {/* 모바일 FAQ 플로팅 버튼 + 하단 시트 */}
      <button onClick={() => setSheetOpen(true)}
        className="lg:hidden fixed right-4 bottom-36 z-30 flex items-center gap-1.5 text-white text-[13px] font-semibold rounded-full px-4 py-2.5 shadow-xl"
        style={{ background: CI.navy, minHeight: 44 }}>
        <MessageCircleQuestion size={15} /> 자주 하는 질문
      </button>
      <AnimatePresence>
        {sheetOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="lg:hidden fixed inset-0 bg-black/40 z-40" onClick={() => setSheetOpen(false)} />
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'tween', duration: 0.25 }}
              className="lg:hidden fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-2xl max-h-[70vh] flex flex-col">
              <div className="flex items-center justify-between px-5 pt-4 pb-2">
                <h3 className="text-[15px] font-extrabold" style={{ color: CI.navy }}>자주 하는 질문</h3>
                <button onClick={() => setSheetOpen(false)} className="p-2 text-zinc-400" style={{ minWidth: 44, minHeight: 44 }}>
                  <X size={18} />
                </button>
              </div>
              <div className="overflow-y-auto px-4 pb-6 space-y-1.5">
                {FAQ_LIST.map(f => {
                  const meta = FAQ_META[f.question];
                  return (
                    <button key={f.id} onClick={() => answerFaq(f.question)}
                      className="w-full flex items-center gap-3 text-left border border-[#E5E7EB] rounded-xl px-3.5 py-3"
                      style={{ minHeight: 44 }}>
                      <span className="w-8 h-8 rounded-lg bg-[#E8F0FE] text-[#0B57D0] flex items-center justify-center shrink-0">
                        {meta?.icon || <FileText size={15} />}
                      </span>
                      <span className="min-w-0">
                        <b className="block text-[14px] text-zinc-800">{f.question}</b>
                        <span className="text-[12px] text-zinc-500">{meta?.desc || ''}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* 최초 방문 고지 모달 */}
      <AnimatePresence>
        {showNotice && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <motion.div initial={{ scale: 0.94, y: 16 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.94, y: 16 }}
              className="bg-white rounded-2xl p-7 w-full max-w-md shadow-2xl">
              <div className="flex items-center gap-3 mb-4">
                <img src="/kcc-logo.png" alt="KCC" className="h-8 w-auto" />
                <h3 className="text-[18px] font-extrabold" style={{ color: CI.navy }}>
                  KCC IR<span style={{ color: CI.red }}>:</span>ON 이용 안내
                </h3>
              </div>
              <p className="text-[14px] text-zinc-600 leading-relaxed">
                본 서비스는 <b>DART 공시 및 KCC 공식 IR 자료</b>를 기반으로 답변하며,
                미공개 정보·전망치는 제공하지 않습니다. 답변은 투자 권유가 아니며,
                투자 판단의 최종 책임은 투자자 본인에게 있습니다.
              </p>
              <button
                onClick={() => {
                  try { localStorage.setItem('kcc_v2_notice_seen', '1'); } catch { /* 무시 */ }
                  setShowNotice(false);
                }}
                className="w-full mt-5 py-3 rounded-xl text-white text-[14px] font-bold transition-opacity hover:opacity-90"
                style={{ background: CI.navy }}>
                확인했습니다
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
