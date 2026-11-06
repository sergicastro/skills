---
type: regex
pattern: '^(?![\s\S]*(?:notes\.py))|(?:CAST|GLOSSARY)\s*=\s*\{(?:(?!\n\})[\s\S])*?(?<=[{,\n][\t ]*)["''`]?(?:(?:routes/)?notes\.py)(?:\(\))?["''`]?\s*:'
flags: i
weight: 0.1
target:
  source: file
  path: out/page.content.js
---
