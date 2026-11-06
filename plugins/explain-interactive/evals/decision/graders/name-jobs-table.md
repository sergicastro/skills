---
type: regex
pattern: '^(?![\s\S]*(?:<code>jobs</code>|\bjobs\s+table))|(?:CAST|GLOSSARY)\s*=\s*\{(?:(?!\n\})[\s\S])*?(?<=[{,\n][\t ]*)["''`]?(?:jobs(?:\s+table)?)(?:\(\))?["''`]?\s*:'
flags: i
weight: 0.333
target:
  source: file
  path: out/page.content.js
---
