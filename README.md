# SplitScan

SplitScan is a session-based bill splitting app that syncs in real time across a shared URL.

## Epic 1 Status
Implemented:
- Anonymous, URL-based sessions
- Local fallback mode (no Firebase config)
- Firebase realtime integration for sessions, people, and items
- Manual entry for people + items
- Session lock workflow (client + Firestore rules)

## Quick Start

1. Install dependencies
```bash
npm install
```

2. Configure environment
```bash
cp .env.example .env
```
Fill in the `VITE_FIREBASE_*` values from your Firebase project settings.

3. Set up Firebase
- Enable Anonymous Authentication.
- Create a Firestore database.
- Deploy Firestore rules:
```bash
firebase deploy --only firestore
```
 - Deploy Storage rules (for receipt images):
```bash
firebase deploy --only storage
```

4. Run the app
```bash
npm run dev
```

If you skip Firebase config, the app runs in local-only mode and syncs across tabs on the same device.

## Firebase Hosting

1. Install Firebase CLI
```bash
npm install -g firebase-tools
```

2. Set your Firebase project ID
- Update `/Users/victortolosa/Repos/splitscan/.firebaserc` with your project id.

3. Build and deploy
```bash
npm run build
firebase deploy
```

## Project Structure
- `src/routes/Landing.tsx`: session creation and join
- `src/routes/Scanner.tsx`: receipt capture + OCR review
- `src/routes/Workspace.tsx`: live workspace for people + items
- `src/lib/data.ts`: data client (Firebase + local)
- `src/lib/firebase.ts`: Firebase bootstrap
- `src/lib/ocr.ts`: OCR parsing helpers
- `firebase/firestore.rules`: database rules
- `firebase/storage.rules`: storage rules

## Next Epics
- OCR capture and parsing review
- Item explosion and assignment logic
- Confirmation receipt view
