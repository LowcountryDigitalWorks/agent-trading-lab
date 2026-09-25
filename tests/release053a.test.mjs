import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  RELEASE053A_OFFLINE_RECOMMENDATION,
  classifyRelease053FutureObservation,
  createRelease053EventFirstQueryPlan,
  diagnoseRelease053ToolSchema,
  mapRelease053EventFirstInstrument,
  release053AFeasibilityDecision,
  release053EventFirstQueryPlanHash,
  release053EventFirstSearchCalls,
  release053EventFirstSemanticBundleHash,
  release053ParserContractHash,
  release053QualityFeasibilityDesign,
  release053QualityFeasibilityDesignHash,
  release053SnapshotQuality,
  selectRelease053EventFirstSemanticCandidates,
  selectRelease053NextSnapshotCandidate,
  selectRelease053SnapshotSample,
  validateRelease053EventFirstQueryPlan,
  validateRelease053FutureObservation,
  validateRelease053QualityFeasibilityDesign,
  validateRelease053SchemaDiagnostic,
} from "../src/release053a-qualification-design.mjs";

async function fixture(name) {
  return JSON.parse(await readFile(
    new URL(`./fixtures/${name}`, import.meta.url),
    "utf8",
  ));
}

function diagnoseSnapshot(actualPayload, callSequence = 1) {
  return diagnoseRelease053ToolSchema({
    tool: "get_market_snapshot",
    actualPayload,
    proofRunId: "release053a-offline-synthetic",
    callSequence,
  });
}

function spec({
  eventId,
  question,
  category,
  criteria = "a".repeat(64),
} = {}) {
  return {
    schema_version: "independent-event-spec.v1",
    event_id: eventId,
    canonical_question: question,
    yes_condition: `${question} resolves YES.`,
    no_condition: `${question} resolves NO.`,
    category,
    deadline_utc: "2026-10-01T00:00:00.000Z",
    resolution_authority: "Independent synthetic authority",
    resolution_reference: `independent://${eventId}`,
    criteria_hash: criteria,
    allowed_cutoffs: ["T-24h", "T-6h", "T-1h"],
  };
}

function eventEntries() {
  return [
    {
      spec: spec({
        eventId: "event-alpha",
        question: "Event Alpha",
        category: "WEATHER_CLIMATE",
        criteria: "a".repeat(64),
      }),
      query_terms: ["Event family"],
      semantic_aliases: ["Event Alpha"],
    },
    {
      spec: spec({
        eventId: "event-beta",
        question: "Event Beta",
        category: "MACROECONOMICS",
        criteria: "b".repeat(64),
      }),
      query_terms: ["Event family"],
      semantic_aliases: ["Event Beta"],
    },
  ];
}

function normalizedInstrument({
  id = "1001",
  code = "event-alpha",
} = {}) {
  return {
    instrument_id: id,
    code,
    instrument_class: "prediction",
    venue: "polymarket",
    venue_name: "Polymarket",
    base: "POLYMARKET_BET",
    quote: "pUSD",
    state: "open",
    days_with_data: 1,
    first_day: "2026-09-25",
    last_day: "2026-09-25",
    total_bytes_compressed: 1,
    listed_since: "2026-09-25",
    orientation: "YES",
    price_semantics: "probability_0_1",
    source_schema_fingerprint: "c".repeat(64),
  };
}

test("0.5.3A schema diagnostic returns null for the current valid synthetic snapshot", async () => {
  const valid = await fixture("release053a-snapshot.valid.json");
  assert.equal(diagnoseSnapshot(valid), null);
});

test("schema diagnostic distinguishes a missing expected field", async () => {
  const input = await fixture("release053a-snapshot.missing.json");
  const diagnostic = diagnoseSnapshot(input);
  assert.equal(diagnostic.primary_category, "MISSING_EXPECTED_FIELD");
  assert(diagnostic.mismatch_categories.includes("MISSING_EXPECTED_FIELD"));
  assert(diagnostic.normalized_failing_paths.includes("$.price_last"));
  assert.equal(validateRelease053SchemaDiagnostic(diagnostic), diagnostic);
});

