#!/bin/bash
export PATH="/mnt/c/Users/lucid/tools/node-v24.13.1-win-x64:$PATH"
cd backend && exec node_modules/.bin/vitest "$@"
