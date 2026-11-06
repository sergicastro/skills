---
type: regex
pattern: 'type\s*:\s*\W(decision|before-after|debugging|concept)\W'
match: not_contains
target:
  source: file
  path: out/page.content.js
---
