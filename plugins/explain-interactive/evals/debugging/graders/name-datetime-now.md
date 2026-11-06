---
type: regex
pattern: '^(?![\s\S]*(?:datetime\.now))|(?:CAST|GLOSSARY)\s*=\s*\{(?:(?!\n\})[\s\S])*?(?<=[{,\n][\t ]*)["''`]?(?:datetime\.now)(?:\(\))?["''`]?\s*:'
flags: i
weight: 0.167
target:
  source: file
  path: out/page.content.js
---
