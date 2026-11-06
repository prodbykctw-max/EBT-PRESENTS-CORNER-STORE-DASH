#!/bin/bash
# start/stop my servers: hp.sh up|down
cd /home/claude/wt-ref2 && (PORT=5731 nohup node scripts/serve.mjs 5731 >/dev/null 2>&1 &)
cd /home/claude/wt-ref2-main && (PORT=5732 nohup node scripts/serve.mjs 5732 >/dev/null 2>&1 &)
cd /home/claude/wt-ref2/tools-ref2 && (nohup node repl.mjs >/tmp/repl.log 2>&1 &)
