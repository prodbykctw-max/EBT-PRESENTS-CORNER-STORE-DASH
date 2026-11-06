#!/bin/bash
cd /home/claude/wt-shadow2
run() { echo "== $*"; node tools-shadow/shoot.mjs "$@" 2>&1 | tail -2 | cut -c1-700; }
run 5871 "qa&skipfoot" after drive
run 5871 "qa" after foot
run 5871 "qa&skipfoot&look=comic" after_comic check
run 5871 "qa&skipfoot" after_desk check desktop
run 5871 "qa&skipfoot&people=none" after_none check
node tools-shadow/bot.mjs 5871 2>&1 | tail -1 > tools-shadow/out/bot_after3.log
echo ALLDONE
