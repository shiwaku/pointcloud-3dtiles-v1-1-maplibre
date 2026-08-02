// maplibre-gl v6 は default export を持たない（名前付きエクスポートのみ）
import * as maplibregl from 'maplibre-gl'
import * as THREE from 'three'
import { TilesRenderer } from '3d-tiles-renderer'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export interface PointCloudStats {
  visible: number
  downloading: number
  parsing: number
  points: number
}

export interface PointCloudOptions {
  /** tileset.json の URL */
  url: string
  /** 点の直径（メートル） */
  pointSize: number
  /** TilesRenderer の errorTarget。小さいほど高精細・高負荷 */
  errorTarget: number
  /** 遠近で点を縮小するか */
  sizeAttenuation: boolean
  /** タイルセットの読み込み完了時。地図をデータ位置へ寄せるのに使う */
  onTilesetLoad?: (center: { lng: number; lat: number; alt: number }) => void
  onStats?: (stats: PointCloudStats) => void
  onError?: (message: string) => void
}

export interface PointCloudHandle {
  layer: maplibregl.CustomLayerInterface
  setPointSize(size: number): void
  setErrorTarget(value: number): void
  setSizeAttenuation(enabled: boolean): void
  /** 読み込み済みタイルの中心（緯度経度）。未読込なら null */
  center(): { lng: number; lat: number; alt: number } | null
}

/** ECEF (EPSG:4978) から緯度経度・楕円体高へ。Bowring 法の一段近似。 */
export function ecefToLngLatAlt(x: number, y: number, z: number) {
  const a = 6378137.0
  const e2 = 6.69437999014e-3
  const b = a * Math.sqrt(1 - e2)
  const ep2 = (a * a - b * b) / (b * b)

  const p = Math.sqrt(x * x + y * y)
  const th = Math.atan2(a * z, b * p)
  const lon = Math.atan2(y, x)
  const lat = Math.atan2(z + ep2 * b * Math.sin(th) ** 3, p - e2 * a * Math.cos(th) ** 3)
  const n = a / Math.sqrt(1 - e2 * Math.sin(lat) * Math.sin(lat))
  const alt = p / Math.cos(lat) - n

  return { lng: (lon * 180) / Math.PI, lat: (lat * 180) / Math.PI, alt }
}

/**
 * 指定した緯度経度における ECEF -> シーン座標の回転行列を返す。
 *
 * localTransform 側で `scale(s, -s, s) * rotateX(90deg)` を掛けているため、
 * シーンの軸は x = 東 / y = 上 / z = 南 になる。したがってこの行列の各行は
 * ECEF ベクトルを East, Up, -North へ射影するものであればよい。
 *
 * MapLibre 公式サンプルはこの 3 軸をルートタイルの transform（列が East/North/Up の
 * ENU -> ECEF 行列）から取り出しているが、point-tiler の tileset.json はルートに
 * transform を持たない。単位行列で代用すると ECEF の Z 軸を「上」とみなすことになり、
 * 東京（北緯 35.68 度）では鉛直軸が arccos(sin 35.68 deg) = 54.3 度ずれる。
 * そのため transform には頼らず、緯度経度から ENU 基底を直接組み立てている。
 */
export function ecefToSceneRotation(lngDeg: number, latDeg: number): THREE.Matrix4 {
  const lng = (lngDeg * Math.PI) / 180
  const lat = (latDeg * Math.PI) / 180
  const sinLng = Math.sin(lng)
  const cosLng = Math.cos(lng)
  const sinLat = Math.sin(lat)
  const cosLat = Math.cos(lat)

  // prettier-ignore
  return new THREE.Matrix4().setFromMatrix3(new THREE.Matrix3().set(
    -sinLng,          cosLng,          0,       // East
    cosLat * cosLng,  cosLat * sinLng, sinLat,  // Up
    sinLat * cosLng,  sinLat * sinLng, -cosLat, // -North
  ))
}

