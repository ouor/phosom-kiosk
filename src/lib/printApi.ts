// 인쇄 서버 (print-web 백엔드) 통신 + 이미지 정규화.
//
// 흐름:
//   1. 합성된 PNG Blob 을 normalizeForPrint 로 통과시켜 EXIF 베이크 + portrait
//      이면 90° CW 회전 + JPEG 0.92 재인코딩. 서버가 portrait 를 422 로 거절하므로
//      클라이언트에서 미리 landscape/square 로 맞춘다.
//   2. multipart/form-data 로 POST /api/jobs. idempotency_key 는 호출자가
//      crypto.randomUUID() 로 만들어 넘긴다 (네트워크 재시도 시 동일 키 유지).
//   3. createJob 응답으로 받은 id 로 getJob 폴링 (2.5s 주기). DONE 도달 시 종료.

import { env } from '../env';

export const JOB_STATUSES = [
  'PENDING',
  'APPROVED',
  'PRINTING',
  'DONE',
  'FAILED',
  'REJECTED',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export type CreateJobResponse = {
  id: string;
  status: JobStatus;
};

export type PublicJob = {
  id: string;
  requester_name: string;
  status: JobStatus;
  created_at: string;
  updated_at: string;
};

export class PrintApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'PrintApiError';
    this.status = status;
  }
}

/**
 * 합성 결과 이미지를 인쇄 서버가 받아들일 수 있는 형태로 정규화한다.
 * - createImageBitmap 으로 EXIF orientation 베이크
 * - portrait 이면 90° CW 회전
 * - 항상 JPEG 0.92 로 재인코딩
 *
 * print-web/frontend/src/pages/UserPage.tsx 의 normalizeForPrint 와 같은 로직.
 */
export async function normalizeForPrint(input: Blob): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(input, { imageOrientation: 'from-image' });
  } catch {
    // 디코드 실패 시 (예: 비-Safari 의 HEIC) 원본 그대로 넘긴다 — 서버가 받아 처리.
    return new File([input], 'photo.jpg', { type: input.type || 'image/jpeg' });
  }

  const isPortrait = bitmap.height > bitmap.width;
  const outW = isPortrait ? bitmap.height : bitmap.width;
  const outH = isPortrait ? bitmap.width : bitmap.height;

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return new File([input], 'photo.jpg', { type: input.type || 'image/jpeg' });
  }

  if (isPortrait) {
    ctx.translate(outW, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(bitmap, 0, 0);
  } else {
    ctx.drawImage(bitmap, 0, 0);
  }
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.92),
  );
  if (!blob) {
    return new File([input], 'photo.jpg', { type: input.type || 'image/jpeg' });
  }
  return new File([blob], 'photo.jpg', {
    type: 'image/jpeg',
    lastModified: Date.now(),
  });
}

async function readDetail(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { detail?: string };
    if (typeof j.detail === 'string') return j.detail;
  } catch {
    /* not json */
  }
  return `HTTP ${res.status}`;
}

export async function createJob(args: {
  requesterName: string;
  idempotencyKey: string;
  image: File;
}): Promise<CreateJobResponse> {
  const form = new FormData();
  form.set('requester_name', args.requesterName);
  form.set('idempotency_key', args.idempotencyKey);
  form.set('image', args.image);

  let res: Response;
  try {
    res = await fetch(`${env.printApiBase}/api/jobs`, {
      method: 'POST',
      body: form,
    });
  } catch {
    throw new PrintApiError(0, '네트워크 연결을 확인해 주세요.');
  }
  if (!res.ok) {
    throw new PrintApiError(res.status, await readDetail(res));
  }
  return (await res.json()) as CreateJobResponse;
}

export async function getJob(jobId: string): Promise<PublicJob> {
  let res: Response;
  try {
    res = await fetch(`${env.printApiBase}/api/jobs/${encodeURIComponent(jobId)}`);
  } catch {
    throw new PrintApiError(0, '네트워크 연결을 확인해 주세요.');
  }
  if (!res.ok) {
    throw new PrintApiError(res.status, await readDetail(res));
  }
  return (await res.json()) as PublicJob;
}

/**
 * DONE 만이 사용자 시점의 terminal — FAILED/REJECTED 는 admin 재시도가 들어올
 * 수 있어 폴링을 계속한다. print-web/UserPage 와 같은 의미론.
 */
export function isTerminal(status: JobStatus): boolean {
  return status === 'DONE';
}

/** 사용자에게 노출하는 3 단계 phase. admin 디테일(승인/거절/실패) 은 숨긴다. */
export type UserPhase = 'waiting' | 'progress' | 'done';

export function userPhase(s: JobStatus): UserPhase {
  if (s === 'PRINTING') return 'progress';
  if (s === 'DONE') return 'done';
  return 'waiting';
}
