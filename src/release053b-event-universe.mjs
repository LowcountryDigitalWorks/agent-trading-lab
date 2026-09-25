import { canonicalSerialize, sha256Hex } from "./canonical.mjs";
import {
  createIndependentEventSpec,
  validateIndependentEventSpec,
} from "./cryptostruct-source.mjs";
import {
  createRelease053EventFirstQueryPlan,
  release053EventFirstQueryPlanHash,
  release053EventFirstSearchCalls,
  release053EventFirstSemanticBundleHash,
} from "./release053a-qualification-design.mjs";

export const RELEASE053B_EVENT_UNIVERSE_SCHEMA =
  "release053-independent-event-universe.v1";

const EVENT_DATES = Object.freeze([
  "2026-09-28",
  "2026-09-29",
  "2026-09-30",
  "2026-10-01",
  "2026-10-02",
]);

const STATIONS = Object.freeze([
  Object.freeze({
    slug: "atlanta",
    station_id: "USW00013874",
    station_name: "ATLANTA HARTSFIELD JACKSON INTERNATIONAL AIRPORT",
    city: "Atlanta",
    short_label: "Atlanta",
    threshold_f: 80,
    query_term: "Atlanta daily high temperature",
    station_reference:
      "https://www.ncei.noaa.gov/cdo-web/datasets/GHCND/stations/GHCND%3AUSW00013874/detail",
  }),
  Object.freeze({
    slug: "boston",
    station_id: "USW00014739",
    station_name: "BOSTON LOGAN INTERNATIONAL AIRPORT",
    city: "Boston",
    short_label: "Boston",
    threshold_f: 68,
    query_term: "Boston daily high temperature",
    station_reference:
      "https://www.ncei.noaa.gov/cdo-web/datasets/GHCND/stations/GHCND%3AUSW00014739/detail",
  }),
  Object.freeze({
    slug: "chicago",
    station_id: "USW00094846",
    station_name: "CHICAGO OHARE INTERNATIONAL AIRPORT",
    city: "Chicago",
    short_label: "Chicago",
    threshold_f: 70,
    query_term: "Chicago daily high temperature",
    station_reference:
      "https://www.ncei.noaa.gov/cdo-web/datasets/GHCND/stations/GHCND%3AUSW00094846/detail",
  }),
  Object.freeze({
    slug: "los-angeles",
    station_id: "USW00023174",
    station_name: "LOS ANGELES INTERNATIONAL AIRPORT",
    city: "Los Angeles",
    short_label: "Los Angeles",
    threshold_f: 75,
    query_term: "Los Angeles daily high temperature",
    station_reference:
      "https://www.ncei.noaa.gov/cdo-web/datasets/GHCND/stations/GHCND%3AUSW00023174/detail",
  }),
  Object.freeze({
    slug: "miami",
    station_id: "USW00012839",
    station_name: "MIAMI INTERNATIONAL AIRPORT",
    city: "Miami",
    short_label: "Miami",
    threshold_f: 88,
    query_term: "Miami daily high temperature",
    station_reference:
      "https://www.ncei.noaa.gov/cdo-web/datasets/GHCND/stations/GHCND%3AUSW00012839/detail",
  }),
  Object.freeze({
    slug: "new-york-city",
    station_id: "USW00094728",
    station_name: "NY CITY CENTRAL PARK",
    city: "New York City",
    short_label: "NYC",
    threshold_f: 70,
    query_term: "New York City daily high temperature",
    station_reference:
      "https://www.ncei.noaa.gov/cdo-web/datasets/GHCND/stations/GHCND%3AUSW00094728/detail",
  }),
  Object.freeze({
    slug: "phoenix",
    station_id: "USW00023183",
    station_name: "PHOENIX AIRPORT",
    city: "Phoenix",
    short_label: "Phoenix",
    threshold_f: 100,
    query_term: "Phoenix daily high temperature",
    station_reference:
      "https://www.ncei.noaa.gov/cdo-web/datasets/GHCND/stations/GHCND%3AUSW00023183/detail",
  }),
  Object.freeze({
    slug: "seattle",
    station_id: "USW00024233",
    station_name: "SEATTLE TACOMA AIRPORT",
    city: "Seattle",
    short_label: "Seattle",
    threshold_f: 65,
    query_term: "Seattle daily high temperature",
    station_reference:
      "https://www.ncei.noaa.gov/cdo-web/datasets/GHCND/stations/GHCND%3AUSW00024233/detail",
  }),
]);

