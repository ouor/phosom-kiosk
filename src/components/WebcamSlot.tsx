// 카메라 슬롯 내부에서 라이브 영상을 보여주고, capture() 호출 시 현재 프레임을
// JPEG Blob 으로 캡쳐한다. 촬영 버튼은 부모(VisitorPage) 가 들고 있으므로
// 본 컴포넌트는 forwardRef + useImperativeHandle 로 capture 함수만 노출한다.

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

type Props = {
  /** 카메라 facing. 키오스크 부스 가정상 기본 front. */
  facing?: 'front' | 'back';
  onCapture: (blob: Blob) => void;
};

export type WebcamSlotHandle = {
  capture: () => void;
};

export const WebcamSlot = forwardRef<WebcamSlotHandle, Props>(function WebcamSlot(
  { facing = 'front', onCapture },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 클로저가 stale 한 콜백을 잡지 않도록 ref 로 우회.
  const onCaptureRef = useRef(onCapture);
  onCaptureRef.current = onCapture;

  useEffect(() => {
    const facingMode = facing === 'back' ? 'environment' : 'user';
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode }, audio: false })
      .then((s) => {
        streamRef.current = s;
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      .catch((e: Error) => setError(e.message ?? '카메라 접근 실패'));
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [facing]);

  useImperativeHandle(
    ref,
    () => ({
      capture: () => {
        const video = videoRef.current;
        if (!video?.videoWidth) return;
        const c = document.createElement('canvas');
        c.width = video.videoWidth;
        c.height = video.videoHeight;
        const ctx = c.getContext('2d')!;
        if (facing === 'front') {
          // 셀카처럼 좌우 반전된 프리뷰와 캡쳐 결과를 일치시킨다.
          ctx.translate(c.width, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(video, 0, 0);
        c.toBlob(
          (blob) => {
            if (blob) onCaptureRef.current(blob);
          },
          'image/jpeg',
          0.92,
        );
      },
    }),
    [facing],
  );

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-red-50 p-2 text-center text-xs text-red-700">
        카메라를 사용할 수 없어요
        <br />
        {error}
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        onCanPlay={() => setReady(true)}
        className="block h-full w-full object-cover"
        style={facing === 'front' ? { transform: 'scaleX(-1)' } : undefined}
      />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-white/80">
          카메라 준비 중…
        </div>
      )}
    </div>
  );
});
