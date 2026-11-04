# Open space parcels

Data build for the `/openspace` page. The build runs once per county. It lists every tax parcel that is open space by property class, the county open space layer, or NYPAD. It records each parcel's local assessment status and its NYPAD match.

## Files

| File | Purpose |
|---|---|
| `build_county.py` | Builds one or more counties and uploads the results to R2 |
| `openspace_parcels.py` | Analysis code; also runs alone for one town and writes an Excel workbook |
| `counties.json` | Per-county sources. Counties not listed use the NYS statewide parcel service and have no county open space layer |

## Build

```
pip install geopandas pyogrio requests boto3 openpyxl
python scripts/openspace/build_county.py --county Westchester --nypad ../openspace/NYPAD_202604.gdb
```

Output goes to `local/openspace` (ignored by git):

```
index.json                              counties, municipalities, build dates
westchester/parcels.csv                 one row per open space parcel
westchester/geo/<municipality>.geojson  parcel and NYPAD outlines for the map
cache/westchester_parcels.gpkg          downloaded parcels; --refresh to download again
```

Running `npm run dev` without `OPENSPACE_DATA_URL` serves this folder at `/openspace-data`, so the page works locally before anything is uploaded.

## Publish to R2

1. Create a bucket (for example `nyseeds-data`). Turn on public access, through a custom domain such as `data.nyseeds.org` or the r2.dev URL.
2. Create an R2 API token with read and write access to the bucket.
3. Add these lines to `.env`:

   ```
   R2_ACCOUNT_ID=...
   R2_ACCESS_KEY_ID=...
   R2_SECRET_ACCESS_KEY=...
   R2_BUCKET=nyseeds-data
   OPENSPACE_DATA_URL=https://data.nyseeds.org/openspace
   ```

4. Build, upload, and allow the site's origins to read the bucket (CORS only needs setting once):

   ```
   python scripts/openspace/build_county.py --county Westchester --nypad ../openspace/NYPAD_202604.gdb --upload --set-cors "https://nyseeds.org,http://localhost:5000"
   ```

Each upload replaces that county's files. It merges the county into the `index.json` already in the bucket, so other counties stay listed. Use `--all` to build every county the statewide service covers.

## Data notes

- Parcels: 2025 assessment roll, NYS statewide parcel schema. Westchester comes from the county's own GIS service. The parcel layer has no exemption codes, so tax status means property class plus roll section.
- NYPAD: the `NYPAD_Combined` layer. Codes are decoded with the geodatabase's own lookup tables. Proclamation boundaries are left out unless `--include-proclamation` is passed.
- A parcel is "In NYPAD" at 75% coverage or more, and "Partly in NYPAD" from 10% to 75%.
- Easements: an eased parcel keeps its main-use property class on the roll, and NYPAD may draw only the eased area. A parcel is listed when a NYPAD easement covers at least 0.25 acre or 10% of it, and `nypad_easement_acres` gives the covered acres.
