class FormulaError(Exception):
    """Base class for structural formula problems. These are import-blocking
    and must never become a published node-value state."""


class FormulaSyntaxError(FormulaError):
    pass


class UnknownFunctionError(FormulaError):
    pass


class InvalidReferenceError(FormulaError):
    pass


class DependencyCycleError(FormulaError):
    def __init__(self, cycle: list[str]):
        self.cycle = cycle
        super().__init__("Dependency cycle: " + " -> ".join(cycle))
