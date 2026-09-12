import { describe, it, expect } from 'vitest'
import { safeLocalRedirect } from '../src/lib/auth/redirect'
describe('local redirect boundary',()=>{
  it.each(['/dashboard','/estimates/abc?tab=preflight'])('allows %s',path=>expect(safeLocalRedirect(path)).toBe(path))
  it.each(['//evil.com','///evil.com','https://evil.com','http://evil.com','/%2fevil.com','/%252fevil.com','/%5cevil.com','/\\evil.com','/bad%','/\nevil.com','javascript:alert(1)',null,{},''])('rejects %s',path=>expect(safeLocalRedirect(path)).toBe('/'))
})