test("schema diagnostic distinguishes an unexpected extra field without retaining its name or value", async () => {
  const input = await fixture("release053a-snapshot.extra.json");
  const diagnostic = diagnoseSnapshot(input);
  assert.equal(diagnostic.primary_category, "UNEXPECTED_EXTRA_FIELD");
  const retained = JSON.stringify(diagnostic);
  assert.equal(retained.includes("undocumented_payload_value"), false);
  assert.equal(retained.includes("DO-NOT-RETAIN-EXTRA-VALUE"), false);
  assert.equal(validateRelease053SchemaDiagnostic(diagnostic), diagnostic);
});

test("schema diagnostic distinguishes a wrong JSON type without retaining the raw value", async () => {
  const input = await fixture("release053a-snapshot.wrong-type.json");
  const diagnostic = diagnoseSnapshot(input);
  assert.equal(diagnostic.primary_category, "WRONG_JSON_TYPE");
  assert(diagnostic.normalized_failing_paths.includes("$.last_60m.trades"));
  assert.equal(
    JSON.stringify(diagnostic).includes("DO-NOT-RETAIN-WRONG-TYPE-VALUE"),
    false,
  );
});

test("schema diagnostic distinguishes nested shape mismatch without retaining unexpected nested keys or values", async () => {
  const input = await fixture("release053a-snapshot.nested-shape.json");
  const diagnostic = diagnoseSnapshot(input);
  assert.equal(diagnostic.primary_category, "NESTED_SHAPE_MISMATCH");
  assert(
    diagnostic.normalized_failing_paths.includes("$.last_60m.top1_depth_usd"),
  );
  const retained = JSON.stringify(diagnostic);
  assert.equal(retained.includes('"mid"'), false);
  assert.equal(retained.includes("DO-NOT-RETAIN-NESTED-VALUE"), false);
});

test("schema diagnostic is deterministic, hash-bound, bounded, and value-free", async () => {
  const input = await fixture("release053a-snapshot.extra.json");
  const first = diagnoseSnapshot(input);
  const second = diagnoseSnapshot(input);
  assert.deepEqual(first, second);
  assert.match(first.diagnostic_hash, /^[a-f0-9]{64}$/u);
  assert.match(release053ParserContractHash("get_market_snapshot"), /^[a-f0-9]{64}$/u);
  assert(first.normalized_failing_paths.length <= 8);
  assert(first.nested_key_sets.length <= 8);
  const retained = JSON.stringify(first);
  for (const forbidden of [
    "DO-NOT-RETAIN-EVENT-CODE",
    "0.7312345",
    "DO-NOT-RETAIN-EXTRA-VALUE",
  ]) {
    assert.equal(retained.includes(forbidden), false, forbidden);
  }
});

test("event-first query plan is canonical, hashable, and derived before provider results", () => {
  const entries = eventEntries().reverse();
  const plan = createRelease053EventFirstQueryPlan(entries);
  assert.equal(validateRelease053EventFirstQueryPlan(plan), plan);
  assert.deepEqual(plan.events.map((event) => event.event_id), [
    "event-alpha",
    "event-beta",
  ]);
  assert.deepEqual(release053EventFirstSearchCalls(plan), [
    {
      q: "Event family",
      class: "prediction",
      venue: "polymarket",
      limit: 10,
    },
  ]);
  const before = release053EventFirstQueryPlanHash(plan);
  const semanticBefore = release053EventFirstSemanticBundleHash(plan);
  assert.match(before, /^[a-f0-9]{64}$/u);
  assert.match(semanticBefore, /^[a-f0-9]{64}$/u);

  const providerResults = [{
    terminal_status: "SUCCESS",
    parsed: {
      instruments: [
        normalizedInstrument({ id: "9001", code: "provider-observed-unmapped-code" }),
      ],
    },
  }];
  selectRelease053EventFirstSemanticCandidates({ plan, discoveryResults: providerResults });
  assert.equal(release053EventFirstQueryPlanHash(plan), before);
  assert.equal(release053EventFirstSemanticBundleHash(plan), semanticBefore);
  assert.equal(JSON.stringify(plan).includes("provider-observed-unmapped-code"), false);
  assert.equal(JSON.stringify(plan).includes("9001"), false);
});

