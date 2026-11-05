#!/usr/bin/env python3
"""
openspace_parcels.py

List every open space tax parcel inside a town (or county) boundary. For each parcel,
show its local assessment status and open space designations, and the NYPAD records
that cover it, or that it is missing from NYPAD.

A parcel counts as open space when any of these is true:
  1. its property class is in the open space class list (see --classes)
  2. at least --include-overlap of its area is in the county open space layer
  3. at least --include-overlap of its area is in NYPAD (fee or easement)
  4. a NYPAD easement covers at least 0.25 acre or 10% of it
     (nypad_easement_acres gives the covered acres)
The selected_by column says which rule(s) picked it up.

Sources (defaults are for Westchester County, NY):
  Parcels     Westchester County GIS tax parcels, NYS statewide parcel schema,
              2025 assessment roll (giswww.westchestergov.com DataHub_TaxParcels).
  County OS   Westchester County Planning open space layer (AlldataMerge).
  NYPAD       Local file geodatabase from nypad.org (NYPAD_Combined layer).
  Boundary    Census TIGERweb town (county subdivision) or county boundary.

Usage:
  pip install geopandas pyogrio requests openpyxl
  python openspace_parcels.py --nypad NYPAD_202604.gdb --municipality "New Castle"
  python openspace_parcels.py --nypad NYPAD_202604.gdb --municipality "New Castle" --min-acres 1
  python openspace_parcels.py --nypad NYPAD_202604.gdb --municipality Bedford --classes "9xx,59x,822"

Outputs (in --out):
  openspace_parcels.xlsx   Parcels sheet (one row per parcel), Summary sheet, Codes sheet
  openspace_parcels.csv    same rows as the Parcels sheet
  openspace_parcels.gpkg   parcels with all columns, NYPAD and county open space for mapping
"""

import argparse
import re
import sys
import time
import warnings
import xml.etree.ElementTree as ET
from pathlib import Path

import geopandas as gpd
import pandas as pd
import pyogrio
import requests
from shapely.geometry import box

warnings.filterwarnings("ignore", message=".*organizePolygons.*")

PARCEL_URL = ("https://giswww.westchestergov.com/ArcGIS/rest/services/"
              "DataHub_TaxParcels/MapServer/0")
PARCEL_URL_ALT = ("https://services6.arcgis.com/EbVsqZ18sv1kVJ3k/ArcGIS/rest/services/"
                  "Westchester_County_Parcels/FeatureServer/0")
COUNTY_OS_URL = ("https://services.arcgis.com/XKEHpOulfycN9cGC/ArcGIS/rest/services/"
                 "AlldataMerge/FeatureServer/16")
TIGER_BASE = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb"

WORK_CRS = "EPSG:32618"          # UTM 18N, meters
SQM_PER_ACRE = 4046.8564224
MIN_PIECE_SQM = 5.0               # ignore overlaps smaller than this (edge slivers)

DEFAULT_CLASSES = "129,190,552,553,557,560,59x,682,821,822,9xx"
# A parcel is listed when a NYPAD easement covers at least this much of it, even if
# the easement is below --include-overlap.
EASEMENT_MIN_ACRES = 0.25
EASEMENT_MIN_SHARE = 0.10

