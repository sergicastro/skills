---
type: regex
pattern: '^(?![\s\S]*(?:recipe-site))|(?:CAST|GLOSSARY)\s*=\s*\{(?:(?!\n\})[\s\S])*?(?<=[{,\n][\t ]*)["''`]?(?:(?:acme/)?recipe-site)(?:\(\))?["''`]?\s*:'
flags: i
weight: 0.333
target:
  source: file
  path: out/page.content.js
---
