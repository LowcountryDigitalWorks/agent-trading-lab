import {
  release053bCategoryCounts,
  release053bSearchCalls,
  validateRelease053bEventUniverse,
} from "../src/release053b-event-universe.mjs";
import {
  release053bFreezeSurface,
} from "../src/release053b-final-proof.mjs";

console.log(JSON.stringify({
  ...validateRelease053bEventUniverse(),
  category_counts: release053bCategoryCounts(),
  query_plan: release053bSearchCalls(),
  freeze_surface: release053bFreezeSurface(),
}, null, 2));
