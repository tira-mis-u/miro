// Palette symbol definitions are kept separate from the React component for stable hot refresh.
export const SYMBOL_GROUPS: Record<string, [string, string, string?][]> = {
  'GREEK LOWERCASE': [
    ['α', 'alpha', '\\alpha '], ['β', 'beta', '\\beta '], ['γ', 'gamma', '\\gamma '], ['δ', 'delta', '\\delta '],
    ['ε', 'epsilon', '\\epsilon '], ['ϵ', 'varepsilon', '\\varepsilon '], ['ζ', 'zeta', '\\zeta '], ['η', 'eta', '\\eta '],
    ['θ', 'theta', '\\theta '], ['ϑ', 'vartheta', '\\vartheta '], ['ι', 'iota', '\\iota '], ['κ', 'kappa', '\\kappa '],
    ['ϰ', 'varkappa', '\\varkappa '], ['λ', 'lambda', '\\lambda '], ['μ', 'mu', '\\mu '], ['ν', 'nu', '\\nu '],
    ['ξ', 'xi', '\\xi '], ['ο', 'omicron', 'ο'], ['π', 'pi', '\\pi '], ['ϖ', 'varpi', '\\varpi '],
    ['ρ', 'rho', '\\rho '], ['ϱ', 'varrho', '\\varrho '], ['σ', 'sigma', '\\sigma '], ['ς', 'varsigma', '\\varsigma '],
    ['τ', 'tau', '\\tau '], ['υ', 'upsilon', '\\upsilon '], ['φ', 'phi', '\\phi '], ['ϕ', 'varphi', '\\varphi '],
    ['χ', 'chi', '\\chi '], ['ψ', 'psi', '\\psi '], ['ω', 'omega', '\\omega '], ['ϝ', 'digamma', '\\digamma '],
  ],
  'GREEK UPPERCASE': [
    ['Γ', 'Gamma', '\\Gamma '], ['Δ', 'Delta', '\\Delta '], ['Θ', 'Theta', '\\Theta '], ['Λ', 'Lambda', '\\Lambda '],
    ['Ξ', 'Xi', '\\Xi '], ['Π', 'Pi', '\\Pi '], ['Σ', 'Sigma', '\\Sigma '], ['Υ', 'Upsilon', '\\Upsilon '],
    ['Φ', 'Phi', '\\Phi '], ['Ψ', 'Psi', '\\Psi '], ['Ω', 'Omega', '\\Omega '],
  ],
  OPERATORS: [
    ['∑', 'sum', '\\sum'], ['∫', 'integral symbol', '\\int'], ['∂', 'partial', '\\partial '], ['∞', 'infinity', '\\infty '],
    ['≠', 'not equal', '\\neq '], ['≈', 'approximately equal', '\\approx '], ['≃', 'similarity relation', '\\simeq '], ['≤', 'less than or equal', '\\le '], ['≥', 'greater than or equal', '\\ge '],
    ['±', 'plus-minus', '\\pm '], ['×', 'times', '\\times '], ['÷', 'divide', '\\div '], ['·', 'dot', '\\cdot '], ['∓', 'minus-plus', '\\mp '],
    ['∀', 'for all', '\\forall '], ['∃', 'exists', '\\exists '], ['∇', 'nabla', '\\nabla '], ['∝', 'proportional to', '\\propto '], ['≡', 'equivalent', '\\equiv '],
    ['∴', 'therefore', '\\therefore '], ['∵', 'because', '\\because '],
  ],
  ARROWS: [
    ['→', 'right arrow', '\\to '], ['←', 'left arrow', '\\leftarrow '], ['↔', 'left-right arrow', '\\leftrightarrow '], ['⇒', 'implies', '\\Rightarrow '],
    ['⇐', 'implied by', '\\Leftarrow '], ['⇔', 'if and only if', '\\Leftrightarrow '], ['↑', 'up arrow', '\\uparrow '], ['↓', 'down arrow', '\\downarrow '],
  ],
  SETS: [
    ['∈', 'element of', '\\in '], ['∉', 'not an element of', '\\notin '], ['⊂', 'subset', '\\subset '], ['⊃', 'superset', '\\supset '],
    ['∪', 'union', '\\cup '], ['∩', 'intersection', '\\cap '], ['∅', 'empty set', '\\emptyset '],
  ],
};
