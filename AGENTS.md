# Repository instructions

This repository is the public research codebase for the Lowcountry Digital Works Agent Trading Lab.

Release 0.4 is limited to the deterministic Phase 0B forecast harness and Kalshi public-source qualification authorized by `LowcountryDigitalWorks/business-operations#258`, building on accepted Release 0.3 main `0cc2bacceaf0dd9484b529539a896fb7f2d9bef3`.

## Boundaries

- Phase 0A Releases 0.1–0.3 are closed. Do not change crypto pairs, windows, EMA logic, stake, liquidity, risk, costs, execution, or the accepted Release 0.3 NEGATIVE result.
- Release 0.4 is source qualification + forecast measurement harness only. It is not model-efficacy testing, OOS collection, trading, execution, or P&L testing.
- Kalshi access is public unauthenticated read-only REST only. No account, API key, credential, signing, authenticated endpoint, or order path.
- Exactly one bounded live qualification proof is authorized after routine CI is green: <=250 GETs and <=50 candidate events.
- The proof must not retain raw live response bodies or bulk orderbook/market archives in the repository or public artifact.
- Mock/synthetic treatment only. No Gemini, OpenAI, Jev, or other external model/API call.
- No OOS-A/OOS-B live collection in this release.
- No prediction-market trading, BUY/SELL threshold, portfolio sizing, wallet, signing, paper/live execution, or P&L simulation.
- Preserve Release 0.1 CandidateEnvelope/DecisionRecord/EvidenceEvent/RunManifest and append-only + hash-chained + tamper-evident evidence semantics.
- Incremental cash and real capital remain $0.
- No customer data, PHI, CUI, payment data, credentials, or private LDW material.

Use a meaningful branch and PR. Routine CI stays offline, synthetic, and deterministic. Development must not merge; freeze the exact candidate and return to Product Orchestrator after the one authorized source-qualification proof.
