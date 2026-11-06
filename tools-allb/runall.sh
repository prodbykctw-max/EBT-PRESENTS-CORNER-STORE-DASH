#!/bin/bash
# one headless browser at a time. 5871 = this branch, 5872 = origin/main (worktree /home/claude/wt-allb-main)
cd /home/claude/wt-allb
run() { echo "== $*"; node tools-allb/shoot.mjs "$@" 2>&1 | tail -2 | cut -c1-900; }
run 5872 "qa&skipfoot" before drive
run 5871 "qa&skipfoot" after drive
run 5872 "qa" before foot
run 5871 "qa" after foot
run 5872 "qa&skipfoot" before_desk drive desktop
run 5871 "qa&skipfoot" after_desk drive desktop
echo ALLDONE
