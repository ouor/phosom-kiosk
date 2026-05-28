// 프리셋 미리보기 전용 렌더러. 편집 기능 (드래그/리사이즈/회전 핸들) 은 모두
// 제거하고, 카메라 슬롯의 활성/완료 상태 표시만 남긴다.
//
// 컨테이너 크기에 맞춰 캔버스가 contain 비율로 스케일된다 (zoom/pan 없음).

import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Ref,
} from 'react';

import {
  getCanvas,
  getRenderOps,
  type DrawImageOp,
  type DrawTextOp,
  type Operation,
  type Preset,
  type TakeCameraOp,
} from '../lib/operations';
import { WebcamSlot, type WebcamSlotHandle } from './WebcamSlot';

type Props = {
  preset: Preset;
  /** loadPresetFromBlob 에서 source 가 blob: URL 로 치환된 operations. */
  operations: Operation[];
  /** slotId → 채워진 사진의 objectURL */
  previewFills: Map<string, string>;
  /** 현재 활성 슬롯 id. 이 슬롯에는 WebcamSlot 이 렌더된다. */
  activeSlotId: string | null;
  /** 슬롯 클릭 — 비활성 슬롯을 활성화. */
  onActivateSlot?: (slotId: string) => void;
  /** WebcamSlot 의 capture() 호출용 ref. */
  webcamRef?: Ref<WebcamSlotHandle>;
  /** 활성 슬롯에서 capture 또는 file pick 으로 사진이 만들어졌을 때. */
  onFillSlot?: (slotId: string, blob: Blob) => void;
};

export function FrameRenderer({
  preset,
  operations,
  previewFills,
  activeSlotId,
  onActivateSlot,
  webcamRef,
  onFillSlot,
}: Props) {
  const canvas = getCanvas(preset);
  const renderOps = useMemo(() => getRenderOps({ ...preset, operations }), [preset, operations]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setContainerSize({ w: rect.width, h: rect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale =
    containerSize.w && containerSize.h
      ? Math.min(containerSize.w / canvas.width, containerSize.h / canvas.height)
      : 0;

  return (
    <div ref={containerRef} className="relative flex h-full w-full items-center justify-center overflow-hidden">
      {scale > 0 && (
        <div
          className="relative shadow-2xl shadow-black/40"
          style={{
            width: canvas.width,
            height: canvas.height,
            background: canvas.background ?? '#ffffff',
            transform: `scale(${scale})`,
            transformOrigin: 'center center',
          }}
        >
          {renderOps.map((op) => {
            const isCamSlot = op.op === 'takeCamera';
            const isActive = isCamSlot && op.id === activeSlotId;
            const fillUrl = isCamSlot ? previewFills.get(op.id) : undefined;
            const clickable = isCamSlot && !isActive && !!onActivateSlot;

            const elStyle: CSSProperties = {
              position: 'absolute',
              left: op.x,
              top: op.y,
              width: op.width,
              height: op.height,
              transform: op.rotation ? `rotate(${op.rotation}deg)` : undefined,
              overflow: 'hidden',
              cursor: clickable ? 'pointer' : undefined,
            };

            return (
              <div
                key={op.id}
                style={elStyle}
                onClick={
                  clickable
                    ? () => onActivateSlot?.(op.id)
                    : undefined
                }
              >
                {isActive ? (
                  <WebcamSlot
                    ref={webcamRef}
                    facing={(op as TakeCameraOp).facing ?? 'front'}
                    onCapture={(blob) => onFillSlot?.(op.id, blob)}
                  />
                ) : isCamSlot && fillUrl ? (
                  <img
                    src={fillUrl}
                    alt=""
                    draggable={false}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none', userSelect: 'none' }}
                  />
                ) : (
                  <OpRenderer op={op} />
                )}

                {isCamSlot && !isActive && !fillUrl && (
                  <CameraSlotPlaceholder slot={(op as TakeCameraOp).slot} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function OpRenderer({ op }: { op: Operation }) {
  if (op.op === 'drawImage') {
    const imgOp = op as DrawImageOp;
    return (
      <img
        src={imgOp.source}
        alt=""
        draggable={false}
        style={{
          width: '100%',
          height: '100%',
          objectFit: imgOp.kind === 'background' ? 'cover' : 'fill',
          opacity: imgOp.opacity ?? 1,
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      />
    );
  }
  if (op.op === 'drawText') {
    const t = op as DrawTextOp;
    const stroke = t.strokeColor;
    const strokeW = t.strokeWidth ?? Math.max(1, Math.round((t.fontSize ?? 24) * 0.06));
    const style: CSSProperties = {
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent:
        t.align === 'right' ? 'flex-end' : t.align === 'left' ? 'flex-start' : 'center',
      color: t.color ?? '#2b2418',
      fontSize: t.fontSize,
      fontWeight: (t.weight as number | string) ?? 500,
      fontFamily: t.fontFamily
        ? `"${t.fontFamily}", -apple-system, BlinkMacSystemFont, sans-serif`
        : undefined,
      textAlign: t.align ?? 'center',
      opacity: t.opacity ?? 1,
      userSelect: 'none',
      pointerEvents: 'none',
      textShadow: stroke ? `0 0 ${strokeW}px ${stroke}, 0 0 ${strokeW}px ${stroke}` : undefined,
      whiteSpace: 'pre-wrap',
      overflow: 'hidden',
      padding: 4,
    };
    return <div style={style}>{t.text}</div>;
  }
  return null;
}

function CameraSlotPlaceholder({ slot }: { slot: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(0,0,0,0.06)',
        border: '4px dashed rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 8,
        color: 'rgba(0,0,0,0.6)',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      <div style={{ fontSize: '4rem', lineHeight: 1 }}>📷</div>
      <div style={{ fontWeight: 700, fontSize: '1.5rem' }}>슬롯 {slot + 1}</div>
    </div>
  );
}