# NYS ORPTS property type classification codes (tax.ny.gov, prclas.htm)
PROP_CLASS = {
    "100": "Agricultural", "105": "Agricultural vacant land (productive)",
    "110": "Livestock and products", "111": "Poultry and poultry products",
    "112": "Dairy products", "113": "Cattle, calves, hogs", "114": "Sheep and wool",
    "115": "Honey and beeswax", "116": "Other livestock", "117": "Horse farms",
    "120": "Field crops", "129": "Acquired development rights",
    "130": "Truck crops - mucklands", "140": "Truck crops - not mucklands",
    "150": "Orchard crops", "151": "Apples, pears, peaches, cherries, etc.",
    "152": "Vineyards", "160": "Other fruits", "170": "Nursery and greenhouse",
    "180": "Specialty farms", "181": "Fur products", "182": "Pheasant, etc.",
    "183": "Aquatic", "184": "Livestock: deer, moose, llamas, etc.",
    "190": "Fish, game and wildlife preserves",
    "200": "Residential", "210": "One family year-round residence",
    "215": "One family year-round residence with accessory apartment",
    "220": "Two family year-round residence", "230": "Three family year-round residence",
    "240": "Rural residence with acreage",
    "241": "Primary residential, also used in agricultural production",
    "242": "Recreational use", "250": "Estate", "260": "Seasonal residences",
    "270": "Manufactured home", "271": "Multiple manufactured homes",
    "280": "Residential multi-purpose/multi-structure", "281": "Multiple residences",
    "283": "Residence with incidental commercial use",
    "300": "Vacant land", "310": "Residential", "311": "Residential vacant land",
    "312": "Residential land including a small improvement",
    "314": "Rural vacant lots of 10 acres or less", "315": "Underwater vacant land",
    "320": "Rural", "321": "Abandoned agricultural land",
    "322": "Residential vacant land over 10 acres", "323": "Other rural vacant lands",
    "330": "Vacant land located in commercial areas",
    "331": "Commercial vacant land with minor improvements",
    "340": "Vacant land located in industrial areas",
    "341": "Industrial vacant land with minor improvements",
    "350": "Urban renewal or slum clearance", "351": "Shell building - residential",
    "352": "Shell building - commercial", "380": "Public utility vacant land",
    "400": "Commercial", "410": "Living accommodations", "411": "Apartments",
    "414": "Hotel", "415": "Motel", "416": "Manufactured home parks",
    "417": "Camps, cottages, bungalows",
    "418": "Inns, lodges, boarding and rooming houses", "420": "Dining establishments",
    "421": "Restaurants", "422": "Diners and luncheonettes",
    "423": "Snack bars, drive-ins, ice cream bars", "424": "Night clubs", "425": "Bar",
    "426": "Fast food franchises", "430": "Motor vehicle services",
    "431": "Auto dealers - sales and service", "432": "Service and gas stations",
    "433": "Auto body, tire shops, other related auto sales",
    "434": "Automatic car wash", "435": "Manual car wash",
    "436": "Self-service car wash", "437": "Parking garage", "438": "Parking lot",
    "439": "Small parking garage",
    "440": "Storage, warehouse and distribution facilities",
    "441": "Fuel storage and distribution facilities",
    "442": "Mini warehouse (self-storage)",
    "443": "Grain and feed elevators, mixers, sales outlets",
    "444": "Lumber yards, sawmills", "445": "Coal yards, bins",
    "446": "Cold storage facilities", "447": "Trucking terminals",
    "448": "Piers, wharves, docks and related facilities",
    "449": "Other storage, warehouse and distribution facilities",
    "450": "Retail services", "451": "Regional shopping centers",
    "452": "Area or neighborhood shopping centers", "453": "Large retail outlets",
    "454": "Large retail food stores",
    "455": "Dealerships - sales and service (other than auto)",
    "456": "Medium retail outlet", "457": "Small retail outlet",
    "460": "Banks and office buildings", "461": "Standard bank - single occupant",
    "462": "Drive-in branch bank", "463": "Bank complex with office building",
    "464": "Office building", "465": "Professional building",
    "470": "Miscellaneous services", "471": "Funeral homes",
    "472": "Dog kennels, veterinary clinics", "473": "Greenhouses", "474": "Billboards",
    "475": "Junkyards", "480": "Multiple use or multi-purpose",
    "481": "Downtown row type (with common wall)", "482": "Downtown row type (detached)",
    "483": "Converted residence", "484": "One story small structure",
    "485": "One story small structure - multi-occupant", "486": "Minimart",
    "500": "Recreation and entertainment", "510": "Entertainment assembly",
    "511": "Legitimate theaters", "512": "Motion picture theaters",
    "513": "Drive-in theaters", "514": "Auditoriums, exhibition and exposition halls",
    "515": "Radio, television and motion picture studios", "520": "Sports assembly",
    "521": "Stadiums, arenas, armories, field houses", "522": "Racetracks",
    "530": "Amusement facilities", "531": "Fairgrounds", "532": "Amusement parks",
    "533": "Game farms", "534": "Social organizations",
    "540": "Indoor sports facilities", "541": "Bowling centers",
    "542": "Ice or roller skating rinks", "543": "YMCA's, YWCA's, etc.",
    "544": "Health spas", "545": "Indoor swimming pools", "546": "Other indoor sports",
    "550": "Outdoor sports activities", "551": "Skiing centers",
    "552": "Public golf courses", "553": "Private golf country clubs",
    "554": "Outdoor swimming pools", "555": "Riding stables",
    "556": "Ice or roller skating rinks (may be covered)", "557": "Other outdoor sports",
    "560": "Improved beaches", "570": "Marinas",
    "580": "Camps, camping facilities and resorts", "581": "Camps",
    "582": "Camping facilities", "583": "Resort complexes", "590": "Parks",
    "591": "Playgrounds", "592": "Athletic fields", "593": "Picnic grounds",
    "600": "Community services", "610": "Education", "611": "Libraries",
    "612": "Schools", "613": "Colleges and universities",
    "614": "Special schools and institutions", "615": "Other educational facilities",
    "620": "Religious", "630": "Welfare", "631": "Orphanages",
    "632": "Benevolent and moral associations", "633": "Homes for the aged",
    "640": "Health", "641": "Hospitals", "642": "All other health facilities",
    "650": "Government", "651": "Highway garage",
    "652": "Office building (governmental)", "653": "Parking lots (governmental)",
    "660": "Protection", "661": "Army, Navy, Air Force, Marine and Coast Guard",
    "662": "Police and fire protection, electrical signal", "670": "Correctional",
    "680": "Cultural and recreational", "681": "Cultural facilities",
    "682": "Recreational facilities", "690": "Miscellaneous",
    "691": "Professional associations",
    "692": "Roads, streets, highways and parkways", "693": "Indian reservations",
    "694": "Animal welfare shelters", "695": "Cemeteries",
    "700": "Industrial", "710": "Manufacturing and processing",
    "712": "High-tech - manufacturing and processing",
    "714": "Light industrial - manufacturing and processing",
    "715": "Heavy manufacturing and processing", "720": "Mining and quarrying",
    "730": "Wells", "740": "Industrial product pipelines",
    "800": "Public services", "820": "Water", "821": "Flood control",
    "822": "Water supply", "823": "Water treatment facilities",
    "826": "Water transmission - improvements",
    "827": "Water transmission - outside plant", "830": "Communication",
    "837": "Cellular telephone towers", "840": "Transportation",
    "841": "Motor vehicle", "843": "Non-ceiling railroad", "844": "Air",
    "846": "Bridges, tunnels and subways", "847": "Pipelines",
    "850": "Waste disposal", "851": "Solid wastes", "852": "Landfills and dumps",
    "853": "Sewage treatment and water pollution control",
    "860": "Special franchise property", "870": "Electric and gas",
    "872": "Electric substation / electric power generation facilities",
    "873": "Gas measuring and regulation station",
    "878": "Electric power generation facility - solar",
    "880": "Electric and gas transmission and distribution",
    "882": "Electric transmission improvement", "883": "Gas transmission improvement",
    "884": "Electric distribution, outside plant property",
    "885": "Gas distribution, outside plant property",
    "900": "Wild, forested, conservation lands and public parks",
    "910": "Private wild and forest lands",
    "911": "Forest land under RPTL Section 480",
    "912": "Forest land under RPTL Section 480-a",
    "920": "Private hunting and fishing clubs", "930": "State-owned forest lands",
    "931": "State forest preserve, Adirondack or Catskill Parks",
    "932": "State-owned land, other than forest preserve",
    "940": "Reforested land and related conservation",
    "941": "State-owned reforested land", "942": "County-owned reforested land",
    "950": "Hudson River-Black River Regulating District land", "960": "Public parks",
    "961": "State-owned public parks and recreation areas",
    "962": "County-owned public parks and recreation areas",
    "963": "City, town, or village public parks",
    "970": "Other wild or conservation lands", "971": "Wetlands with use restrictions",
    "972": "Land under water", "980": "Taxable state-owned conservation easements",
    "990": "Other taxable state land assessments",
}
ROLL_SECTION = {
    "1": "Taxable", "3": "Taxable state land", "5": "Special franchise",
    "6": "Utility property", "7": "Ceiling railroad property",
    "8": "Wholly exempt",
}
OWNER_TYPE = {
    "1": "Federal", "2": "State", "3": "County", "4": "City", "5": "Town",
    "6": "Village", "7": "Mixed government", "8": "Private",
    "9": "Public school district or BOCES", "10": "Road right of way", "11": "Water",
    "-999": "Unknown",
}

