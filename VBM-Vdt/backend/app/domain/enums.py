from enum import Enum


class DatasetType(str, Enum):
    REGION = "REGION"
    GLOBAL = "GLOBAL"


class TreeType(str, Enum):
    GENERAL_FCF = "GENERAL_FCF"
    REGIONAL_FCF = "REGIONAL_FCF"
    PRODUCTION = "PRODUCTION"
    COST = "COST"


class NodeType(str, Enum):
    GROUP = "GROUP"
    INPUT = "INPUT"
    CALCULATED = "CALCULATED"


class FavorableDirection(str, Enum):
    HIGHER_IS_BETTER = "HIGHER_IS_BETTER"
    LOWER_IS_BETTER = "LOWER_IS_BETTER"
    NEUTRAL = "NEUTRAL"


class ValueContext(str, Enum):
    ACTUALS = "ACTUALS"
    BUDGET = "BUDGET"
    LOBP = "LOBP"
    BENCHMARK = "BENCHMARK"


class ValueStatus(str, Enum):
    AVAILABLE = "AVAILABLE"
    MISSING = "MISSING"
    MISSING_DEPENDENCY = "MISSING_DEPENDENCY"
    NOT_INFORMED = "NOT_INFORMED"
    CALCULATION_ERROR = "CALCULATION_ERROR"


class ValueOrigin(str, Enum):
    INPUT = "INPUT"
    CALCULATED = "CALCULATED"


class MissingPolicy(str, Enum):
    ALLOW = "ALLOW"
    WARN = "WARN"
    BLOCK = "BLOCK"
