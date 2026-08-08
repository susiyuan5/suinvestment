"""Octagon adapter.

No remote API is assumed. Only manually supplied, validated JSON is accepted
until a real tool name, schema, authentication flow, and rate limit are audited.
"""

from ..contracts import validate_evidence

def import_manual(payload: dict) -> dict:
    if not isinstance(payload, dict) or not isinstance(payload.get("evidence"), list):
        return {"available": False, "reason": "manual_evidence_json_required", "evidence": []}
    for item in payload["evidence"]:
        validate_evidence(item)
    return {"available": True, "evidence": payload["evidence"], "produces_trade_conclusion": False}
