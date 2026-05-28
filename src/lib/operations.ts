// .frame.preset 의 Operation 스키마. web-editor / RN 앱과 동일하게 유지.

export type OperationId = string;

export type BaseOperation = {
  op: 'createCanvas' | 'drawImage' | 'drawText' | 'takeCamera';
  id: OperationId;
  visible?: boolean;
  locked?: boolean;
};

export type Transform = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
};

export type CreateCanvasOp = BaseOperation & {
  op: 'createCanvas';
  width: number;
  height: number;
  background?: string;
};

export type DrawImageOp = BaseOperation &
  Transform & {
    op: 'drawImage';
    source: string;
    kind?: 'image' | 'sticker' | 'drawing' | 'background';
    opacity?: number;
  };

export type DrawTextOp = BaseOperation &
  Transform & {
    op: 'drawText';
    text: string;
    fontFamily?: string;
    fontSize: number;
    color: string;
    strokeColor?: string | null;
    strokeWidth?: number;
    align?: 'left' | 'center' | 'right';
    weight?:
      | number
      | 'normal'
      | 'bold'
      | '100'
      | '200'
      | '300'
      | '400'
      | '500'
      | '600'
      | '700'
      | '800'
      | '900';
    opacity?: number;
  };

export type TakeCameraOp = BaseOperation &
  Transform & {
    op: 'takeCamera';
    slot: number;
    source?: string;
    facing?: 'front' | 'back';
  };

export type Operation = CreateCanvasOp | DrawImageOp | DrawTextOp | TakeCameraOp;

export type PresetMeta = {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  tags?: string[];
  type?: string;
  layout?: string;
  author?: string;
  schemaVersion: string;
  thumbnail?: string;
};

export type Preset = {
  meta: PresetMeta;
  operations: Operation[];
};

export function getCanvas(preset: Preset): CreateCanvasOp {
  const first = preset.operations[0];
  if (first?.op === 'createCanvas') return first;
  return {
    op: 'createCanvas',
    id: 'canvas',
    width: 1080,
    height: 1920,
    background: '#ffffff',
  };
}

export function getRenderOps(preset: Preset): Exclude<Operation, CreateCanvasOp>[] {
  return preset.operations.filter(
    (o): o is Exclude<Operation, CreateCanvasOp> => o.op !== 'createCanvas',
  );
}

export function getCameraSlots(preset: Preset): TakeCameraOp[] {
  return preset.operations
    .filter((o): o is TakeCameraOp => o.op === 'takeCamera')
    .sort((a, b) => a.slot - b.slot);
}

export function isTransformable(
  op: Operation,
): op is DrawImageOp | DrawTextOp | TakeCameraOp {
  return op.op === 'drawImage' || op.op === 'drawText' || op.op === 'takeCamera';
}
