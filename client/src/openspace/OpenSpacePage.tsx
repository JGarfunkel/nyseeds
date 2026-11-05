import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ParcelMap from "./ParcelMap";
import {
  afterCode,
  gapNumbers,
  fetchCsv,
  fetchJson,
  joinUrl,
  num,
  STATUS_STYLE,
  STATUSES,
  type OpenSpaceIndex,
  type Parcel,
} from "./data";

const PAGE_SIZE = 100;
const NONE = "__none__"; // county OS filter value for parcels not in the county layer

// A parcel listed only because of its size (e.g. a private residential lot) is not open
// space, so its NYPAD status doesn't apply.
const isOpenSpace = (p: Parcel) => p.selected_by !== "large parcel";

// NYS property class hundreds groups.
const CLASS_GROUPS: Record<string, string> = {
  "1": "Agricultural",
  "2": "Residential",
  "3": "Vacant Land",
  "4": "Commercial",
  "5": "Recreation & Entertainment",
  "6": "Community Services",
  "7": "Industrial",
  "8": "Public Services",
  "9": "Conservation Lands & Public Parks",
};

// Property class filter text: "6xx" or "6" matches the whole group, "612" (or a picked
// "612 School") that class, and anything else is a substring of "code description".
function makeClassMatcher(text: string): (p: Parcel) => boolean {
  const t = text.trim().toLowerCase();
  if (!t) return () => true;
  const group = t.match(/^(\d)(?:xx)?(?:\s+all\b.*)?$/);
  if (group) return (p) => p.prop_class.startsWith(group[1]);
  const code = t.match(/^(\d{3})(?:\s|$)/);
  if (code) return (p) => p.prop_class === code[1];
  const partial = t.match(/^(\d{1,2})x*$/);
  if (partial) return (p) => p.prop_class.startsWith(partial[1]);
  return (p) => `${p.prop_class} ${p.prop_class_desc}`.toLowerCase().includes(t);
}

type SortKey = "address" | "municipality" | "owner" | "parcel_acres" | "prop_class" | "nypad_status";
const STATUS_RANK: Record<string, number> = { "Not in NYPAD": 0, "Partly in NYPAD": 1, "In NYPAD": 2 };

function readUrlState() {
  const q = new URLSearchParams(window.location.search);
  return {
    county: q.get("county") ?? "",
    muni: q.get("muni") ?? "",
    parcel: q.get("parcel") ?? "",
    status: q.get("status")?.split(",").filter(Boolean) ?? [],
    minAcres: q.get("min") ?? "",
    search: q.get("q") ?? "",
    notes: q.get("notes") === "1",
    easement: q.get("easement") === "1",
    os: q.get("os") ? q.get("os") === "1" : !q.get("src") || q.get("src") === "os",
    large: q.get("large") === "1" || q.get("src") === "large",
    propClass: q.get("class") ?? "",
    countyOs: q.get("cos") ?? "",
  };
}

