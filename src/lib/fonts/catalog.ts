// web-editor / RN 앱과 동일한 폰트 카탈로그. drawText.fontFamily 가
// 동일한 typeface 로 해결되어야 프리셋이 어디서 만들어졌든 같은 모양으로
// 렌더된다.

export type FontEntry = {
  id: string;
  label: string;
  family: string;
  weight: number;
  url: string;
  ext: 'ttf' | 'otf';
  bytes: number;
};

export const FONT_CATALOG: FontEntry[] = [
  {
    id: 'noto-sans-kr',
    label: 'Noto Sans KR',
    family: 'NotoSansKR-Regular',
    weight: 400,
    url: 'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/SubsetOTF/KR/NotoSansKR-Regular.otf',
    ext: 'otf',
    bytes: 4_644_748,
  },
  {
    id: 'noto-serif-kr',
    label: 'Noto Serif KR',
    family: 'NotoSerifKR-Regular',
    weight: 400,
    url: 'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Serif/SubsetOTF/KR/NotoSerifKR-Regular.otf',
    ext: 'otf',
    bytes: 7_669_020,
  },
  {
    id: 'black-han-sans',
    label: 'Black Han Sans',
    family: 'BlackHanSans-Regular',
    weight: 900,
    url: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/blackhansans/BlackHanSans-Regular.ttf',
    ext: 'ttf',
    bytes: 998_424,
  },
  {
    id: 'dongle',
    label: 'Dongle',
    family: 'Dongle-Regular',
    weight: 400,
    url: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/dongle/Dongle-Regular.ttf',
    ext: 'ttf',
    bytes: 4_458_600,
  },
  {
    id: 'jua',
    label: 'Jua',
    family: 'Jua-Regular',
    weight: 400,
    url: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/jua/Jua-Regular.ttf',
    ext: 'ttf',
    bytes: 2_119_352,
  },
];

export function getFontEntryByFamily(family: string | undefined): FontEntry | undefined {
  if (!family) return undefined;
  return FONT_CATALOG.find((f) => f.family === family);
}
