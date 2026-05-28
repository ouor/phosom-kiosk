// Canvas 2D 기반 프리뷰 이미지 내보내기.
// 모든 레이어를 fullres canvas 에 합성한 뒤 PNG Blob 을 반환한다.

import { ensureFontsByFamily } from './fonts/fontLoader';
import {
  getCanvas,
  type DrawImageOp,
  type DrawTextOp,
  type Operation,
  type Preset,
  type TakeCameraOp,
} from './operations';

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`이미지 로드 실패: ${src}`));
    img.src = src;
  });
}

function drawCameraSlotPlaceholder(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  slotIndex: number,
) {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.06)';
  ctx.fillRect(0, 0, w, h);

  const minSide = Math.min(w, h);
  const lineWidth = Math.max(2, Math.round(minSide * 0.012));
  const dash = Math.max(8, Math.round(minSide * 0.04));
  ctx.save();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.lineWidth = lineWidth;
  ctx.setLineDash([dash, dash]);
  const off = lineWidth / 2;
  ctx.strokeRect(off, off, w - lineWidth, h - lineWidth);
  ctx.restore();

  const iconSize = Math.round(minSide * 0.35);
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${iconSize}px -apple-system, "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
  ctx.fillText('📷', w / 2, h / 2 - iconSize * 0.1);

  const labelSize = Math.round(minSide * 0.1);
  ctx.font = `600 ${labelSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.fillText(`Slot ${slotIndex + 1}`, w / 2, h / 2 + iconSize * 0.7);
  ctx.restore();
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dw: number,
  dh: number,
) {
  const scale = Math.max(dw / img.naturalWidth, dh / img.naturalHeight);
  const sw = dw / scale;
  const sh = dh / scale;
  const sx = (img.naturalWidth - sw) / 2;
  const sy = (img.naturalHeight - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
}

export type ExportOptions = {
  /** 빈 카메라 슬롯에 점선 테두리 + 📷 자리표시. 썸네일에 권장. */
  emptyCameraSlotPlaceholder?: boolean;
};

/**
 * Operation 들을 fullres canvas 에 합성해 PNG Blob 을 돌려준다.
 * @param preset       프리셋 (operations 의 source 는 blob:/http(s)/data: 어떤 형태든 허용)
 * @param previewFills slotId → blob URL/objectURL (촬영한 사진)
 */
export async function exportPreviewImage(
  preset: Preset,
  previewFills: Map<string, string>,
  options: ExportOptions = {},
): Promise<Blob> {
  const cv = getCanvas(preset);
  const canvas = document.createElement('canvas');
  canvas.width = cv.width;
  canvas.height = cv.height;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = cv.background ?? '#ffffff';
  ctx.fillRect(0, 0, cv.width, cv.height);

  // drawText 가 참조하는 카탈로그 폰트가 document.fonts 에 등록되어 있어야
  // canvas.fillText 가 시스템 기본 폰트로 폴백하지 않는다.
  const families = new Set<string>();
  for (const op of preset.operations) {
    if (op.op === 'drawText') {
      const fam = (op as DrawTextOp).fontFamily;
      if (fam) families.add(fam);
    }
  }
  if (families.size > 0) {
    await ensureFontsByFamily(families);
    await Promise.all(
      Array.from(families).map((fam) =>
        document.fonts.load(`16px "${fam}"`).catch(() => {}),
      ),
    );
  }

  for (const op of preset.operations as Operation[]) {
    if (op.op === 'createCanvas') continue;
    if (!('x' in op)) continue;

    const { x, y, width, height, rotation } = op;

    ctx.save();

    ctx.translate(x + width / 2, y + height / 2);
    if (rotation) ctx.rotate((rotation * Math.PI) / 180);
    ctx.translate(-width / 2, -height / 2);

    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();

    ctx.globalAlpha = 'opacity' in op ? ((op as DrawImageOp).opacity ?? 1) : 1;

    if (op.op === 'drawImage') {
      const imgOp = op as DrawImageOp;
      try {
        const img = await loadImg(imgOp.source);
        if (imgOp.kind === 'background') {
          drawCover(ctx, img, width, height);
        } else {
          ctx.drawImage(img, 0, 0, width, height);
        }
      } catch {
        /* 이미지 로드 실패 시 무시 */
      }
    } else if (op.op === 'takeCamera') {
      const camOp = op as TakeCameraOp;
      const fillUrl = previewFills.get(camOp.id) ?? camOp.source;
      if (fillUrl) {
        try {
          const img = await loadImg(fillUrl);
          drawCover(ctx, img, width, height);
        } catch {
          /* ignore */
        }
      } else if (options.emptyCameraSlotPlaceholder) {
        drawCameraSlotPlaceholder(ctx, width, height, camOp.slot);
      }
    } else if (op.op === 'drawText') {
      const textOp = op as DrawTextOp;
      const fontSize = textOp.fontSize;
      const weight = textOp.weight ?? 500;
      const family = textOp.fontFamily
        ? `"${textOp.fontFamily}", -apple-system, BlinkMacSystemFont, sans-serif`
        : '-apple-system, BlinkMacSystemFont, sans-serif';
      ctx.font = `${weight} ${fontSize}px ${family}`;
      ctx.fillStyle = textOp.color;
      ctx.globalAlpha = textOp.opacity ?? 1;
      ctx.textBaseline = 'middle';

      const align = textOp.align ?? 'center';
      ctx.textAlign = align;
      const textX = align === 'left' ? 4 : align === 'right' ? width - 4 : width / 2;

      const lines = textOp.text.split('\n');
      const lineH = fontSize * 1.2;
      const totalH = lines.length * lineH;
      const startY = (height - totalH) / 2 + lineH / 2;

      if (textOp.strokeColor) {
        ctx.strokeStyle = textOp.strokeColor;
        ctx.lineWidth = textOp.strokeWidth ?? Math.max(1, Math.round(fontSize * 0.06));
        ctx.lineJoin = 'round';
        lines.forEach((line, i) => ctx.strokeText(line, textX, startY + i * lineH));
        lines.forEach((line, i) => ctx.fillText(line, textX, startY + i * lineH));
      } else {
        lines.forEach((line, i) => ctx.fillText(line, textX, startY + i * lineH));
      }
    }

    ctx.restore();
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('PNG 내보내기 실패'));
    }, 'image/png');
  });
}
