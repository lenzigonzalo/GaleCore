/**
 * Contratos del adapter local de registros de régimen (GaleCore-AI,
 * `galecore_ai.adapters.regime_viewer`, item GC-AI-0004). Todo lo que se muestra en la pestaña
 * Régimen sale de estas respuestas tal cual: el front no deriva estados ni compara números.
 */

export type RegimeRecordStatus = 'OK' | 'INTEGRITY_FAILED' | 'READ_INCONSISTENT';

export interface RegimeMeta {
  records_dir: string;
  symbols: string[];
  annotations_file: string;
  annotation_count: number;
  read_only: boolean;
  reviews_enabled: boolean;
  served_at: string;
  /** Zona horaria de la convención con la que se fecha cada registro (America/New_York). */
  timezone?: string;
  /** Fecha de hoy en esa zona: es la que decide si "hay registro de hoy". */
  today?: string;
}

export interface RegimeSource {
  capability_id: string;
  endpoint: string;
  freshness_basis: string;
  freshness_status: string;
  market_data_as_of?: string | null;
  provenance: string;
  response_received_at?: string | null;
}

export interface RegimeSnapshot {
  run_id: string;
  prepared_at: string;
  facts_hash: string;
  conventions_hash: string;
  market_data_as_of: string | null;
  freshness_status: string;
}

export interface RegimeGuardrail {
  guardrail_id: string;
  passed: boolean;
  message: string;
}

export interface RegimeAssetEntry {
  asset_id: string;
  version: string;
  content_hash: string;
}

export interface RegimeAssets {
  agent: RegimeAssetEntry;
  skills: Record<string, RegimeAssetEntry>;
  protocols: Record<string, RegimeAssetEntry>;
  conventions: Record<string, RegimeAssetEntry>;
}

export interface RegimeClaimCheck {
  metric: string;
  value: number | string | null;
  unit: string;
  fact_value: number | string | boolean | null;
  matches: boolean;
}

export interface RegimeEvidenceRow {
  claim: string;
  fact_path: string;
  fact_value: number | string | boolean | null;
}

export interface RegimeComparisonRow {
  metric: string;
  before: number | string | null;
  after: number | string | null;
  /** Diferencia numérica calculada por el adapter; null si algún lado no es numérico. */
  delta: number | null;
}

export interface RegimeComparison {
  observed_at: string;
  rows: RegimeComparisonRow[];
}

export interface RegimeOutcome {
  observed_at: string;
  facts: Record<string, unknown>;
  facts_hash: string;
  facts_provenance: string;
}

export type ReviewVerdict = 'agree' | 'partial' | 'disagree';

export interface RegimeHumanReview {
  reviewed_at: string;
  verdict: ReviewVerdict;
  comment: string;
}

export interface RegimeAnnotation {
  symbol: string;
  date: string;
  entry_hash: string;
  kind: string;
  label: string;
  note: string;
  source: string;
  decided_on: string;
}

export interface RegimeAcceptedPayload {
  gamma_regime: string;
  tail_pricing: string;
  observations: string[];
  implications: string[];
  limitations: string[];
  quantitative_claims: { metric: string; value: number; unit: string }[];
  evidence: { claim: string; fact_path: string }[];
}

export interface RegimeEntry {
  run_id: string;
  prompt: string;
  accepted_at: string;
  facts_hash: string;
  facts: Record<string, unknown> & { sources?: Record<string, RegimeSource> };
  host: { provider: string | null; model: string | null; provenance: string };
  accepted_payload: RegimeAcceptedPayload;
  outcomes: RegimeOutcome[];
  human_reviews: RegimeHumanReview[];
  // Detalle que agrega el adapter a partir de la misma lectura que hace `query`.
  recorded_at: string;
  snapshot: RegimeSnapshot;
  effective_assets: RegimeAssets;
  trace: { trace_id: string; facts_provenance: string; guardrails: RegimeGuardrail[] };
  entry_hash: string;
  claims: RegimeClaimCheck[];
  evidence: RegimeEvidenceRow[];
  comparisons: RegimeComparison[];
  states: { outcome_pending: boolean; review_pending: boolean };
  annotation: RegimeAnnotation | null;
}

export interface RegimeRecordOk {
  date: string;
  status: 'OK';
  path: string;
  entries: RegimeEntry[];
}

export interface RegimeRecordFailed {
  date: string;
  status: 'INTEGRITY_FAILED' | 'READ_INCONSISTENT';
  path: string | null;
  problems: string[];
}

export type RegimeRecord = RegimeRecordOk | RegimeRecordFailed;

export interface RegimeRecordsResponse {
  symbol: string;
  since: string;
  until: string | null;
  records_dir: string;
  count: number;
  integrity_failed: string[];
  read_inconsistent: string[];
  records: RegimeRecord[];
  queried_at: string;
}

export interface RegimeTodayResponse {
  date: string;
  timezone: string;
  symbol: string;
  status: 'NO_RECORD' | RegimeRecordStatus;
  record: RegimeRecord | null;
  records_dir: string;
  queried_at: string;
}

export interface RegimeReviewRequest {
  symbol: string;
  date: string;
  run_id: string;
  verdict: ReviewVerdict;
  comment: string;
}

export interface RegimeReviewResponse {
  recorded: { run_id: string; path: string; verdict: ReviewVerdict };
  record: RegimeRecord | null;
  queried_at: string;
}
