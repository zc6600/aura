#!/usr/bin/env python
import sys, json

args = json.loads(sys.stdin.read())
print(json.dumps({'success': True}))