export function createPointCloudLayer(
  map: maplibregl.Map,
  options: PointCloudOptions,
): PointCloudHandle {
  let scene: THREE.Scene | null = null
  let camera: THREE.PerspectiveCamera | null = null // MapLibre の投影行列を受け取る描画用
  let tilesCamera: THREE.PerspectiveCamera | null = null // TilesRenderer の LOD 判定用
  let renderer: THREE.WebGLRenderer | null = null
  let tiles: TilesRenderer | null = null
  // 3d-tiles-renderer の型では TilesGroup が Object3D を継承していないため、
  // three.js 側の API を使うにはこちらで保持し直す必要がある。
  let tilesGroup: THREE.Group | null = null
  let localTransform: THREE.Matrix4 | null = null
  let origin: { lng: number; lat: number; alt: number } | null = null

  /**
   * 全タイルで共有する 1 枚のマテリアル。使い回すことで UI の操作が
   * 読み込み済みタイル全体へ即座に反映される。
   *
   * point-tiler の GLB は material を持たない POINTS プリミティブなので、
   * three.js の GLTFLoader は `sizeAttenuation: false` の PointsMaterial
   * （＝常に 1px）を割り当てる。それをこれで差し替える。
   */
  const material = new THREE.PointsMaterial({
    size: options.pointSize,
    sizeAttenuation: options.sizeAttenuation,
    vertexColors: true,
  })

  // 毎フレーム再確保しないよう使い回す一時オブジェクト
  const tmp = { P: new THREE.Matrix4(), invP: new THREE.Matrix4(), V: new THREE.Matrix4() }
  const sphere = new THREE.Sphere()

  function updateLocalTransform(lng: number, lat: number, alt: number): void {
    const mc = maplibregl.MercatorCoordinate.fromLngLat([lng, lat], alt)
    const s = mc.meterInMercatorCoordinateUnits()

    localTransform = new THREE.Matrix4()
      .makeTranslation(mc.x, mc.y, mc.z)
      // Y 軸反転: メルカトルは南が +Y、three.js は北が +Y
      .scale(new THREE.Vector3(s, -s, s))
      // Z-up を Y-up に倒す
      .multiply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), Math.PI / 2))
  }

  function placeTileset(): void {
    if (!tiles || !tilesGroup || !tiles.getBoundingSphere(sphere)) return

    const center = sphere.center.clone()
    const { lng, lat, alt } = ecefToLngLatAlt(center.x, center.y, center.z)
    origin = { lng, lat, alt }

    updateLocalTransform(lng, lat, alt)

    // タイルセット全体を「中心を原点へ移動」してから ENU 姿勢へ回転させる
    tilesGroup.matrix.multiplyMatrices(
      ecefToSceneRotation(lng, lat),
      new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z),
    )
    tilesGroup.matrixAutoUpdate = false
    tilesGroup.updateMatrixWorld(true)

    options.onTilesetLoad?.(origin)
  }

  function initTiles(): void {
    if (!scene || !tilesCamera || !renderer) return

    tiles = new TilesRenderer(options.url)
    tilesGroup = tiles.group as unknown as THREE.Group
    tilesGroup.name = 'pointcloud-3dtiles'
    tiles.errorTarget = options.errorTarget
    scene.add(tilesGroup)

    tiles.setCamera(tilesCamera)
    tiles.setResolutionFromRenderer(tilesCamera, renderer)

    // GLB の拡張は KHR_mesh_quantization だけ。three.js が標準対応しているため
    // DRACO / KTX2 のデコーダ登録は不要。
    tiles.manager.addHandler(/\.(gltf|glb)$/g, new GLTFLoader())

    tiles.addEventListener('load-model', (event: { scene: THREE.Object3D }) => {
      event.scene.traverse((obj: THREE.Object3D) => {
        const pts = obj as THREE.Points
        if (pts.isPoints) pts.material = material
      })
    })

    tiles.addEventListener('load-tileset', placeTileset)
    tiles.addEventListener('load-error', (event: { error: Error; url: string | URL }) => {
      options.onError?.(
        `タイルの読み込みに失敗しました: ${String(event.url ?? options.url)}\n${event.error?.message ?? ''}`,
      )
    })
  }

  let lastStats = 0

  function emitStats(now: number): void {
    if (!options.onStats || !tiles || now - lastStats < 250) return
    lastStats = now

    const s = (tiles as unknown as { stats?: Record<string, number> }).stats ?? {}
    let points = 0
    tiles.group.traverse((obj) => {
      const pts = obj as THREE.Points
      if (pts.isPoints && pts.visible) points += pts.geometry.attributes.position.count
    })

    options.onStats({
      visible: s.visible ?? 0,
      downloading: s.downloading ?? 0,
      parsing: s.parsing ?? 0,
      points,
    })
  }

  const layer: maplibregl.CustomLayerInterface = {
    id: 'pointcloud-3dtiles',
    type: 'custom',
    renderingMode: '3d',

    onAdd(_map, gl) {
      // スタイル切替で onAdd が再度呼ばれる。WebGL コンテキストは同じキャンバスの
      // ままなので、シーンと TilesRenderer は作り直さず再利用する。
      if (scene) return

      scene = new THREE.Scene()
      camera = new THREE.PerspectiveCamera()
      tilesCamera = new THREE.PerspectiveCamera()

      renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true })
      renderer.autoClear = false

      initTiles()
      const c = map.getCenter()
      updateLocalTransform(c.lng, c.lat, 0)
    },

    render(_gl, args) {
      if (!renderer || !scene || !camera || !tilesCamera || !localTransform) return

      // MapLibre の投影行列にローカル変換を合成して描画用カメラに載せる
      camera.projectionMatrix.fromArray(args.defaultProjectionData.mainMatrix)
      camera.projectionMatrix.multiply(localTransform)

      // TilesRenderer は投影行列とビュー行列を必要とするので、
      // MapLibre 側の投影行列から逆算してビュー行列を復元する
      tmp.P.fromArray(args.projectionMatrix)
      tmp.invP.copy(tmp.P).invert()
      tmp.V.multiplyMatrices(tmp.invP, camera.projectionMatrix)

      tilesCamera.projectionMatrix.copy(tmp.P)
      tilesCamera.matrixWorldInverse.copy(tmp.V)
      tilesCamera.matrixWorld.copy(tmp.V).invert()

      renderer.resetState()
      renderer.render(scene, camera)

      tiles?.update()
      emitStats(performance.now())

      map.triggerRepaint()
    },
  }

  return {
    layer,
    setPointSize(size) {
      material.size = size
      map.triggerRepaint()
    },
    setErrorTarget(value) {
      if (tiles) tiles.errorTarget = value
      map.triggerRepaint()
    },
    setSizeAttenuation(enabled) {
      material.sizeAttenuation = enabled
      material.needsUpdate = true
      map.triggerRepaint()
    },
    center: () => origin,
  }
}
