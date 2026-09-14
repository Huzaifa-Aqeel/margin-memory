// Next exposes URLPattern, which Node 22/TypeScript 5.9 do not declare globally.
// Use the real polyfill's constructor/input types. Options follow the URLPattern standard.
// This adds the missing platform API; it does not suppress declaration checking.
import 'urlpattern-polyfill'
declare global {
  type URLPatternInput = NonNullable<ConstructorParameters<typeof URLPattern>[0]>
  interface URLPatternOptions { ignoreCase?: boolean }
}
