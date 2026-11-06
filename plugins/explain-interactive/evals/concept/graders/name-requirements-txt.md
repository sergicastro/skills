---
type: regex
pattern: '^(?![\s\S]*(?:requirements\.txt))|(?:CAST|GLOSSARY)\s*=\s*\{(?:(?!\n\})[\s\S])*?(?<=[{,\n][\t ]*)["''`]?(?:requirements\.txt)(?:\(\))?["''`]?\s*:'
flags: i
weight: 0.143
target:
  source: file
  path: out/page.content.js
---