# NYPAD fields to report, in output order. Coded fields are decoded with the gdb's
# own domains.
NYPAD_COLS = [
    ("Category", "nypad_category"),
    ("Unit_Nm", "nypad_unit_name"),
    ("Own_Type", "nypad_owner_type"),
    ("Own_Name", "nypad_owner_name"),
    ("Loc_Own", "nypad_local_owner"),
    ("Mang_Type", "nypad_manager_type"),
    ("Loc_Mang", "nypad_local_manager"),
    ("Des_Tp", "nypad_designation"),
    ("Loc_Ds", "nypad_local_designation"),
    ("GAP_Sts", "nypad_gap_status"),
    ("Pub_Access", "nypad_public_access"),
    ("Agg_Src", "nypad_source"),
    ("Src_Date", "nypad_source_date"),
    ("Source_PAI", "nypad_id"),
]
COUNTY_OS_COLS = [("GENTYPE", "county_os_classification"), ("TYPE", "county_os_type"),
                  ("NAME", "county_os_name"), ("ADMIN_JUR", "county_os_manager")]


# ---------------------------------------------------------------- ArcGIS REST

def _post(session, url, data, label):
    for attempt in range(4):
        try:
            r = session.post(url, data=data, timeout=180)
            r.raise_for_status()
            js = r.json()
            if "error" in js:
                raise RuntimeError(js["error"])
            return js
        except (requests.RequestException, ValueError, RuntimeError) as e:
            if attempt == 3:
                raise RuntimeError(f"{label}: request failed: {e}")
            time.sleep(2 ** attempt)


