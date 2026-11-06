---
type: regex
pattern: '^(?![\s\S]*(?:create_payment))|(?:CAST|GLOSSARY)\s*=\s*\{(?:(?!\n\})[\s\S])*?(?<=[{,\n][\t ]*)["''`]?(?:create_payment)(?:\(\))?["''`]?\s*:'
flags: i
weight: 0.2
target:
  source: file
  path: out/page.content.js
---
