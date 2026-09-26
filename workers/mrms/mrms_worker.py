from __future__ import annotations

import gzip
import hashlib
import json
import math
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

import requests
from eccodes import (
    codes_get,
    codes_get_elements,
    codes_grib_new_from_file,
    codes_release,
)
from supabase import create_client

DEFAULT_URL = (
    "https://mrms.ncep.noaa.gov/2D/MESH_Max_30min/"
    "MRMS_MESH_Max_30min.latest.grib2.gz"
)
PRODUCT = "MESH_Max_30min"
MM_PER_INCH = 25.4


def env_required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def parse_bbox(value: str) -> tuple[float, float, float, float]:
    parts = [float(part.strip()) for part in value.split(",")]
    if len(parts) != 4:
        raise ValueError("MRMS_BBOX must be west,south,east,north")
    west, south, east, north = parts
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise ValueError("MRMS_BBOX is invalid")
    return west, south, east, north


def utc_from_grib(gid: int) -> datetime:
    # validityDate/validityTime include any product step when present.
    date = int(codes_get(gid, "validityDate"))
    time_value = int(codes_get(gid, "validityTime"))
    hour = time_value // 100
    minute = time_value % 100
    return datetime(
        date // 10000,
        (date // 100) % 100,
        date % 100,
        hour,
        minute,
        tzinfo=timezone.utc,
    )


def normalize_lon(value: float) -> float:
    while value > 180:
        value -= 360
    while value < -180:
        value += 360
    return value


def axis_index_range(
    first: float,
    increment: float,
    count: int,
    lower: float,
    upper: float,
) -> range:
    if increment == 0 or count <= 0:
        return range(0)
    a = (lower - first) / increment
    b = (upper - first) / increment
    lo = max(0, math.ceil(min(a, b) - 1e-9))
    hi = min(count - 1, math.floor(max(a, b) + 1e-9))
    return range(lo, hi + 1) if lo <= hi else range(0)


def extract_cells(
    grib_path: Path,
    bbox: tuple[float, float, float, float],
    minimum_inches: float,
) -> tuple[datetime, list[dict[str, float | str]]]:
    west, south, east, north = bbox

    with grib_path.open("rb") as fh:
        gid = codes_grib_new_from_file(fh)
        if gid is None:
            raise RuntimeError("NOAA file contained no GRIB message")

        try:
            grid_type = str(codes_get(gid, "gridType"))
            if grid_type not in {"regular_ll", "regular_gg"}:
                raise RuntimeError(f"Unsupported MRMS grid type: {grid_type}")

            ni = int(codes_get(gid, "Ni"))
            nj = int(codes_get(gid, "Nj"))
            lat1 = float(codes_get(gid, "latitudeOfFirstGridPointInDegrees"))
            lon1_raw = float(codes_get(gid, "longitudeOfFirstGridPointInDegrees"))
            lon1 = normalize_lon(lon1_raw)
            di = float(codes_get(gid, "iDirectionIncrementInDegrees"))
            dj = float(codes_get(gid, "jDirectionIncrementInDegrees"))
            i_negative = int(codes_get(gid, "iScansNegatively")) == 1
            j_positive = int(codes_get(gid, "jScansPositively")) == 1
            j_consecutive = int(codes_get(gid, "jPointsAreConsecutive")) == 1
            alternate = int(codes_get(gid, "alternativeRowScanning")) == 1

            if alternate:
                raise RuntimeError("Alternating-row GRIB scanning is not supported")

            lon_step = -di if i_negative else di
            lat_step = dj if j_positive else -dj

            # MRMS CONUS longitudes are west-negative after normalization and do
            # not cross the antimeridian. Refuse an ambiguous bbox rather than
            # silently selecting the wrong cells.
            if west > east:
                raise RuntimeError("Antimeridian-crossing MRMS bbox is unsupported")

            i_range = axis_index_range(lon1, lon_step, ni, west, east)
            j_range = axis_index_range(lat1, lat_step, nj, south, north)
            if len(i_range) == 0 or len(j_range) == 0:
                return utc_from_grib(gid), []

            indexes: list[int] = []
            coords: list[tuple[int, int, float, float]] = []
            for j in j_range:
                latitude = lat1 + j * lat_step
                for i in i_range:
                    longitude = normalize_lon(lon1 + i * lon_step)
                    flat = i * nj + j if j_consecutive else j * ni + i
                    indexes.append(flat)
                    coords.append((i, j, latitude, longitude))

            values_mm = codes_get_elements(gid, "values", indexes)
            cells: list[dict[str, float | str]] = []
            for (i, j, latitude, longitude), raw_mm in zip(coords, values_mm):
                value_mm = float(raw_mm)
                if not math.isfinite(value_mm) or value_mm < 0:
                    continue
                inches = value_mm / MM_PER_INCH
                if inches + 1e-9 < minimum_inches:
                    continue
                cells.append(
                    {
                        "grid_key": f"{i}:{j}",
                        "mesh_inches": round(inches, 2),
                        "latitude": round(latitude, 5),
                        "longitude": round(longitude, 5),
                    }
                )

            return utc_from_grib(gid), cells
        finally:
            codes_release(gid)


def chunks(rows: list[dict[str, float | str]], size: int) -> Iterable[list[dict[str, float | str]]]:
    for start in range(0, len(rows), size):
        yield rows[start : start + size]


def main() -> int:
    enabled = os.getenv("MRMS_ENABLED", "false").strip().lower() in {"1", "true", "yes", "on"}
    if not enabled:
        print(json.dumps({"state": "disabled", "reason": "MRMS_ENABLED is not true"}))
        return 0

    supabase_url = env_required("SUPABASE_URL")
    service_key = env_required("SUPABASE_SERVICE_ROLE_KEY")
    bbox = parse_bbox(env_required("MRMS_BBOX"))
    source_url = os.getenv("MRMS_PRODUCT_URL", DEFAULT_URL).strip() or DEFAULT_URL
    minimum_inches = float(os.getenv("MRMS_STORE_MIN_INCHES", "0.50"))
    batch_size = max(50, min(2000, int(os.getenv("MRMS_BATCH_SIZE", "750"))))

    if minimum_inches < 0:
        raise RuntimeError("MRMS_STORE_MIN_INCHES must be non-negative")

    response = requests.get(
        source_url,
        timeout=(10, 45),
        headers={"User-Agent": "DeltaRidge-MRMS/1.0"},
    )
    response.raise_for_status()
    compressed = response.content
    checksum = hashlib.sha256(compressed).hexdigest()

    try:
        grib_bytes = gzip.decompress(compressed)
    except OSError as exc:
        raise RuntimeError("NOAA MRMS response was not valid gzip") from exc

    with tempfile.TemporaryDirectory(prefix="deltaridge-mrms-") as tmp:
        grib_path = Path(tmp) / "mesh.grib2"
        grib_path.write_bytes(grib_bytes)
        valid_at, cells = extract_cells(grib_path, bbox, minimum_inches)

    db = create_client(supabase_url, service_key)
    valid_iso = valid_at.isoformat()

    existing = (
        db.table("mrms_ingest_runs")
        .select("id,status,source_checksum")
        .eq("product", PRODUCT)
        .eq("valid_at", valid_iso)
        .limit(1)
        .execute()
    )
    existing_rows = existing.data or []
    if existing_rows and existing_rows[0].get("status") == "success":
        print(json.dumps({"state": "already_ingested", "valid_at": valid_iso}))
        return 0

    run_payload = {
        "product": PRODUCT,
        "valid_at": valid_iso,
        "source_url": source_url,
        "source_file": source_url.rsplit("/", 1)[-1],
        "source_checksum": checksum,
        "status": "started",
        "minimum_inches": minimum_inches,
        "bbox_west": bbox[0],
        "bbox_south": bbox[1],
        "bbox_east": bbox[2],
        "bbox_north": bbox[3],
        "cells_stored": 0,
        "error_summary": None,
        "completed_at": None,
    }

    if existing_rows:
        run_id = existing_rows[0]["id"]
        db.table("mrms_ingest_runs").update(run_payload).eq("id", run_id).execute()
    else:
        inserted = db.table("mrms_ingest_runs").insert(run_payload).execute()
        run_id = inserted.data[0]["id"]

    try:
        written = 0
        for batch in chunks(cells, batch_size):
            result = db.rpc(
                "ingest_mrms_mesh_cells",
                {
                    "p_run_id": run_id,
                    "p_product": PRODUCT,
                    "p_valid_at": valid_iso,
                    "p_cells": batch,
                },
            ).execute()
            if result.data is not None:
                written += int(result.data)

        db.table("mrms_ingest_runs").update(
            {
                "status": "success",
                "cells_stored": len(cells),
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "error_summary": None,
            }
        ).eq("id", run_id).execute()

        print(
            json.dumps(
                {
                    "state": "success",
                    "valid_at": valid_iso,
                    "cells": len(cells),
                    "rpc_rows": written,
                    "minimum_inches": minimum_inches,
                    "bbox": bbox,
                }
            )
        )
        return 0
    except Exception as exc:
        db.table("mrms_ingest_runs").update(
            {
                "status": "failed",
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "error_summary": str(exc)[:1000],
            }
        ).eq("id", run_id).execute()
        raise


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"state": "failed", "error": str(exc)}), file=sys.stderr)
        raise
