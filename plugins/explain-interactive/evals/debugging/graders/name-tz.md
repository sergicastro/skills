---
type: regex
pattern: '^(?![\s\S]*(?:\bTZ\b))|(?:CAST|GLOSSARY)\s*=\s*\{(?:(?!\n\})[\s\S])*?(?<=[{,\n][\t ]*)["''`]?(?:TZ(?:=UTC)?)(?:\(\))?["''`]?\s*:'
weight: 0.167
target:
  source: file
  path: out/page.content.js
---
