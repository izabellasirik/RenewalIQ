# Renewal IQ

AI workflow platform for commercial insurance brokers — Phase 1 MVP vertical slice.

Two connected modules share one normalized risk profile:

1. **AI Submission Assistant** — drag-and-drop document upload, simulated extraction into a unified editable risk profile with per-field confidence and source, conflict/missing-field detection, and a pre-filled sample commercial application.
2. **Carrier Appetite Intelligence** — matches the risk profile against a seed set of direct carriers and MGAs, with per-criterion reasoning, "available through" relationships, and appetite freshness warnings.

## Stack

React + TypeScript + Vite, Tailwind CSS v4, React Router, Zustand (persisted to `localStorage`).

## Running locally

```bash
npm install
npm run dev      # start dev server
npm run build    # type-check + production build
```

## Architecture

- `src/types/` — shared data model (`RiskProfile`, `AppetiteRecord`, `MatchResult`, etc.). Every extracted value is wrapped in a `FieldValue<T>` carrying confidence, source, and conflict metadata.
- `src/services/extraction/` — document extraction abstraction. `mockExtractionProvider` returns canned results today; a real LLM/OCR provider can implement the same `ExtractionProvider` interface later without touching UI code.
- `src/services/appetite/` — deterministic rules engine that matches a risk profile against appetite records and explains every match/rejection.
- `src/services/application/` — maps a risk profile onto a sample commercial application layout.
- `src/data/` — seed data: one sample transportation account with four sample documents, and 8 sample carrier/MGA appetite records.
- `src/state/useAccountsStore.ts` — app state (accounts, documents, risk profiles, match results).
- `src/components/`, `src/pages/` — UI, organized by feature area.

## Try it

From the Dashboard, click **Try Sample Account** (or **New Submission** → **Use sample account**), then **Load sample submission documents** on the Upload page to see the full flow: extraction → risk profile review → submission assistant → carrier appetite matching.