def fetch_arcgis(layer_url, where="1=1", bbox_4326=None, session=None, label="layer",
                 chunk=500):
    """Download all matching features. Pages by object ID, which works on both
    MapServer and FeatureServer layers whatever their pagination support."""
    s = session or requests.Session()
    q = {"where": where, "f": "json"}
    if bbox_4326 is not None:
        xmin, ymin, xmax, ymax = bbox_4326
        q.update({"geometry": f"{xmin},{ymin},{xmax},{ymax}",
                  "geometryType": "esriGeometryEnvelope", "inSR": 4326,
                  "spatialRel": "esriSpatialRelIntersects"})
    ids = _post(s, f"{layer_url}/query", {**q, "returnIdsOnly": "true"}, label)
    oids = sorted(ids.get("objectIds") or [])
    print(f"  {label}: {len(oids)} features to download", file=sys.stderr)
    frames = []
    for i in range(0, len(oids), chunk):
        part = oids[i:i + chunk]
        js = _post(s, f"{layer_url}/query",
                   {"objectIds": ",".join(map(str, part)), "outFields": "*",
                    "returnGeometry": "true", "outSR": 4326, "f": "geojson"}, label)
        if js.get("features"):
            frames.append(gpd.GeoDataFrame.from_features(js["features"], crs="EPSG:4326"))
        print(f"  {label}: {min(i + chunk, len(oids))}/{len(oids)}", file=sys.stderr)
    if not frames:
        return gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")
    return gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), crs="EPSG:4326")


def census_boundary(state_fips, county_fips, municipality=None, session=None):
    s = session or requests.Session()
    if municipality:
        service, layer_name = "Places_CouSub_ConCity_SubMCD", "County Subdivisions"
        mun = municipality.replace("'", "''")
        where = (f"STATE='{state_fips}' AND COUNTY='{county_fips}' "
                 f"AND UPPER(BASENAME)=UPPER('{mun}')")
    else:
        service, layer_name = "State_County", "Counties"
        where = f"STATE='{state_fips}' AND COUNTY='{county_fips}'"
    url = f"{TIGER_BASE}/{service}/MapServer"
    info = s.get(url, params={"f": "json"}, timeout=60).json()
    ids = [l["id"] for l in info.get("layers", []) if l.get("name") == layer_name]
    if not ids:
        raise RuntimeError(f"no '{layer_name}' layer in {url}")
    gdf = fetch_arcgis(f"{url}/{ids[0]}", where=where, session=s, label="Boundary")
    if gdf.empty:
        raise RuntimeError(f"no boundary matched {where}")
    return gdf


# ---------------------------------------------------------------- NYPAD

def nypad_domains(path, layer):
    """Return {field: {code: descriptor}} from the file geodatabase's coded value
    domains. Empty dict if the file is not a .gdb or the catalog cannot be read."""
    try:
        items = pyogrio.read_dataframe(path, layer="GDB_Items", read_geometry=False,
                                       LIST_ALL_TABLES="YES")
    except Exception as e:
        print(f"  NYPAD: could not read code lists ({e}); codes shown undecoded",
              file=sys.stderr)
        return {}
    domains = {}
    for d in items["Definition"].dropna():
        if "CodedValueDomain" in d:
            r = ET.fromstring(d)
            domains[r.findtext("DomainName")] = {
                cv.findtext("Code"): cv.findtext("Name") for cv in r.iter("CodedValue")}
    fc = items[items["Name"] == layer]["Definition"]
    if fc.empty:
        return {}
    out = {}
    for f in ET.fromstring(fc.iloc[0]).iter("GPFieldInfoEx"):
        dn = f.findtext("DomainName")
        if dn in domains:
            out[f.findtext("Name")] = domains[dn]
    return out


def make_decoder(domain):
    """Value -> 'CODE: Descriptor'. Accepts a code, a descriptor stored in place of
    the code (some NYPAD records do this), or a short form such as 'Closed'."""
    by_name = {v.lower(): k for k, v in domain.items()}
    def fmt(code):
        desc = domain[code]
        if desc == code:
            return code
        if re.match(rf"{re.escape(code)}\s*[–\-:]", desc):
            return desc
        return f"{code}: {desc}"
    def decode(v):
        if v is None or (isinstance(v, float) and pd.isna(v)):
            return None
        v = str(v).strip()
        if not v:
            return None
        if v in domain:
            return fmt(v)
        code = by_name.get(v.lower())
        if code is None:
            hits = [c for n, c in by_name.items() if n.startswith(v.lower())
                    or v.lower().startswith(n)]
            if not hits:
                hits = [c for n, c in by_name.items() if v.lower() in n]
            code = hits[0] if len(hits) == 1 else None
        return fmt(code) if code else v
    return decode


def read_nypad(path, layer, aoi, include_proclamation):
    if layer is None:
        layers = pyogrio.list_layers(path)
        polys = [n for n, t in layers if t and "Polygon" in t]
        if not polys:
            sys.exit(f"No polygon layers in {path}")
        layer = next((n for n in polys if "combined" in n.lower()), polys[0])
        print(f"  NYPAD layers: {polys}; using '{layer}'", file=sys.stderr)
    info = pyogrio.read_info(path, layer=layer)
    bbox = tuple(gpd.GeoSeries([aoi], crs=WORK_CRS).to_crs(info["crs"]).total_bounds)
    g = gpd.read_file(path, layer=layer, bbox=bbox)
    doms = nypad_domains(path, layer)
    for fld, _ in NYPAD_COLS:
        if fld in g.columns and fld in doms:
            g[fld] = g[fld].map(make_decoder(doms[fld]))
    if not include_proclamation and "Category" in g.columns:
        procl = g["Category"].fillna("").str.startswith("Proclamation")
        if procl.any():
            print(f"  NYPAD: leaving out {int(procl.sum())} proclamation boundaries "
                  f"(use --include-proclamation to keep them)", file=sys.stderr)
        g = g[~procl]
    return g, layer


