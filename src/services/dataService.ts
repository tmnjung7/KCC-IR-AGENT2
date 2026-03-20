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
    const response = await fetch(url);
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
    const cleanPath = repoPath.trim().replace(/\/$/, '');
    const apiUrl = `https://api.github.com/repos/${cleanPath}/contents`;
    console.log('Fetching from GitHub API:', apiUrl);
    
    const response = await fetch(apiUrl);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`GitHub API 오류: ${response.status} ${errorData.message || response.statusText}`);
    }
    
    const files = await response.json();
    if (!Array.isArray(files)) {
      throw new Error('GitHub API가 올바른 파일 목록을 반환하지 않았습니다.');
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
  const MAX_CONTEXT_LENGTH = 120000;
  const seenRows = new Set<string>(); // 중복 행 방지

  for (const file of allFileData) {
    if (!file.data || file.data.length === 0) continue;

    const fileNameLower = file.name.toLowerCase();
    const fileNumMatch = file.name.match(/\d+/g);
    const fileNums = fileNumMatch ? fileNumMatch : [];
    
    const isFileMentioned = keywords.some(k => 
      fileNameLower.includes(k) || 
      (k.match(/^\d+$/) && fileNums.includes(k)) ||
      (k.includes('번') && fileNums.includes(k.replace('번', '')))
    );

    // 1. 헤더 찾기
    let headerRowIndex = -1;
    let maxDateCount = 0;
    for (let i = 0; i < Math.min(20, file.data.length); i++) {
      const row = file.data[i];
      const dateCount = row.filter((cell: any) => 
        String(cell).match(/\d{1,2}Q\d{2}/i) || String(cell).match(/\d{4}/)
      ).length;
      if (dateCount > maxDateCount) {
        maxDateCount = dateCount;
        headerRowIndex = i;
      }
    }

    const isWideFormat = maxDateCount >= 2;
    const headers = headerRowIndex !== -1 ? file.data[headerRowIndex] : (file.data[0] || []);
    const unitInfo = file.name.includes('1_2') && !file.data.some(r => r.join(' ').includes('원')) ? " (단위: 천원)" : "";

    // 2. 검색 및 컨텍스트 윈도우 적용
    const relevantIndices = new Set<number>();
    
    file.data.forEach((row, index) => {
      const rowStr = row.join(' ').toLowerCase();
      const matchedKeywords = keywords.filter(k => rowStr.includes(k));
      
      // 관련성 점수 계산 (매칭된 키워드 수)
      if (matchedKeywords.length > 0 || isFileMentioned) {
        // 매칭된 행 주변 인덱스 추가 (컨텍스트 윈도우: 앞 1행, 뒤 4행)
        // 계층 구조(부문명 아래에 실적 나열) 대응을 위해 뒤쪽 윈도우를 더 길게 잡음
        const start = Math.max(0, index - 1);
        const end = Math.min(file.data.length - 1, index + 5);
        for (let i = start; i <= end; i++) {
          relevantIndices.add(i);
        }
      }
    });

    // 3. 선택된 행들을 텍스트로 변환
    Array.from(relevantIndices).sort((a, b) => a - b).forEach(idx => {
      const row = file.data[idx];
      const rowKey = `${file.name}-${idx}-${row.join('|')}`;
      if (seenRows.has(rowKey)) return;
      seenRows.add(rowKey);

      let rowContext = `[파일명: ${file.name}${unitInfo}] `;
      
      if (isWideFormat) {
        const matchedPairs = [];
        for (let colIdx = 0; colIdx < Math.max(headers.length, row.length); colIdx++) {
          const header = String(headers[colIdx] || '').trim();
          const value = String(row[colIdx] || '').trim();
          if (header && value && header !== value) {
            matchedPairs.push(`${header}: ${value}`);
          }
        }
        rowContext += `항목: ${row[0] || row[1] || '정보없음'} | ${matchedPairs.join(' | ')}\n`;
      } else {
        const matchedPairs = [];
        for (let colIdx = 0; colIdx < Math.min(headers.length, row.length); colIdx++) {
          const header = String(headers[colIdx] || '').trim();
          const value = String(row[colIdx] || '').trim();
          if (header && value) {
            matchedPairs.push(`${header}: ${value}`);
          }
        }
        rowContext += `데이터: ${matchedPairs.join(' | ')}\n`;
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
