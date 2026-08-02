#!/usr/bin/env bash
#
# LAS/LAZ 点群を 3D Tiles v1.1 (GLB) に変換する。
#
#   usage: scripts/convert.sh [入力ディレクトリ] [出力ディレクトリ]
#          scripts/convert.sh las/tokyo 3dtiles/tokyo
#
# 環境変数で上書きできるパラメータ:
#   INPUT_EPSG   入力座標系   (default: 6677 = JGD2011 平面直角座標系 IX系)
#   OUTPUT_EPSG  出力座標系   (default: 4979 = WGS84 3D。3D Tiles 用)
#   MIN_ZOOM     最小ズーム   (default: 15)
#   MAX_ZOOM     最大ズーム   (default: 20)
#   THREADS      並列数       (default: nproc)
#   MAX_MEMORY   メモリ上限MB (default: 16384)
#
set -euo pipefail

INPUT_DIR="${1:-las/tokyo}"
OUTPUT_DIR="${2:-3dtiles/tokyo}"

INPUT_EPSG="${INPUT_EPSG:-6677}"
OUTPUT_EPSG="${OUTPUT_EPSG:-4979}"
MIN_ZOOM="${MIN_ZOOM:-15}"
MAX_ZOOM="${MAX_ZOOM:-20}"
THREADS="${THREADS:-$(nproc)}"
MAX_MEMORY="${MAX_MEMORY:-16384}"

if ! command -v ptiler >/dev/null 2>&1; then
  echo "error: ptiler が見つかりません。scripts/install-ptiler.sh を実行してください。" >&2
  exit 1
fi

shopt -s nullglob
inputs=("$INPUT_DIR"/*.las "$INPUT_DIR"/*.laz)
shopt -u nullglob

if [ ${#inputs[@]} -eq 0 ]; then
  echo "error: $INPUT_DIR に .las / .laz がありません。" >&2
  exit 1
fi

mkdir -p logs "$OUTPUT_DIR"

echo "input      : ${#inputs[@]} files in $INPUT_DIR"
echo "output     : $OUTPUT_DIR"
echo "epsg       : $INPUT_EPSG -> $OUTPUT_EPSG"
echo "zoom       : $MIN_ZOOM..$MAX_ZOOM"

# --quantize: KHR_mesh_quantization。POSITION を float32 -> uint16 に落として約半減させる。
#             three.js の GLTFLoader が標準対応しているためビューア側の追加設定は不要。
#             --meshopt / --gzip-compress はデコーダやサーバ設定が要るのでここでは使わない。
ptiler \
  --input "${inputs[@]}" \
  --output "$OUTPUT_DIR" \
  --input-epsg "$INPUT_EPSG" \
  --output-epsg "$OUTPUT_EPSG" \
  --min "$MIN_ZOOM" \
  --max "$MAX_ZOOM" \
  --threads "$THREADS" \
  --max-memory-mb "$MAX_MEMORY" \
  --quantize \
  2>&1 | tee "logs/ptiler-$(basename "$OUTPUT_DIR").log"

echo
echo "done: $OUTPUT_DIR/tileset.json"
