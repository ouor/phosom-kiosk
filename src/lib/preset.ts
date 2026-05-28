// .frame.preset (zip) 의 브라우저용 로더.
// frame.json + thumbnail.png + assets/* 레이아웃을 풀어
// blob: URL 로 source 를 치환한 resolvedOperations 를 돌려준다.

import JSZip from 'jszip';

import type { DrawImageOp, Operation, Preset, TakeCameraOp } from './operations';

export type AssetMap = Map<string, Blob>;

export type LoadedPreset = {
  preset: Preset;
  resolvedOperations: Operation[];
  thumbnail: Blob | null;
  /** blob: URL → archive path (assets/...) 역매핑. unload 시 revoke 용. */
  blobUrls: string[];
  assets: AssetMap;
};

export async function loadPresetFromBlob(file: Blob): Promise<LoadedPreset> {
  const zip = await JSZip.loadAsync(file);
  const frameRaw = await zip.file('frame.json')?.async('string');
  if (!frameRaw) throw new Error('frame.json 이 없는 프리셋입니다.');
  const preset: Preset = JSON.parse(frameRaw);

  const assets: AssetMap = new Map();
  const pathToUrl = new Map<string, string>();
  const blobUrls: string[] = [];

  const entries: Promise<void>[] = [];
  zip.forEach((relPath, entry) => {
    if (entry.dir) return;
    if (relPath === 'frame.json') return;
    entries.push(
      (async () => {
        const blob = await entry.async('blob');
        assets.set(relPath, blob);
        const url = URL.createObjectURL(blob);
        pathToUrl.set(relPath, url);
        blobUrls.push(url);
      })(),
    );
  });
  await Promise.all(entries);

  const thumbnail = preset.meta.thumbnail ? (assets.get(preset.meta.thumbnail) ?? null) : null;

  const resolvedOperations: Operation[] = preset.operations.map((op) => {
    if (op.op === 'drawImage' || op.op === 'takeCamera') {
      const src = (op as DrawImageOp | TakeCameraOp).source;
      if (src && src.startsWith('assets/') && pathToUrl.has(src)) {
        return { ...op, source: pathToUrl.get(src)! } as Operation;
      }
    }
    return op;
  });

  return { preset, resolvedOperations, thumbnail, blobUrls, assets };
}

/** loadPresetFromBlob 으로 생성된 blob: URL 을 해제. 프리셋 언로드 시 호출. */
export function revokeLoaded(loaded: LoadedPreset): void {
  for (const url of loaded.blobUrls) URL.revokeObjectURL(url);
}
