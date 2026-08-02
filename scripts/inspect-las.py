#!/usr/bin/env python3
"""LAS/LAZ のヘッダを一覧する。変換前に EPSG と点数を確認するための補助スクリプト。

    usage: python scripts/inspect-las.py las/tokyo
"""

from __future__ import annotations

import sys
from pathlib import Path

import laspy


def main(argv: list[str]) -> int:
    target = Path(argv[1] if len(argv) > 1 else "las/tokyo")
    files = sorted([*target.glob("*.las"), *target.glob("*.laz")])
    if not files:
        print(f"{target} に .las / .laz がありません。", file=sys.stderr)
        return 1

    total = 0
    no_crs: list[str] = []
    crs_set: set[str] = set()
    bounds = [float("inf")] * 3 + [float("-inf")] * 3

    print(f"{'file':<20}{'ver':<6}{'fmt':<5}{'points':>14}  crs")
    print("-" * 72)
    for path in files:
        with laspy.open(path) as fh:
            header = fh.header
            crs = header.parse_crs()
            total += header.point_count
            if crs is None:
                no_crs.append(path.name)
            else:
                crs_set.add(str(crs.to_epsg() or crs.name))
            for i in range(3):
                bounds[i] = min(bounds[i], header.mins[i])
                bounds[i + 3] = max(bounds[i + 3], header.maxs[i])
            print(
                f"{path.name:<20}{str(header.version):<6}{header.point_format.id:<5}"
                f"{header.point_count:>14,}  {crs.to_epsg() if crs else '-'}"
            )

    print("-" * 72)
    print(f"{'TOTAL':<20}{'':<6}{'':<5}{total:>14,}")
    print(f"bounds x: {bounds[0]:.3f} .. {bounds[3]:.3f}  ({bounds[3] - bounds[0]:.1f} m)")
    print(f"bounds y: {bounds[1]:.3f} .. {bounds[4]:.3f}  ({bounds[4] - bounds[1]:.1f} m)")
    print(f"bounds z: {bounds[2]:.3f} .. {bounds[5]:.3f}  ({bounds[5] - bounds[2]:.1f} m)")

    area = (bounds[3] - bounds[0]) * (bounds[4] - bounds[1])
    if area > 0:
        print(f"density : {total / area:.1f} points/m^2 (bbox 全体を母数とした概算)")

    print(f"crs     : {', '.join(sorted(crs_set)) or '(なし)'}")
    if no_crs:
        print(
            f"warning : 投影情報を持たないファイルが {len(no_crs)} 件あります "
            f"({', '.join(no_crs)})。ptiler には --input-epsg を明示してください。"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
