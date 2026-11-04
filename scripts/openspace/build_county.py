#!/usr/bin/env python3
"""
build_county.py

Build the open space parcel files for one or more New York counties and, optionally,
upload them to Cloudflare R2 for the NYSeeds /openspace page.

For each county it writes, under --out:
  <county>/parcels.csv            one row per open space parcel (all municipalities)
  <county>/geo/<municipality>.geojson
                                  simplified parcel outlines plus nearby NYPAD outlines,
                                  for the map
  index.json                      list of built counties and their municipalities

Usage (from the nyseeds folder):
  pip install geopandas pyogrio requests boto3
  python scripts/openspace/build_county.py --county Westchester --nypad ../openspace/NYPAD_202604.gdb
  python scripts/openspace/build_county.py --county Westchester --county Putnam --nypad ... --upload
  python scripts/openspace/build_county.py --all --nypad ... --upload
  python scripts/openspace/build_county.py --upload-only [--county Westchester]

Parcels come from the source listed for the county in counties.json, or else from the
NYS ITS statewide public parcel service (38 counties). Downloads are cached in
<out>/cache; pass --refresh to download again.

R2 upload uses these environment variables (a .env file in the current folder is read):
  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
  R2_PREFIX (optional, default "openspace")
"""

import argparse
import datetime as dt
import json
import os
import re
import sys
from pathlib import Path
from types import SimpleNamespace

import geopandas as gpd
import pandas as pd
import requests
import shapely

sys.path.insert(0, str(Path(__file__).resolve().parent))
import openspace_parcels as osp  # noqa: E402

HERE = Path(__file__).resolve().parent
STATEWIDE_PARCELS = ("https://gisservices.its.ny.gov/arcgis/rest/services/"
                     "NYS_Tax_Parcels_Public/MapServer/1")
STATEWIDE_COUNTIES = [
    "Albany", "Broome", "Cayuga", "Chautauqua", "Cortland", "Erie", "Genesee", "Greene",
    "Hamilton", "Lewis", "Livingston", "Montgomery", "Oneida", "Onondaga", "Ontario",
    "Orange", "Oswego", "Otsego", "Putnam", "Rensselaer", "Rockland", "Schuyler",
    "Steuben", "St Lawrence", "Suffolk", "Sullivan", "Tioga", "Tompkins", "Ulster",
    "Warren", "Wayne", "Westchester", "Wyoming",
    "Bronx", "Kings", "New York", "Queens", "Richmond"]


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", str(s).lower()).strip("-") or "unknown"


def load_dotenv(path=Path(".env")):
    if path.exists():
        for line in path.read_text().splitlines():
            m = re.match(r"\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$", line)
            if m and m.group(1) not in os.environ:
                os.environ[m.group(1)] = m.group(2).strip().strip('"').strip("'")


# ---------------------------------------------------------------- sources

def county_boundary(name, state_fips, session):
    """County polygon and FIPS code from Census TIGERweb, looked up by name."""
    url = f"{osp.TIGER_BASE}/State_County/MapServer"
    info = session.get(url, params={"f": "json"}, timeout=60).json()
    lid = next(l["id"] for l in info["layers"] if l.get("name") == "Counties")
    base = name.replace("'", "''").replace("St ", "St. ")
    g = osp.fetch_arcgis(f"{url}/{lid}", session=session, label="County boundary",
                         where=f"STATE='{state_fips}' AND UPPER(BASENAME)=UPPER('{base}')")
    if g.empty:
        raise RuntimeError(f"Census has no county named {name!r} in state {state_fips}")
    return g


def get_parcels(cfg, bbox, cache, refresh, session):
    if cache.exists() and not refresh:
        print(f"  parcels: using cache {cache}", file=sys.stderr)
        return gpd.read_file(cache)
    url = cfg.get("parcel_url") or STATEWIDE_PARCELS
    where = cfg.get("parcel_where") or f"COUNTY_NAME='{cfg['name']}'"
    try:
        par = osp.fetch_arcgis(url, where=where, bbox_4326=bbox, session=session,
                               label="Parcels")
    except RuntimeError as e:
        if url == STATEWIDE_PARCELS:
            raise
        print(f"  {e}\n  trying the NYS statewide parcel service", file=sys.stderr)
        par = osp.fetch_arcgis(STATEWIDE_PARCELS, where=f"COUNTY_NAME='{cfg['name']}'",
                               bbox_4326=bbox, session=session, label="Parcels")
    cache.parent.mkdir(parents=True, exist_ok=True)
    par.to_file(cache, driver="GPKG")
    return par


# ---------------------------------------------------------------- outputs

def to_geojson(gdf, props, tolerance_m):
    g = gdf.copy()
    g["geometry"] = g.geometry.simplify(tolerance_m, preserve_topology=True)
    g = g[~g.geometry.is_empty].to_crs(4326)
    g["geometry"] = shapely.set_precision(g.geometry.values, 1e-6)
    return json.loads(g[props + ["geometry"]].to_json(drop_id=True))["features"]


