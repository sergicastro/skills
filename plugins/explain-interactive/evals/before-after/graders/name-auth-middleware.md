---
type: regex
pattern: '^(?![\s\S]*(?:AuthMiddleware))|(?:CAST|GLOSSARY)\s*=\s*\{(?:(?!\n\})[\s\S])*?(?<=[{,\n][\t ]*)["''`]?(?:AuthMiddleware)(?:\(\))?["''`]?\s*:'
flags: i
weight: 0.1
target:
  source: file
  path: out/page.content.js
---
