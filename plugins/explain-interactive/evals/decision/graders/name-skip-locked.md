---
type: regex
pattern: '^(?![\s\S]*(?:SKIP\s+LOCKED))|(?:CAST|GLOSSARY)\s*=\s*\{(?:(?!\n\})[\s\S])*?(?<=[{,\n][\t ]*)["''`]?(?:(?:SELECT\s+\S*\s*)?(?:FOR\s+UPDATE\s+)?SKIP\s+LOCKED)(?:\(\))?["''`]?\s*:'
flags: i
weight: 0.333
target:
  source: file
  path: out/page.content.js
---