# ---------------------------------------------------------------- geometry

def clean(gdf):
    g = gdf.to_crs(WORK_CRS)
    g = g[g.geometry.notna() & ~g.geometry.is_empty].copy()
    g["geometry"] = g.geometry.make_valid()
    return g[g.geom_type.isin(["Polygon", "MultiPolygon", "GeometryCollection"])]


def match(parcels, layer, cols, min_share_parcel=0.10, min_share_feature=0.5):
    """For each parcel: share of its area covered by `layer`, and the attributes of
    the layer features associated with it, largest overlap first. A feature is
    associated when it covers min_share_parcel of the parcel, or when
    min_share_feature of the feature lies inside the parcel."""
    pid = parcels[["pid", "geometry"]]
    if layer.empty:
        return pd.DataFrame({"share": 0.0}, index=parcels["pid"])
    lay = layer.reset_index(drop=True).assign(lid=lambda d: d.index)
    j = gpd.sjoin(pid, lay[["lid", "geometry"]], predicate="intersects", how="inner")
    if j.empty:
        res = pd.DataFrame({"share": 0.0}, index=parcels["pid"])
        return res
    pg = pid.set_index("pid").geometry
    lg = lay.set_index("lid").geometry
    a = pg.loc[j["pid"]].values
    b = lg.loc[j["lid"]].values
    j = j[["pid", "lid"]].reset_index(drop=True)
    inter = gpd.GeoSeries(a, crs=WORK_CRS).intersection(gpd.GeoSeries(b, crs=WORK_CRS))
    j["ov"] = inter.area.values
    j["pa"] = gpd.GeoSeries(a).area.values
    j["la"] = gpd.GeoSeries(b).area.values
    j = j[j["ov"] > MIN_PIECE_SQM]

    # coverage share, overlaps within the layer counted once
    cov = {}
    for p, grp in j.groupby("pid"):
        u = lg.loc[grp["lid"]].union_all()
        cov[p] = pg.loc[p].intersection(u).area / pg.loc[p].area
    res = pd.DataFrame({"share": pd.Series(cov)})

    assoc = j[(j["ov"] / j["pa"] >= min_share_parcel) | (j["ov"] / j["la"] >= min_share_feature)]
    assoc = assoc.sort_values(["pid", "ov"], ascending=[True, False])
    assoc = assoc.merge(lay.drop(columns="geometry"), on="lid", how="left")
    for src, dst in cols:
        if src not in assoc.columns:
            continue
        res[dst] = assoc.groupby("pid")[src].agg(_join_unique)
    res["count"] = assoc.groupby("pid").size()
    return res.reindex(parcels["pid"])


def _join_unique(vals):
    seen = []
    for v in vals:
        if v is None or (isinstance(v, float) and pd.isna(v)):
            continue
        v = str(v).strip()
        if v and v not in seen:
            seen.append(v)
    return " | ".join(seen) if seen else None


# ---------------------------------------------------------------- parcels

def class_code(v):
    m = re.match(r"\s*(\d{3})", str(v or ""))
    return m.group(1) if m else None


def class_desc(code):
    if not isinstance(code, str) or not code:
        return None
    return (PROP_CLASS.get(code) or PROP_CLASS.get(code[:2] + "0")
            or PROP_CLASS.get(code[0] + "00"))


def class_matcher(spec):
    pats = [p.strip().lower() for p in spec.split(",") if p.strip()]
    rx = [re.compile("^" + p.replace("x", r"\d") + "$") for p in pats]
    return lambda code: isinstance(code, str) and any(r.match(code) for r in rx)


def first_col(df, *names):
    for n in names:
        if n in df.columns:
            return df[n]
    return pd.Series([None] * len(df), index=df.index)


# ---------------------------------------------------------------- analysis

