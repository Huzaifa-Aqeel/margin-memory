import {execFileSync} from 'node:child_process'
execFileSync('npm',['exec','vitest','run','tests/database.test.ts'],{stdio:'inherit'})
