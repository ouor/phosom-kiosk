// 운영자가 선택하는 키오스크 설정. localStorage 기반 — IndexedDB 만큼의 용량이
// 필요 없고 동기 read 가 가능해야 마운트 시 깜빡임 없이 초기값을 잡을 수 있다.

const PRINT_MODE_KEY = 'photo-kiosk.print-mode';

/**
 * - `auto`: 제출 후 감사 화면만 노출. QR 없음. 인쇄 서버가 알아서 처리.
 * - `queue`: 감사 화면에 QR 코드를 노출 → 방문자가 자기 폰으로 스캔해 별도
 *           /track/:jobId 페이지에서 상태를 확인. 키오스크 자체는 폴링 안 함.
 */
export type PrintMode = 'auto' | 'queue';

export const DEFAULT_PRINT_MODE: PrintMode = 'auto';

export function loadPrintMode(): PrintMode {
  try {
    const raw = localStorage.getItem(PRINT_MODE_KEY);
    if (raw === 'auto' || raw === 'queue') return raw;
  } catch {
    /* localStorage 사용 불가 — 기본값으로 폴백 */
  }
  return DEFAULT_PRINT_MODE;
}

export function savePrintMode(mode: PrintMode): void {
  try {
    localStorage.setItem(PRINT_MODE_KEY, mode);
  } catch {
    /* 무시 — 다음 부팅 시 기본값으로 폴백 */
  }
}