const MONTHS = Object.freeze([
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]);

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function titleStation(value) {
  return value.toLowerCase().replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function dateParts(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date);
  if (!match) throw new Error(`invalid event date: ${date}`);
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function dateLabel(date, includeYear = true) {
  const parts = dateParts(date);
  return includeYear
    ? `${MONTHS[parts.month - 1]} ${parts.day}, ${parts.year}`
    : `${MONTHS[parts.month - 1]} ${parts.day}`;
}

function resolutionDeadline(date) {
  const epoch = Date.parse(`${date}T00:00:00.000Z`) + 86_400_000;
  return new Date(epoch + 12 * 3_600_000).toISOString();
}

function resolutionReference(stationId, date) {
  return [
    "https://www.ncei.noaa.gov/access/services/data/v1",
    "?dataset=daily-summaries",
    `&stations=${stationId}`,
    `&startDate=${date}`,
    `&endDate=${date}`,
    "&format=json",
    "&units=standard",
    "&includeAttributes=false",
  ].join("");
}

function criteriaHash(station, date) {
  const reference = resolutionReference(station.station_id, date);
  return sha256Hex(canonicalSerialize({
    authority: "NOAA/NCEI GHCN Daily Summaries",
    station_id: station.station_id,
    local_date: date,
    element: "TMAX",
    units: "degrees_Fahrenheit",
    comparison: "greater_than_or_equal",
    threshold_f: station.threshold_f,
    resolution_reference: reference,
  }));
}

function semanticAliases(station, date) {
  const withYear = dateLabel(date, true);
  const withoutYear = dateLabel(date, false);
  const threshold = station.threshold_f;
  return [
    `Will the highest temperature in ${station.city} be ${threshold} F or higher on ${withYear}`,
    `Will the highest temperature in ${station.city} be ${threshold} F or higher on ${withoutYear}`,
    `${station.city} highest temperature ${threshold} F or higher ${withYear}`,
    `${station.city} daily high temperature at least ${threshold} F ${withYear}`,
    `${station.short_label} high temperature ${withYear} ${threshold} F or above`,
    `${station.short_label} temperature ${withYear} ${threshold} or higher`,
  ];
}

function eventEntry(station, date) {
  const reference = resolutionReference(station.station_id, date);
  const spec = createIndependentEventSpec({
    event_id:
      `wx-${station.slug}-${date.replaceAll("-", "")}-tmax-gte-${station.threshold_f}f`,
    canonical_question:
      `Will the NOAA/NCEI daily maximum temperature at ${titleStation(station.station_name)} on ${date} be at least ${station.threshold_f}°F?`,
    yes_condition:
      `YES if NOAA/NCEI GHCN Daily Summaries reports a valid numeric TMAX for station ${station.station_id} on local date ${date} that is greater than or equal to ${station.threshold_f}°F.`,
    no_condition:
      `NO if NOAA/NCEI GHCN Daily Summaries reports a valid numeric TMAX for station ${station.station_id} on local date ${date} that is less than ${station.threshold_f}°F.`,
    category: "WEATHER_CLIMATE",
    deadline_utc: resolutionDeadline(date),
    resolution_authority: "NOAA/NCEI GHCN Daily Summaries",
    resolution_reference: reference,
    criteria_hash: criteriaHash(station, date),
  });
  validateIndependentEventSpec(spec);
  return {
    spec,
    query_terms: [station.query_term],
    semantic_aliases: semanticAliases(station, date),
  };
}

export function release053bStationSources() {
  return deepFreeze(structuredClone(STATIONS));
}

export function release053bIndependentEventEntries() {
  const entries = [];
  for (const station of STATIONS) {
    for (const date of EVENT_DATES) entries.push(eventEntry(station, date));
  }
  entries.sort((left, right) => left.spec.event_id.localeCompare(right.spec.event_id));
  return deepFreeze(entries);
}

export function release053bEventUniverse() {
  const events = release053bIndependentEventEntries()
    .map((entry) => structuredClone(entry.spec))
    .sort((left, right) => left.event_id.localeCompare(right.event_id));
  return deepFreeze({
    schema_version: RELEASE053B_EVENT_UNIVERSE_SCHEMA,
    derivation_contract:
      "independent-noaa-ncei-daily-tmax-before-provider-access",
    events,
  });
}

export function release053bEventUniverseHash() {
  return sha256Hex(canonicalSerialize(release053bEventUniverse()));
}

export function release053bEventFirstQueryPlan() {
  return createRelease053EventFirstQueryPlan(release053bIndependentEventEntries());
}

export function release053bQueryPlanHash() {
  return release053EventFirstQueryPlanHash(release053bEventFirstQueryPlan());
}

export function release053bSemanticBundleHash() {
  return release053EventFirstSemanticBundleHash(release053bEventFirstQueryPlan());
}

export function release053bSearchCalls() {
  return release053EventFirstSearchCalls(release053bEventFirstQueryPlan());
}

export function release053bCategoryCounts() {
  const counts = {
    WEATHER_CLIMATE: 0,
    MACROECONOMICS: 0,
    SCIENCE_TECHNOLOGY: 0,
    ENTERTAINMENT_CULTURE: 0,
  };
  for (const event of release053bEventUniverse().events) counts[event.category] += 1;
  return deepFreeze(counts);
}

export function validateRelease053bEventUniverse() {
  const entries = release053bIndependentEventEntries();
  if (entries.length !== 40) throw new Error("Release 0.5.3B event universe must contain 40 events");
  const ids = entries.map((entry) => entry.spec.event_id);
  if (new Set(ids).size !== ids.length) throw new Error("Release 0.5.3B event IDs must be unique");
  const queries = release053bSearchCalls();
  if (queries.length !== 8) throw new Error("Release 0.5.3B query plan must contain exactly 8 unique searches");
  if (!queries.every((query) =>
    query.class === "prediction"
    && query.venue === "polymarket"
    && query.limit === 10
  )) {
    throw new Error("Release 0.5.3B search defaults changed");
  }
  return deepFreeze({
    event_count: entries.length,
    query_count: queries.length,
    event_universe_hash: release053bEventUniverseHash(),
    query_plan_hash: release053bQueryPlanHash(),
    semantic_bundle_hash: release053bSemanticBundleHash(),
    category_counts: release053bCategoryCounts(),
  });
}
