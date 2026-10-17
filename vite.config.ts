import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// DEMO BRANCH ONLY (demo/commissions-sample) — never merge into a branch production is built from.
// Every build of this branch is the Commissions demo: the Supabase settings are blanked here, so the
// app has no database connection at all and runs in its existing local-only mode, on fictional data.
// Variables already in the environment take priority over .env files, so empty values here win.
if (process.env.VERCEL_ENV === 'production') {
  throw new Error('The Commissions demo branch must never be built for Production. Nothing was built.')
}
process.env.VITE_SUPABASE_URL = ''
process.env.VITE_SUPABASE_ANON_KEY = ''
process.env.VITE_FEATURE_COMMISSIONS = 'true'
process.env.VITE_COMMISSIONS_DEMO = 'true'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
})