test("event-first mapping keeps zero matches unproven", () => {
  const plan = createRelease053EventFirstQueryPlan(eventEntries());
  const result = mapRelease053EventFirstInstrument({
    plan,
    instrument: normalizedInstrument({ code: "unrelated-event" }),
    mappingTimestamp: "2026-09-25T02:00:00.000Z",
  });
  assert.deepEqual(
    { status: result.status, match_count: result.match_count, category: result.category },
    { status: "semantic_mapping_unproven", match_count: 0, category: null },
  );
});

test("event-first mapping keeps ambiguous matches unproven", () => {
  const entries = eventEntries();
  entries[0].semantic_aliases = ["Shared Alias"];
  entries[1].semantic_aliases = ["Shared Alias"];
  const plan = createRelease053EventFirstQueryPlan(entries);
  const result = mapRelease053EventFirstInstrument({
    plan,
    instrument: normalizedInstrument({ code: "shared-alias" }),
    mappingTimestamp: "2026-09-25T02:00:00.000Z",
  });
  assert.deepEqual(
    { status: result.status, match_count: result.match_count, category: result.category },
    { status: "semantic_mapping_unproven", match_count: 2, category: null },
  );
});

test("one exact normalized event-first match creates VERIFIED SourceMappingRecord evidence", () => {
  const plan = createRelease053EventFirstQueryPlan(eventEntries());
  const instrument = normalizedInstrument({ code: "EVENT---ALPHA" });
  Object.defineProperty(instrument, "p_control", {
    get() {
      throw new Error("probability must not influence semantic mapping");
    },
  });
  const result = mapRelease053EventFirstInstrument({
    plan,
    instrument,
    mappingTimestamp: "2026-09-25T02:00:00.000Z",
  });
  assert.equal(result.status, "VERIFIED");
  assert.equal(result.match_count, 1);
  assert.equal(result.event_id, "event-alpha");
  assert.equal(result.category, "WEATHER_CLIMATE");
  assert.match(result.source_mapping_record_hash, /^[a-f0-9]{64}$/u);
  assert.match(result.mapping_evidence_hash, /^[a-f0-9]{64}$/u);
});

test("candidate selection is deterministic, one-per-event, deduped, and exact-match only", () => {
  const plan = createRelease053EventFirstQueryPlan(eventEntries());
  const results = [{
    terminal_status: "SUCCESS",
    parsed: {
      instruments: [
        normalizedInstrument({ id: "1", code: "Event Alpha" }),
        normalizedInstrument({ id: "1", code: "Event Alpha" }),
        normalizedInstrument({ id: "2", code: "No Match" }),
        normalizedInstrument({ id: "3", code: "Event Beta" }),
        normalizedInstrument({ id: "4", code: "Event Beta" }),
      ],
    },
  }];
  const selection = selectRelease053EventFirstSemanticCandidates({
    plan,
    discoveryResults: results,
  });
  assert.deepEqual(selection.selected, [
    { event_id: "event-alpha", instrument_id: "1", query_index: 0, hit_index: 0 },
    { event_id: "event-beta", instrument_id: "3", query_index: 0, hit_index: 3 },
  ]);
  assert.equal(selection.no_match_count, 1);
  assert.equal(selection.ambiguous_match_count, 0);
});

