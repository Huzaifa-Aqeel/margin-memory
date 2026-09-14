import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
export default defineConfig({resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))},conditions:['react-server']},ssr:{resolve:{conditions:['react-server','node'],externalConditions:['react-server','node']}},test:{include:['tests/**/*.test.ts'],testTimeout:30000,hookTimeout:60000}})
