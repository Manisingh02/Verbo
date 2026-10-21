# Verbo Project Status

Last updated: 2026-02-05

## What’s Implemented
- Firebase config is wired via `.env` with project `verbo-f4503`.
- Auth uses Firebase client SDK (login + signup screens already exist).
- Cloud Functions scaffold exists under `functions/`:
  - Express app exported as `api`
  - Endpoints: `GET /health`, `GET /flashcards`, `GET /review-queue`
  - Auth guard verifies Firebase ID token
- Client API wrapper in `src/core/api/index.ts` calls Functions.
- Flashcards + Review screens:
  - Try Functions first
  - Fall back to mock data with banner on empty/error

## What’s NOT Implemented Yet
- Cloud Functions logic for Firestore reads/writes.
- Firestore security rules and indexes.
- CSV upload script for curated vocab/quiz data.
- Quiz wired to backend (still mock).

## Key Files
- App entry: `App.tsx`
- Firebase config: `src/core/config/firebase.ts`
- Functions client: `src/core/api/index.ts`
- Flashcards UI: `src/screens/learning/FlashcardsScreen.tsx`
- Review UI: `src/screens/review/ReviewQueueScreen.tsx`
- Functions source: `functions/src/index.ts`
- Firestore schema: `FIRESTORE SCHEMA.md` (authoritative)
- PRD: `VERBO PRD 1.0.md` (product/flow reference)

## Environment Variables (in .env)
- EXPO_PUBLIC_FIREBASE_API_KEY
- EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN
- EXPO_PUBLIC_FIREBASE_PROJECT_ID
- EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET
- EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
- EXPO_PUBLIC_FIREBASE_APP_ID
- EXPO_PUBLIC_FUNCTIONS_URL

## Functions Base URL
- https://us-central1-verbo-f4503.cloudfunctions.net/api

## How to Run (Client)
- `npm install`
- `npm run start`

## How to Run (Functions)
- `cd functions`
- `npm install`
- `npm run build`
- `firebase deploy --only functions`

## Notes
- The app can run UI and auth without Functions.
- No Firestore reads/writes should occur from the client directly.
