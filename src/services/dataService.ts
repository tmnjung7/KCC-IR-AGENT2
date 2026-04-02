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

  for (const file of allFileData) {
    if (!file.data || file.data.length === 0) continue;

    const fileNameLower = file.name.toLowerCase();
    const fileNumMatch = file.name.match(/\d+/g);
    const fileNums = fileNumMatch ? fileNumMatch : [];
    
    // 파일명 자체가 키워드에 포함되는지 확인
    const isFileMentioned = keywords.some(k => 
      fileNameLower.includes(k) || 
      (k.match(/^\d+$/) && fileNums.includes(k))
    ) || mentionedFileNums.some(num => fileNums.includes(num));

    // 1. 헤더 찾기 로직 강화
    let headerRowIndex = 0;
    let maxDateCount = 0;
    for (let i = 0; i < Math.min(15, file.data.length); i++) {
      const row = file.data[i];
      const dateCount = row.filter((cell: any) => 
        String(cell).match(/\d{1,2}Q\d{2}/i) || String(cell).match(/20\d{2}/)
      ).length;
      if (dateCount > maxDateCount) {
        maxDateCount = dateCount;
        headerRowIndex = i;
      }
    }

    const isWideFormat = maxDateCount >= 2;
    const headers = file.data[headerRowIndex] || [];
    
    // 2. 검색 및 윈도우 추출
    const relevantIndices = new Set<number>();
    
  // "이자비용" 특수 처리
  const isInterestExpenseQuery = query.includes('이자비용') || query.includes('이자');
  const targetKeywords = isInterestExpenseQuery ? [...keywords, '이자비용', '이자', '금융비용', '비용'] : keywords;

  file.data.forEach((row, index) => {
    const rowStr = row.join(' ').toLowerCase();
    // 키워드가 하나라도 포함되거나, 이자비용 쿼리인 경우 더 유연하게 매칭
    const matchedKeywords = targetKeywords.filter(k => rowStr.includes(k));
    
    if (matchedKeywords.length >= 1 || isFileMentioned) {
      // 매칭된 행 주변 인덱스 추가 (컨텍스트 윈도우 확대: 앞 5행, 뒤 15행)
      const start = Math.max(0, index - 5);
      const end = Math.min(file.data.length - 1, index + 15);
      for (let i = start; i <= end; i++) {
        relevantIndices.add(i);
      }
    }
  });

    // 3. 텍스트 변환
    Array.from(relevantIndices).sort((a, b) => a - b).forEach(idx => {
      const row = file.data[idx];
      const rowKey = `${file.name}-${idx}-${row.join('|')}`;
      if (seenRows.has(rowKey)) return;
      seenRows.add(rowKey);

      let rowContext = `[파일: ${file.name}] `;
      
      if (isWideFormat) {
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
