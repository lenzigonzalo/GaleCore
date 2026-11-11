"""A strategy that does not enter for days because of the same cause (WS-0098, increment 5).

The calculation lives in one place, GaleCore's API (``GET /App/Runtime/Strategies/{name}/Card`` → ``stall``: days in a row
without entering, cause and the engine's own sentence), which the strategy's sheet shows as it is. The supervisor only reads it
and raises one ``stalled`` alert per streak once it reaches ``MIN_DAYS``. No model, no recount.
"""

from __future__ import annotations

MIN_DAYS = 3                      # owner-approved (Opus review, 10/11)


def drafts_for(instances: list[dict], read, min_days: int = MIN_DAYS) -> tuple[list[dict], list[str]]:
    """(alert drafts, problems) for the running SHADOW strategies. One unread strategy is reported, the rest still run."""
    drafts, problems, seen = [], [], set()
    for inst in instances:
        name = inst.get("specName", "")
        if inst.get("mode") != "SHADOW" or inst.get("lifecycleState") != "RUNNING" or name in seen:
            continue
        seen.add(name)
        try:
            card = read(f"/App/Runtime/Strategies/{name}/Card")
            if not isinstance(card, dict):
                raise TypeError("ficha sin forma de objeto")
        except Exception as exc:  # noqa: BLE001
            problems.append(f"{name}: ficha no leída ({str(exc)[:120]})")
            continue
        stall = card.get("stall")
        if not isinstance(stall, dict) or not isinstance(stall.get("days"), int) or stall["days"] < min_days:
            continue
        iid = inst.get("instanceId", "")
        drafts.append({
            "key": f"stalled:{iid}:{stall.get('cause')}:{stall.get('since')}", "kind": "stalled", "strategy": name,
            "strategy_ref": None, "instance_id": iid, "position_id": f"{stall.get('cause')}@{stall.get('since')}",
            "motivo": f"{stall.get('text')} (desde el {stall.get('since')}): {stall.get('reason')}",
            "dato": {"dias": stall["days"], "desde": str(stall.get("since")), "causa": str(stall.get("cause")),
                     "motivo_del_motor": str(stall.get("reason"))},
            "regla": f"aviso a los {min_days} días hábiles seguidos sin entrar por la misma causa (dato de la API)",
            "propuesta": "Revisá si el límite o la regla que la frena es lo que querías: así no va a operar."})
    return drafts, problems
