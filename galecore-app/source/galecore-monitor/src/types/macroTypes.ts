export interface MacroDefinition {
  id: string; name: string; family: string; region: string; unit: string; source: string;
  frequency: string; calendarId: string; instrumentType: string; currency: string;
  methodologyVersion: string; supportedHorizons: string[]; limitations: string[];
}
export interface MacroObservation {
  id: string; seriesId: string; value: number | null; observationTime: string;
  publishedAt: string | null; availableAt: string | null; retrievedAt: string;
  timestampPrecision: string; sourceRef: string; vintageId: string | null;
  provenance: string; qualityStatus: string; qualityReasons: string[];
}
export interface MacroMetric {
  id: string; seriesId: string; levelRef: string | null; comparisonRef: string | null;
  value: number | null; unit: string; horizon: string; actualFrom: string | null;
  actualTo: string | null; inputRefs: string[]; formulaVersion: string; qualityStatus: string; limitations: string[];
}
export interface MacroEvent {
  id: string; name: string; date: string; source: string; sourceRef: string;
  retrievedAt: string; timestampPrecision: string; limitations: string[];
  /** Balance de una empresa de la watchlist (Tastytrade): el panel de detalle muestra estos datos en vez del texto de fecha programada. */
  earnings?: { symbol: string; timeOfDay: string | null; estimated: boolean | null; consensusEps: number | null };
}
export interface MacroSnapshot {
  id: string; schemaVersion: string; horizon: string; region: string; currency: string;
  dataCutoff: string; generatedAt: string; contentHash: string; historicalFidelity: string;
  seriesDefinitions: MacroDefinition[]; observations: MacroObservation[]; metrics: MacroMetric[];
  events: MacroEvent[]; sourceStatuses: { id: string; status: string; asOf: string | null; retrievedAt: string | null; reasons: string[] }[];
  methodologyVersions: string[];
}