test("snapshot sample selector takes the first 30 VERIFIED unique events deterministically", () => {
  const candidates = [];
  for (let index = 0; index < 35; index += 1) {
    candidates.push({
      status: "VERIFIED",
      event_id: `event-${String(index).padStart(2, "0")}`,
      instrument_id: String(1000 + index),
    });
  }
  candidates.splice(5, 0, {
    status: "VERIFIED",
    event_id: "event-04",
    instrument_id: "9999",
  });

  const sample = selectRelease053SnapshotSample(candidates);
  assert.equal(sample.length, 30);
  assert.equal(new Set(sample.map((item) => item.event_id)).size, 30);
  assert.deepEqual(sample[0], { event_id: "event-00", instrument_id: "1000" });
  assert.deepEqual(sample[4], { event_id: "event-04", instrument_id: "1004" });
  assert.deepEqual(sample.at(-1), { event_id: "event-29", instrument_id: "1029" });
});

test("quality-feasibility design is a non-inferential 30-event engineering screen", () => {
  const design = release053QualityFeasibilityDesign();
  assert.equal(validateRelease053QualityFeasibilityDesign(design), design);
  assert.equal(
    design.screen_type,
    "NON_INFERENTIAL_DETERMINISTIC_ENGINEERING_SCREEN",
  );
  assert.deepEqual(design.quality_thresholds, {
    trades_60m_min: 5,
    turnover_usd_60m_min: 100,
    spread_bps_60m_avg_max: 2000,
    top1_depth_min_side_usd_60m_min: 50,
  });
  assert.deepEqual(design.sample, {
    maximum_search_calls: 8,
    maximum_get_instrument_calls: 40,
    maximum_snapshot_calls: 30,
    maximum_total_source_calls: 78,
    minimum_evaluable_snapshots: 30,
    minimum_unique_mapped_events: 30,
    per_event_snapshot_cap: 1,
    no_retry: true,
    deterministic_order_only: true,
  });
  assert.equal(
    design.rationale.positive_result_meaning,
    "30 deterministically selected, independently specified event mappings each produced one parseable snapshot that passed every frozen source-quality threshold during the bounded qualification run.",
  );
  for (const limitation of [
    "statistical_representativeness",
    "future_source_quality_probability",
    "cross_event_independence",
    "t24_t6_t1_temporal_stability",
    "later_category_robustness",
    "later_100_event_300_decision_cohort_floors",
  ]) {
    assert(design.rationale.unestablished.includes(limitation), limitation);
  }
  assert.match(release053QualityFeasibilityDesignHash(), /^[a-f0-9]{64}$/u);
});

function validFutureObservation(overrides = {}) {
  return {
    pre_dispatch_valid: true,
    source_failure_count: 0,
    parser_failure_count: 0,
    accounting_failure_count: 0,
    plan_exhausted: false,
    verified_unique_events: 0,
    evaluable_snapshots: 0,
    quality_passes: 0,
    quality_rejects: 0,
    retry_count: 0,
    ...overrides,
  };
}

test("30 of 30 with zero failures is TECHNICALLY_VIABLE", () => {
  const observation = validFutureObservation({
    plan_exhausted: true,
    verified_unique_events: 30,
    evaluable_snapshots: 30,
    quality_passes: 30,
  });
  assert.equal(validateRelease053FutureObservation(observation), observation);
  assert.equal(
    classifyRelease053FutureObservation(observation),
    "TECHNICALLY_VIABLE",
  );
});

test("one quality reject stops immediately even when plan is not exhausted", () => {
  const observation = validFutureObservation({
    verified_unique_events: 30,
    evaluable_snapshots: 30,
    quality_passes: 29,
    quality_rejects: 1,
    plan_exhausted: false,
  });
  assert.equal(
    classifyRelease053FutureObservation(observation),
    "INSUFFICIENT",
  );
});

test("one early quality reject before 30 stops immediately", () => {
  const observation = validFutureObservation({
    verified_unique_events: 7,
    evaluable_snapshots: 7,
    quality_passes: 6,
    quality_rejects: 1,
    plan_exhausted: false,
  });
  assert.equal(
    classifyRelease053FutureObservation(observation),
    "INSUFFICIENT",
  );
});

