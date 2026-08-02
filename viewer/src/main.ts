// maplibre-gl v6 は default export を持たない（名前付きエクスポートのみ）
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

import { getBasemapStyle, type Basemap } from './basemap'
import { createPointCloudLayer, type PointCloudStats } from './pointcloud'
import { applyThemeAttr, initialTheme, type Theme } from './theme'
import './style.css'

const params = new URLSearchParams(location.search)

/** tileset.json の場所。?tileset= か VITE_TILESET_URL で差し替えられる。 */
const TILESET_URL = new URL(
  params.get('tileset') ?? import.meta.env.VITE_TILESET_URL ?? '/3dtiles/tokyo/tileset.json',
  location.href,
).toString()

const DATA_ATTRIBUTION = import.meta.env.VITE_DATA_ATTRIBUTION ?? '点群データ'

let theme: Theme = initialTheme()
let base: Basemap = 'map'
applyThemeAttr(theme)

const isMobile = window.matchMedia('(max-width: 640px)').matches

/**
 * URL に位置の hash が付いていれば利用者が指定した視点なので自動移動しない。
 * MapLibre は `hash: true` だと Map 生成の時点で hash を書き込むため、
 * 必ず Map を作る前に読む。
 */
const hasUserPosition = location.hash.length > 1

// ---- DOM ----
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const panel = $<HTMLElement>('panel')
const toast = $<HTMLElement>('toast')
const pointSizeInput = $<HTMLInputElement>('point-size')
const pointSizeOut = $<HTMLOutputElement>('point-size-out')
const errorTargetInput = $<HTMLInputElement>('error-target')
const errorTargetOut = $<HTMLOutputElement>('error-target-out')
const sizeAttenuationInput = $<HTMLInputElement>('size-attenuation')
const statEls: Record<keyof PointCloudStats, HTMLElement> = {
  visible: $('stat-visible'),
  downloading: $('stat-downloading'),
  parsing: $('stat-parsing'),
  points: $('stat-points'),
}

$('tileset-url').textContent = TILESET_URL.replace(location.origin, '')

function showToast(message: string): void {
  toast.hidden = false
  toast.textContent = message
}
toast.addEventListener('click', () => {
  toast.hidden = true
})

// ---- 地図 ----
const map = new maplibregl.Map({
  container: 'map',
  style: getBasemapStyle(base, theme),
  center: [139.7671, 35.6812],
  zoom: 16,
  pitch: 60,
  maxPitch: 85,
  // 地図位置を URL の #ズーム/緯度/経度 に反映（共有・リロード時の位置維持）
  hash: true,
  attributionControl: false,
  canvasContextAttributes: { antialias: true },
})

map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'top-right')
map.addControl(new maplibregl.ScaleControl(), 'bottom-left')
map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: DATA_ATTRIBUTION }))

map.on('error', (e) => showToast(`地図の読み込みでエラーが発生しました: ${e.error?.message ?? e}`))

// ---- 点群レイヤー ----
const pointcloud = createPointCloudLayer(map, {
  url: TILESET_URL,
  pointSize: Number(pointSizeInput.value),
  errorTarget: Number(errorTargetInput.value),
  sizeAttenuation: sizeAttenuationInput.checked,
  onTilesetLoad: ({ lng, lat }) => {
    if (!hasUserPosition) map.jumpTo({ center: [lng, lat], zoom: 17, pitch: 60 })
  },
  onStats: (stats) => {
    statEls.visible.textContent = stats.visible.toLocaleString('ja-JP')
    statEls.downloading.textContent = stats.downloading.toLocaleString('ja-JP')
    statEls.parsing.textContent = stats.parsing.toLocaleString('ja-JP')
    statEls.points.textContent = stats.points.toLocaleString('ja-JP')
  },
  onError: showToast,
})

function addPointCloudLayer(): void {
  if (!map.getLayer(pointcloud.layer.id)) map.addLayer(pointcloud.layer)
}
map.on('style.load', addPointCloudLayer)

// ---- 表示コントロール ----
pointSizeInput.addEventListener('input', () => {
  const size = Number(pointSizeInput.value)
  pointSizeOut.textContent = `${size.toFixed(2)} m`
  pointcloud.setPointSize(size)
})

errorTargetInput.addEventListener('input', () => {
  const value = Number(errorTargetInput.value)
  errorTargetOut.textContent = String(value)
  pointcloud.setErrorTarget(value)
})

sizeAttenuationInput.addEventListener('change', () => {
  pointcloud.setSizeAttenuation(sizeAttenuationInput.checked)
})

$<HTMLButtonElement>('fit-btn').addEventListener('click', () => {
  const c = pointcloud.center()
  if (!c) {
    showToast('タイルセットがまだ読み込まれていません。')
    return
  }
  map.flyTo({ center: [c.lng, c.lat], zoom: 17, pitch: 60 })
})

// ---- テーマ / パネル開閉 ----
const themeBtn = $<HTMLButtonElement>('theme-btn')
const collapseBtn = $<HTMLButtonElement>('collapse-btn')

function syncThemeBtn(): void {
  themeBtn.textContent = theme === 'dark' ? '☀️' : '🌙'
}

function syncCollapseBtn(): void {
  collapseBtn.textContent = panel.classList.contains('collapsed') ? '▾' : '▴'
}

function reloadStyle(): void {
  map.setStyle(getBasemapStyle(base, theme), { diff: false })
}

themeBtn.addEventListener('click', () => {
  theme = theme === 'dark' ? 'light' : 'dark'
  applyThemeAttr(theme)
  syncThemeBtn()
  // 写真背景はテーマの影響を受けないので張り替え不要
  if (base === 'map') reloadStyle()
})

collapseBtn.addEventListener('click', () => {
  panel.classList.toggle('collapsed')
  syncCollapseBtn()
})

// ---- 背景地図スイッチャー（右下） ----
class BasemapControl implements maplibregl.IControl {
  private el!: HTMLElement

  onAdd(): HTMLElement {
    this.el = document.createElement('div')
    this.el.className = 'maplibregl-ctrl basemap-switch'
    const defs: [Basemap, string][] = [
      ['map', '地図'],
      ['photo', '写真'],
    ]
    for (const [b, label] of defs) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.textContent = label
      btn.dataset.base = b
      btn.setAttribute('aria-selected', String(b === base))
      btn.addEventListener('click', () => setBase(b))
      this.el.append(btn)
    }
    return this.el
  }

  onRemove(): void {
    this.el.remove()
  }

  sync(): void {
    for (const btn of this.el.querySelectorAll<HTMLButtonElement>('button')) {
      btn.setAttribute('aria-selected', String(btn.dataset.base === base))
    }
  }
}

const basemapCtrl = new BasemapControl()
map.addControl(basemapCtrl, 'bottom-right')

function setBase(next: Basemap): void {
  if (next === base) return
  base = next
  basemapCtrl.sync()
  reloadStyle()
}

// ---- 初期化 ----
// ?debug で DevTools から地図と点群レイヤーを触れるようにする（姿勢の検証用）
if (params.has('debug')) {
  Object.assign(window, { __viewer: { map, pointcloud, setBase, get theme() { return theme } } })
}

syncThemeBtn()
if (isMobile) panel.classList.add('collapsed')
syncCollapseBtn()
if (isMobile) $('hint').textContent = '1本指=移動 / 2本指=回転・傾き'
