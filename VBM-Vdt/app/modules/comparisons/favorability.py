from dataclasses import dataclass
from decimal import Decimal
from enum import Enum
from typing import Optional

from app.domain.enums import FavorableDirection, ValueStatus


class Favorability(str, Enum):
    FAVORABLE = "FAVORABLE"
    UNFAVORABLE = "UNFAVORABLE"
    NEUTRAL = "NEUTRAL"


@dataclass
class ComparisonOutcome:
    delta: Optional[Decimal]
    percent_delta: Optional[Decimal]
    favorability: Favorability


def compare_values(
    baseline_status: ValueStatus,
    baseline_value: Optional[Decimal],
    comparator_status: ValueStatus,
    comparator_value: Optional[Decimal],
    direction: Optional[FavorableDirection],
    *,
    comparator_is_target: bool = False,
) -> ComparisonOutcome:
    if baseline_status is not ValueStatus.AVAILABLE or comparator_status is not ValueStatus.AVAILABLE:
        return ComparisonOutcome(None, None, Favorability.NEUTRAL)

    if comparator_is_target:
        # The comparator is a goal/target and the baseline is the actual
        # result - used only by the Baseline x Target comparison, never by
        # Simulation. "Favorable" means the actual result is on the good
        # side of the target, and percent is relative to the target,
        # matching the usual "variance from target" reading.
        delta = baseline_value - comparator_value
        percent_delta = (delta / abs(comparator_value) * 100) if comparator_value != 0 else None
    else:
        delta = comparator_value - baseline_value
        percent_delta = (delta / abs(baseline_value) * 100) if baseline_value != 0 else None

    if delta == 0 or direction is None or direction is FavorableDirection.NEUTRAL:
        favorability = Favorability.NEUTRAL
    elif direction is FavorableDirection.HIGHER_IS_BETTER:
        favorability = Favorability.FAVORABLE if delta > 0 else Favorability.UNFAVORABLE
    else:  # LOWER_IS_BETTER
        favorability = Favorability.FAVORABLE if delta < 0 else Favorability.UNFAVORABLE

    return ComparisonOutcome(delta, percent_delta, favorability)
