"""Capability contracts — defines what GaleCore capabilities the AI layer can invoke.

Phase 3 is read-only: only PURE_QUERY and COMPUTE capabilities.
No STATE_MUTATION, no EXTERNAL_ACTION.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


class SemanticClass(str, Enum):
    """Capability classification per P0-CONTRACTS §4."""

    PURE_QUERY = "PURE_QUERY"
    COMPUTE = "COMPUTE"
    STATE_MUTATION = "STATE_MUTATION"
    EXTERNAL_ACTION = "EXTERNAL_ACTION"


# Phase 3 allowlist — only these semantic classes are permitted
PHASE3_ALLOWED_CLASSES = frozenset({SemanticClass.PURE_QUERY, SemanticClass.COMPUTE})


class CapabilityParameter(BaseModel):
    """A single parameter for a capability."""

    name: str
    type: str  # e.g. "string", "number", "boolean"
    required: bool = True
    description: str = ""


class CapabilityDefinition(BaseModel):
    """Definition of a GaleCore capability that can be invoked from the AI layer."""

    capability_id: str  # e.g. "market_data.quote"
    semantic_class: SemanticClass
    description: str
    parameters: list[CapabilityParameter] = Field(default_factory=list)
    returns: str = ""  # description of return type
    version: str = "1.0"

    def is_phase3_allowed(self) -> bool:
        """Check if this capability is allowed in Phase 3 (read-only)."""
        return self.semantic_class in PHASE3_ALLOWED_CLASSES


# Known capability definitions for Phase 3
KNOWN_CAPABILITIES: list[CapabilityDefinition] = [
    CapabilityDefinition(
        capability_id="market_data.quote",
        semantic_class=SemanticClass.PURE_QUERY,
        description="Get current market quote for a symbol",
        parameters=[
            CapabilityParameter(name="symbol", type="string", description="Ticker symbol"),
        ],
        returns="Quote with bid, ask, last, volume",
    ),
    CapabilityDefinition(
        capability_id="compute.gamma_exposure",
        semantic_class=SemanticClass.COMPUTE,
        description="Compute gamma exposure (GEX) for a symbol (single expiration)",
        parameters=[
            CapabilityParameter(name="symbol", type="string", description="Underlying symbol"),
            CapabilityParameter(name="dte", type="number", required=False, description="Days to expiration filter"),
        ],
        returns="Net GEX, call/put GEX, zero gamma level, walls, strikes",
    ),
    CapabilityDefinition(
        capability_id="compute.gex_analysis",
        semantic_class=SemanticClass.COMPUTE,
        description="Global GEX analysis across all expirations with macro regime context",
        parameters=[
            CapabilityParameter(name="symbol", type="string", description="Underlying symbol"),
        ],
        returns="Global GEX scope (net/call/put, walls, coverage), macro regime, config",
    ),
    CapabilityDefinition(
        capability_id="compute.put_skew",
        semantic_class=SemanticClass.COMPUTE,
        description="25-delta put skew snapshot (iv_put_25delta / iv_atm) for a symbol",
        parameters=[
            CapabilityParameter(name="symbol", type="string", description="Underlying symbol"),
        ],
        returns="Spot, ATM IV, 25-delta put IV, putSkew25d ratio, GaleCore level semaphore",
    ),
    CapabilityDefinition(
        capability_id="market_data.trade",
        semantic_class=SemanticClass.PURE_QUERY,
        description="Last trade print for a symbol or index (e.g. VIX, VVIX)",
        parameters=[
            CapabilityParameter(name="symbol", type="string", description="Symbol or index"),
        ],
        returns="Trade events with price and epoch-millisecond time",
    ),
    # GC-AI-0019: what GaleCore already served and the harness could not ask for (probed on GaleCore Dev, 03/10).
    CapabilityDefinition(
        capability_id="market_data.option_chains",
        semantic_class=SemanticClass.PURE_QUERY,
        description="Option chain of an underlying: every expiration with its strikes and OCC symbols (~1 MB for SPY)",
        parameters=[CapabilityParameter(name="symbol", type="string", description="Underlying symbol")],
        returns="symbol, expirations[expirationDate, daysToExpiration, settlementType, strikes[strikePrice, call, put]]",
    ),
    CapabilityDefinition(
        capability_id="compute.iv_rank",
        semantic_class=SemanticClass.COMPUTE,
        description="IV rank and IV percentile of an underlying over GaleCore's stored daily IV history",
        parameters=[CapabilityParameter(name="symbol", type="string", description="Underlying symbol")],
        returns="currentIV, ivRank, ivPercentile, tradingDays, history[date, iv]",
    ),
    CapabilityDefinition(
        capability_id="compute.implied_volatility",
        semantic_class=SemanticClass.COMPUTE,
        description="IV term structure (IV30 at 0/5/9/30/90 days) and expected daily move of an underlying",
        parameters=[CapabilityParameter(name="symbol", type="string", description="Underlying symbol")],
        returns="spot, iV30_0d..iV30_90d, dailyMove, dailyMoveDollar",
    ),
    CapabilityDefinition(
        capability_id="market_data.volatility_metrics",
        semantic_class=SemanticClass.PURE_QUERY,
        description="Tastytrade market metrics: IV index and its changes, IV percentile, HV, beta, liquidity; next earnings (date, AMC/BMO, estimated or confirmed, EPS consensus), sector, P/E and last ex-dividend",
        parameters=[CapabilityParameter(name="symbol", type="string", description="One or more symbols, comma-separated")],
        returns="items[symbol, impliedVolatilityIndex, impliedVolatilityPercentile, earnings{expectedReportDate, timeOfDay, estimated, consensusEps}, sector, industry, dividendExDate, ...]",
    ),
    CapabilityDefinition(
        capability_id="market_data.earnings_history",
        semantic_class=SemanticClass.PURE_QUERY,
        description="Past earnings reports of a symbol (last 3 years): report date and reported EPS, most recent first",
        parameters=[CapabilityParameter(name="symbol", type="string", description="Underlying symbol")],
        returns="symbol, items[occurredDate, eps]",
    ),
    CapabilityDefinition(
        capability_id="market_data.candles",
        semantic_class=SemanticClass.PURE_QUERY,
        description="OHLCV candles of a symbol from a start time (interval e.g. 1d, 1h, 5m)",
        parameters=[
            CapabilityParameter(name="symbol", type="string", description="Underlying symbol"),
            CapabilityParameter(name="interval", type="string", description="Candle period: 1d, 1h, 5m, ..."),
            CapabilityParameter(name="fromTime", type="string", description="ISO 8601 start (UTC)"),
            CapabilityParameter(name="toTime", type="string", required=False, description="ISO 8601 end (UTC)"),
        ],
        returns="DXLink FEED_DATA: data[Candle with time, open, high, low, close, volume]",
    ),
    CapabilityDefinition(
        capability_id="market_data.option_greeks",
        semantic_class=SemanticClass.PURE_QUERY,
        description="Greeks of ONE option contract (OCC symbol, 21 chars, e.g. from market_data.option_chains)",
        parameters=[CapabilityParameter(name="symbol", type="string", description="OCC option symbol")],
        returns="DXLink Greeks event: price, volatility, delta, gamma, theta, rho, vega",
    ),
    # GC-0006 (GaleCore): calendario macro y del FOMC servidos por GaleCore, con procedencia (SourcedResponse).
    CapabilityDefinition(
        capability_id="calendar.macro_releases",
        semantic_class=SemanticClass.PURE_QUERY,
        description="Scheduled macro releases from FRED (NFP=50, CPI=10, PPI=46, GDP=53, income/spending=54, retail=9)",
        parameters=[
            CapabilityParameter(name="From", type="string", description="YYYY-MM-DD"),
            CapabilityParameter(name="To", type="string", description="YYYY-MM-DD, at most 180 days after From"),
            CapabilityParameter(name="ReleaseIds", type="string", required=False, description="Comma-separated ids"),
        ],
        returns="source, upstreamUrl, retrievedAt, notes, data[releaseId, releaseName, date]",
    ),
    CapabilityDefinition(
        capability_id="calendar.fomc_meetings",
        semantic_class=SemanticClass.PURE_QUERY,
        description="FOMC meetings from the Fed's public calendar (start, end, projections, scheduled)",
        parameters=[CapabilityParameter(name="Years", type="string", required=False, description="e.g. 2026,2027")],
        returns="source, upstreamUrl, retrievedAt, sha256, notes, data[year, start, end, projections, scheduled]",
    ),
    # WS-0014 (GaleCore): fuentes públicas servidas por GaleCore con la misma procedencia (SourcedResponse); una fuente
    # caída o que cambió de forma es 502, nunca una lista vacía.
    CapabilityDefinition(
        capability_id="history.index_daily",
        semantic_class=SemanticClass.PURE_QUERY,
        description="Official CBOE daily history of VIX (since 1990, OHLC), VVIX (since 2006) and SKEW (since 1990, close only)",
        parameters=[
            CapabilityParameter(name="Index", type="string", description="VIX, VVIX or SKEW"),
            CapabilityParameter(name="From", type="string", required=False, description="YYYY-MM-DD; default one year before To"),
            CapabilityParameter(name="To", type="string", required=False, description="YYYY-MM-DD; default today"),
        ],
        returns="source=cboe, upstreamUrl, asOf (last published day), sha256, notes, data[date, open, high, low, close]",
    ),
    CapabilityDefinition(
        capability_id="rates.treasury_curve",
        semantic_class=SemanticClass.PURE_QUERY,
        description="Official daily Treasury par yield curve, % by tenor (1M, 1.5M, 2M, 3M, 4M, 6M, 1Y ... 30Y)",
        parameters=[
            CapabilityParameter(name="From", type="string", required=False, description="YYYY-MM-DD; default 30 days before To"),
            CapabilityParameter(name="To", type="string", required=False, description="YYYY-MM-DD, at most today"),
        ],
        returns="source=treasury, asOf, sha256 per year, notes, data[date, rates{tenor: percent}]",
    ),
    CapabilityDefinition(
        capability_id="calendar.treasury_auctions",
        semantic_class=SemanticClass.PURE_QUERY,
        description="Announced upcoming Treasury auctions (bills, notes, bonds) from Fiscal Data",
        parameters=[],
        returns="source=treasury, asOf (record date), notes, data[securityType, securityTerm, auctionDate, issueDate, "
        "announcementDate, offeringAmount (USD, null until announced), cusip, reopening]",
    ),
    CapabilityDefinition(
        capability_id="macro.fred_series",
        semantic_class=SemanticClass.PURE_QUERY,
        description="Any FRED series with metadata and the vintage read (e.g. DGS10, DFII10, T10YIE, BAMLH0A0HYM2, CPIAUCSL)",
        parameters=[
            CapabilityParameter(name="SeriesId", type="string", description="FRED series id"),
            CapabilityParameter(name="From", type="string", required=False, description="YYYY-MM-DD; default one year before To"),
            CapabilityParameter(name="To", type="string", required=False, description="YYYY-MM-DD; default today"),
        ],
        returns="source=fred, upstreamUrl (no key), asOf (last observation with value), notes, data[id, title, units, "
        "frequency, seasonalAdjustment, lastUpdated, realtimeStart, realtimeEnd, observations[date, value|null]]",
    ),
    CapabilityDefinition(
        capability_id="macro.bls_series",
        semantic_class=SemanticClass.PURE_QUERY,
        description="Official BLS values (e.g. CPI CUUR0000SA0/CUSR0000SA0, unemployment LNS14000000, payrolls CES0000000001)",
        parameters=[
            CapabilityParameter(name="Ids", type="string", description="Comma-separated BLS series ids, up to 25"),
            CapabilityParameter(name="StartYear", type="string", required=False, description="default the year before EndYear"),
            CapabilityParameter(name="EndYear", type="string", required=False, description="default this year; at most 10 years"),
        ],
        returns="source=bls, asOf (year-period), notes, data[seriesId, observations[year, period, periodName, value, latest, footnotes]]",
    ),
    CapabilityDefinition(
        capability_id="filings.sec_company",
        semantic_class=SemanticClass.PURE_QUERY,
        description="SEC company by ticker: CIK and name",
        parameters=[CapabilityParameter(name="Ticker", type="string", description="e.g. AAPL")],
        returns="source=sec, data[cik, ticker, name]",
    ),
    CapabilityDefinition(
        capability_id="filings.sec_filings",
        semantic_class=SemanticClass.PURE_QUERY,
        description="Recent SEC filings of a company (8-K items: 2.02 = earnings release), with document URLs",
        parameters=[
            CapabilityParameter(name="Ticker", type="string", required=False, description="Ticker or Cik"),
            CapabilityParameter(name="Cik", type="string", required=False, description="Ticker or Cik"),
            CapabilityParameter(name="Forms", type="string", required=False, description="e.g. 8-K,10-Q,10-K; default all"),
            CapabilityParameter(name="Since", type="string", required=False, description="YYYY-MM-DD; default 90 days ago"),
        ],
        returns="source=sec, asOf, notes, data[cik, name, sic, tickers, filings[form, filingDate, reportDate, "
        "acceptanceDateTime, accessionNumber, url, items]]",
    ),
    CapabilityDefinition(
        capability_id="filings.sec_facts",
        semantic_class=SemanticClass.PURE_QUERY,
        description="Reported XBRL values of one concept for a company (e.g. Revenues, NetIncomeLoss, EarningsPerShareDiluted)",
        parameters=[
            CapabilityParameter(name="Ticker", type="string", required=False, description="Ticker or Cik"),
            CapabilityParameter(name="Cik", type="string", required=False, description="Ticker or Cik"),
            CapabilityParameter(name="Tag", type="string", description="XBRL concept"),
            CapabilityParameter(name="Taxonomy", type="string", required=False, description="default us-gaap"),
            CapabilityParameter(name="Since", type="string", required=False, description="period end from YYYY-MM-DD"),
        ],
        returns="source=sec, asOf (last filed), notes, data[cik, entityName, label, facts[unit, start, end, value, form, "
        "fiscalYear, fiscalPeriod, filed, frame, accession]]",
    ),
    # WS-0037: la cuenta real (Tastytrade, sólo lectura) y Macro, que el monitor ya muestra. Cuenta real ≠ SHADOW:
    # nunca se suman ni se cruzan sus decisiones (PRODUCT.md «Límites»).
    CapabilityDefinition(
        capability_id="account.overview",
        semantic_class=SemanticClass.PURE_QUERY,
        description="REAL account (Tastytrade, read-only) at a glance: value, cash, buying power, today's and open "
        "result, max risk against the limit, SPY-equivalent exposure, theta, vega and what needs attention today",
        parameters=[],
        returns="asOf, netLiq, cash, buyingPower, dayPnl, dayPnlPct, openPnl, maxRisk, maxRiskPct, maxRiskLimitPct, "
        "exposure (SPY delta x beta, theta, vega), attention[], positions[], missing[]",
    ),
    CapabilityDefinition(
        capability_id="account.balances",
        semantic_class=SemanticClass.PURE_QUERY,
        description="REAL account (Tastytrade, read-only) balances: cash, derivative values, margin equity, buying power",
        parameters=[],
        returns="accountNumber, cashBalance, longDerivativeValue, shortDerivativeValue, marginEquity, equityBuyingPower, …",
    ),
    CapabilityDefinition(
        capability_id="account.positions",
        semantic_class=SemanticClass.PURE_QUERY,
        description="REAL account (Tastytrade, read-only) open positions, leg by leg",
        parameters=[],
        returns="positions[symbol, instrumentType, underlyingSymbol, quantity, quantityDirection, closePrice, "
        "averageOpenPrice, expiresAt, …]",
    ),
    CapabilityDefinition(
        capability_id="account.spreads",
        semantic_class=SemanticClass.PURE_QUERY,
        description="REAL account (Tastytrade, read-only) positions grouped as spreads, with max loss, probability of "
        "profit and net greeks computed by GaleCore",
        parameters=[],
        returns="spreads[id, underlyingSymbol, expiration, structure, contracts, width, short/long put/call strikes, "
        "initialCredit, currentNetCredit, hasLiveQuote, maxProfit, maxLoss, pop, openPnl, dayPnl, greeks]",
    ),
    CapabilityDefinition(
        capability_id="macro.board",
        semantic_class=SemanticClass.PURE_QUERY,
        description="The Macro board of the monitor: futures strip (ES, NQ, gold, oil…), rates, breakevens, currencies "
        "and commodities with day/week/month changes (~140 KB: use --out)",
        parameters=[],
        returns="asOf, strip[id, name, symbol, unit, last, changeDay, changeWeek, changeMonth, asOf], sections[…]",
    ),
    CapabilityDefinition(
        capability_id="macro.catalog",
        semantic_class=SemanticClass.PURE_QUERY,
        description="What the Macro board covers: each series' definition, family, region, unit, source and frequency",
        parameters=[],
        returns="schemaVersion, methodologyVersion, seriesDefinitions[id, name, family, region, unit, source, frequency]",
    ),
]
