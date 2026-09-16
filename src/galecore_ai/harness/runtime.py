"""CognitiveRuntime — the orchestrator for agent runs.

Sequence:
  1. Preflight — validate skill, capabilities, agent permissions
  2. Context assembly — build system prompt, inject facts/conventions/protocols
  3. Model call — generate_structured via ModelProvider
  4. Guardrails — validate output against invariants
  5. Trace — record the run (inputs, outputs, timing, tokens)
  6. Return AgentRunResult

The runtime never calls GaleCore directly — it receives facts as input.
Capability dispatch happens outside the runtime (caller is responsible).
"""

from __future__ import annotations

import logging
import time
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from galecore_ai.application.validate_interpretation import validate_interpretation
from galecore_ai.capabilities.registry import CapabilityRegistry
from galecore_ai.contracts.agent_run import (
    AgentDefinitionTrace,
    AgentRunRequest,
    AgentRunResult,
    ConventionTrace,
    GuardrailTrace,
    ProtocolTrace,
    RunStatus,
    SkillTrace,
    TraceRecord,
)
from galecore_ai.harness.assets import definition_hash
from galecore_ai.harness.context_assembler import ContextAssembler
from galecore_ai.harness.convention_resolver import ConventionResolver
from galecore_ai.harness.guardrails import GuardrailRunner
from galecore_ai.harness.preflight import run_preflight
from galecore_ai.harness.protocol_loader import ProtocolLoader
from galecore_ai.harness.skill_loader import SkillLoader
from galecore_ai.models.gateway import ModelProvider
from galecore_ai.models.provider import ModelMessage, ModelRequest, ModelRole

if TYPE_CHECKING:
    from galecore_ai.harness.definitions import AgentDefinition

logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(tz=UTC)


