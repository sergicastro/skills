---
type: regex
pattern: 'type\s*:\s*\Wdecision\W'
match: contains
target:
  source: file
  path: out/page.content.js
---