def write_county(key, cfg, gdf, nyp, out, meta):
    cdir = out / key
    (cdir / "geo").mkdir(parents=True, exist_ok=True)
    df = gdf.drop(columns="geometry")
    df.to_csv(cdir / "parcels.csv", index=False)

    munis = []
    for name, part in gdf.groupby(gdf["municipality"].fillna("Unknown")):
        s = slug(name)
        area = part.geometry.union_all().envelope.buffer(300)
        near = nyp[nyp.intersects(area)]
        feats = []
        for f in to_geojson(part.assign(layer="parcel"), ["parcel_id", "layer"], 0.5):
            feats.append(f)
        if not near.empty:
            n = near.assign(layer="nypad",
                            name=near.get("Unit_Nm"), category=near.get("Category"),
                            designation=near.get("Des_Tp"))
            feats += to_geojson(n, ["layer", "name", "category", "designation"], 2.0)
        (cdir / "geo" / f"{s}.geojson").write_text(
            json.dumps({"type": "FeatureCollection", "features": feats},
                       separators=(",", ":")))
        munis.append({
            "name": name, "slug": s, "town": _mode(part["town"]),
            "parcels": int(len(part)), "acres": round(float(part["parcel_acres"].sum()), 1),
            "geo": f"{key}/geo/{s}.geojson"})

    counts = df["nypad_status"].astype(str).value_counts().to_dict()
    entry = {
        "key": key, "name": cfg["name"], "built": dt.date.today().isoformat(),
        "csv": f"{key}/parcels.csv", "parcels": int(len(df)),
        "acres": round(float(df["parcel_acres"].sum()), 1),
        "by_status": {k: int(v) for k, v in counts.items()},
        "roll_year": _mode(df["roll_year"]), "municipalities":
            sorted(munis, key=lambda m: m["name"]), **meta}
    return entry


def _mode(s):
    s = s.dropna()
    if s.empty:
        return None
    v = s.mode().iloc[0]
    return v.item() if hasattr(v, "item") else v


def update_index(out, entries, remote_index=None):
    path = out / "index.json"
    idx = remote_index or (json.loads(path.read_text()) if path.exists() else {})
    counties = {c["key"]: c for c in idx.get("counties", [])}
    for e in entries:
        counties[e["key"]] = e
    idx = {"updated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
           "counties": sorted(counties.values(), key=lambda c: c["name"])}
    path.write_text(json.dumps(idx, indent=1))
    return idx


# ---------------------------------------------------------------- R2