export default function OpenSpacePage() {
  const init = useMemo(readUrlState, []);
  const [countyKey, setCountyKey] = useState(init.county);
  const [muni, setMuni] = useState(init.muni);
  const [statuses, setStatuses] = useState<string[]>(init.status);
  const [minAcres, setMinAcres] = useState(init.minAcres);
  const [search, setSearch] = useState(init.search);
  const [notesOnly, setNotesOnly] = useState(init.notes);
  const [easementOnly, setEasementOnly] = useState(init.easement);
  const [osChecked, setOsChecked] = useState(init.os);
  const [largeChecked, setLargeChecked] = useState(init.large);
  const [selectedId, setSelectedId] = useState(init.parcel);
  const [propClass, setPropClass] = useState(init.propClass);
  const [countyOs, setCountyOs] = useState(init.countyOs);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "nypad_status", dir: 1 });
  const [page, setPage] = useState(0);

  useEffect(() => {
    document.title = "NYSeeds: Open Space Explorer";
  }, []);

  const config = useQuery({
    queryKey: ["openspace-config"],
    queryFn: () => fetchJson<{ dataUrl: string }>("/api/openspace/config"),
  });
  const dataUrl = config.data?.dataUrl;
  const index = useQuery({
    queryKey: ["openspace-index", dataUrl],
    queryFn: () => fetchJson<OpenSpaceIndex>(joinUrl(dataUrl!, "index.json")),
    enabled: !!dataUrl,
  });
  const county = index.data?.counties.find((c) => c.key === countyKey);
  const parcelsQ = useQuery({
    queryKey: ["openspace-csv", dataUrl, county?.csv, county?.built],
    queryFn: () => fetchCsv(joinUrl(dataUrl!, county!.csv)),
    enabled: !!dataUrl && !!county,
  });

  // Pick the only county automatically when there is just one.
  useEffect(() => {
    if (!countyKey && index.data?.counties.length === 1) setCountyKey(index.data.counties[0].key);
  }, [index.data, countyKey]);

  // Keep the URL in step so a filtered view or a selected parcel can be shared.
  useEffect(() => {
    const q = new URLSearchParams();
    if (countyKey) q.set("county", countyKey);
    if (muni) q.set("muni", muni);
    if (statuses.length) q.set("status", statuses.join(","));
    if (minAcres) q.set("min", minAcres);
    if (search) q.set("q", search);
    if (notesOnly) q.set("notes", "1");
    if (easementOnly) q.set("easement", "1");
    q.set("os", osChecked ? "1" : "0");
    if (largeChecked) q.set("large", "1");
    if (propClass) q.set("class", propClass);
    if (countyOs) q.set("cos", countyOs);
    if (selectedId) q.set("parcel", selectedId);
    const s = q.toString();
    window.history.replaceState(null, "", s ? `?${s}` : window.location.pathname);
  }, [countyKey, muni, statuses, minAcres, search, notesOnly, easementOnly, osChecked, largeChecked, propClass, countyOs, selectedId]);

  useEffect(() => setPage(0), [countyKey, muni, statuses, minAcres, search, notesOnly, easementOnly, osChecked, largeChecked, propClass, countyOs, sort]);

  const muniEntry = county?.municipalities.find((m) => m.slug === muni);
  const all = parcelsQ.data ?? [];

  // Choices for the two column filters, taken from the loaded county.
  // Suggestions are the broad hundreds groups present (6xx All Community Services) followed
  // by each specific class ("612 School").
  const classOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of all) {
      if (!p.prop_class) continue;
      m.set(p.prop_class, `${p.prop_class} ${p.prop_class_desc}`);
      const d = p.prop_class[0];
      if (CLASS_GROUPS[d]) m.set(`${d}xx`, `${d}xx All ${CLASS_GROUPS[d]}`);
    }
    return [...m].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [v, k]);
  }, [all]);
  const classMatch = useMemo(() => makeClassMatcher(propClass), [propClass]);
  const countyOsOptions = useMemo(
    () => [...new Set(all.map((p) => p.county_os_classification).filter(Boolean))].sort(),
    [all],
  );

  const filtered = useMemo(() => {
    const min = parseFloat(minAcres) || 0;
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = all.filter((p) => {
      if (muniEntry && p.municipality !== muniEntry.name) return false;
      if (statuses.length && (!isOpenSpace(p) || !statuses.includes(p.nypad_status))) return false;
      if (min && num(p.parcel_acres) < min) return false;
      if (notesOnly && !p.review_notes) return false;
      if (easementOnly && !(num(p.nypad_easement_acres) > 0)) return false;
      if (!classMatch(p)) return false;
      if (countyOs && (countyOs === NONE ? !!p.county_os_classification : p.county_os_classification !== countyOs)) return false;
      // Parcels listed only because of their size have "large parcel" as the sole rule.
      // With neither or both boxes ticked, nothing is excluded.
      if (osChecked !== largeChecked && osChecked !== isOpenSpace(p)) return false;
      if (words.length) {
        const hay = [p.address, p.owner, p.parcel_id, p.nypad_unit_name, p.county_os_name, p.prop_class_desc]
          .join(" ")
          .toLowerCase();
        if (!words.every((w) => hay.includes(w))) return false;
      }
      return true;
    });
    const val = (p: Parcel): string | number => {
      switch (sort.key) {
        case "parcel_acres":
          return num(p.parcel_acres);
        case "nypad_status":
          return isOpenSpace(p) ? STATUS_RANK[p.nypad_status] ?? 9 : 10;
        default:
          return (p[sort.key] ?? "").toLowerCase();
      }
    };
    return rows.sort((a, b) => {
      const x = val(a), y = val(b);
      if (x < y) return -sort.dir;
      if (x > y) return sort.dir;
      return num(b.parcel_acres) - num(a.parcel_acres);
    });
  }, [all, muniEntry, statuses, minAcres, search, notesOnly, easementOnly, osChecked, largeChecked, classMatch, countyOs, sort]);

  const selected = all.find((p) => p.parcel_id === selectedId);
  const selectedMuni = selected
    ? county?.municipalities.find((m) => m.name === selected.municipality)
    : undefined;
  const mapMuni = selectedMuni ?? muniEntry;
  const statusById = useMemo(() => new Map(all.map((p) => [p.parcel_id, p.nypad_status])), [all]);
  const totals = useMemo(() => {
    const t: Record<string, { n: number; acres: number }> = {};
    for (const p of filtered) {
      if (!isOpenSpace(p)) continue;
      t[p.nypad_status] ??= { n: 0, acres: 0 };
      t[p.nypad_status].n++;
      t[p.nypad_status].acres += num(p.parcel_acres);
    }
    return t;
  }, [filtered]);
  const totalAcres = filtered.reduce((s, p) => s + num(p.parcel_acres), 0);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const shown = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // When a parcel is picked (on the map, or from a shared link), page the table to its
  // row and scroll it into view. Runs once per selection, so manual paging is left alone.
  const revealed = useRef("");
  useEffect(() => {
    if (!selectedId) {
      revealed.current = "";
      return;
    }
    if (revealed.current === selectedId) return;
    const i = filtered.findIndex((p) => p.parcel_id === selectedId);
    if (i < 0) return;
    revealed.current = selectedId;
    setPage(Math.floor(i / PAGE_SIZE));
    requestAnimationFrame(() =>
      document.getElementById(`parcel-row-${CSS.escape(selectedId)}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );
  }, [selectedId, filtered]);

  const toggleStatus = (s: string) =>
    setStatuses((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  const sortBy = (key: SortKey) =>
    setSort((cur) => (cur.key === key ? { key, dir: cur.dir === 1 ? -1 : 1 } : { key, dir: key === "parcel_acres" ? -1 : 1 }));

  const loadError = config.error || index.error || parcelsQ.error;

  return (
    <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <h1 className="text-2xl font-bold text-gray-900">NYSeeds: Open Space Explorer</h1>
      <p className="mt-1 max-w-3xl text-sm text-gray-600">
        Tax parcels classed as open space by the assessor, mapped in the county open space layer, or
        covered by the <a target="_blank" rel="noopener" href="https://www.nypad.org/InteractiveMap">New York Protected Areas Database (NYPAD)</a>, 
        plus larger parcels of any class (5 acres, default). Each row shows the parcel's local assessment status and the
        NYPAD record that covers it, if any.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-xs font-medium text-gray-600">
          County
          <select
            className="mt-1 rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900"
            value={countyKey}
            onChange={(e) => {
              setCountyKey(e.target.value);
              setMuni("");
              setPropClass("");
              setCountyOs("");
              setSelectedId("");
            }}
          >
            <option value="">Select a county</option>
            {index.data?.counties.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs font-medium text-gray-600">
          Municipality
          <select
            className="mt-1 rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 disabled:bg-gray-100"
            value={muni}
            disabled={!county}
            onChange={(e) => setMuni(e.target.value)}
          >
            <option value="">All municipalities</option>
            {county?.municipalities.map((m) => (
              <option key={m.slug} value={m.slug}>
                {m.name} ({m.parcels})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs font-medium text-gray-600">
          Minimum acres
          <input
            type="number"
            min="0"
            step="0.5"
            className="mt-1 w-28 rounded border border-gray-300 px-2 py-1.5 text-sm"
            value={minAcres}
            onChange={(e) => setMinAcres(e.target.value)}
            placeholder="Any"
          />
        </label>
        <label className="flex items-center gap-1.5 pb-1.5 text-sm text-gray-700">
          <input type="checkbox" checked={osChecked} onChange={(e) => setOsChecked(e.target.checked)} />
          Open space
        </label>
        <label className="flex items-center gap-1.5 pb-1.5 text-sm text-gray-700">
          <input type="checkbox" checked={largeChecked} onChange={(e) => setLargeChecked(e.target.checked)} />
          Large parcels
        </label>
        <label className="flex flex-col text-xs font-medium text-gray-600">
          Search
          <input
            type="search"
            className="mt-1 w-56 rounded border border-gray-300 px-2 py-1.5 text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Address, owner, name, ID"
          />
        </label>
        <label className="flex flex-col text-xs font-medium text-gray-600">
          Property class
          <input
            type="text"
            list="prop-class-options"
            className="mt-1 w-56 rounded border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-100"
            value={propClass}
            disabled={!county}
            onChange={(e) => setPropClass(e.target.value)}
            placeholder="All (e.g. 6xx, 612, school)"
          />
          <datalist id="prop-class-options">
            {classOptions.map(([value]) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        </label>
        <label className="flex flex-col text-xs font-medium text-gray-600">
          County OS
          <select
            className="mt-1 max-w-[14rem] rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 disabled:bg-gray-100"
            value={countyOs}
            disabled={!county}
            onChange={(e) => setCountyOs(e.target.value)}
          >
            <option value="">All</option>
            <option value={NONE}>Not in county layer</option>
            {countyOsOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-col text-xs font-medium text-gray-600">
          NYPAD status
          <div className="mt-1 flex gap-1">
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => toggleStatus(s)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
                  statuses.includes(s) ? `${STATUS_STYLE[s].badge} ring-current` : "bg-white text-gray-600 ring-gray-300"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-1.5 pb-1.5 text-sm text-gray-700">
          <input type="checkbox" checked={notesOnly} onChange={(e) => setNotesOnly(e.target.checked)} />
          Has review notes
        </label>
        <label className="flex items-center gap-1.5 pb-1.5 text-sm text-gray-700">
          <input type="checkbox" checked={easementOnly} onChange={(e) => setEasementOnly(e.target.checked)} />
          Has NYPAD easement
        </label>
      </div>

      {loadError && (
        <p className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-red-800">
          Could not load the data: {(loadError as Error).message}
        </p>
      )}
      {index.data && index.data.counties.length === 0 && (
        <p className="mt-4 text-sm text-gray-600">No counties have been built yet.</p>
      )}
      {!county && index.data && index.data.counties.length > 0 && (
        <p className="mt-6 text-sm text-gray-600">Choose a county to list its open space parcels.</p>
      )}
      {county && parcelsQ.isLoading && <p className="mt-6 text-sm text-gray-600">Loading {county.name} County parcels…</p>}

      {county && parcelsQ.data && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-700">
            <span>
              <strong>{filtered.length.toLocaleString()}</strong> parcels,{" "}
              <strong>{Math.round(totalAcres).toLocaleString()}</strong> acres
            </span>
            {STATUSES.map((s) =>
              totals[s] ? (
                <span key={s} className={`rounded px-1.5 py-0.5 text-xs ${STATUS_STYLE[s].badge}`}>
                  {s}: {totals[s].n.toLocaleString()} ({Math.round(totals[s].acres).toLocaleString()} ac)
                </span>
              ) : null,
            )}
            <span className="text-xs text-gray-500">
              {county.roll_year ? `${county.roll_year} assessment roll · ` : ""}
              {county.nypad ? `${county.nypad} · ` : ""}built {county.built} ·{" "}
              <a className="text-green-700 underline hover:text-green-800" href={joinUrl(dataUrl!, county.csv)} download>
                Download CSV
              </a>
            </span>
          </div>

          <div className="mt-3 flex flex-col gap-4 lg:flex-row">
            <div className="min-w-0 lg:w-[65%]">
              <div className="overflow-x-auto rounded-md border border-gray-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                    <tr>
                      <Th label="Parcel" k="address" sort={sort} onSort={sortBy} />
                      {!muniEntry && <Th label="Municipality" k="municipality" sort={sort} onSort={sortBy} />}
                      <Th label="Owner" k="owner" sort={sort} onSort={sortBy} />
                      <Th label="Acres" k="parcel_acres" sort={sort} onSort={sortBy} right />
                      <Th label="Property class" k="prop_class" sort={sort} onSort={sortBy} />
                      <th className="px-2 py-2">County OS</th>
                      <Th label="NYPAD" k="nypad_status" sort={sort} onSort={sortBy} />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((p) => (
                      <tr
                        key={p.parcel_id}
                        id={`parcel-row-${p.parcel_id}`}
                        onClick={() => setSelectedId(p.parcel_id === selectedId ? "" : p.parcel_id)}
                        className={`cursor-pointer border-t border-gray-100 align-top ${
                          p.parcel_id === selectedId ? "bg-blue-50" : "hover:bg-gray-50"
                        }`}
                      >
                        <td className="px-2 py-1.5">
                          <div className="text-gray-900">{p.address || "No address"}</div>
                        </td>
                        {!muniEntry && <td className="px-2 py-1.5 text-gray-700">{p.municipality}</td>}
                        <td className="px-2 py-1.5 text-gray-700">
                          <div>{p.owner}</div>
                          <div className="text-xs text-gray-500">{afterCode(p.owner_type)}</div>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{num(p.parcel_acres).toFixed(1)}</td>
                        <td className="px-2 py-1.5 text-gray-700">
                          <div>
                            {p.prop_class} {p.prop_class_desc}
                          </div>
                          <div className="text-xs text-gray-500">{afterCode(p.roll_section)}</div>
                        </td>
                        <td className="px-2 py-1.5 text-gray-700">{p.county_os_classification || "—"}</td>
                        <td className="px-2 py-1.5">
                          {isOpenSpace(p) ? (
                            <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs ${STATUS_STYLE[p.nypad_status]?.badge ?? ""}`}>
                              {p.nypad_status}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">N/A</span>
                          )}
                          {p.nypad_designation && <div className="mt-0.5 text-xs text-gray-600">{afterCode(p.nypad_designation)}</div>}
                          {gapNumbers(p.nypad_gap_status) && (
                            <div className="mt-0.5 text-xs text-gray-600" title={p.nypad_gap_status}>
                              GAP {gapNumbers(p.nypad_gap_status)}
                            </div>
                          )}
                          {num(p.nypad_easement_acres) > 0 && (
                            <div className="mt-0.5 text-xs text-gray-600">
                              Easement: {num(p.nypad_easement_acres).toFixed(1)} of {num(p.parcel_acres).toFixed(1)} ac
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                    {shown.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-2 py-6 text-center text-gray-500">
                          No parcels match these filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {pages > 1 && (
                <div className="mt-2 flex items-center justify-between text-sm text-gray-600">
                  <button className="rounded border px-2 py-1 disabled:opacity-40" disabled={page === 0} onClick={() => setPage(page - 1)}>
                    Previous
                  </button>
                  <span>
                    Page {page + 1} of {pages}
                  </span>
                  <button className="rounded border px-2 py-1 disabled:opacity-40" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
                    Next
                  </button>
                </div>
              )}
            </div>

            <div className="lg:sticky lg:top-4 lg:w-[35%] lg:self-start">
              {mapMuni ? (
                <div className="space-y-3">
                  <div className="h-[420px] rounded-md border border-gray-200">
                    <ParcelMap
                      geoUrl={joinUrl(dataUrl!, mapMuni.geo)}
                      selectedId={selected?.parcel_id ?? ""}
                      statusById={statusById}
                      fallbackCenter={selected?.lat ? [num(selected.lat), num(selected.lon)] : null}
                      onSelect={setSelectedId}
                    />
                  </div>
                  {selected ? (
                    <ParcelDetails p={selected} onClose={() => setSelectedId("")} />
                  ) : (
                    <p className="text-xs text-gray-500">Click a parcel on the map to see its record.</p>
                  )}
                </div>
              ) : (
                <div className="flex h-[420px] items-center justify-center rounded-md border border-dashed border-gray-300 px-4 text-center text-sm text-gray-500">
                  Select a parcel, or choose a municipality, to see the map.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Th({
  label,
  k,
  sort,
  onSort,
  right,
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: 1 | -1 };
  onSort: (k: SortKey) => void;
  right?: boolean;
}) {
  const active = sort.key === k;
  return (
    <th className={`px-2 py-2 ${right ? "text-right" : ""}`}>
      <button type="button" onClick={() => onSort(k)} className="uppercase hover:text-gray-900">
        {label}
        {active ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
      </button>
    </th>
  );
}

const DETAIL_GROUPS: { title: string; fields: [string, string][] }[] = [
  {
    title: "Parcel",
    fields: [
      ["parcel_id", "SWIS-SBL"],
      ["print_key", "Print key"],
      ["address", "Address"],
      ["municipality", "Municipality"],
      ["town", "Town or city"],
      ["owner", "Owner"],
      ["owner_type", "Owner type"],
      ["parcel_acres", "Acres (mapped)"],
      ["unit_count", "Unit parcels on this lot"],
      ["assessor_acres", "Acres (assessor)"],
    ],
  },
  {
    title: "Local assessment",
    fields: [
      ["prop_class", "Property class"],
      ["prop_class_desc", "Class description"],
      ["roll_section", "Roll section"],
      ["used_as", "Used as"],
      ["ag_district", "Agricultural district"],
      ["roll_year", "Roll year"],
    ],
  },
  {
    title: "County open space layer",
    fields: [
      ["county_os_share", "Share of parcel"],
      ["county_os_classification", "Classification"],
      ["county_os_type", "Type"],
      ["county_os_name", "Name"],
      ["county_os_manager", "Managing organization"],
    ],
  },
  {
    title: "NYPAD",
    fields: [
      ["nypad_status", "Status"],
      ["nypad_share", "Share of parcel"],
      ["nypad_easement_acres", "Easement acres"],
      ["nypad_category", "Category"],
      ["nypad_unit_name", "Unit name"],
      ["nypad_owner_type", "Owner type"],
      ["nypad_owner_name", "Owner"],
      ["nypad_local_owner", "Local owner"],
      ["nypad_manager_type", "Manager type"],
      ["nypad_local_manager", "Local manager"],
      ["nypad_designation", "Designation"],
      ["nypad_local_designation", "Local designation"],
      ["nypad_gap_status", "GAP status"],
      ["nypad_public_access", "Public access"],
      ["nypad_source", "Source"],
      ["nypad_source_date", "Source date"],
      ["nypad_id", "NYPAD ID"],
    ],
  },
  {
    title: "Review",
    fields: [
      ["selected_by", "Listed because"],
    ],
  },
];

function ParcelDetails({ p, onClose }: { p: Parcel; onClose: () => void }) {
  const fmt = (k: string, v: string) => {
    if (k.endsWith("_share") && v) return `${Math.round(num(v) * 100)}%`;
    if (k === "nypad_easement_acres") return `${num(v).toFixed(2)} of ${num(p.parcel_acres).toFixed(2)} acres`;
    return v;
  };
  return (
    <div className="rounded-md border border-gray-200 bg-white p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-gray-900">{p.address || p.parcel_id}</div>
          <div className="text-xs text-gray-500">
            {p.municipality} · {num(p.parcel_acres).toFixed(2)} acres
          </div>
        </div>
        <button type="button" onClick={onClose} className="text-xs text-gray-500 hover:text-gray-900">
          Close
        </button>
      </div>
      {p.review_notes && (
        <p className="mt-3 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
          <span className="font-semibold">Notes:</span> {p.review_notes}
        </p>
      )}
      {DETAIL_GROUPS.map((g) => {
        const rows = g.fields.filter(([k]) => p[k] && !(k === "nypad_easement_acres" && !(num(p[k]) > 0)) && !(k === "unit_count" && num(p[k]) <= 1));
        if (!rows.length) return null;
        return (
          <div key={g.title} className="mt-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{g.title}</div>
            <dl className="mt-1 grid grid-cols-[10rem_1fr] gap-x-3 gap-y-0.5">
              {rows.map(([k, label]) => (
                <div key={k} className="contents">
                  <dt className="text-gray-500">{label}</dt>
                  <dd className="text-gray-900">{fmt(k, p[k])}</dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })}
      {p.nypad_status === "Not in NYPAD" && isOpenSpace(p) && (
        <p className="mt-3 rounded bg-red-50 px-2 py-1 text-xs text-red-800">This parcel is not in NYPAD.</p>
      )}
    </div>
  );
}
