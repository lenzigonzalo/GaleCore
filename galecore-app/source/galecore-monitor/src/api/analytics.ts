import apiClient from './client';
import {
  GammaExposureApiResponse,
  GammaExposureResponse,
  IVRankApiResponse,
  IVRankResponse,
  ImpliedVolatilityApiResponse,
  ImpliedVolatilityResponse,
} from '../types/api';

export async function fetchGammaExposure(symbol: string): Promise<GammaExposureResponse> {
  const { data } = await apiClient.get<GammaExposureApiResponse>(
    '/App.Analytics/GammaExposure',
    { params: { Symbol: symbol }, timeout: 120_000 }
  );

  const strikes = data.strikes ?? [];

  // Derive callWall: strike with highest callGEX
  const callWallStrike = strikes.reduce(
    (best, s) => (s.callGEX > best.callGEX ? s : best),
    strikes[0] ?? { strike: 0, callGEX: 0, putGEX: 0, netGEX: 0 }
  );
  // Derive putWall: strike with most negative putGEX
  const putWallStrike = strikes.reduce(
    (best, s) => (s.putGEX < best.putGEX ? s : best),
    strikes[0] ?? { strike: 0, callGEX: 0, putGEX: 0, netGEX: 0 }
  );
  // Net GEX: sum of netGEX across all strikes, convert M → B
  const netGex = strikes.reduce((sum, s) => sum + s.netGEX, 0) / 1000;

  return {
    symbol:         data.symbol,
    spot:           data.spot,
    dte:            data.dte,
    expiration:     data.expiration ?? '',
    zeroGammaLevel: data.gammaZeroLevel,
    netGex,
    callWall: callWallStrike.strike,
    putWall: putWallStrike.strike,
    strikes: strikes.map((s) => ({
      strike:    s.strike,
      callGex:   s.callGEX,
      putGex:    s.putGEX,
      netGex:    s.netGEX,
      callOI:    s.callOI,
      putOI:     s.putOI,
      callDelta: s.callDelta,
      putDelta:  s.putDelta,
    })),
  };
}

export async function fetchIVRank(symbol: string): Promise<IVRankResponse> {
  const { data } = await apiClient.get<IVRankApiResponse>(
    '/App.Analytics/IVRank',
    { params: { Symbol: symbol } }
  );
  console.debug(`[IVRank] ${symbol}:`, data);
  // Map raw response — field names verified from API
  const raw = data as Record<string, unknown>;
  return {
    symbol: (raw.symbol as string) ?? symbol,
    ivRank: (raw.ivRank as number) ?? (raw.rank as number) ?? 0,
    ivPercentile: (raw.ivPercentile as number) ?? 0,
    timestamp: (raw.timestamp as string) ?? new Date().toISOString(),
  };
}

export async function fetchImpliedVolatility(symbol: string): Promise<ImpliedVolatilityResponse> {
  const { data } = await apiClient.get<ImpliedVolatilityApiResponse>(
    '/App.Analytics/ImpliedVolatility',
    { params: { Symbol: symbol } }
  );
  console.debug(`[ImpliedVolatility] ${symbol}:`, JSON.stringify(data));

  // Unwrap possible { data: {...} } wrapper
  const raw = ((data as any)?.data ?? data) as Record<string, unknown>;

  // API field names: iV30_30d, iV30_9d, iV30_90d (formato unificado IV30_Nd)
  const iv30 =
    (raw.iV30_30d          as number) ||
    (raw.impliedVolatility as number) ||
    0;

  const iv9d =
    (raw.iV30_9d  as number) ||
    undefined;

  const iv3m =
    (raw.iV30_90d as number) ||
    undefined;

  console.debug(`[ImpliedVolatility] ${symbol} parsed → iv30_30d=${iv30} iv30_9d=${iv9d} iv30_90d=${iv3m}`);

  return {
    symbol:    (raw.symbol as string) ?? symbol,
    iv30,
    iv9d,
    iv3m,
    timestamp: (raw.timestamp as string) ?? new Date().toISOString(),
  };
}
