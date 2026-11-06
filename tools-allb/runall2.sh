#!/bin/bash
# the checks (one headless browser at a time)
cd /home/claude/wt-allb
O=/home/claude/wt-allb/tools-allb/out
node tools-allb/shoot.mjs 5871 "qa" after foot 2>&1 | tail -1 | cut -c1-100
node tools-allb/motion.mjs 5872 "qa&skipfoot" > $O/motion_before.json 2>&1
node tools-allb/motion.mjs 5871 "qa&skipfoot" > $O/motion_after.json 2>&1
node tools-allb/motion.mjs 5871 "qa&skipfoot&people=AB" > $O/motion_after_AB.json 2>&1
node tools-allb/motion.mjs 5871 "qa&skipfoot&people=A" > $O/motion_after_A.json 2>&1
node tools-allb/motion.mjs 5871 "qa&skipfoot&people=none" > $O/motion_after_none.json 2>&1
node tools-allb/shoot.mjs 5871 "qa&skipfoot&look=comic" after_comic check 2>&1 | tail -1 | cut -c1-100
node tools-allb/bot.mjs 5871 > $O/bot_after.log 2>&1
node tools-allb/bot.mjs 5872 > $O/bot_before.log 2>&1
echo ALLDONE2
