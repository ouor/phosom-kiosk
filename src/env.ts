// 빌드 시 주입되는 환경 변수의 단일 진입점. 누락 시 즉시 throw 해서
// 런타임 미스 매치를 빨리 드러낸다.

function read(name: string): string {
  const v = import.meta.env[name];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`환경 변수 ${name} 가 정의되지 않았어요. .env.local 을 확인해 주세요.`);
  }
  return v;
}

export const env = {
  /** 인쇄 서버 base URL. 예: http://localhost:8000 또는 https://print.t.ouor.in */
  printApiBase: read('VITE_PRINT_API_BASE').replace(/\/$/, ''),
};
