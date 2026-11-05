---
type: regex
pattern: 'type\s*:\s*\Wdebugging\W'
match: contains
target:
  source: file
  path: out/page.content.js
---
