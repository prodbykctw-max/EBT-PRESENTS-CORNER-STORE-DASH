#!/bin/bash
# usage: run.sh snippet.js [which] [tag]   (@WHICH@ and @TAG@ in the snippet are replaced)
sed "s/@WHICH@/${2:-branch}/g; s/@TAG@/${3:-}/g" "$1" | curl -s -m 3000 -X POST localhost:5790/run --data-binary @-
