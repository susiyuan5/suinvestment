from dataclasses import dataclass, field


@dataclass(frozen=True)
class StrategyConfig:
    base_buy_amount: float = 100.0
    sensitivity: float = 5.0
    min_multiplier: float = 0.3
    max_multiplier: float = 2.0
    initial_cash: float = 10000.0
    commission_rate: float = 0.001
    slippage_rate: float = 0.0005
    strategy_mode: str = "dip_buy"
    fractional_shares: bool = True


@dataclass(frozen=True)
class RiskConfig:
    max_single_buy_pct_cash: float = 0.30
    drawdown_threshold: float = 0.30
    drawdown_action: str = "reduce"
    drawdown_reduce_multiplier: float = 0.50
    consecutive_decline_weeks: int = 4


@dataclass(frozen=True)
class BacktestConfig:
    strategy: StrategyConfig = field(default_factory=StrategyConfig)
    risk: RiskConfig = field(default_factory=RiskConfig)
    results_dir: str = "results"
