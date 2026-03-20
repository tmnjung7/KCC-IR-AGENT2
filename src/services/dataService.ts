import Papa from 'papaparse';

export interface IRData {
  category: string;
  item: string;
  value: string;
  unit: string;
  period: string;
  source: string;
}

export const fetchCSVData = async (url: string): Promise<IRData[]> => {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch CSV');
    const csvText = await response.text();
    
    return new Promise((resolve, reject) => {
      Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          resolve(results.data as IRData[]);
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
export const fetchAllCSVFromRepo = async (repoPath: string): Promise<{name: string, data: IRData[]}[]> => {
  try {
    // repoPath 예시: "tmnjung7/KCC-IR-AGENT"
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

export const formatContext = (allFileData: {name: string, data: IRData[]}[]): string => {
  return allFileData.map(file => 
    `[파일명: ${file.name}]\n` + 
    file.data.map(d => 
      `기간: ${d.period}, 항목: ${d.item}, 수치: ${d.value}${d.unit}, 분류: ${d.category}, 출처: ${d.source}`
    ).join('\n')
  ).join('\n\n');
};
