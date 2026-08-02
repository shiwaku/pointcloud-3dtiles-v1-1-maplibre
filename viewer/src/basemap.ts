import type { StyleSpecification } from 'maplibre-gl'
import type { Theme } from './theme'

export type Basemap = 'map' | 'photo'

// API キー不要で使えるベクタースタイル。テーマに合わせて明暗を切り替える。
const VECTOR_STYLE: Record<Theme, string> = {
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
}

const GSI_PHOTO_ATTRIBUTION =
  '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル（全国最新写真）</a>'

/** 地理院 全国最新写真（シームレス）ラスタスタイル。日本国内のみ。 */
function photoStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      photo: {
        type: 'raster',
        tiles: ['https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg'],
        tileSize: 256,
        maxzoom: 18,
        attribution: GSI_PHOTO_ATTRIBUTION,
      },
    },
    layers: [{ id: 'photo', type: 'raster', source: 'photo' }],
  }
}

/**
 * 背景地図スタイルを返す。ベクター側は URL 文字列のまま MapLibre に渡して取得させる
 * （スタイル JSON を自前で fetch する必要はない）。
 */
export function getBasemapStyle(base: Basemap, theme: Theme): string | StyleSpecification {
  return base === 'photo' ? photoStyle() : VECTOR_STYLE[theme]
}
