/** Accept only paths that remain local through URL decoding and browser normalization. */
export function safeLocalRedirect(input: unknown): string {
  if (typeof input !== 'string' || !input.startsWith('/') || input.startsWith('//')) return '/'
  try {
    let decoded = input
    for (let i = 0; i < 8; i++) {
      if (/\\|[\u0000-\u0020\u007f]/.test(decoded) || !decoded.startsWith('/') || decoded.startsWith('//')) return '/'
      const url = new URL(decoded, 'https://local.invalid')
      if (url.origin !== 'https://local.invalid') return '/'
      const next = decodeURIComponent(decoded)
      if (next === decoded) return input
      decoded = next
    }
  } catch { return '/' }
  return '/'
}
