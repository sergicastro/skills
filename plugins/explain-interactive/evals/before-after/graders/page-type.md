---
type: regex
pattern: 'type\s*:\s*\Wbefore-after\W'
match: contains
target:
  source: file
  path: out/page.content.js
---
