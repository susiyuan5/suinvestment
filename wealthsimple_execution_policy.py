"""Pure, local-only Wealthsimple manual execution feasibility checks."""
from __future__ import annotations
from datetime import datetime, timezone
import math

MINIMUM_FRACTIONAL_AMOUNT = 1.0

def _number(value):
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None

def _fresh(value, now=None, max_age_days=1):
    try:
        at = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        current = now or datetime.now(timezone.utc)
        if at.tzinfo is None: at = at.replace(tzinfo=timezone.utc)
        return 0 <= (current - at).total_seconds() / 86400 <= max_age_days
    except (TypeError, ValueError):
        return False

def execute(value, *, now=None):
    value = value or {}
    amount = max(0, round(_number(value.get("suggestedAmount")) or 0, 2))
    result = {"executable": False, "executionStatus": "本周不可执行", "executableAmount": 0, "retainedCash": amount, "requiredOrderType": "未知", "requiresFractionalOrder": False, "requiresCurrencyConversion": False, "estimatedFxFee": None, "reasonCodes": [], "warnings": []}
    if not amount: result["reasonCodes"].append("ZERO_SUGGESTION"); return result
    price = _number(value.get("price"))
    if price is None or price <= 0: result["executionStatus"] = "数据过期"; result["reasonCodes"].append("INVALID_PRICE"); return result
    if not _fresh(value.get("quoteTimestamp"), now=now, max_age_days=value.get("maxQuoteAgeDays", 1)): result["executionStatus"] = "数据过期"; result["reasonCodes"].append("STALE_QUOTE"); return result
    otc = str(value.get("marketType", "")).upper() == "OTC" or str(value.get("symbol", "")).upper() == "BYDDY"
    if not value.get("accountCurrency") or not value.get("tradingCurrency") or not value.get("accountType"): result["reasonCodes"].append("ACCOUNT_RULES_UNKNOWN"); return result
    if value["accountCurrency"] != value["tradingCurrency"]:
        result["requiresCurrencyConversion"] = True
        if _number(value.get("fxRate")) is None or not _fresh(value.get("fxAsOf"), now=now, max_age_days=value.get("fxMaxAgeDays", 3)): result["executionStatus"] = "数据过期"; result["reasonCodes"].append("FX_RATE_UNAVAILABLE_OR_STALE"); return result
        result["estimatedFxFee"] = round(amount * max(0, _number(value.get("fxFeeRate")) if _number(value.get("fxFeeRate")) is not None else .015), 2)
    if otc:
        result["requiredOrderType"] = "LIMIT"
        if value.get("accountType") != "NON_REGISTERED": result["executionStatus"] = "账户不支持"; result["reasonCodes"].append("OTC_REGISTERED_ACCOUNT"); return result
        if amount < price: result["reasonCodes"].append("OTC_AMOUNT_BELOW_ONE_SHARE"); return result
        result.update(executable=True, executionStatus="可以执行", executableAmount=amount, retainedCash=0); return result
    support = value.get("fractionalSupported")
    if support in (None, "unknown"):
        result["executionStatus"] = "需要确认碎股支持"; result["requiredOrderType"] = "MARKET"; result["reasonCodes"].append("FRACTIONAL_SUPPORT_UNKNOWN"); result["warnings"].append("需要在 Wealthsimple 确认碎股支持"); return result
    shares = math.floor(amount / price)
    if support is False:
        result["requiredOrderType"] = "MARKET"; result["executableAmount"] = round(shares * price, 2); result["retainedCash"] = round(amount - result["executableAmount"], 2)
        if not shares: result["reasonCodes"].append("NO_WHOLE_SHARE"); return result
        result.update(executable=True, executionStatus="可以执行"); return result
    result["requiredOrderType"] = "MARKET"; result["requiresFractionalOrder"] = shares == 0 or abs(amount - shares * price) > .005
    if result["requiresFractionalOrder"] and amount < max(0, _number(value.get("minimumFractionalAmount")) or MINIMUM_FRACTIONAL_AMOUNT): result["reasonCodes"].append("BELOW_FRACTIONAL_MINIMUM"); return result
    result.update(executable=True, executionStatus="可以执行", executableAmount=amount, retainedCash=0); return result
