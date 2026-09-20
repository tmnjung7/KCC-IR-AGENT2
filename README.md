# KCC IR AI 어시스턴트

KCC(주) 주주·투자자를 위한 IR AI 챗봇입니다.
DART(금융감독원 전자공시시스템) Open API에서 재무 데이터를 **자동 수집**하고,
Gemini 또는 Claude 모델로 답변을 생성합니다.

## 주요 기능

- **DART 자동 연동** — 재무상태표·손익계산서 주요계정(3개년), 최신 분기실적, 재무지표(수익성/안정성/성장성/활동성), 배당현황, 최근 90일 공시목록을 자동 수집 (6시간 캐시). 수기 CSV 업데이트가 더 이상 필요 없습니다.
- **멀티 LLM** — Gemini(2.0 Flash Lite / 2.5 Flash / 2.5 Pro)와 Claude(Haiku 4.5 / Sonnet 5 / Opus 5)를 UI에서 전환. Claude는 프롬프트 캐싱으로 반복 질의 시 시스템 프롬프트 토큰 비용을 약 90% 절감합니다.
- **웹 검색 근거** — 전망·주가·최신 뉴스 질문은 자동으로 웹 검색을 활성화하고 출처 링크를 표시합니다.
- **실시간 대시보드** — 매출액·영업이익·자산총계(YoY 포함), 부채비율 추이 차트가 DART 데이터로 자동 갱신됩니다.
- **보조 데이터** — GitHub 저장소의 CSV(IR 지식베이스 등)는 기존처럼 함께 로드되어 DART 데이터를 보완합니다.

## 실행 방법

**사전 준비:** Node.js 18+

1. 의존성 설치: `npm install`
2. `.env.local`(또는 배포 환경변수)에 키 설정 — [.env.example](.env.example) 참고
   - `GEMINI_API_KEY` 또는 `ANTHROPIC_API_KEY` 중 최소 하나
   - `DART_API_KEY` (권장): https://opendart.fss.or.kr 에서 무료 발급
3. 실행: `npm run dev` → http://localhost:3000

## 환경변수

| 변수 | 필수 | 설명 |
|------|------|------|
| `GEMINI_API_KEY` | 택1 | Gemini API 키 |
| `ANTHROPIC_API_KEY` | 택1 | Claude API 키 (설정 시 UI에 전환 토글 표시) |
| `DART_API_KEY` | 권장 | DART Open API 인증키. 미설정 시 GitHub CSV만 사용 |
| `DART_CORP_CODE` | 선택 | DART 고유번호 8자리 (미설정 시 종목코드로 자동 조회) |
| `DART_STOCK_CODE` | 선택 | 종목코드 (기본 002380 = KCC) |

## 아키텍처

```
src/App.tsx               ─ UI (채팅 + 대시보드)
src/services/llm.ts       ─ 프론트엔드 LLM 호출 (SSE 스트리밍)
src/services/dataService.ts ─ DART/CSV 로드 + 키워드 기반 컨텍스트 검색
api/_lib/dart.ts          ─ DART Open API 수집·캐시 모듈
api/_lib/llm.ts           ─ Gemini/Claude 프로바이더 추상화
api/_lib/prompt.ts        ─ 시스템 프롬프트 단일 소스
api/chat.ts, api/dart-data.ts, api/providers.ts ─ Vercel 서버리스 엔드포인트
server.ts                 ─ 로컬/AI Studio용 Express 서버 (동일 라우트)
```
