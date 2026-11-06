---
type: regex
pattern: '^(?![\s\S]*(?:shop-api))|(?:CAST|GLOSSARY)\s*=\s*\{(?:(?!\n\})[\s\S])*?(?<=[{,\n][\t ]*)["''`]?(?:(?:acme/)?shop-api)(?:\(\))?["''`]?\s*:'
flags: i
weight: 0.2
target:
  source: file
  path: out/page.content.js
---
