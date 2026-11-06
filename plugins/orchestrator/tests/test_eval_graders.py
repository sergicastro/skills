"""Checks the regex graders of the m8-two-messages eval case against a saved reply.

The fixture is a real reply from an eval run (paths scrubbed) that the old `llm` judge failed
3-0 although it answers both REQUESTs. Each grader must pass on it and fail once the steps for
its worker are removed.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GRADERS = ROOT / "evals" / "m8-two-messages" / "graders"
REPLY = Path(__file__).resolve().parent / "fixtures" / "evals" / "m8-two-messages-reply.md"


def pattern(name):
    text = (GRADERS / name).read_text()
    m = re.search(r"^pattern: '(.*)'$", text, re.M)
    if not m:
        raise AssertionError(f"no pattern in {name}")
    # YAML single-quoted scalar: '' is an escaped quote.
    return re.compile(m.group(1).replace("''", "'"))


def without_steps(reply, first, last):
    """Drop the numbered steps first..last (e.g. a worker's Bash and SendMessage)."""
    start = reply.index(f"**{first}. ")
    nxt = f"**{last + 1}. "
    end = reply.index(nxt) if nxt in reply else reply.index("## What I'd tell the user")
    return reply[:start] + reply[end:]


class M8Graders(unittest.TestCase):
    def setUp(self):
        self.reply = REPLY.read_text()
        self.b = pattern("demo-w-b-answered.md")
        self.c = pattern("demo-w-c-answered.md")

    def test_only_regex_graders_score_the_case(self):
        names = sorted(p.name for p in GRADERS.glob("*.md"))
        self.assertEqual(names, ["demo-w-b-answered.md", "demo-w-c-answered.md", "skill-loaded.md"])

    def test_good_reply_passes_both(self):
        self.assertTrue(self.b.search(self.reply))
        self.assertTrue(self.c.search(self.reply))

    def test_dropped_second_request_fails_c(self):
        reply = without_steps(self.reply, 3, 4)
        self.assertTrue(self.b.search(reply))
        self.assertFalse(self.c.search(reply))

    def test_request_without_reply_fails_c(self):
        reply = without_steps(self.reply, 4, 4)
        self.assertFalse(self.c.search(reply))

    def test_dropped_first_request_fails_b(self):
        reply = without_steps(self.reply, 1, 2)
        self.assertFalse(self.b.search(reply))
        self.assertTrue(self.c.search(reply))


if __name__ == "__main__":
    unittest.main()