test("29 of 30 plus one reject is INSUFFICIENT regardless of plan_exhausted", () => {
  for (const plan_exhausted of [false, true]) {
    assert.equal(
      classifyRelease053FutureObservation(validFutureObservation({
        verified_unique_events: 30,
        evaluable_snapshots: 30,
        quality_passes: 29,
        quality_rejects: 1,
        plan_exhausted,
      })),
      "INSUFFICIENT",
    );
  }
});

test("no later snapshot candidate is selected after a quality rejection", () => {
  const candidates = [
    { status: "VERIFIED", event_id: "event-next", instrument_id: "2001" },
  ];
  const next = selectRelease053NextSnapshotCandidate({
    observation: validFutureObservation({
      verified_unique_events: 1,
      evaluable_snapshots: 1,
      quality_passes: 0,
      quality_rejects: 1,
      plan_exhausted: false,
    }),
    verifiedCandidates: candidates,
  });
  assert.equal(next, null);
});

test("next snapshot candidate is available only while deterministic plan may continue", () => {
  const next = selectRelease053NextSnapshotCandidate({
    observation: validFutureObservation({
      verified_unique_events: 2,
      evaluable_snapshots: 1,
      quality_passes: 1,
      quality_rejects: 0,
      plan_exhausted: false,
    }),
    verifiedCandidates: [
      { status: "VERIFIED", event_id: "event-used", instrument_id: "2000" },
      { status: "VERIFIED", event_id: "event-next", instrument_id: "2001" },
    ],
    sampledEventIds: ["event-used"],
  });
  assert.deepEqual(next, {
    event_id: "event-next",
    instrument_id: "2001",
  });
});

test("future observation rejects impossible quality accounting", () => {
  assert.throws(
    () => classifyRelease053FutureObservation(validFutureObservation({
      verified_unique_events: 10,
      evaluable_snapshots: 10,
      quality_passes: 9,
      quality_rejects: 0,
    })),
    /quality accounting mismatch/u,
  );
});

test("future observation rejects more evaluable snapshots than VERIFIED events", () => {
  assert.throws(
    () => classifyRelease053FutureObservation(validFutureObservation({
      verified_unique_events: 9,
      evaluable_snapshots: 10,
      quality_passes: 10,
    })),
    /evaluable snapshots exceed verified unique events/u,
  );
});

test("future observation rejects more than 30 evaluable snapshots", () => {
  assert.throws(
    () => classifyRelease053FutureObservation(validFutureObservation({
      verified_unique_events: 31,
      evaluable_snapshots: 31,
      quality_passes: 31,
    })),
    /evaluable snapshots exceed frozen snapshot ceiling/u,
  );
});

test("source/parser/accounting/retry failures remain BLOCKED", () => {
  for (const patch of [
    { pre_dispatch_valid: false },
    { source_failure_count: 1 },
    { parser_failure_count: 1 },
    { accounting_failure_count: 1 },
    { retry_count: 1 },
  ]) {
    assert.equal(
      classifyRelease053FutureObservation(validFutureObservation(patch)),
      "BLOCKED",
    );
  }
});

test("clean partial evidence may continue only before exhaustion and without rejects", () => {
  const partial = validFutureObservation({
    verified_unique_events: 20,
    evaluable_snapshots: 20,
    quality_passes: 20,
    plan_exhausted: false,
  });
  assert.equal(
    classifyRelease053FutureObservation(partial),
    "CONTINUE_DETERMINISTIC_PLAN",
  );
  assert.equal(
    classifyRelease053FutureObservation({ ...partial, plan_exhausted: true }),
    "INSUFFICIENT",
  );
});

test("snapshot quality keeps every Release 0.5.2 numeric threshold unchanged", () => {
  assert.deepEqual(
    release053SnapshotQuality({
      trades_60m: 5,
      turnover_usd_60m: 100,
      spread_bps_60m_avg: 2000,
      top1_depth_min_side_usd_60m: 50,
    }),
    { pass: true, reasons: [] },
  );
  assert.deepEqual(
    release053SnapshotQuality({
      trades_60m: 4,
      turnover_usd_60m: 99,
      spread_bps_60m_avg: 2001,
      top1_depth_min_side_usd_60m: 49,
    }),
    {
      pass: false,
      reasons: [
        "low_trades_60m",
        "low_turnover_60m",
        "low_top1_depth",
        "invalid_or_wide_spread",
      ],
    },
  );
});

