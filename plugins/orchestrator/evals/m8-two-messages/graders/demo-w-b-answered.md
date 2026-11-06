---
# demo-w-b's REQUEST gets its own `request` call, then a SendMessage to demo-w-b carrying an ASSIGN or NONE_READY
type: regex
pattern: 'request\s+demo\s+demo-w-b\b[\s\S]*?SendMessage[\s\S]{0,80}?\bdemo-w-b\b[\s\S]*?\[orch v1 (?:ASSIGN|NONE_READY)\]'
target: last_message
---
