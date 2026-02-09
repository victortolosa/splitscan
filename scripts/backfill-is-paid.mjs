import fs from 'node:fs';
import path from 'node:path';
import admin from 'firebase-admin';

const root = process.cwd();
const defaultKeyPath = path.join(root, 'splitscan-660e7-firebase-adminsdk-fbsvc-5447b22557.json');
const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || defaultKeyPath;

if (!fs.existsSync(keyPath)) {
  console.error(`Service account key not found at ${keyPath}`);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, 'utf8'))),
});

const db = admin.firestore();

const run = async () => {
  const sessionsSnap = await db.collection('sessions').get();
  let peopleChecked = 0;
  let peopleUpdated = 0;
  let sessionsChecked = 0;

  for (const sessionDoc of sessionsSnap.docs) {
    sessionsChecked += 1;
    const peopleSnap = await db.collection('sessions').doc(sessionDoc.id).collection('people').get();
    const updates = [];

    for (const personDoc of peopleSnap.docs) {
      peopleChecked += 1;
      const data = personDoc.data();
      const hasValid = typeof data.is_paid === 'boolean';
      if (!hasValid) {
        updates.push(personDoc.ref.update({
          is_paid: false,
          updated_at: new Date().toISOString(),
        }));
        peopleUpdated += 1;
      }
    }

    if (updates.length) {
      await Promise.all(updates);
    }
  }

  console.log(
    JSON.stringify(
      {
        sessionsChecked,
        peopleChecked,
        peopleUpdated,
      },
      null,
      2
    )
  );
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
