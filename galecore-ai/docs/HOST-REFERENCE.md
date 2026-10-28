# GaleCore-AI — referencia de uso desde el host

Detalle que antes estaba en `CLAUDE.md` (movido el 05/10/2026, F0-1). El mapa corto está en `CLAUDE.md`; el
catálogo (`cli catalog`) es la fuente de verdad de las capacidades y esta página es un resumen.

## Capacidades

Current capabilities: `gex_interpretation` (read-only GEX), `regime_interpretation` (daily regime
with an evaluable record), `research` (resumable investigation, below), `context_research` (context
of a trading idea with GaleCore + the host's external sources; every response kept as `evidence:`),
`strategy_design` (proposal with parameter table and management tree → `strategy check` against the runtime →
WS-0043: `simulated_amount_usd` in the proposal is the amount a strategy is simulated with, declared when its design closes (WS-0058: the profile holds no limits; each design also declares its own `limits`, percentages of that amount: `max_drawdown_pct` (its kill switch), per trade, open, reserve, bet, target and minimum return, edge sample); `strategy controls` lists it as missing and does not recommend approval without it, `strategy sheet` measures the limits on it, and `capital` splits each strategy with the amount of its latest approved version (a later draft does not move it; with no approved version it says so; `--amount` stays a what-if). `capital --real [--symbol S --width W --credit C --contracts N]`: the real Tastytrade account read without caps (value, open risk, positions as % of `netLiq`) and, with a candidate, its maximum loss; GaleCore's `missing` is kept, and unpaired legs or an unreported risk leave the open risk marked incomplete. Advisor only, nothing blocks.
`strategy save` → the critic's `strategy critique` → `strategy sheet` for the owner → owner's
`strategy approve` of the exact hash → `strategy deploy-check` → deploy to SHADOW in GaleCore Dev only),
`strategy_followup` (what a deployed version did, saved as a revision of its investigation),
`data_sources` (which source covers a need, its cost, limits and last checked access: `sources list|query|check|declare`),
`user_profile` (WS-0058: three things only — name, interests and memory items of title and one line — written by the user in the monitor and read in `space context`; no `profile` command), `daily_attention` (what deserves attention today about what is in SHADOW, saved as a
revision of one investigation per strategy), `capability_builder` (a new capability with the template:
catalog entry + skill, data needs from the source registry, controls) and `idea_inbox` (the owner's "anotá esto":
`inbox add --text "<words verbatim>"` into `knowledge/inbox/`, not evaluated then; reviewed later with `inbox list`
and `inbox resolve <id> --to roadmap|backlog:BL-NNN|work-item:<id>|done|discarded`). `strategy_project` (GC-AI-0026): "en la estrategia X" / "mi cartera" →
`project show strategy:<name>|portfolio` (versions, approval, rules, last follow-up, investigations, feedback, the
owner's log, what is missing) and `project add <name>|portfolio --kind thesis|story|decision|pending|done` (owner's
words, hash-chained in `knowledge/projects/`). Shared projects (WS-0064): `project share <folder> --with <user>` uploads the folder to GaleCore and adds the member, `project unshare <folder> --with <user>` (owner), `project shared` (mine and shared with me, with members), `project sync <folder>|--all` (pulls the others' changes, pushes mine; `--all` also creates the folders shared with me). The files stay on each PC; state in `<folder>/.sync.json` (outside git, never synced); both edited = both versions kept (`<name> (conflicto <user> <date>).<ext>`); files over 2 MB are skipped. The Lab runs `sync` by itself. `watch_alerts` (P1-01b): "avisame si SPY baja a 760" → `supervise watch --symbol SPY --below 760 --text "<words>" --prompt "<request>"` stores a rule in `knowledge/supervision/rules/`; the supervisor (code, every 5 minutes, regular session) reads the number from GaleCore and alerts once in the monitor. The host never watches; `supervise watches|unwatch <id>`. WS-0023: «revisalo el 23/10» / «reanudá cuando cierren» → `supervise remind --on <YYYY-MM-DD> | --when-closed <instance> --decision "<la decisión>" --text "<words>" --prompt "<request>"`: a reminder the supervisor checks and alerts once with the decision as context (never only a project `pending`). `state`: the state read now from GaleCore (entries, instances, open positions, structures the runtime executes; data health as connectivity, freshness and coverage, never one «OK»); a saved record is an antecedent. `strategy controls --ref <ref>`: each rule executed by the runtime, watched by the supervisor (an alert, never a block) or only declared, the indispensable controls and whether approval is recommended. `alert_analysis` (U-70): «analizá este aviso» → `supervise context <alert>` prints, by code and without a model, the context to read (the monitor's button opens Claude Code in its terminal with that request, P1-01c); `supervise analyze <alert> --prompt "<pedido>"` is the one-shot run of WS-0008: the code gathers the alert, the position, the strategy's exits and limit and today's numbers; the model (sonnet, no tools) describes, never advises; the result shows under the alert; `supervise analyses`. `performance_review` (P1-03): «¿cómo viene la estrategia?», «¿cuánto rinde contra mi objetivo?», «¿edge o suerte?», «¿qué aprendo de este cierre?», «resumime la semana» → `performance [--strategy <name>] [--since <YYYY-MM-DD>]`: GaleCore's `App/Runtime/Performance` (by strategy, version and exit rule; portfolio against the reference capital; each close against its rule's planned level) set against the numbers the strategy declares in its design (objective, minimum, edge sample, limits) and the decisions recorded for each close; each close gets a diagnosis `reglas|ejecucion|tesis|todavia_nada` with `observado` kept apart from `hipotesis`; `decisiones_a_revisar` lists decisions whose review date arrived. Nothing is stored. `catalog --check`
validates every entry (skill and contract load, flow commands exist, data needs resolve or say why not,
controls say what is not checked). The catalog is the source of truth; this list is a summary.

