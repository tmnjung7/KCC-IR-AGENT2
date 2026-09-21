/**
 * IP당 요청 제한 (일일 + 분당) — 공개 배포 시 비용 폭주 방지
 *
 * 환경변수:
 *   RATE_LIMIT_PER_DAY : IP당 일일 채팅 허용 건수 (기본 20)
 *   RATE_LIMIT_PER_MIN : IP당 분당 채팅 허용 건수 (기본 5)
 *   ADMIN_TOKEN        : 관리자 우회 토큰 (기본: 관리자 비밀번호 0815)
 *
 * 서버리스 인스턴스별 메모리 카운터라 완벽한 집계는 아니지만
 * (인스턴스 재시작 시 초기화), 남용 억제 목적으로는 충분하다.
 */

const PER_DAY = () => Math.max(1, Number(process.env.RATE_LIMIT_PER_DAY) || 20);
const PER_MIN = () => Math.max(1, Number(process.env.RATE_LIMIT_PER_MIN) || 5);
const ADMIN_TOKEN = () => (process.env.ADMIN_TOKEN || "0815").trim();

interface Counter { day: string; dayCount: number; minStart: number; minCount: number }
const counters = new Map<string, Counter>();

function todayKST(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function clientIp(req: any): string {
  const fwd = String(req.headers?.["x-forwarded-for"] || "");
  if (fwd) return fwd.split(",")[0].trim();
  return String(req.socket?.remoteAddress || req.connection?.remoteAddress || "unknown");
}

export function isAdminRequest(req: any): boolean {
  const token = String(req.headers?.["x-admin-token"] || "").trim();
  return !!token && token === ADMIN_TOKEN();
}

export function checkRateLimit(req: any): { allowed: boolean; message?: string } {
  if (isAdminRequest(req)) return { allowed: true };

  const ip = clientIp(req);
  const now = Date.now();
  const day = todayKST();

  // 오래된 엔트리 정리 (메모리 누수 방지)
  if (counters.size > 5000) {
    for (const [k, v] of counters) {
      if (v.day !== day) counters.delete(k);
    }
  }

  let c = counters.get(ip);
  if (!c || c.day !== day) {
    c = { day, dayCount: 0, minStart: now, minCount: 0 };
    counters.set(ip, c);
  }
  if (now - c.minStart >= 60_000) {
    c.minStart = now;
    c.minCount = 0;
  }

  if (c.dayCount >= PER_DAY()) {
    return {
      allowed: false,
      message: `일일 질문 한도(${PER_DAY()}건)를 초과했습니다. 내일 다시 이용해 주세요. 자세한 문의는 KCC IR 담당부서로 연락 부탁드립니다.`,
    };
  }
  if (c.minCount >= PER_MIN()) {
    return {
      allowed: false,
      message: "요청이 너무 잦습니다. 잠시 후(약 1분 뒤) 다시 시도해 주세요.",
    };
  }

  c.dayCount++;
  c.minCount++;
  return { allowed: true };
}
