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
    const apiUrl = `https://api.github.com/repos/${repoPath}/contents/`;
    const response = await fetch(apiUrl);
    if (!response.ok) throw new Error('Failed to fetch repo contents');
    
    const files = await response.json();
    const csvFiles = files.filter((file: any) => file.name.endsWith('.csv'));
    
    const allData = await Promise.all(csvFiles.map(async (file: any) => {
      const data = await fetchCSVData(file.download_url);
      return { name: file.name, data };
    }));
    
    return allData;
  } catch (error) {
    console.error('Repo Fetch Error:', error);
    return [];
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
  const cleanQuery = query.replace(/[?.,!]/g, ' ');
  const keywords = cleanQuery.split(' ').filter(k => k.length >= 1 && !['은', '는', '이', '가', '을', '를', '의', '에'].includes(k));
  
  let context = "### IR 데이터 분석 결과 ###\n\n";
  let totalLength = 0;
  const MAX_CONTEXT_LENGTH = 100000;

  for (const file of allFileData) {
    if (!file.data || file.data.length === 0) continue;

    // 1. 헤더 행 찾기 (날짜 정보가 가장 많은 행을 헤더로 간주)
    let headerRowIndex = -1;
    let maxDateCount = 0;
    
    // 상단 20줄 내에서 헤더 탐색
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

    const headers = headerRowIndex !== -1 ? file.data[headerRowIndex] : [];

    // 2. 키워드와 관련된 데이터 행 찾기 및 '헤더:값' 매칭
    file.data.forEach((row, index) => {
      const rowStr = row.join(' ');
      if (keywords.some(k => rowStr.includes(k)) && index !== headerRowIndex) {
        let rowContext = `[파일명: ${file.name} | 항목: ${row[0] || row[1] || '정보없음'}]\n`;
        
        // 헤더와 현재 행의 값을 1:1로 매칭 (Smart Zipper)
        const matchedPairs = [];
        for (let colIdx = 0; colIdx < Math.max(headers.length, row.length); colIdx++) {
          const header = String(headers[colIdx] || '').trim();
          const value = String(row[colIdx] || '').trim();
          
          if (header && value && header !== value) {
            matchedPairs.push(`${header}: ${value}`);
          }
        }
        
        rowContext += matchedPairs.join(' | ') + '\n\n';
        
        if (totalLength + rowContext.length < MAX_CONTEXT_LENGTH) {
          context += rowContext;
          totalLength += rowContext.length;
        }
      }
    });
  }

  if (totalLength === 0) {
    return "질문과 관련된 데이터를 찾을 수 없습니다. 키워드를 확인해 주세요.";
  }

  return context;
};
