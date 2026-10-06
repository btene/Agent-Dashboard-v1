#!/usr/bin/env python3
"""Example agent for the "Local command / script" runner.

Add an agent with command `python3 examples/command-agent.py` (and start the
server with ALLOW_COMMAND_RUNNER=true). The input arrives on stdin; whatever
you print is the output. An optional final `##usage {...}` line feeds analytics.
"""
import json
import sys

text = sys.stdin.read()
print(f"Reversed input: {text[::-1]}")
print("##usage " + json.dumps({"tokensIn": len(text.split()), "tokensOut": len(text.split()), "costUsd": 0}))
