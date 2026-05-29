// 방문자 모드 — 부스에 걸린 태블릿에서 반복 사용되는 화면.
//
// 흐름:
//   select   → 캐시된 프레임 썸네일 그리드 (탭하면 capture 진입)
//   capture  → FrameRenderer + 큰 촬영 버튼. 슬롯 순서대로 자동 진행.
//   preview  → 합성된 PNG + 이름 입력 + "인쇄 요청" 버튼
//   tracking → /api/jobs/{id} 폴링. DONE 도달 시 "처음으로" 버튼.
//
// 새로고침 보호: tracking 단계의 job 정보를 localStorage 에 저장 → 마운트 시 복원.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
// 방문자 화면에서는 라우터 네비게이션 노출 자체를 안 한다 — 운영자 모드 진입은
// 부스 외부에서 URL 로만.

import { FrameRenderer } from '../components/FrameRenderer';
import type { WebcamSlotHandle } from '../components/WebcamSlot';
import { listPresets, type StoredPreset } from '../lib/db';
import { exportPreviewImage } from '../lib/export';
import { getCameraSlots } from '../lib/operations';
import { loadPresetFromBlob, revokeLoaded, type LoadedPreset } from '../lib/preset';
import {
  createJob,
  getJob,
  isTerminal,
  normalizeForPrint,
  PrintApiError,
  userPhase,
  type JobStatus,
  type UserPhase,
} from '../lib/printApi';

type View = 'select' | 'capture' | 'preview' | 'submitting' | 'tracking';

const STORAGE_KEY = 'photo-kiosk.active-job';
type StoredJob = { id: string; name: string };

// 촬영 카운트다운 한 단계당 표시 시간(ms). 3 → 2 → 1 각 단계마다 한 번씩.
const COUNTDOWN_TICK_MS = 800;

function loadStoredJob(): StoredJob | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredJob) : null;
  } catch {
    return null;
  }
}
function persistStoredJob(j: StoredJob | null) {
  if (j) localStorage.setItem(STORAGE_KEY, JSON.stringify(j));
  else localStorage.removeItem(STORAGE_KEY);
}