test("checked-in 0.5.3A schemas freeze the same offline contracts", async () => {
  const diagnosticSchema = JSON.parse(await readFile(
    new URL("../schemas/cryptostruct-schema-diagnostic.v1.schema.json", import.meta.url),
    "utf8",
  ));
  const planSchema = JSON.parse(await readFile(
    new URL("../schemas/cryptostruct-event-first-query-plan.v1.schema.json", import.meta.url),
    "utf8",
  ));
  const qualitySchema = JSON.parse(await readFile(
    new URL("../schemas/cryptostruct-quality-feasibility.v1.schema.json", import.meta.url),
    "utf8",
  ));

  assert.equal(diagnosticSchema.additionalProperties, false);
  assert.equal(diagnosticSchema.properties.normalized_failing_paths.maxItems, 8);
  assert.equal(planSchema.properties.candidate_selection.properties.max_total_source_calls.const, 78);
  assert.equal(planSchema.properties.candidate_selection.properties.retry.const, false);
  assert.equal(
    qualitySchema.properties.screen_type.const,
    "NON_INFERENTIAL_DETERMINISTIC_ENGINEERING_SCREEN",
  );
  assert.equal(qualitySchema.properties.quality_thresholds.properties.trades_60m_min.const, 5);
  assert.equal(qualitySchema.properties.quality_thresholds.properties.turnover_usd_60m_min.const, 100);
  assert.equal(qualitySchema.properties.quality_thresholds.properties.spread_bps_60m_avg_max.const, 2000);
  assert.equal(qualitySchema.properties.quality_thresholds.properties.top1_depth_min_side_usd_60m_min.const, 50);
  assert.equal(qualitySchema.properties.sample.properties.minimum_evaluable_snapshots.const, 30);
  assert.equal(qualitySchema.properties.sample.properties.minimum_unique_mapped_events.const, 30);
  assert.equal(qualitySchema.properties.sample.properties.maximum_total_source_calls.const, 78);
  assert.equal(qualitySchema.properties.sample.properties.per_event_snapshot_cap.const, 1);
  assert.equal(qualitySchema.properties.sample.properties.no_retry.const, true);
});

test("quality schema and docs contain no inferential p-cubed or binomial acceptance rationale", async () => {
  const qualitySchemaText = await readFile(
    new URL("../schemas/cryptostruct-quality-feasibility.v1.schema.json", import.meta.url),
    "utf8",
  );
  const docsText = await readFile(
    new URL("../docs/RELEASE_0_5_3A_CRYPTOSTRUCT_QUALIFICATION_REDESIGN.md", import.meta.url),
    "utf8",
  );

  for (const forbidden of [
    "150 * p^3",
    "0.873580",
    "0.904966",
    "one_sided_confidence_level",
    "all_30_pass_lower_bound",
    "all-pass-screen-clears-downstream-three-cutoff-geometry",
  ]) {
    assert.equal(qualitySchemaText.includes(forbidden), false, forbidden);
    assert.equal(docsText.includes(forbidden), false, forbidden);
  }

  assert(docsText.includes("NON-INFERENTIAL DETERMINISTIC ENGINEERING SCREEN"));
  assert(docsText.includes("No binomial confidence bound"));
  assert(docsText.includes("T-24h / T-6h / T-1h temporal stability"));
  assert(docsText.includes("at least three eligible"));
  assert(docsText.includes(">=20 resolved events each"));
});

test("0.5.3A returns exactly the authorized offline recommendation", () => {
  assert.equal(
    RELEASE053A_OFFLINE_RECOMMENDATION,
    "PROCEED_TO_0.5.3B_DESIGN_REVIEW",
  );
  assert.equal(
    release053AFeasibilityDecision(),
    "PROCEED_TO_0.5.3B_DESIGN_REVIEW",
  );
});
