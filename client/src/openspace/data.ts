// Types and loaders for the open space parcel data built by
// scripts/openspace/build_county.py and served from R2 (or local/openspace in dev).

export interface MunicipalityEntry {
  name: string;
  slug: string;
  town?: string | null;
  parcels: number;
  acres: number;
  geo: string;
}

export interface CountyEntry {
  key: string;
  name: string;
  built: string;
  csv: string;
  parcels: number;
  acres: number;
  by_status?: Record<string, number>;
  roll_year?: number | null;
  municipalities: MunicipalityEntry[];
  nypad?: string;
  parcel_source?: string;
  county_os_source?: string | null;
}

export interface OpenSpaceIndex {
  updated: string;
  counties: CountyEntry[];
}

/** One CSV row. All values are strings as read from the file. */
export type Parcel = Record<string, string> & { parcel_id: string };

export const STATUSES = ["Not in NYPAD", "Partly in NYPAD", "In NYPAD"] as const;
export type NypadStatus = (typeof STATUSES)[number];

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} (${url})`);
  return res.json();
}

export async function fetchCsv(url: string): Promise<Parcel[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} (${url})`);
  return parseCsv(await res.text()) as Parcel[];
}

export function joinUrl(base: string, rel: string): string {
  return `${base.replace(/\/+$/, "")}/${rel.replace(/^\/+/, "")}`;
}

/** RFC 4180 CSV parser: quoted fields, doubled quotes, embedded commas and newlines. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...data] = rows;
  if (!header) return [];
  return data
    .filter((r) => r.length > 1 || r[0] !== "")
    .map((r) => Object.fromEntries(header.map((h, j) => [h, r[j] ?? ""])));
}

export const num = (v: string | undefined) => {
  const n = parseFloat(v ?? "");
  return Number.isFinite(n) ? n : 0;
};

/** "8: Wholly exempt" -> "Wholly exempt" */
export const afterCode = (v: string | undefined) => (v ?? "").replace(/^[^:]*:\s*/, "");

export const STATUS_STYLE: Record<string, { badge: string; fill: string }> = {
  "Not in NYPAD": { badge: "bg-red-100 text-red-800", fill: "#dc2626" },
  "Partly in NYPAD": { badge: "bg-amber-100 text-amber-800", fill: "#d97706" },
  "In NYPAD": { badge: "bg-green-100 text-green-800", fill: "#16a34a" },
};
