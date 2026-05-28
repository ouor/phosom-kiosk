// drawText.fontFamily 가 가리키는 카탈로그 폰트를 FontFace API 로 등록한다.
// DOM 렌더(미리보기) 와 canvas 2D fillText(합성) 양쪽이 같은 family 를 보도록
// document.fonts 에 add 한다. 동시 호출은 in-flight Promise 를 공유.

import { FONT_CATALOG, type FontEntry } from './catalog';

type FontState = 'idle' | 'loading' | 'loaded' | 'error';

const states = new Map<string, FontState>();
const inflight = new Map<string, Promise<void>>();

async function loadOne(entry: FontEntry): Promise<void> {
  states.set(entry.id, 'loading');
  const ff = new FontFace(entry.family, `url(${entry.url})`, {
    weight: String(entry.weight),
    display: 'swap',
  });
  await ff.load();
  document.fonts.add(ff);
  states.set(entry.id, 'loaded');
}

async function ensureFont(id: string): Promise<void> {
  if (states.get(id) === 'loaded') return;
  const existing = inflight.get(id);
  if (existing) return existing;

  const entry = FONT_CATALOG.find((f) => f.id === id);
  if (!entry) return;

  const promise = loadOne(entry)
    .catch((err) => {
      console.warn('fontLoader: failed to load', id, err);
      states.set(id, 'error');
      throw err;
    })
    .finally(() => {
      inflight.delete(id);
    });

  inflight.set(id, promise);
  return promise;
}

export async function ensureFontsByFamily(
  families: Iterable<string>,
): Promise<void> {
  const ids: string[] = [];
  for (const fam of families) {
    const entry = FONT_CATALOG.find((f) => f.family === fam);
    if (entry) ids.push(entry.id);
  }
  await Promise.all(ids.map((id) => ensureFont(id).catch(() => {})));
}
