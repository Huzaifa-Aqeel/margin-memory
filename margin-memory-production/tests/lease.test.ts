import {it,expect} from 'vitest'
import {withLease} from '../src/lib/agent/lease'
it('heartbeats during execution and before commit',async()=>{let renewals=0;await withLease(async()=>{renewals++},async()=>{await new Promise(r=>setTimeout(r,25))},5);expect(renewals).toBeGreaterThanOrEqual(3)})
it('lease loss aborts the worker and prevents successful output',async()=>{let renewals=0;await expect(withLease(async()=>{if(++renewals>1)throw new Error('lease lost')},async(_heartbeat,signal)=>{await new Promise(r=>setTimeout(r,20));expect(signal.aborted).toBe(true);return 'invalid'},5)).rejects.toThrow('lease lost')})
