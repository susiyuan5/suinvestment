"""Cycle adapter with an explicit not-applicable path."""

def analyze(payload: dict) -> dict:
    if not isinstance(payload, dict):
        return {"available": False, "not_applicable": False}
    return {"available": True, "not_applicable": bool(payload.get("not_applicable")), "stage_probabilities": payload.get("stage_probabilities", {}), "max_adjustment_points": 10}
