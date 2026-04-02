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
    // 개별 파일 내용도 캐시 방지
    const cacheBustedUrl = url.includes('?') ? `${url}&t=${Date.now()}` : `${url}?t=${Date.now()}`;
    const response = await fetch(cacheBustedUrl);
    if (!response.ok) throw new Error('Failed to fetch CSV');
    const csvText = await response.text();
    
    return new Promise((resolve, reject) => {
      Papa.parse(csvText, {
        header: false, // 헤더 없이 원본 행 그대로 가져옴 (복잡한 엑셀 구조 대응)
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
    const cleanPath = repoPath.trim().replace(/\/$/, '').replace(/\.git$/, '');
    // 캐시 방지를 위해 타임스탬프와 랜덤 문자열 추가
    const apiUrl = `https://api.github.com/repos/${cleanPath}/contents?t=${Date.now()}&r=${Math.random().toString(36).substring(7)}`;
    console.log('Fetching from GitHub API (Force Refresh):', apiUrl);
    
    const response = await fetch(apiUrl);
    if (!response.ok) {
      if (response.status === 403) {
        throw new Error('깃허브 API 호출 한도 초과입니다. 잠시 후(약 10~30분) 다시 시도해 주세요.');
      }
      if (response.status === 404) {
        throw new Error('저장소를 찾을 수 없습니다. 경로(Owner/Repo)가 정확한지 확인해 주세요.');
      }
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`GitHub API 오류: ${response.status} ${errorData.message || response.statusText}`);
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
  
  const particles = ['은', '는', '이', '가', '을', '를', '의', '에', '와', '과', '도', '만', '에서', '부터', '까지'];
  const stopWords = ['파일', '파일에', '대한', '알려줘', '분석', '추이', '최근', '어때', '정보', '정보가', '있을텐데', '질문', '질문의', '이해하지', '못하고', '검색을', '못해주는데', '왜', '그럴까'];
  
  let keywords = cleanQuery.split(' ').filter(k => k.length >= 1);
  
  // 파일 번호 추출 (예: "1-3", "1번", "3번")
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

  let context = "### IR 데이터 분석 결과 ###\n\n";
  let totalLength = 0;
  const MAX_CONTEXT_LENGTH = 150000; // 컨텍스트 용량 확대
  const seenRows = new Set<string>();

  for (let fileIdx = 0; fileIdx < allFileData.length; fileIdx++) {
    const file = allFileData[fileIdx];
    if (!file.data || file.data.length === 0) continue;

    const fileNameLower = file.name.toLowerCase();
    const fileNumMatch = file.name.match(/\d+/g);
    const fileNums = fileNumMatch ? fileNumMatch : [];
    
    // 파일명 자체가 키워드에 포함되는지 확인 또는 순서(1번, 2번...) 확인
    const isFileMentioned = keywords.some(k => 
      fileNameLower.includes(k) || 
      (k.match(/^\d+$/) && fileNums.includes(k))
    ) || 
    mentionedFileNums.some(num => fileNums.includes(num)) ||
    mentionedFileNums.includes((fileIdx + 1).toString()); // 1번 파일 등 순서 매칭

    // 1. 다이나믹 헤더 수집 (파일 전체에서 헤더 후보군 추출)
    const headerCandidates: {index: number, headers: any[]}[] = [];
    file.data.forEach((row, idx) => {
      const dateCount = row.filter((cell: any) => 
        String(cell).match(/\d{1,2}Q\d{2}/i) || 
        String(cell).match(/20\d{2}/) ||
        String(cell).match(/^\d{2}년$/) ||
        String(cell).match(/^20\d{2}년$/)
      ).length;
      if (dateCount >= 2) {
        headerCandidates.push({index: idx, headers: row});
      }
    });

    // 기본 헤더 설정 (기존 로직 호환성 유지)
    let headerRowIndex = 0;
    if (headerCandidates.length > 0) {
      headerRowIndex = headerCandidates[0].index;
    }
    const isWideFormat = headerCandidates.length > 0;
    const defaultHeaders = file.data[headerRowIndex] || [];
    
    // 2. 검색 및 윈도우 추출
    const relevantIndices = new Set<number>();
    
    // 키워드 확장 및 동의어 처리 (IR 특화)
    const isInterestExpenseQuery = query.includes('이자비용') || query.includes('이자');
    const isDebtRatioQuery = query.includes('부채비율') || query.includes('부채') || query.includes('비율');
    const isSalesQuery = query.includes('매출') || query.includes('수익') || query.includes('실적');
    const isDivisionQuery = query.includes('사업부') || query.includes('부문') || query.includes('세그먼트') || query.includes('건자재') || query.includes('도료') || query.includes('실리콘');
    const isQuarterQuery = query.match(/\d[qQ]/) || query.includes('분기');
    const isSumQuery = query.includes('합계') || query.includes('누계') || query.includes('합') || query.includes('더하기') || query.includes('총액');
    
    let targetKeywords = [...keywords];
    if (isInterestExpenseQuery) targetKeywords.push('이자비용', '이자', '금융비용', '비용');
    if (isDebtRatioQuery) targetKeywords.push('부채비율', '부채', '비율', '안정성', '자본');
    if (isSalesQuery) targetKeywords.push('매출', '매출액', '수익', '영업수익', '실적', '영업이익');
    if (isDivisionQuery) targetKeywords.push('사업부', '부문', '세그먼트', 'division', 'segment', '건자재', '건축자재', '건재', '도료', '실리콘', '소재', '유리');
    if (isQuarterQuery) targetKeywords.push('4q', '3q', '2q', '1q', '분기', '실적');
    if (isSumQuery) targetKeywords.push('합계', '누계', '총액', '실적');
    
    // 연도 키워드 (2025, 25 등) 추출
    const yearKeywords = keywords.filter(k => k.match(/^\d{2,4}$/));
    const hasYearInQuery = yearKeywords.length > 0;

    file.data.forEach((row, index) => {
      const rowStr = row.join(' ').toLowerCase();
      
      // 1. 키워드 매칭 (항목명 중심)
      const matchedKeywords = targetKeywords.filter(k => rowStr.includes(k));
      
      // 2. 연도 매칭 (현재 행 자체에 연도가 있는지)
      const hasYearInRow = yearKeywords.some(y => rowStr.includes(y));

      // [개선] 질문에 연도가 있고, 현재 행이 속한 섹션의 헤더에 해당 연도가 있는지 확인
      const nearestHeader = headerCandidates
        .filter(h => h.index <= index)
        .sort((a, b) => b.index - a.index)[0];
      
      const isYearInHeader = hasYearInQuery && nearestHeader && 
        yearKeywords.some(y => nearestHeader.headers.join(' ').includes(y));

      // 항목명이 매칭되거나, 연도가 직접 매칭되거나, 헤더에 연도가 있는 상태에서 항목이 매칭된 경우
      if (matchedKeywords.length >= 1 || hasYearInRow || (isYearInHeader && matchedKeywords.length > 0) || isFileMentioned) {
        // 매칭된 행 주변 인덱스 추가 (컨텍스트 윈도우 확대: 앞 10행, 뒤 20행)
        const start = Math.max(0, index - 10);
        const end = Math.min(file.data.length - 1, index + 25);
        for (let i = start; i <= end; i++) {
          relevantIndices.add(i);
        }

        // [추가] 매칭된 행 바로 위의 헤더 후보도 강제로 포함
        if (nearestHeader) relevantIndices.add(nearestHeader.index);
      }
    });

    // 핵심 지표 질문 시 헤더 행은 무조건 포함 (AI가 연도를 파악할 수 있게 함)
    if (relevantIndices.size > 0) {
      relevantIndices.add(headerRowIndex);
      // 혹시 헤더가 여러 줄일 수 있으므로 주변 2행도 추가
      relevantIndices.add(Math.max(0, headerRowIndex - 1));
      relevantIndices.add(Math.min(file.data.length - 1, headerRowIndex + 1));
    }

    // 3. 텍스트 변환
    Array.from(relevantIndices).sort((a, b) => a - b).forEach(idx => {
      const row = file.data[idx];
      const rowKey = `${file.name}-${idx}-${row.join('|')}`;
      if (seenRows.has(rowKey)) return;
      seenRows.add(rowKey);

      // 현재 행에 가장 가까운 상단 헤더 찾기
      const currentHeader = headerCandidates
        .filter(h => h.index <= idx)
        .sort((a, b) => b.index - a.index)[0] || {index: 0, headers: defaultHeaders};
      const headers = currentHeader.headers;

      let rowContext = `[파일: ${file.name}] `;
      
      if (isWideFormat || headers.length >= 2) {
        const matchedPairs = [];
        for (let colIdx = 0; colIdx < Math.max(headers.length, row.length); colIdx++) {
          const h = String(headers[colIdx] || '').trim();
          const v = String(row[colIdx] || '').trim();
          if (h && v && h !== v) matchedPairs.push(`${h}: ${v}`);
        }
        rowContext += `항목: ${row[0] || row[1] || '데이터'} | ${matchedPairs.join(' | ')}\n`;
      } else {
        const matchedPairs = [];
        for (let colIdx = 0; colIdx < Math.min(headers.length, row.length); colIdx++) {
          const h = String(headers[colIdx] || '').trim();
          const v = String(row[colIdx] || '').trim();
          if (h && v) matchedPairs.push(`${h}: ${v}`);
        }
        rowContext += `정보: ${matchedPairs.join(' | ')}\n`;
      }

      if (totalLength + rowContext.length < MAX_CONTEXT_LENGTH) {
        context += rowContext;
        totalLength += rowContext.length;
      }
    });
  }

  if (totalLength === 0 || context === "### IR 데이터 분석 결과 ###\n\n") {
    return "질문과 관련된 데이터를 찾을 수 없습니다. 키워드(예: 도료, 실리콘, 매출액)를 명확히 포함해 주세요.";
  }

  return context;
};
