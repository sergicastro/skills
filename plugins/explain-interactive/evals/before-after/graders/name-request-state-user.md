---
type: regex
pattern: '^(?![\s\S]*(?:request\.state\.user))|(?:CAST|GLOSSARY)\s*=\s*\{(?:(?!\n\})[\s\S])*?(?<=[{,\n][\t ]*)["''`]?(?:request\.state(?:\.user)?)(?:\(\))?["''`]?\s*:'
flags: i
weight: 0.1
target:
  source: file
  path: out/page.content.js
---
