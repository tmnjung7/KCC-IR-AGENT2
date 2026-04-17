import Papa from 'papaparse';

export interface IRData {
  category: string;
  item: string;
  value: string;
  unit: string;
  period: string;
  source: string;
}

export const fetchCSVData = async (url: string): Promise<any[]> => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    // Fetch directly to avoid server IP rate limits
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response.ok) throw new Error('Failed to fetch CSV');
    const csvText = await response.text();
    
    return new Promise((resolve, reject) => {
      Papa.parse(csvText, {
        header: false,
        skipEmptyLines: true,
        complete: (results) => {
          resolve(results.data);
        },
        error: (error: any) => {
          reject(error);
        }
      });
    });
  } catch (error) {
    console.error('CSV Fetch Error:', error);
    return [];
  }
};

// 깃허브 저장소 내의 모든 CSV 파일 목록을 가져오는 함수
export const fetchAllCSVFromRepo = async (repoPath: string): Promise<{name: string, data: any[]}[]> => {
  try {
    // Fetch directly from GitHub API to avoid server IP rate limits
    const apiUrl = `https://api.github.com/repos/${repoPath}/contents`;
    console.log('Fetching from GitHub API directly:', apiUrl);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(apiUrl, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'KCC-IR-Assistant'
      },
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMsg = errorData.message || `GitHub API 오류: ${response.status}`;
      console.error('GitHub API Error Details:', errorData);
      if (response.status === 403 && errorMsg.includes('rate limit')) {
        throw new Error('GitHub API 호출 한도가 초과되었습니다. 잠시 후 다시 시도해 주세요.');
      }
      throw new Error(errorMsg);
    }
    
    const files = await response.json();
    if (!Array.isArray(files)) {
      throw new Error('GitHub API가 올바른 파일 목록을 반환하지 않았습니다.');
    }

    // 지원하지 않는 파일 형식(xlsx 등) 체크를 위한 로그
    const unsupportedFiles = files.filter((file: any) => 
      file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls')
    );
    if (unsupportedFiles.length > 0) {
      console.warn('지원되지 않는 엑셀 파일이 발견되었습니다. CSV로 변환이 필요합니다:', unsupportedFiles.map(f => f.name));
    }

    const csvFiles = files.filter((file: any) => file.name.toLowerCase().endsWith('.csv'));
    console.log('Found CSV files:', csvFiles.map(f => f.name));
    
    if (csvFiles.length === 0) {
      return [];
    }

    const allData = await Promise.all(csvFiles.map(async (file: any) => {
      try {
        const data = await fetchCSVData(file.download_url);
        return { name: file.name, data };
      } catch (err) {
        console.error(`Error fetching CSV ${file.name}:`, err);
        return { name: file.name, data: [] };
      }
    }));
    
    return allData.filter(item => item.data.length > 0);
  } catch (error: any) {
    console.error('Repo Fetch Error:', error);
    throw error;
  }
};

export const formatContext = (allFileData: {name: string, data: any[]}[]): string => {
  let context = "";
  let totalLength = 0;
  const MAX_CONTEXT_LENGTH = 50000;

  for (const file of allFileData) {
    const fileHeader = `[파일명: ${file.name}]\n`;
    context += fileHeader;
    totalLength += fileHeader.length;

    for (const row of file.data) {
      const line = row.join(' | ') + '\n';
      if (totalLength + line.length > MAX_CONTEXT_LENGTH) break;
      context += line;
      totalLength += line.length;
    }
    context += "\n";
  }
  
  return context;
};