export function VisitorPage() {
  const [presets, setPresets] = useState<StoredPreset[] | null>(null);

  // tracking 복원 — 새로고침해도 job 진행 상태 유지.
  const [view, setView] = useState<View>(() =>
    loadStoredJob() ? 'tracking' : 'select',
  );
  const [trackedJob, setTrackedJob] = useState<StoredJob | null>(() => loadStoredJob());

  const [loaded, setLoaded] = useState<LoadedPreset | null>(null);
  const [fills, setFills] = useState<Map<string, string>>(new Map());
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);
  const [composite, setComposite] = useState<Blob | null>(null);
  const [requesterName, setRequesterName] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 촬영 카운트다운. null = 비활성. 3 → 2 → 1 순으로 줄다가 0 에서 실제 촬영.
  const [countdown, setCountdown] = useState<number | null>(null);

  const webcamRef = useRef<WebcamSlotHandle>(null);

  // unmount 시 정리에 쓰는 최신 값 미러. state 만 deps 로 쓰면 매번 cleanup 이
  // 돌면서 아직 살아있는 blob URL 까지 revoke 되므로 ref 로 우회.
  const loadedRef = useRef<LoadedPreset | null>(null);
  loadedRef.current = loaded;
  const fillsRef = useRef<Map<string, string>>(fills);
  fillsRef.current = fills;

  // 프리셋 목록 로드.
  useEffect(() => {
    listPresets().then(setPresets).catch((e) => {
      console.error(e);
      setPresets([]);
    });
  }, []);

  // 컴포넌트 unmount 시 blob URL 누수 방지 — 항상 최신 ref 기준으로 정리.
  useEffect(() => {
    return () => {
      if (loadedRef.current) revokeLoaded(loadedRef.current);
      fillsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  // 카운트다운 진행 — 1 틱마다 줄이고, 0 에 닿으면 실제 촬영을 트리거한다.
  // deps 가 countdown 하나라 0 도달 시 capture 는 정확히 한 번만 호출된다.
  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      webcamRef.current?.capture();
      setCountdown(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setCountdown((c) => (c === null ? null : c - 1));
    }, COUNTDOWN_TICK_MS);
    return () => clearTimeout(timer);
  }, [countdown]);

  const onSelectFrame = useCallback(async (preset: StoredPreset) => {
    setErrorMsg(null);
    // 기존 로드된 게 있으면 정리
    if (loaded) revokeLoaded(loaded);
    fills.forEach((url) => URL.revokeObjectURL(url));
    setFills(new Map());

    try {
      const next = await loadPresetFromBlob(preset.presetZip);
      setLoaded(next);
      const slots = getCameraSlots({ ...next.preset, operations: next.resolvedOperations });
      setActiveSlotId(slots[0]?.id ?? null);
      setView('capture');
    } catch (e) {
      console.error(e);
      setErrorMsg('프레임을 불러오지 못했어요. 다른 프레임을 선택해 주세요.');
    }
  }, [loaded, fills]);

  const resetToSelect = useCallback(() => {
    setCountdown(null);
    if (loaded) revokeLoaded(loaded);
    fills.forEach((url) => URL.revokeObjectURL(url));
    setLoaded(null);
    setFills(new Map());
    setActiveSlotId(null);
    setComposite(null);
    setRequesterName('');
    setErrorMsg(null);
    persistStoredJob(null);
    setTrackedJob(null);
    setView('select');
  }, [loaded, fills]);

  const slots = useMemo(
    () => (loaded ? getCameraSlots({ ...loaded.preset, operations: loaded.resolvedOperations }) : []),
    [loaded],
  );

  // 활성 슬롯에서 capture → fills 채우고 다음 슬롯으로. 마지막이면 composite 생성 후 preview 로.
  const onFillSlot = useCallback(
    async (slotId: string, blob: Blob) => {
      const url = URL.createObjectURL(blob);
      const nextFills = new Map(fills);
      const prev = nextFills.get(slotId);
      if (prev) URL.revokeObjectURL(prev);
      nextFills.set(slotId, url);
      setFills(nextFills);

      const idx = slots.findIndex((s) => s.id === slotId);
      const nextSlot = slots[idx + 1];
      if (nextSlot) {
        setActiveSlotId(nextSlot.id);
        return;
      }
      // 모든 슬롯이 채워졌으면 합성 후 preview 로 자동 진입.
      setActiveSlotId(null);
      if (!loaded) return;
      try {
        const blobOut = await exportPreviewImage(
          { ...loaded.preset, operations: loaded.resolvedOperations },
          nextFills,
        );
        setComposite(blobOut);
        setView('preview');
      } catch (e) {
        console.error(e);
        setErrorMsg('합성에 실패했어요. 다시 시도해 주세요.');
      }
    },
    [fills, loaded, slots],
  );

  // 촬영 버튼 → 즉시 찍지 않고 3·2·1 카운트다운을 시작한다 (0 도달 시 effect 가 촬영).
  const onCapture = () => {
    if (countdown !== null || !activeSlotId) return;
    setCountdown(3);
  };

  const onRetakeAll = () => {
    setCountdown(null);
    fills.forEach((url) => URL.revokeObjectURL(url));
    setFills(new Map());
    setActiveSlotId(slots[0]?.id ?? null);
    setComposite(null);
    setView('capture');
  };

  const onSubmitPrint = async () => {
    if (!composite || !requesterName.trim()) return;
    setErrorMsg(null);
    setView('submitting');
    try {
      const file = await normalizeForPrint(composite);
      const job = await createJob({
        requesterName: requesterName.trim(),
        idempotencyKey: crypto.randomUUID(),
        image: file,
      });
      const stored: StoredJob = { id: job.id, name: requesterName.trim() };
      persistStoredJob(stored);
      setTrackedJob(stored);
      setView('tracking');
    } catch (e) {
      console.error(e);
      const msg = e instanceof PrintApiError ? e.message : '인쇄 요청에 실패했어요.';
      setErrorMsg(msg);
      setView('preview');
    }
  };

  // ── 단계별 렌더 ──────────────────────────────────────────────────────────

  if (view === 'tracking' && trackedJob) {
    return <Tracker job={trackedJob} onDone={resetToSelect} />;
  }

  if (view === 'select') {
    return (
      <SelectView
        presets={presets}
        onPick={onSelectFrame}
        error={errorMsg}
      />
    );
  }

  if (view === 'capture' && loaded) {
    const filledCount = fills.size;
    const total = slots.length;
    const currentIdx = activeSlotId ? slots.findIndex((s) => s.id === activeSlotId) : -1;
    return (
      <KioskShell
        title={loaded.preset.meta.name || '프레임'}
        progress={`${filledCount}/${total}`}
        onAbort={resetToSelect}
      >
        <div className="flex h-full min-h-0 min-w-0 flex-col">
          <div className="relative min-h-0 min-w-0 flex-1 bg-black">
            <FrameRenderer
              preset={loaded.preset}
              operations={loaded.resolvedOperations}
              previewFills={fills}
              activeSlotId={activeSlotId}
              webcamRef={webcamRef}
              onActivateSlot={(id) => setActiveSlotId(id)}
              onFillSlot={onFillSlot}
            />
            {countdown !== null && countdown > 0 && <CountdownOverlay value={countdown} />}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-neutral-800 bg-neutral-950 p-4">
            <button
              type="button"
              onClick={onRetakeAll}
              disabled={filledCount === 0}
              className="rounded-lg border border-neutral-700 px-4 py-3 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
            >
              처음부터 다시
            </button>
            <button
              type="button"
              onClick={onCapture}
              disabled={!activeSlotId || countdown !== null}
              className="rounded-full bg-rose-500 px-10 py-5 text-xl font-bold text-white shadow-lg hover:bg-rose-400 disabled:opacity-40"
            >
              📸{' '}
              {countdown !== null
                ? '촬영 준비…'
                : currentIdx >= 0
                ? `${currentIdx + 1}번째 촬영`
                : '촬영'}
            </button>
            <div className="w-[120px]" />
          </div>
        </div>
      </KioskShell>
    );
  }

  if ((view === 'preview' || view === 'submitting') && loaded && composite) {
    return (
      <PreviewView
        loaded={loaded}
        composite={composite}
        requesterName={requesterName}
        onChangeName={setRequesterName}
        onRetake={onRetakeAll}
        onSubmit={onSubmitPrint}
        submitting={view === 'submitting'}
        error={errorMsg}
        onAbort={resetToSelect}
      />
    );
  }

  // fallback — 알 수 없는 상태일 때 select 로.
  return <SelectView presets={presets} onPick={onSelectFrame} error={errorMsg} />;
}