The user's comment on a stored result is kept with `feedback add` (`knowledge/feedback/<id>.json`, words
verbatim, tied to `research:<id>` + revision, skill and version taken from that revision, classified
`case | preference | method`) and applied where its kind belongs, citing `feedback:<id>`: a `research
revise` of that result, or a new skill version whose `history.yaml` cites it
(`catalog --check` requires a history entry for every skill's version in force). `feedback list` says
what is applied and what is pending. Method: `capability_builder` rules 9–13.

Entorno, códigos de salida y cómo probar: `CLAUDE.md`.

## Vertical 1: GEX-SPY analysis

Full guide with payload rules: `docs/LOCAL-VALIDATION-GEX-INTERACTIVE.md`.

```bash
python -B -m galecore_ai.adapters.cli prepare --symbol SPY                          # PreparedAnalysisView: run_id, facts, asset hashes; snapshot stored internally
echo '{"run_id": "<run_id>", "interpretation": <GexInterpretation JSON>, "host_provider": "claude-code", "host_model": "claude-opus-5"}'   | python -B -m galecore_ai.adapters.cli accept                                    # exit 0 = SUCCESS; non-zero = rejected (result null)
```

`GexInterpretation` in one line: `regime` = `positive_gamma` (net_gex > 0) or `negative_gamma` (net_gex < 0), never `near_zero` (always rejected: call/put GEX and net GEX use incompatible scales); `observations`/`implications` without digits; numbers only in `quantitative_claims` (`net_gex→billion_usd`; `spot`, `zero_gamma_level`, `call_wall`, `put_wall→usd`; value exactly equal to the fact); `evidence` paths must resolve (entailment is not checked); at least one limitation. Never invent, rescale or round numbers; never recommend trading actions; never add facts GaleCore did not provide. Present exactly the accepted payload; do not reformulate.

## Vertical 2: daily regime with an evaluable record

Full guide with payload rules and the record format: `docs/LOCAL-VALIDATION-REGIME-INTERACTIVE.md`.

```bash
python -B -m galecore_ai.adapters.cli prepare --symbol SPY --skill regime          # GEX + 25Δ put skew + VIX/VVIX; any missing/stale source fails closed
echo '{"run_id": "<run_id>", "interpretation": <RegimeInterpretation JSON>, "host_provider": "claude-code", "host_model": "claude-opus-5"}'   | python -B -m galecore_ai.adapters.cli accept --record --prompt "Analizá el régimen de hoy de SPY y guardalo"   # record written only on SUCCESS
python -B -m galecore_ai.adapters.cli record outcome --symbol SPY --date <YYYY-MM-DD> [--run-id <run_id>]      # later: facts now, GALECORE_VERIFIED
python -B -m galecore_ai.adapters.cli record review  --symbol SPY --date <YYYY-MM-DD> --run-id <run_id> --verdict agree|partial|disagree --comment "..."
python -B -m galecore_ai.adapters.cli query --symbol SPY --since <YYYY-MM-DD> [--until <YYYY-MM-DD>]           # no model call; INTEGRITY_FAILED is reported, never skipped
```

`RegimeInterpretation` in one line: `gamma_regime` by the sign of `net_gex`; `tail_pricing` = `calm`/`elevated` exactly as `facts.put_skew_level_ok`; prose without digits; numbers only in `quantitative_claims` with the fact's exact value and its unit (`billion_usd`, `usd`, `ratio`, `iv_decimal`, `index_points`); `evidence` paths must resolve; at least one limitation. Records: `<workspace>/knowledge/regime/<SYMBOL>/<YYYY-MM-DD>.md` (America/New_York date; moved from `GaleCore/research/regime/` by GC-AI-0005; `GALECORE_RECORDS_DIR` overrides), one file per day (YAML frontmatter = the record), entries appended, acceptance-time content covered by `entry_hash`. Never compare with earlier sessions from memory — only through `query`, stated in limitations. Present the accepted payload and the record path; do not reformulate.

## Capability 3: resumable investigation (`research`, GC-AI-0005)

No GaleCore needed. Method: `config/skills/research/SKILL.md`.

```bash
python -B -m galecore_ai.adapters.cli kb search --text "<idea>"          # antecedents; --status unfinished = open or test_planned
echo '{"content": <ResearchContent JSON>, "host_provider": "claude-code", "host_model": "<model>"}' | python -B -m galecore_ai.adapters.cli research save --slug <slug> --prompt "<user request>"
python -B -m galecore_ai.adapters.cli kb show research:<id>                 # pending next steps, missing, history, cited_by
echo '{...}' | python -B -m galecore_ai.adapters.cli research revise --id <id> --reason continuation|correction|result --note "<what changes>" --prompt "<user request>"
```

`ResearchContent` in one line: `title`, `question`, `status` (open | test_planned | concluded | abandoned);
`antecedents` `{ref, summary, bearing}` — each ref must resolve and `bearing` says how it changes the
hypothesis or plan; `statements` `{kind: fact|interpretation|hypothesis|decision, text, sources}` — a fact
cites a source; `hypothesis`; `test_plan` `{step, data_needed, supports_if, weakens_if}`; `missing`;
`next_steps` (required while open or test_planned); at least one limitation. Revisions are append-only
and hashed. Storing does not validate the reasoning; it is not a strategy.

## Capability 4: context of a trading idea (`context_research`, GC-AI-0007)

Method: `config/skills/context-research/SKILL.md` (factors by idea and horizon, sources by verified
access, observation / implied expectation / consensus / hypothesis, competing scenarios). Each source
response used is stored first, then cited; the investigation itself is `research` with the method stamped:

```bash
echo '{"content": <EvidenceContent JSON>, "host_provider": "...", "host_model": "..."}' | python -B -m galecore_ai.adapters.cli evidence add --slug <source-series> --prompt "<request>"
echo '{"content": <ResearchContent JSON>, ...}' | python -B -m galecore_ai.adapters.cli research save --capability context_research --slug <slug> --prompt "<request>"
python -B -m galecore_ai.adapters.cli kb search --text "<terms>" --kind evidence
```

Evidence (`<knowledge>/evidence/<id>.json`) is create-only, hashed and always `HOST_DECLARED`: GaleCore-AI
did not fetch it and never labels it GaleCore-verified. Params that may carry credentials are refused.

### What the assets prove and what they don't

- Asset hashes in the prepare output prove **which definitions were loaded**
- They do **not** prove the host read or obeyed them
- `HOST_DECLARED` provenance means the validator recorded what the host claimed but did not independently verify it
- `GALECORE_VERIFIED` means the facts came through controlled integration with GaleCore

## Cognitive assets

| Asset | Path | Purpose |
|---|---|---|
| GEX Skill | `config/skills/gex-analysis/skill.yaml` | Instructions, output contract, examples |
| Regime Skill | `config/skills/regime-analysis/skill.yaml` | Daily regime: GEX + put skew + VIX/VVIX, output contract, examples |
| Research Skill | `config/skills/research/SKILL.md` | Resumable investigation: antecedents, typed statements, test plan, next steps |
| Catalog | `config/catalog.yaml` | Every capability: request served, skill, contract, flow, storage, controls |
| Facts Discipline | `config/protocols/facts-discipline.yaml` | Guardrails: no invented numbers, facts match source, no trading recommendation, no numbers in prose, quantitative claims valid |
| Trading Defaults | `config/conventions/trading-defaults.yaml` | Near-zero threshold, timezone, currency |