export const searchContext = (allFileData: {name: string, data: any[]}[], query: string): string => {
  const cleanQuery = query.toLowerCase().replace(/[?.,!]/g, ' ');
  
  const particles = ['은', '는', '이', '가', '을', '를', '의', '에', '와', '과', '도', '만', '에서', '부터', '까지', '년', '분기'];
  const stopWords = ['파일', '파일에', '대한', '알려줘', '분석', '추이', '최근', '어때', '정보', '정보가', '있을텐데', '질문', '질문의', '이해하지', '못하고', '검색을', '못해주는데', '왜', '그럴까', '변화', '변화는', '있거든', '명확하게', '사진처럼', '어떻게', '알려', '보여줘'];
  
  let keywords = cleanQuery.split(' ').filter(k => k.length >= 1);
  
  // 파일 번호 추출
  const fileRefMatch = query.match(/(\d+)[-~](\d+)|(\d+)번|(\d+)-(\d+)/g);
  const mentionedFileNums: string[] = [];
  if (fileRefMatch) {
    fileRefMatch.forEach(m => {
      const nums = m.match(/\d+/g);
      if (nums) mentionedFileNums.push(...nums);
    });
  }

  keywords = keywords.map(word => {
    let processed = word;
    for (const p of particles) {
      if (processed.endsWith(p) && processed.length > p.length) {
        processed = processed.slice(0, -p.length);
        break;
      }
    }
    return processed;
  }).filter(k => k.length >= 1 && !stopWords.includes(k));
  
  console.log('Extracted keywords for search:', keywords);

  // ── 기타포괄손익 관련 청크 비우선 처리를 위한 상수 ──────────────────────
  const DEPRIORITIZE_KEYWORDS = [
    '후속기간에 당기손익으로 재분류되지 않는 항목',
    '기타포괄손익',
    '자산재평가이익',
    '재평가잉여금',
  ];

  // ── 재무가치 관련 질문 감지 → 우선 검색어 앵커 ──────────────────────────
  const FINANCIAL_TRIGGER_KEYWORDS = [
    '기업가치', '재무건전성', '재무안정성', '밸류업',
    '기업가치제고', '주주환원', '배당', '밸류에이션',
  ];
  const PRIORITY_SEARCH_TERMS = [
    '부채비율', '자기자본비율', '유동비율',
    '총자산', '자기자본', '영업이익률',
    'roe', 'roa', '순차입금',
  ];

  // 키워드 확장 및 동의어 처리
  const lowerQuery = query.toLowerCase();
  const isInterestExpenseQuery = lowerQuery.includes('이자비용') || lowerQuery.includes('이자');
  const isDebtRatioQuery = lowerQuery.includes('부채비율') || lowerQuery.includes('부채') || lowerQuery.includes('비율') || lowerQuery.includes('debt') || lowerQuery.includes('ratio');
  const isSalesQuery = lowerQuery.includes('매출') || lowerQuery.includes('수익') || lowerQuery.includes('실적') || lowerQuery.includes('영업이익');
  const isDivisionQuery = lowerQuery.includes('사업부') || lowerQuery.includes('부문') || lowerQuery.includes('세그먼트') || lowerQuery.includes('건자재') || lowerQuery.includes('건재') || lowerQuery.includes('도료') || lowerQuery.includes('실리콘') || lowerQuery.includes('소재') || lowerQuery.includes('유리');
  const isEbitdaQuery = lowerQuery.includes('ebitda') || lowerQuery.includes('ebidta') || lowerQuery.includes('에비타') || lowerQuery.includes('상각전영업이익') || lowerQuery.includes('상각전');
  const isRoeQuery = lowerQuery.includes('roe') || lowerQuery.includes('자기자본이익률');
  // 재무건전성·기업가치 관련 질문 감지
  const isFinancialValueQuery = FINANCIAL_TRIGGER_KEYWORDS.some(kw => lowerQuery.includes(kw));

  let targetKeywords = [...keywords];
  if (isInterestExpenseQuery) targetKeywords.push('이자비용', '이자', '금융비용', '비용', 'interest');
  if (isDebtRatioQuery) targetKeywords.push('부채비율', '부채', '비율', '안정성', '자본', 'debt', 'ratio', 'liabilities', 'equity');
  if (isSalesQuery) targetKeywords.push('매출', '매출액', '수익', '영업수익', '실적', '영업이익');
  if (isDivisionQuery) targetKeywords.push('사업부', '부문', '세그먼트', 'division', 'segment', '건자재', '건축자재', '건재', '도료', '실리콘', '소재', '유리');
  if (isEbitdaQuery) targetKeywords.push('ebitda', 'ebidta', '에비타', '상각전영업이익', '상각전', '영업이익');
  if (isRoeQuery) targetKeywords.push('roe', '자기자본이익률', '수익성', '이익률');
  // 재무가치 질문이면 핵심 건전성 지표를 검색 앵커로 강제 추가
  if (isFinancialValueQuery) {
    targetKeywords.push(...PRIORITY_SEARCH_TERMS);
    console.log('[FinancialValueQuery] Priority search terms anchored:', PRIORITY_SEARCH_TERMS);
  }

  const yearKeywords = keywords.filter(k => k.match(/^\d{2,4}$/));
  const hasYearInQuery = yearKeywords.length > 0;

  // 모든 파일의 모든 행을 점수화하여 수집
  interface ScoredRow {
    fileIdx: number;
    fileName: string;
    rowIndex: number;
    row: any[];
    score: number;
    headers: any[];
  }

  const allScoredRows: ScoredRow[] = [];

  allFileData.forEach((file, fileIdx) => {
    if (!file.data || file.data.length === 0) return;

    const fileNameLower = file.name.toLowerCase();
    const fileNumMatch = (file.name.match(/\d+/g) || []) as string[];
    const isFileMentioned = mentionedFileNums.includes((fileIdx + 1).toString()) || 
                           mentionedFileNums.some(num => fileNumMatch.includes(num));

    // 헤더 수집
    const headerCandidates: {index: number, headers: any[]}[] = [];
    file.data.forEach((row, idx) => {
      const rowStr = row.join(' ');
      const dateCount = row.filter((cell: any) => 
        String(cell).match(/\d{1,2}Q\d{2}/i) || String(cell).match(/20\d{2}/)
      ).length;
      const hasHeaderLabels = rowStr.includes('항목') || rowStr.includes('수치') || rowStr.includes('단위') || rowStr.includes('구분') || rowStr.includes('계정');
      if (dateCount >= 2 && hasHeaderLabels) headerCandidates.push({index: idx, headers: row});
    });

    const defaultHeaders = headerCandidates.length > 0 ? headerCandidates[0].headers : (file.data[0] || []);

    for (let rowIndex = 0; rowIndex < file.data.length; rowIndex++) {
      const row = file.data[rowIndex];
      const rowStr = row.join(' ').toLowerCase();
      const cleanRowStr = rowStr.replace(/\s+/g, '');

      let score = 0;

      // 1. 핵심 재무 키워드 매칭 (매우 높은 가중치)
      if (isDebtRatioQuery && (rowStr.includes('부채비율') || cleanRowStr.includes('부채비율'))) score += 1000;
      if (isInterestExpenseQuery && (rowStr.includes('이자비용') || cleanRowStr.includes('이자비용'))) score += 1000;
      if (isEbitdaQuery && (rowStr.includes('ebitda') || rowStr.includes('ebidta') || rowStr.includes('상각전') || cleanRowStr.includes('ebitda') || cleanRowStr.includes('ebidta') || cleanRowStr.includes('상각전'))) score += 1000;
      if (isRoeQuery && (rowStr.includes('roe') || cleanRowStr.includes('roe') || rowStr.includes('자기자본이익률'))) score += 1000;
      if (isSalesQuery && (rowStr.includes('매출') || cleanRowStr.includes('매출액') || rowStr.includes('영업이익') || cleanRowStr.includes('영업이익'))) score += 500;
      if (isDivisionQuery && (rowStr.includes('사업부') || rowStr.includes('부문') || rowStr.includes('건자재') || rowStr.includes('도료') || rowStr.includes('실리콘'))) score += 500;

      // 2. 일반 키워드 매칭
      targetKeywords.forEach(k => {
        const lowerK = k.toLowerCase();
        if (rowStr.includes(lowerK) || cleanRowStr.includes(lowerK.replace(/\s+/g, ''))) {
          score += 100;
        }
      });

      // 3. 연도 매칭
      if (yearKeywords.some(y => rowStr.includes(y))) score += 50;

      // 4. 파일 언급 가중치
      if (isFileMentioned) score += 200;

      // 4-1. 사업부문 관련 질문일 때, 파일명에 '사업부'나 '부문정보'가 들어가면 압도적인 가중치 부여
      if (isDivisionQuery && (fileNameLower.includes('사업부') || fileNameLower.includes('부문정보'))) {
        score += 2000;
      }

      // 5. 헤더 행 자체는 점수 부여 (문맥 파악용)
      const isHeader = headerCandidates.some(h => h.index === rowIndex);
      if (isHeader) score += 10;

      // 5-1. 핵심 재무지표 우선 가중치 (모든 쿼리에 항상 적용 — 기타포괄손익보다 항상 상위에 오도록)
      const CORE_PRIORITY_METRICS = [
        '부채비율', '자기자본비율', '유동비율', '당좌비율',
        '영업이익률', '영업이익', '매출액', '매출',
        '자기자본', '순차입금', 'roe', 'roa', 'ebitda',
      ];
      const hasCoreMetric = CORE_PRIORITY_METRICS.some(metric =>
        rowStr.includes(metric) || cleanRowStr.includes(metric.replace(/\s+/g, ''))
      );
      if (hasCoreMetric && score > 0) score += 150;

      // 6. 기타포괄손익 관련 행 컨텍스트 완전 제외 (기본값)
      //    사용자가 기타포괄손익을 명시적으로 물어볼 때만 포함
      const userExplicitlyAskedOCI =
        lowerQuery.includes('기타포괄손익') ||
        lowerQuery.includes('후속기간') ||
        lowerQuery.includes('재분류');

      if (!userExplicitlyAskedOCI && score > 0) {
        const containsDeprioritized = DEPRIORITIZE_KEYWORDS.some(kw =>
          rowStr.includes(kw) || cleanRowStr.includes(kw.replace(/\s+/g, ''))
        );
        if (containsDeprioritized) continue; // 컨텍스트에서 완전 제거
      }

      if (score > 0) {
        const nearestHeader = headerCandidates
          .filter(h => h.index <= rowIndex)
          .sort((a, b) => b.index - a.index)[0] || {headers: defaultHeaders};

        allScoredRows.push({
          fileIdx,
          fileName: file.name,
          rowIndex,
          row,
          score,
          headers: nearestHeader.headers
        });
      }
    }
  });

  // 점수 순으로 정렬
  allScoredRows.sort((a, b) => b.score - a.score);

  // 재무가치 질문: 기타포괄손익 청크를 무조건 마지막으로 re-rank (이중 안전장치)
  if (isFinancialValueQuery) {
    const primary: ScoredRow[] = [];
    const deprioritized: ScoredRow[] = [];
    for (const r of allScoredRows) {
      const rStr = r.row.join(' ').toLowerCase();
      const rClean = rStr.replace(/\s+/g, '');
      const isDepriorRow = DEPRIORITIZE_KEYWORDS.some(kw =>
        rStr.includes(kw) || rClean.includes(kw.replace(/\s+/g, ''))
      );
      if (isDepriorRow) deprioritized.push(r);
      else primary.push(r);
    }
    allScoredRows.splice(0, allScoredRows.length, ...primary, ...deprioritized);
    console.log(`[Rerank] Financial query: ${primary.length} primary rows / ${deprioritized.length} deprioritized (기타포괄손익) rows pushed to end.`);
  }

  if (allScoredRows.length > 0) {
    console.log('Top 5 scored rows:', allScoredRows.slice(0, 5).map(r => ({
      file: r.fileName,
      score: r.score,
      row: r.row.slice(0, 3)
    })));
  }

  let context = "### IR 데이터 분석 결과 (관련성 높은 데이터 우선) ###\n\n";
  let totalLength = 0;
  const MAX_CONTEXT_LENGTH = 100000; // 250,000 → 100,000: 점수 기반 상위 행만 추려내므로 품질 동일, 처리 속도 개선
  const seenRows = new Set<string>();

  // 상위 점수 행들부터 컨텍스트에 추가
  for (const item of allScoredRows) {
    const rowKey = `${item.fileName}-${item.rowIndex}-${item.row.join('|')}`;
    if (seenRows.has(rowKey)) continue;
    seenRows.add(rowKey);

    let rowContext = `[파일: ${item.fileName}] `;
    const headers = item.headers;
    const row = item.row;

    const matchedPairs = [];
    for (let colIdx = 0; colIdx < Math.max(headers.length, row.length); colIdx++) {
      const h = String(headers[colIdx] || '').trim();
      const v = String(row[colIdx] || '').trim();
      if (h && v) matchedPairs.push(`${h}: ${v}`);
    }

    if (matchedPairs.length > 0) {
      rowContext += `항목: ${row[0] || row[1] || '데이터'} | ${matchedPairs.join(' | ')}\n`;
    } else {
      rowContext += `데이터: ${row.join(' | ')}\n`;
    }

    if (totalLength + rowContext.length < MAX_CONTEXT_LENGTH) {
      context += rowContext;
      totalLength += rowContext.length;
    } else {
      break;
    }
  }

  if (totalLength === 0 || context.length < 50) {
    return "질문과 관련된 데이터를 찾을 수 없습니다. 키워드(예: 부채비율, 매출액)를 명확히 포함해 주세요.";
  }

  return context;
};