def r2_client():
    import boto3
    need = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]
    missing = [k for k in need if not os.environ.get(k)]
    if missing:
        sys.exit(f"Missing R2 settings: {', '.join(missing)}")
    return boto3.client(
        "s3", endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"], region_name="auto")


def r2_get_index(client, bucket, prefix):
    try:
        obj = client.get_object(Bucket=bucket, Key=f"{prefix}/index.json")
        return json.loads(obj["Body"].read())
    except Exception:
        return None


def r2_upload(client, bucket, prefix, out, keys):
    types = {".csv": "text/csv; charset=utf-8", ".geojson": "application/geo+json",
             ".json": "application/json"}
    files = [p for k in keys for p in (out / k).rglob("*") if p.is_file()]
    files.append(out / "index.json")
    for i, p in enumerate(files, 1):
        rel = p.relative_to(out).as_posix()
        client.upload_file(str(p), bucket, f"{prefix}/{rel}", ExtraArgs={
            "ContentType": types.get(p.suffix, "application/octet-stream"),
            "CacheControl": "public, max-age=300" if p.name == "index.json"
            else "public, max-age=3600"})
        print(f"  uploaded {i}/{len(files)} {rel}", file=sys.stderr)


def r2_set_cors(client, bucket, origins):
    client.put_bucket_cors(Bucket=bucket, CORSConfiguration={"CORSRules": [{
        "AllowedOrigins": origins, "AllowedMethods": ["GET", "HEAD"],
        "AllowedHeaders": ["*"], "MaxAgeSeconds": 86400}]})
    print(f"  CORS set for {origins}", file=sys.stderr)


def upload_existing(out, keys, cors=None):
    """Upload already-built counties from <out>, merging index.json with the remote one."""
    path = out / "index.json"
    if not path.exists():
        sys.exit(f"No {path} found; build a county first")
    built = {c["key"]: c for c in json.loads(path.read_text()).get("counties", [])}
    keys = keys or sorted(built)
    missing = [k for k in keys if k not in built or not (out / k / "parcels.csv").exists()]
    if missing:
        sys.exit(f"Not built in {out}: {', '.join(missing)}")
    client = r2_client()
    bucket = os.environ["R2_BUCKET"]
    prefix = os.environ.get("R2_PREFIX", "openspace")
    update_index(out, [built[k] for k in keys], r2_get_index(client, bucket, prefix))
    r2_upload(client, bucket, prefix, out, keys)
    if cors:
        r2_set_cors(client, bucket, [o.strip() for o in cors.split(",")])
    print(f"\nUploaded {', '.join(built[k]['name'] for k in keys)} from {out.resolve()}",
          file=sys.stderr)


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--county", action="append", default=[],
                    help="County name; repeat for several")
    ap.add_argument("--all", action="store_true",
                    help="Every county in counties.json plus the statewide service list")
    ap.add_argument("--nypad", required=False, help="NYPAD file geodatabase (.gdb)")
    ap.add_argument("--nypad-layer", default=None)
    ap.add_argument("--config", default=str(HERE / "counties.json"))
    ap.add_argument("--out", default="local/openspace")
    ap.add_argument("--classes", default=osp.DEFAULT_CLASSES)
    ap.add_argument("--large-acres", type=float, default=None,
                    help="Override each county's large_acres from counties.json")
    ap.add_argument("--include-overlap", type=float, default=0.25)
    ap.add_argument("--in-nypad", type=float, default=0.75)
    ap.add_argument("--include-proclamation", action="store_true")
    ap.add_argument("--refresh", action="store_true", help="Download parcels again")
    ap.add_argument("--upload", action="store_true", help="Upload results to R2")
    ap.add_argument("--upload-only", action="store_true",
                    help="Skip the build and upload counties already in --out to R2 "
                         "(all of them, or only those named with --county)")
    ap.add_argument("--set-cors", default=None, metavar="ORIGINS",
                    help="Comma-separated origins to allow on the R2 bucket, e.g. "
                         "'https://nyseeds.org,http://localhost:5000'")
    args = ap.parse_args()
    load_dotenv()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    config = json.loads(Path(args.config).read_text())
    state_fips = config.get("state_fips", "36")
    defaults = config.get("counties", {})

    names = list(args.county)
    if args.all:
        names = sorted({*(c["name"] for c in defaults.values()), *STATEWIDE_COUNTIES})
    if args.set_cors and not names and not args.upload_only:
        r2_set_cors(r2_client(), os.environ["R2_BUCKET"],
                    [o.strip() for o in args.set_cors.split(",")])
        return
    by_name = {c["name"].lower(): (k, c) for k, c in defaults.items()}
    if args.upload_only:
        upload_existing(out, [by_name.get(n.lower(), (slug(n), None))[0] for n in args.county],
                        args.set_cors)
        return
    if not names:
        sys.exit("Name at least one --county, or pass --all")
    if not args.nypad:
        sys.exit("--nypad is required to build counties")

    opts = SimpleNamespace(classes=args.classes, include_overlap=args.include_overlap,
                           in_nypad=args.in_nypad, min_acres=0.0)
    s = requests.Session()
    entries = []
    for name in names:
        key, cfg = by_name.get(name.lower(), (slug(name), {"name": name}))
        print(f"\n=== {cfg['name']} County", file=sys.stderr)
        try:
            b = county_boundary(cfg["name"], state_fips, s)
            aoi = osp.clean(b).geometry.union_all()
            bbox = gpd.GeoSeries([aoi], crs=osp.WORK_CRS).to_crs(4326).total_bounds

            par = get_parcels(cfg, bbox, out / "cache" / f"{key}_parcels.gpkg",
                              args.refresh, s)
            par = osp.clean(par)
            par = par[par.geometry.representative_point().within(aoi)]
            par = par.reset_index(drop=True)
            par["pid"] = par.index
            par["parcel_acres"] = (par.geometry.area / osp.SQM_PER_ACRE).round(2)
            print(f"  {len(par)} parcels in the county", file=sys.stderr)

            cos = gpd.GeoDataFrame(geometry=[], crs=osp.WORK_CRS)
            if cfg.get("county_os_url"):
                cos = osp.clean(osp.fetch_arcgis(cfg["county_os_url"], bbox_4326=bbox,
                                                 session=s, label="County OS"))
            nyp, nyp_layer = osp.read_nypad(args.nypad, args.nypad_layer, aoi,
                                            args.include_proclamation)
            nyp = osp.clean(nyp)

            opts.large_acres = (args.large_acres if args.large_acres is not None
                                else cfg.get("large_acres", 0))
            gdf = osp.analyze(par, cos, nyp, opts)
            print(f"  {len(gdf)} open space parcels", file=sys.stderr)
            entries.append(write_county(key, cfg, gdf, nyp, out, {
                "nypad": Path(args.nypad).name,
                "parcel_source": cfg.get("parcel_url") or STATEWIDE_PARCELS,
                "county_os_source": cfg.get("county_os_url"),
                "classes": args.classes}))
        except Exception as e:
            print(f"  FAILED: {e}", file=sys.stderr)
            if len(names) == 1:
                raise

    if not entries:
        sys.exit("Nothing was built")
    client = r2_client() if args.upload else None
    prefix = os.environ.get("R2_PREFIX", "openspace")
    remote = r2_get_index(client, os.environ["R2_BUCKET"], prefix) if client else None
    update_index(out, entries, remote)
    if client:
        r2_upload(client, os.environ["R2_BUCKET"], prefix, out, [e["key"] for e in entries])
        if args.set_cors:
            r2_set_cors(client, os.environ["R2_BUCKET"],
                        [o.strip() for o in args.set_cors.split(",")])
    print(f"\nBuilt {', '.join(e['name'] for e in entries)} in {out.resolve()}",
          file=sys.stderr)


if __name__ == "__main__":
    main()
