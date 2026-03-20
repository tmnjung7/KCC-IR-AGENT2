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
  const keywords = cleanQuery.split(' ').filter(k => k.length >= 1 && !['은', '는', '이', '가', '을', '를', '의', '에', '파일', '파일에', '대한', '알려줘', '분석', '추이'].includes(k));
  
  let context = "### IR 데이터 분석 결과 ###\n\n";
  let totalLength = 0;
  const MAX_CONTEXT_LENGTH = 100000;

  for (const file of allFileData) {
    if (!file.data || file.data.length === 0) continue;

    const fileNameLower = file.name.toLowerCase();
    const isFileMentioned = keywords.some(k => fileNameLower.includes(k));

    // 1. 헤더 행 찾기 (날짜 정보가 가장 많은 행을 헤더로 간주)
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

    // 날짜 헤더가 거의 없다면 (예: 2개 미만) 세로형(Long Format)으로 간주
    const isWideFormat = maxDateCount >= 2;
    const headers = headerRowIndex !== -1 ? file.data[headerRowIndex] : (file.data[0] || []);

    // 2. 키워드와 관련된 데이터 행 찾기
    const unitInfo = file.name.includes('1_2') ? " (단위: 천원)" : "";
    
    file.data.forEach((row, index) => {
      const rowStr = row.join(' ').toLowerCase();
      // 파일명이 언급되었거나 키워드가 포함된 경우
      const isRelevant = isFileMentioned || keywords.some(k => rowStr.includes(k));
      
      if (isRelevant && index !== headerRowIndex) {
        let rowContext = `[파일명: ${file.name}${unitInfo}]\n`;
        
        if (isWideFormat) {
          // 가로형 표: 헤더와 값을 1:1 매칭
          const matchedPairs = [];
          for (let colIdx = 0; colIdx < Math.max(headers.length, row.length); colIdx++) {
            const header = String(headers[colIdx] || '').trim();
            const value = String(row[colIdx] || '').trim();
            if (header && value && header !== value) {
              matchedPairs.push(`${header}: ${value}`);
            }
          }
          rowContext += `항목: ${row[0] || row[1] || '정보없음'} | ${matchedPairs.join(' | ')}\n\n`;
        } else {
          // 세로형 표: 헤더와 값을 1:1 매칭하여 의미 전달
          const matchedPairs = [];
          for (let colIdx = 0; colIdx < Math.min(headers.length, row.length); colIdx++) {
            const header = String(headers[colIdx] || '').trim();
            const value = String(row[colIdx] || '').trim();
            if (header && value) {
              matchedPairs.push(`${header}: ${value}`);
            }
          }
          rowContext += `데이터: ${matchedPairs.join(' | ')}\n\n`;
        }
        
        if (totalLength + rowContext.length < MAX_CONTEXT_LENGTH) {
          context += rowContext;
          totalLength += rowContext.length;
        }
      }
    });
  }

  if (totalLength === 0 || context === "### IR 데이터 분석 결과 ###\n\n") {
    return "질문과 관련된 데이터를 찾을 수 없습니다. 키워드를 확인해 주세요.";
  }

  return context;
};
