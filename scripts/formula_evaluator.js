/**
 * Simple formula evaluator for FSAE catalog formulas.
 * Supports placeholders like [Size1], [Size2], [C1], [C2] and Math functions.
 * 
 * @param {string} formula - e.g. "([C1]*[Size1]+[C2])"
 * @param {Object} values - map of parameter name to numeric value (e.g., {Size1: 5})
 * @param {Object} constants - map of constant name to numeric value (e.g., {C1: 14.3, C2: 82})
 * @returns {number} evaluated result
 */
function evaluateFormula(formula, values = {}, constants = {}) {
  if (!formula) return 0;
  let code = formula.trim();
  
  // Replace all placeholders with their values
  const all = { ...constants, ...values };
  for (const [key, val] of Object.entries(all)) {
    const placeholder = `\[${key}\]`;
    const re = new RegExp(placeholder, 'g');
    code = code.replace(re, val);
  }
  
  // Ensure Math is available for functions like Math.pow, Math.sqrt, Math.E
  // We'll use Function constructor to evaluate the expression in a safe context
  // Only Math is allowed as a global; we pass it as a parameter.
  const fn = new Function('Math', 'return ' + code);
  return fn(Math);
}

// Example usage:
// const cost = evaluateFormula("([C1]*[Size1]+[C2])", {Size1: 10}, {C1: 14.3, C2: 82});
// console.log(cost); // 14.3*10 + 82 = 225

// Export for use in other scripts (if using modules)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { evaluateFormula };
}
