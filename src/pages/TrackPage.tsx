// 방문자가 자기 폰으로 QR 을 스캔해 접속하는 독립 페이지. 키오스크는 제출
// 직후에 select 로 돌아가고, 대기/진행 상태는 여기서만 폴링한다.
//
// admin 의 존재(승인/거절/실패) 는 사용자에게 노출하지 않는다 — print-web 의
// UserPage 와 같은 의미론: DONE 만이 사용자 시점의 terminal, FAILED/REJECTED 는
// "대기중" 으로 보이고 폴링이 계속된다.

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import {
  getJob,
  isTerminal,
  PrintApiError,
  userPhase,
  type JobStatus,
  type UserPhase,
} from '../lib/printApi';

const POLL_INTERVAL_MS = 2500;

export function TrackPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [requesterName, setRequesterName] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) {
      setLoadError('잘못된 주소입니다.');
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const j = await getJob(jobId);
        if (cancelled) return;
        setStatus(j.status);
        setRequesterName(j.requester_name);
        setPollError(null);
        if (isTerminal(j.status)) return;
      } catch (e) {
        if (cancelled) return;
        if (e instanceof PrintApiError && e.status === 404) {
          setLoadError('해당 인쇄 요청을 찾을 수 없어요.');
          return;
        }
        setPollError(e instanceof PrintApiError ? e.message : '상태를 가져오지 못했어요.');
      }
      timer = window.setTimeout(tick, POLL_INTERVAL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId]);

  const phase: UserPhase | null = status ? userPhase(status) : null;

  return (
    <div className="flex h-full items-center justify-center bg-neutral-950 p-6 text-neutral-100">
      <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-6 text-center shadow-2xl shadow-black/40">
        <h1 className="text-lg font-semibold text-neutral-300">인쇄 상태</h1>

        {loadError ? (
          <p className="mt-6 text-sm text-red-400">{loadError}</p>
        ) : (
          <>
            {requesterName && (
              <>
                <p className="mt-4 text-sm text-neutral-400">요청자</p>
                <p className="mt-1 text-2xl font-semibold text-neutral-100">{requesterName}</p>
              </>
            )}

            <div
              className={
                'mt-6 rounded-xl border px-5 py-6 ' +
                (phase === 'done'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                  : phase === 'progress'
                  ? 'border-blue-500/40 bg-blue-500/10 text-blue-200'
                  : 'border-amber-500/40 bg-amber-500/10 text-amber-200')
              }
            >
              <p className="text-lg font-bold">
                {phase === 'done'
                  ? '출력 완료'
                  : phase === 'progress'
                  ? '출력 중'
                  : phase === 'waiting'
                  ? '대기 중'
                  : '상태 확인 중…'}
              </p>
              <p className="mt-1 text-sm">
                {phase === 'done'
                  ? '출력물을 받아가세요.'
                  : phase === 'progress'
                  ? '잠시만 기다려 주세요.'
                  : phase === 'waiting'
                  ? '순서를 기다리는 중입니다.'
                  : '서버에서 상태를 가져오는 중입니다.'}
              </p>
            </div>

            {pollError && <p className="mt-3 text-xs text-red-400">{pollError}</p>}
          </>
        )}
      </div>
    </div>
  );
}
