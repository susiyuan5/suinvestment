"""Candidate recall adapter; it deliberately contributes no final score."""

def screen(payload: dict) -> dict:
    return {"available": isinstance(payload, dict), "candidates": payload.get("candidates", []) if isinstance(payload, dict) else [], "contributes_to_score": False}
