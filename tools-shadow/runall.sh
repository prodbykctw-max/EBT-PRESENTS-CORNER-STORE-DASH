#!/bin/bash
cd /home/claude/wt-shadow2
run() { echo "== $*"; node tools-shadow/shoot.mjs "$@" 2>&1 | tail -2 | cut -c1-1500; }
run 5872 "qa&skipfoot" before drive
run 5871 "qa&skipfoot" after drive
run 5872 "qa" before foot
run 5871 "qa" after foot
echo ALLDONE
