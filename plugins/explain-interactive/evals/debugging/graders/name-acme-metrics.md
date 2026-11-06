---
type: regex
pattern: '^(?![\s\S]*(?:acme/metrics))|(?:CAST|GLOSSARY)\s*=\s*\{(?:(?!\n\})[\s\S])*?(?<=[{,\n][\t ]*)["''`]?(?:(?:acme/)?metrics)(?:\(\))?["''`]?\s*:'
flags: i
weight: 0.167
target:
  source: file
  path: out/page.content.js
---