def analyze(par, cos, nyp, args):
    """One row per open space parcel. `par`, `cos` and `nyp` are cleaned GeoDataFrames in
    WORK_CRS; `par` needs pid and parcel_acres. `args` carries classes, include_overlap,
    in_nypad and min_acres. Returns a GeoDataFrame."""
    is_os_class = class_matcher(args.classes)
    cm = match(par, cos, COUNTY_OS_COLS)
    nm = match(par, nyp, NYPAD_COLS)

    # 4. assemble one row per parcel
    code = first_col(par, "PROP_CLASS").map(class_code)
    rs = first_col(par, "ROLL_SECTION").astype("string").str.strip()
    ot = first_col(par, "OWNER_TYPE").astype("string").str.strip()
    pts = par.geometry.representative_point().to_crs(4326)
    df = pd.DataFrame({
        "parcel_id": first_col(par, "SWIS_SBL_ID", "SBL").fillna("").astype(str),
        "swis_sbl": first_col(par, "SWIS_SBL_ID", "SBL"),
        "print_key": first_col(par, "PRINT_KEY"),
        "address": first_col(par, "PARCEL_ADDR"),
        "municipality": first_col(par, "MUNI_NAME", "CITYTOWN_NAME"),
        "town": first_col(par, "CITYTOWN_NAME", "MUNI_NAME"),
        "owner": first_col(par, "PRIMARY_OWNER"),
        "owner_type": ot.map(lambda v: f"{v}: {OWNER_TYPE.get(v, '?')}"
                             if pd.notna(v) and v else None),
        "parcel_acres": par["parcel_acres"],
        "assessor_acres": first_col(par, "ACRES"),
        "prop_class": first_col(par, "PROP_CLASS"),
        "prop_class_desc": code.map(class_desc),
        "roll_section": rs.map(lambda v: f"{v}: {ROLL_SECTION.get(v, '?')}"
                               if pd.notna(v) and v else None),
        "used_as": first_col(par, "USED_AS_DESC"),
        "ag_district": first_col(par, "AG_DIST_NAME"),
        "roll_year": first_col(par, "ROLL_YR"),
        "lat": pts.y.round(6),
        "lon": pts.x.round(6),
    })
    # stable unique id: SWIS+SBL, with a suffix where condo units share one
    blank = df["parcel_id"].str.strip() == ""
    df.loc[blank, "parcel_id"] = "pid-" + par.loc[blank, "pid"].astype(str)
    dup = df.groupby("parcel_id").cumcount()
    df.loc[dup > 0, "parcel_id"] = df["parcel_id"] + "-" + dup.astype(str)
    df["county_os_share"] = cm["share"].fillna(0).round(2).values
    for _, dst in COUNTY_OS_COLS:
        df[dst] = cm[dst].values if dst in cm else None
    share = nm["share"].fillna(0).values
    df["nypad_share"] = share.round(2)
    # Easements get their own measure: a parcel is often only partly under one, and
    # its property class still reflects the main use.
    is_ease = (nyp["Category"].fillna("").astype(str).str.startswith("Easement")
               if "Category" in nyp.columns else pd.Series(False, index=nyp.index))
    em = match(par, nyp[is_ease], [])
    ease_share = em["share"].fillna(0).values
    df["nypad_easement_acres"] = (ease_share * par["parcel_acres"].values).round(2)
    df["nypad_status"] = pd.cut(share, [-1, 0.10, args.in_nypad, 2], right=False,
                                labels=["Not in NYPAD", "Partly in NYPAD", "In NYPAD"]
                                ).astype(str)
    for _, dst in NYPAD_COLS:
        df[dst] = nm[dst].values if dst in nm else None

    # Condo and townhouse units are often each mapped as the whole common lot, so one
    # piece of land appears once per unit owner. Keep one row per identical geometry.
    gkey = par.geometry.normalize().to_wkb(hex=True)
    df["unit_count"] = gkey.map(gkey.value_counts()).values
    first = ~gkey.duplicated().values
    shared = df["unit_count"].values > 1
    df.loc[shared, "owner"] = df.loc[shared, "unit_count"].map(lambda n: f"{n} unit owners")
    df.loc[shared, "owner_type"] = None
    df.loc[shared, "assessor_acres"] = None
    df.loc[shared, "print_key"] = df.loc[shared, "print_key"].astype("string").str.replace(
        r"\.[-.]\d+$", "", regex=True)

    # Don't publish the names of private individuals who own residential (2xx) parcels.
    # Owners named as an LLC are companies, so they stay.
    resid = code.fillna("").str.startswith("2").values & ~shared
    is_llc = df["owner"].fillna("").str.contains(r"\bL\.?L\.?C\.?\s*$", case=False, regex=True).values
    df.loc[resid & ~is_llc, "owner"] = "Private owner"

    # 5. selection
    sel_class = code.map(is_os_class).fillna(False).values
    sel_county = df["county_os_share"].values >= args.include_overlap
    sel_nypad = df["nypad_share"].values >= args.include_overlap
    sel_ease = ((df["nypad_easement_acres"].values >= EASEMENT_MIN_ACRES)
                | (ease_share >= EASEMENT_MIN_SHARE))
    large = getattr(args, "large_acres", 0) or 0
    sel_large = (df["parcel_acres"].values >= large) if large else [False] * len(df)
    df["selected_by"] = [
        "; ".join(n for n, f in [("property class", a), ("county open space", b),
                                 ("NYPAD", c), ("NYPAD easement", d and not c),
                                 ("large parcel", e)] if f)
        for a, b, c, d, e in zip(sel_class, sel_county, sel_nypad, sel_ease, sel_large)]
    keep = ((sel_class | sel_county | sel_nypad | sel_ease | sel_large)
            & (df["parcel_acres"] >= args.min_acres) & first)

    # 6. review notes
    def notes(r, cls_ok, big):
        n = []
        if (big and not cls_ok and r.county_os_share < args.include_overlap
                and r.nypad_status == "Not in NYPAD"):
            n.append("Large parcel, not open space class, not in NYPAD")
        if cls_ok and r.nypad_status == "Not in NYPAD":
            n.append("Open space class but not in NYPAD")
        if r.county_os_share >= args.include_overlap and r.nypad_status == "Not in NYPAD":
            n.append("In county open space layer but not in NYPAD")
        if (r.nypad_status != "Not in NYPAD" and r.county_os_share < 0.10):
            n.append("In NYPAD, not in county")
        if (not cls_ok and isinstance(r.nypad_category, str) and "Fee" in r.nypad_category
                and str(r.roll_section or "").startswith("1")):
            n.append("NYPAD fee land on taxable roll with non-open-space class")
        if r.unit_count > 1:
            n.append(f"Shared land: {r.unit_count} unit parcels map to this same lot")
        return "; ".join(n) or None
    df["review_notes"] = [notes(r, c, b) for r, c, b in zip(df.itertuples(), sel_class, sel_large)]

    order = ["Not in NYPAD", "Partly in NYPAD", "In NYPAD"]
    df["nypad_status"] = pd.Categorical(df["nypad_status"], order, ordered=True)
    df = df[keep].sort_values(["nypad_status", "parcel_acres"],
                              ascending=[True, False])
    gdf = gpd.GeoDataFrame(df, geometry=par.geometry[keep].loc[df.index], crs=WORK_CRS)
    return gdf


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--nypad", required=True, help="NYPAD file geodatabase (.gdb)")
    ap.add_argument("--nypad-layer", default=None)
    ap.add_argument("--municipality", default=None,
                    help="Town or city name as Census spells it, e.g. 'New Castle'. "
                         "Omit for the whole county.")
    ap.add_argument("--aoi", default=None, help="Boundary file to use instead of Census")
    ap.add_argument("--state-fips", default="36")
    ap.add_argument("--county-fips", default="119", help="119 = Westchester")
    ap.add_argument("--parcel-url", default=PARCEL_URL)
    ap.add_argument("--county-os-url", default=COUNTY_OS_URL)
    ap.add_argument("--min-acres", type=float, default=0.0,
                    help="Leave out parcels smaller than this (computed acres)")
    ap.add_argument("--large-acres", type=float, default=0.0,
                    help="Also list every parcel at least this large, whatever its class "
                         "(0 = off)")
    ap.add_argument("--classes", default=DEFAULT_CLASSES,
                    help=f"Open space property classes; x is a wildcard digit. "
                         f"Default: {DEFAULT_CLASSES}")
    ap.add_argument("--include-overlap", type=float, default=0.25,
                    help="Share of a parcel that must be in NYPAD or the county open "
                         "space layer for that alone to select it (default 0.25)")
    ap.add_argument("--in-nypad", type=float, default=0.75,
                    help="NYPAD share at or above which a parcel is 'In NYPAD' "
                         "(default 0.75). Between 0.10 and this it is 'Partly in NYPAD'.")
    ap.add_argument("--include-proclamation", action="store_true",
                    help="Count NYPAD proclamation boundaries as coverage")
    ap.add_argument("--out", default="openspace_parcels_out")
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    s = requests.Session()

    # 1. boundary
    print("Study area", file=sys.stderr)
    if args.aoi:
        aoi = gpd.read_file(args.aoi).to_crs(WORK_CRS).geometry.make_valid().union_all()
        aoi_name = Path(args.aoi).stem
    else:
        b = census_boundary(args.state_fips, args.county_fips, args.municipality, s)
        aoi = clean(b).geometry.union_all()
        aoi_name = args.municipality or "County"
    print(f"  {aoi_name}: {aoi.area / SQM_PER_ACRE:,.0f} acres", file=sys.stderr)
    bbox = gpd.GeoSeries([aoi], crs=WORK_CRS).to_crs(4326).total_bounds

    # 2. parcels inside the boundary (by interior point, so edge parcels count once)
    print("Tax parcels", file=sys.stderr)
    try:
        par = fetch_arcgis(args.parcel_url, bbox_4326=bbox, session=s, label="Parcels")
    except RuntimeError as e:
        if args.parcel_url != PARCEL_URL:
            raise
        print(f"  {e}\n  trying the NYS ITS copy of the same data", file=sys.stderr)
        par = fetch_arcgis(PARCEL_URL_ALT, bbox_4326=bbox, session=s, label="Parcels")
    par = clean(par)
    par = par[par.geometry.representative_point().within(aoi)].copy()
    par = par.reset_index(drop=True)
    par["pid"] = par.index
    par["parcel_acres"] = (par.geometry.area / SQM_PER_ACRE).round(2)
    print(f"  {len(par)} parcels inside the boundary", file=sys.stderr)

    # 3. county open space and NYPAD
    print("County open space layer", file=sys.stderr)
    cos = clean(fetch_arcgis(args.county_os_url, bbox_4326=bbox, session=s,
                             label="County OS"))
    print("NYPAD", file=sys.stderr)
    nyp, nyp_layer = read_nypad(args.nypad, args.nypad_layer, aoi,
                                args.include_proclamation)
    nyp = clean(nyp)
    print(f"  {len(nyp)} NYPAD features near the study area", file=sys.stderr)

    gdf = analyze(par, cos, nyp, args)
    df = gdf.drop(columns="geometry")
    print(f"  {len(df)} open space parcels selected"
          + (f" ({args.min_acres} acres or larger)" if args.min_acres else ""),
          file=sys.stderr)

    # 7. summaries
    tot = lambda d: pd.Series({"parcels": len(d), "acres": round(d["parcel_acres"].sum(), 1)},
                              dtype=object)
    by_status = df.groupby("nypad_status", observed=False).apply(tot, include_groups=False)
    by_class = (df.assign(cls=df["prop_class"].map(class_code).fillna("?") + " "
                          + df["prop_class_desc"].fillna(""))
                .pivot_table(index="cls", columns="nypad_status", values="parcel_acres",
                             aggfunc="sum", fill_value=0, observed=False).round(1))
    by_class["Total acres"] = by_class.sum(axis=1)
    by_class = by_class.sort_values("Total acres", ascending=False)
    by_rule = df.groupby("selected_by").apply(tot, include_groups=False)
    by_note = (df.assign(n=df["review_notes"].fillna("").str.split("; "))
               .explode("n").query("n != ''").groupby("n").apply(tot, include_groups=False))
    meta = pd.DataFrame({"item": [
        "Study area", "Study area acres", "Parcels in study area",
        "Open space parcels listed", "Minimum acres", "Open space classes",
        "Selection overlap threshold", "'In NYPAD' threshold", "NYPAD file", "NYPAD layer",
        "Parcel source", "County open space source"],
        "value": [aoi_name, round(aoi.area / SQM_PER_ACRE), len(par), len(df),
                  args.min_acres, args.classes, args.include_overlap, args.in_nypad,
                  Path(args.nypad).name, nyp_layer, args.parcel_url, args.county_os_url]})

    # 8. write
    flat = df.copy()
    flat.to_csv(out / "openspace_parcels.csv", index=False)
    xlsx = out / "openspace_parcels.xlsx"
    with pd.ExcelWriter(xlsx, engine="openpyxl") as xw:
        flat.to_excel(xw, sheet_name="Parcels", index=False)
        meta.to_excel(xw, sheet_name="Summary", index=False, startrow=0)
        r = len(meta) + 2
        for title, t in [("Parcels and acres by NYPAD status", by_status),
                         ("Acres by property class and NYPAD status", by_class),
                         ("Parcels by selection rule", by_rule),
                         ("Review notes", by_note)]:
            pd.DataFrame({title: []}).to_excel(xw, sheet_name="Summary", startrow=r,
                                               index=False)
            t.to_excel(xw, sheet_name="Summary", startrow=r + 1)
            r += len(t) + 4
        codes = pd.concat([
            pd.DataFrame({"field": "prop_class", "code": list(PROP_CLASS),
                          "descriptor": list(PROP_CLASS.values())}),
            pd.DataFrame({"field": "roll_section", "code": list(ROLL_SECTION),
                          "descriptor": list(ROLL_SECTION.values())}),
            pd.DataFrame({"field": "owner_type", "code": list(OWNER_TYPE),
                          "descriptor": list(OWNER_TYPE.values())}),
        ])
        codes.to_excel(xw, sheet_name="Codes", index=False)
        ws = xw.sheets["Parcels"]
        ws.freeze_panes = "B2"
        ws.auto_filter.ref = ws.dimensions
        for col in ws.columns:
            width = max(len(str(c.value or "")) for c in list(col)[:200])
            ws.column_dimensions[col[0].column_letter].width = min(max(10, width + 2), 50)

    gpkg = out / "openspace_parcels.gpkg"
    if gpkg.exists():
        gpkg.unlink()
    gdf.to_file(gpkg, layer="openspace_parcels")
    if not nyp.empty:
        nyp[[c for c, _ in NYPAD_COLS if c in nyp.columns] + ["geometry"]] \
            .to_file(gpkg, layer="nypad")
    if not cos.empty:
        cos[[c for c, _ in COUNTY_OS_COLS if c in cos.columns] + ["geometry"]] \
            .to_file(gpkg, layer="county_open_space")
    gpd.GeoDataFrame({"name": [aoi_name]}, geometry=[aoi], crs=WORK_CRS) \
        .to_file(gpkg, layer="boundary")

    print(f"\nDone. Results in {out.resolve()}", file=sys.stderr)
    print(by_status.to_string())


if __name__ == "__main__":
    main()
