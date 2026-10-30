import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// This build's version: the commit on Vercel, else the build time. The app compares it with /version.json
// (written next to the build) to notice that a newer version was released while it was open.
const APP_VERSION = process.env.VERCEL_GIT_COMMIT_SHA || `build-${Date.now()}`

function versionFile(): Plugin {
  return {
    name: 'renewaliq-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: APP_VERSION }) })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), versionFile()],
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
})
