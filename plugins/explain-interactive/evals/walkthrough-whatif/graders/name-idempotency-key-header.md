---
type: regex
pattern: '^(?![\s\S]*(?:Idempotency[-\s]Key(?!s)))|(?:CAST|GLOSSARY)\s*=\s*\{(?:(?!\n\})[\s\S])*?(?<=[{,\n][\t ]*)["''`]?(?:Idempotency[-\s]Key)(?:\(\))?["''`]?\s*:'
flags: i
weight: 0.2
target:
  source: file
  path: out/page.content.js
---
