import type { StyleSpecification } from 'maplibre-gl'
import paleStyleJson from './pale-style.json'
import type { Theme } from './theme'

export type Basemap = 'map' | 'photo'

/**
 * 国土地理院 最適化ベクトルタイルの淡色地図風スタイル（同梱）。
 * 暗色版は配布されていないので、これを実行時に明度反転して作る。
 */
const paleStyle = paleStyleJson as unknown as StyleSpecification

/**
 * 同梱スタイルのソースは PMTiles を指しているが、同じデータが素の XYZ でも
 * 配信されている。こちらを使えば pmtiles パッケージへの依存を持たずに済む。
 */
const GSI_VECTOR_TILES = 'https://cyberjapandata.gsi.go.jp/xyz/optimal_bvmap-v1/{z}/{x}/{y}.pbf'

const GSI_PHOTO_ATTRIBUTION =
  '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル（全国最新写真）</a>'

// ---- 色ユーティリティ（明度反転でダーク化するため） ----

type Rgba = [number, number, number, number]

function parseColor(str: string): Rgba | null {
  const s = str.trim()
  const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s)
  if (rgba) return [+rgba[1], +rgba[2], +rgba[3], rgba[4] !== undefined ? +rgba[4] : 1]

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s)
  if (!hex) return null
  let h = hex[1]
  if (h.length === 3 || h.length === 4) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
  }
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
    h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
  ]
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]

  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return [h / 6, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255)
    return [v, v, v]
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue = (t: number): number => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [
    Math.round(hue(h + 1 / 3) * 255),
    Math.round(hue(h) * 255),
    Math.round(hue(h - 1 / 3) * 255),
  ]
}

/** 明度を反転して暗色に変換する。色相は保ち、彩度は少し抑える。 */
function darkenColor(str: string): string {
  const c = parseColor(str)
  if (!c) return str
  const [r, g, b, a] = c
  const [h, s, l] = rgbToHsl(r, g, b)
  const nl = Math.min(0.9, Math.max(0.05, 1 - l))
  const [nr, ng, nb] = hslToRgb(h, s * 0.85, nl)
  return `rgba(${nr},${ng},${nb},${a})`
}

/** paint 値は色文字列のほかに式（配列）も取りうるので再帰的に処理する。 */
function transformValue(value: unknown): unknown {
  if (typeof value === 'string') return parseColor(value) ? darkenColor(value) : value
  if (Array.isArray(value)) return value.map(transformValue)
  return value
}

// ---- スタイルの組み立て ----

interface StyleLayerLike {
  paint?: Record<string, unknown>
}

/** PMTiles 参照を XYZ 配信へ差し替える。 */
function useXyzTiles(style: StyleSpecification): StyleSpecification {
  for (const source of Object.values(style.sources)) {
    if (source.type !== 'vector') continue
    source.tiles = [GSI_VECTOR_TILES]
    delete source.url
  }
  return style
}

function buildPaleStyle(): StyleSpecification {
  return useXyzTiles(structuredClone(paleStyle))
}

function buildDarkStyle(): StyleSpecification {
  const style = buildPaleStyle()
  for (const layer of style.layers as unknown as StyleLayerLike[]) {
    const paint = layer.paint
    if (!paint) continue
    for (const key of Object.keys(paint)) {
      if (key.includes('color')) paint[key] = transformValue(paint[key])
    }
  }
  return style
}

/** 地理院 全国最新写真（シームレス）ラスタスタイル。日本国内のみ。 */
function photoStyle(): StyleSpecification {
  return {
    version: 8,
    glyphs: paleStyle.glyphs,
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

const themedCache = new Map<Theme, StyleSpecification>()

/** 背景地図スタイルを返す。ベクター側は同梱の淡色スタイルから組み立てる。 */
export function getBasemapStyle(base: Basemap, theme: Theme): StyleSpecification {
  if (base === 'photo') return photoStyle()

  let style = themedCache.get(theme)
  if (!style) {
    style = theme === 'dark' ? buildDarkStyle() : buildPaleStyle()
    themedCache.set(theme, style)
  }
  return style
}