// ── 화면 컴포넌트들 ──────────────────────────────────────────────────────

// 카메라 프리뷰 위에 겹쳐지는 촬영 카운트다운 숫자. key={value} 로 매 틱마다
// 다시 마운트되어 pop 애니메이션이 재생된다.
function CountdownOverlay({ value }: { value: number }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/30">
      <span
        key={value}
        className="font-black leading-none text-white"
        style={{
          fontSize: '40vmin',
          textShadow: '0 4px 32px rgba(0,0,0,0.6)',
          animation: `countdown-pop ${COUNTDOWN_TICK_MS}ms ease-out`,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function KioskShell({
  title,
  progress,
  onAbort,
  children,
}: {
  title: string;
  progress?: string;
  onAbort?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col bg-neutral-950 text-neutral-100">
      <header className="flex items-center justify-between gap-3 border-b border-neutral-800 bg-neutral-900 px-4 py-3">
        <h1 className="truncate text-base font-semibold">{title}</h1>
        <div className="flex items-center gap-3">
          {progress && <span className="text-sm text-neutral-400">{progress}</span>}
          {onAbort && (
            <button
              type="button"
              onClick={onAbort}
              className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800"
            >
              취소
            </button>
          )}
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
    </div>
  );
}

function SelectView({
  presets,
  onPick,
  error,
}: {
  presets: StoredPreset[] | null;
  onPick: (p: StoredPreset) => void;
  error: string | null;
}) {
  const urls = useMemo(() => {
    const map = new Map<string, string>();
    if (presets) {
      for (const p of presets) {
        if (p.thumbnail) map.set(p.id, URL.createObjectURL(p.thumbnail));
      }
    }
    return map;
  }, [presets]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-neutral-950 text-neutral-100">
      <div className="mx-auto flex h-full w-full max-w-5xl flex-col p-6">
        <header className="mb-6 shrink-0 text-center">
          <h1 className="text-3xl font-bold">프레임을 골라주세요</h1>
          <p className="mt-2 text-neutral-400">원하는 프레임을 탭하면 촬영이 시작됩니다.</p>
        </header>

        {error && (
          <div className="mb-4 shrink-0 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* 그리드 영역만 자체적으로 overflow-auto — 페이지 viewport 는 잠겨 있다. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
        {presets === null ? (
          <p className="text-center text-neutral-500">불러오는 중…</p>
        ) : presets.length === 0 ? (
          <div className="rounded-xl border border-dashed border-neutral-700 p-12 text-center text-neutral-400">
            아직 준비된 프레임이 없어요. 운영자에게 문의해 주세요.
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {presets.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onPick(p)}
                  className="group block w-full overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 transition hover:border-emerald-500/60 hover:shadow-lg hover:shadow-emerald-500/10"
                >
                  <div className="flex aspect-square items-center justify-center bg-neutral-950">
                    {urls.get(p.id) ? (
                      <img
                        src={urls.get(p.id)}
                        alt=""
                        className="max-h-full max-w-full object-contain transition group-hover:scale-105"
                      />
                    ) : (
                      <span className="text-neutral-700">no thumbnail</span>
                    )}
                  </div>
                  <div className="border-t border-neutral-800 px-3 py-2 text-sm font-semibold">
                    {p.name}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        </div>
      </div>
    </div>
  );
}

function PreviewView({
  loaded,
  composite,
  requesterName,
  onChangeName,
  onRetake,
  onSubmit,
  submitting,
  error,
  onAbort,
}: {
  loaded: LoadedPreset;
  composite: Blob;
  requesterName: string;
  onChangeName: (s: string) => void;
  onRetake: () => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
  onAbort: () => void;
}) {
  const compositeUrl = useMemo(() => URL.createObjectURL(composite), [composite]);
  useEffect(() => () => URL.revokeObjectURL(compositeUrl), [compositeUrl]);

  const canSubmit = requesterName.trim().length > 0 && !submitting;

  return (
    <KioskShell
      title={`${loaded.preset.meta.name} — 미리보기`}
      onAbort={onAbort}
    >
      <div className="flex h-full min-h-0 min-w-0 flex-col lg:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-black p-4">
          <img
            src={compositeUrl}
            alt="합성 결과"
            className="max-h-full max-w-full object-contain shadow-2xl shadow-black/50"
          />
        </div>
        <aside className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto border-t border-neutral-800 bg-neutral-950 p-6 lg:w-96 lg:border-l lg:border-t-0">
          <label className="block">
            <span className="text-sm font-medium text-neutral-300">이름</span>
            <input
              type="text"
              value={requesterName}
              onChange={(e) => onChangeName(e.target.value)}
              maxLength={50}
              disabled={submitting}
              placeholder="홍길동"
              className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-3 text-base text-neutral-100 outline-none focus:border-emerald-500"
            />
            <span className="mt-1 block text-xs text-neutral-500">
              인쇄물 픽업 시 호명될 이름입니다.
            </span>
          </label>

          {error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="mt-auto flex flex-col gap-2">
            <button
              type="button"
              onClick={onSubmit}
              disabled={!canSubmit}
              className="rounded-lg bg-emerald-500 px-4 py-4 text-base font-semibold text-emerald-950 hover:bg-emerald-400 disabled:opacity-40"
            >
              {submitting ? '제출 중…' : '🖨 인쇄 요청하기'}
            </button>
            <button
              type="button"
              onClick={onRetake}
              disabled={submitting}
              className="rounded-lg border border-neutral-700 px-4 py-3 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
            >
              다시 촬영
            </button>
          </div>
        </aside>
      </div>
    </KioskShell>
  );
}

function Tracker({
  job,
  onDone,
}: {
  job: StoredJob;
  onDone: () => void;
}) {
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const j = await getJob(job.id);
        if (cancelled) return;
        setStatus(j.status);
        setPollError(null);
        if (isTerminal(j.status)) return;
      } catch (e) {
        if (cancelled) return;
        setPollError(e instanceof PrintApiError ? e.message : '상태를 가져오지 못했어요.');
      }
      timer = window.setTimeout(tick, 2500);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [job.id]);

  const phase: UserPhase | null = status ? userPhase(status) : null;
  const isDone = !!status && isTerminal(status);

  return (
    <KioskShell title="인쇄 요청 진행 중" onAbort={!isDone ? onDone : undefined}>
      <div className="flex h-full items-center justify-center bg-neutral-950 p-6">
        <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-6 text-center">
          <p className="text-sm text-neutral-400">요청자</p>
          <p className="mt-1 text-2xl font-semibold text-neutral-100">{job.name}</p>

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
              {phase === 'done' ? '출력 완료' : phase === 'progress' ? '출력 중' : '대기 중'}
            </p>
            <p className="mt-1 text-sm">
              {phase === 'done'
                ? '출력물을 받아가세요.'
                : phase === 'progress'
                ? '잠시만 기다려 주세요.'
                : '순서를 기다리는 중입니다.'}
            </p>
          </div>

          {pollError && (
            <p className="mt-3 text-xs text-red-400">{pollError}</p>
          )}

          {isDone && (
            <button
              type="button"
              onClick={onDone}
              className="mt-6 w-full rounded-lg bg-emerald-500 px-4 py-3 text-base font-semibold text-emerald-950 hover:bg-emerald-400"
            >
              처음으로
            </button>
          )}
          {!isDone && (
            <button
              type="button"
              onClick={onDone}
              className="mt-6 w-full rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800"
            >
              새로 시작 (이번 요청은 계속 처리됨)
            </button>
          )}
        </div>
      </div>
    </KioskShell>
  );
}