class CognitiveRuntime:
    """Orchestrates a complete agent reasoning cycle.

    Wires together: preflight -> context -> model -> guardrails -> trace.
    """

    def __init__(
        self,
        *,
        provider: ModelProvider,
        skill_loader: SkillLoader,
        protocol_loader: ProtocolLoader,
        convention_resolver: ConventionResolver,
        capability_registry: CapabilityRegistry,
        guardrail_runner: GuardrailRunner | None = None,
        context_assembler: ContextAssembler | None = None,
    ) -> None:
        self._provider = provider
        self._skill_loader = skill_loader
        self._protocol_loader = protocol_loader
        self._conventions = convention_resolver
        self._registry = capability_registry
        self._guardrails = guardrail_runner or GuardrailRunner()
        self._assembler = context_assembler or ContextAssembler()

    async def execute(
        self,
        request: AgentRunRequest,
        *,
        agent_definition: AgentDefinition,
        facts: dict,
        output_schema: type,
    ) -> AgentRunResult:
        """Execute a complete cognitive run.

        Args:
            request: The run request (task_type, parameters).
            agent_definition: The agent to use.
            facts: Deterministic data from GaleCore (pre-fetched by caller).
            output_schema: Pydantic model class for structured output.
        """
        started_at = _utcnow()
        t0 = time.monotonic()
        trace = TraceRecord(
            provider=self._provider.provider_name,
            model=self._provider.model_id,
            agent_definition=AgentDefinitionTrace(
                agent_id=agent_definition.agent_id,
                version=agent_definition.version,
                content_hash=definition_hash(agent_definition),
            ),
            started_at=started_at,
            request_timestamp=request.requested_at,
        )

        # ── 1. Preflight ──────────────────────────────────────────
        skill_id = request.task_type
        preflight = run_preflight(
            agent=agent_definition,
            skill_id=skill_id,
            skill_loader=self._skill_loader,
            registry=self._registry,
        )

        if not preflight.passed:
            trace.completed_at = _utcnow()
            trace.latency_ms = int((time.monotonic() - t0) * 1000)
            trace.error = f"Preflight failed: {'; '.join(preflight.errors)}"
            trace.status = RunStatus.VALIDATION_ERROR.value
            return AgentRunResult(
                run_id=request.run_id,
                status=RunStatus.VALIDATION_ERROR,
                error_detail=trace.error,
                trace=trace,
            )

        skill = self._skill_loader.get(skill_id)
        trace.skills = [SkillTrace(
            skill_id=skill_id, version=skill.version, content_hash=definition_hash(skill),
        )]

        # ── 1b. Facts gate — empty facts must not reach the model ─
        if skill.required_capabilities and not facts:
            trace.completed_at = _utcnow()
            trace.latency_ms = int((time.monotonic() - t0) * 1000)
            trace.error = "Fail-closed: skill requires capabilities but facts are empty"
            trace.status = RunStatus.INSUFFICIENT_DATA.value
            return AgentRunResult(
                run_id=request.run_id,
                status=RunStatus.INSUFFICIENT_DATA,
                error_detail=trace.error,
                trace=trace,
            )

        # ── 2. Context Assembly ───────────────────────────────────
        protocols = self._protocol_loader.get_for_trigger(skill_id)
        trace.protocols = [
            ProtocolTrace(
                protocol_id=p.protocol_id, version=p.version, content_hash=definition_hash(p),
            )
            for p in protocols
        ]

        # Build convention traces
        for conv_set in self._conventions.all_sets():
            trace.conventions.append(
                ConventionTrace(
                    convention_id=conv_set.convention_id,
                    version=conv_set.version,
                    content_hash=definition_hash(conv_set),
                )
            )

        # Collect guardrail IDs from active protocols
        guardrail_ids: list[str] = []
        for proto in protocols:
            guardrail_ids.extend(proto.guardrails)

        user_message = request.parameters.get(
            "user_message",
            f"Analyze {request.parameters.get('symbol', 'the data')}",
        )

        context = self._assembler.assemble(
            agent=agent_definition,
            skill=skill,
            protocols=protocols,
            conventions=self._conventions,
            facts=facts,
            user_message=user_message,
        )

        # ── 3. Model Call ─────────────────────────────────────────
        model_request = ModelRequest(
            messages=[
                ModelMessage(role=ModelRole.SYSTEM, content=context.system_prompt),
                *context.messages,
            ],
            temperature=agent_definition.model_preferences.temperature,
            max_tokens=agent_definition.model_preferences.max_tokens,
            metadata=context.metadata,
        )

        try:
            model_result = await self._provider.generate_structured(
                model_request, output_schema,
            )
        except (OSError, ValueError, RuntimeError) as exc:
            trace.completed_at = _utcnow()
            trace.latency_ms = int((time.monotonic() - t0) * 1000)
            trace.error = f"Model error: {exc}"
            trace.status = RunStatus.MODEL_ERROR.value
            return AgentRunResult(
                run_id=request.run_id,
                status=RunStatus.MODEL_ERROR,
                error_detail=str(exc),
                trace=trace,
            )

        # Model was called successfully
        trace.validator_called_model = True

        # Record token usage
        trace.input_tokens = model_result.input_tokens
        trace.output_tokens = model_result.output_tokens

        if not model_result.ok:
            trace.completed_at = _utcnow()
            trace.latency_ms = int((time.monotonic() - t0) * 1000)
            trace.error = model_result.error
            trace.status = RunStatus.MODEL_ERROR.value
            return AgentRunResult(
                run_id=request.run_id,
                status=RunStatus.MODEL_ERROR,
                error_detail=model_result.error,
                trace=trace,
            )

        # ── 4. Guardrails ─────────────────────────────────────────
        validation = validate_interpretation(
            interpretation=model_result.value.model_dump(mode="json"),
            facts=facts,
            output_schema=output_schema,
            guardrail_ids=guardrail_ids,
            guardrail_runner=self._guardrails,
        )
        guardrail_results = validation.checks

        # Record guardrail traces
        trace.guardrails_executed = [
            GuardrailTrace(
                guardrail_id=g.guardrail_id,
                passed=g.passed,
                message=g.message,
            )
            for g in guardrail_results
        ]

        if not validation.accepted:
            detail = "; ".join(validation.errors)
            trace.completed_at = _utcnow()
            trace.latency_ms = int((time.monotonic() - t0) * 1000)
            trace.error = f"Guardrail failure: {detail}"
            trace.status = RunStatus.VALIDATION_ERROR.value
            # Fail-closed: guardrail failure -> result=null (rejected output never crosses boundary)
            return AgentRunResult(
                run_id=request.run_id,
                status=RunStatus.VALIDATION_ERROR,
                error_detail=f"Guardrail failure: {detail}",
                trace=trace,
                result=None,
            )

        # ── 5. Success ────────────────────────────────────────────
        trace.completed_at = _utcnow()
        trace.latency_ms = int((time.monotonic() - t0) * 1000)
        trace.status = RunStatus.SUCCESS.value

        return AgentRunResult(
            run_id=request.run_id,
            status=RunStatus.SUCCESS,
            result=validation.result,
            trace=trace,
        )
