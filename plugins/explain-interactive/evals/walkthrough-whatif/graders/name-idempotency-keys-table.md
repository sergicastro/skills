---
type: regex
pattern: '^(?![\s\S]*(?:idempotency_keys))|(?:CAST|GLOSSARY)\s*=\s*\{(?:(?!\n\})[\s\S])*?(?<=[{,\n][\t ]*)["''`]?(?:idempotency_keys)(?:\(\))?["''`]?\s*:'
flags: i
weight: 0.2
target:
  source: file
  path: out/page.content.js
---
