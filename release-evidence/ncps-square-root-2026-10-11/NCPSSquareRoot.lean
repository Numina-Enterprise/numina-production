import Mathlib.Analysis.Real.Sqrt

set_option autoImplicit false

/-!
NCPS square-root successor.

This bounded module records the real square-root identities used by the NCPS
formalization. It is separate from the retained 131-theorem Lean-core baseline
because these theorems require Mathlib.

The nonnegativity hypothesis is required only when simplifying `|x|` to `x`.
For arbitrary real input, squaring `Real.sqrt x` yields `max x 0`.
-/

namespace NCPS.SquareRoot

theorem sqrt_sq_eq_abs (x : ℝ) :
    Real.sqrt (x ^ 2) = |x| := by
  simpa using Real.sqrt_sq_eq_abs x

theorem sqrt_sq_of_nonneg (x : ℝ) (hx : 0 ≤ x) :
    Real.sqrt (x ^ 2) = x := by
  simpa using Real.sqrt_sq hx

theorem sq_sqrt_of_nonneg (x : ℝ) (hx : 0 ≤ x) :
    (Real.sqrt x) ^ 2 = x := by
  simpa using Real.sq_sqrt hx

theorem sq_sqrt_total (x : ℝ) :
    (Real.sqrt x) ^ 2 = max x 0 := by
  simpa using (Real.sq_sqrt' (x := x))

end NCPS.SquareRoot
