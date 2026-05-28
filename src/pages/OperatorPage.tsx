// 운영자 모드 — 부스 세팅 단계용 화면.
//
// 책임:
//   - 로컬 .frame.preset 파일을 골라 IndexedDB 에 캐시
//   - 캐시된 프리셋 목록 표시 / 삭제 / 전체 삭제
//   - 방문자 모드 (/visitor) 진입 링크
//
// 프리셋을 로드할 때 썸네일이 zip 안에 없으면 빈 카메라 슬롯 자리표시까지 넣어
// exportPreviewImage 로 즉석에서 생성한다. 그래야 visitor 의 선택 그리드에서
// 모든 프레임이 한눈에 구분된다.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { exportPreviewImage } from '../lib/export';
import { loadPresetFromBlob, revokeLoaded } from '../lib/preset';
import {
  deletePreset,
  listPresets,
  putPreset,
  type StoredPreset,
} from '../lib/db';

export function OperatorPage() {
  const [presets, setPresets] = useState<StoredPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const all = await listPresets();
    setPresets(all);
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  // 썸네일 Blob → objectURL. presets 가 갱신될 때마다 새로 만들고 이전 건 해제.
  const thumbUrls = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of presets) {
      if (p.thumbnail) map.set(p.id, URL.createObjectURL(p.thumbnail));
    }
    return map;
  }, [presets]);
  useEffect(() => {
    return () => thumbUrls.forEach((url) => URL.revokeObjectURL(url));
  }, [thumbUrls]);

  const onPickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const startOrder = presets.length;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const stored = await ingestFile(file, startOrder + i);
        await putPreset(stored);
      }
      await refresh();
    } catch (e) {
      console.error(e);
      setError((e as Error).message || '프리셋 로드 실패');
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (id: string) => {
    await deletePreset(id);
    await refresh();
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-neutral-950 text-neutral-100">
      <div className="mx-auto flex h-full w-full max-w-5xl flex-col p-6">
        <header className="mb-6 flex shrink-0 items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">운영자 — 프레임 관리</h1>
            <p className="mt-1 text-sm text-neutral-400">
              방문자에게 보여줄 .frame.preset 파일을 3~4개 골라 두세요. 새로고침해도
              유지됩니다.
            </p>
          </div>
          <Link
            to="/visitor"
            className={
              'rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400 ' +
              (presets.length === 0 ? 'pointer-events-none opacity-40' : '')
            }
            aria-disabled={presets.length === 0}
          >
            방문자 모드 시작 →
          </Link>
        </header>

        <div className="mb-4 flex shrink-0 flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".preset,application/zip"
            multiple
            className="hidden"
            onChange={(e) => {
              void onPickFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-400 disabled:opacity-50"
          >
            {busy ? '추가 중…' : '+ 프레임 파일 추가'}
          </button>
          <span className="text-xs text-neutral-500">{presets.length}개 저장됨</span>
        </div>

        {error && (
          <div className="mb-4 shrink-0 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* 운영자도 가급적 한 화면에 — 3~4개 가정에선 안 잘리고, 더 많이 올리면
            이 영역만 스크롤된다 (viewport 자체는 잠겨 있음). */}
        <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <p className="text-sm text-neutral-500">불러오는 중…</p>
        ) : presets.length === 0 ? (
          <div className="rounded-xl border border-dashed border-neutral-700 p-12 text-center text-neutral-400">
            아직 추가된 프레임이 없어요. 위의 “프레임 파일 추가” 버튼으로 시작하세요.
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {presets.map((p) => {
              const thumb = thumbUrls.get(p.id);
              return (
                <li
                  key={p.id}
                  className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900"
                >
                  <div className="flex aspect-square items-center justify-center bg-neutral-950">
                    {thumb ? (
                      <img
                        src={thumb}
                        alt=""
                        className="max-h-full max-w-full object-contain"
                      />
                    ) : (
                      <span className="text-neutral-600">썸네일 없음</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t border-neutral-800 px-3 py-2">
                    <span className="truncate text-sm">{p.name}</span>
                    <button
                      type="button"
                      onClick={() => onDelete(p.id)}
                      className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
                    >
                      삭제
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        </div>
      </div>
    </div>
  );
}

/**
 * 사용자 파일 → StoredPreset. zip 안에 thumbnail 이 없으면 placeholder 슬롯이
 * 보이는 형태로 즉석에서 PNG 를 생성해 같이 저장한다.
 */
async function ingestFile(file: File, order: number): Promise<StoredPreset> {
  const loaded = await loadPresetFromBlob(file);
  let thumbnail: Blob | null = loaded.thumbnail;
  try {
    if (!thumbnail) {
      thumbnail = await exportPreviewImage(
        { ...loaded.preset, operations: loaded.resolvedOperations },
        new Map(),
        { emptyCameraSlotPlaceholder: true },
      );
    }
  } catch (e) {
    console.warn('썸네일 생성 실패 — 썸네일 없이 저장', e);
    thumbnail = null;
  }
  // blob: URL 들은 더 이상 필요 없음 — DB 에는 원본 zip 만 보관.
  revokeLoaded(loaded);

  return {
    id: loaded.preset.meta.id || crypto.randomUUID(),
    name: loaded.preset.meta.name || file.name.replace(/\.[^.]+$/, ''),
    presetZip: file,
    thumbnail,
    addedAt: Date.now(),
    order,
  };
}
