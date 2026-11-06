---
type: regex
pattern: '^(?![\s\S]*(?:sys\.prefix))|(?:CAST|GLOSSARY)\s*=\s*\{(?:(?!\n\})[\s\S])*?(?<=[{,\n][\t ]*)["''`]?(?:sys\.prefix)(?:\(\))?["''`]?\s*:'
flags: i
weight: 0.143
target:
  source: file
  path: out/page.content.js
---
