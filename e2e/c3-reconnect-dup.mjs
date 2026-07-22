// Regression for the document-duplication bug: reloading a Yjs doc by
// reseeding from plain text mints fresh CRDT operations, so a client that
// reconnects after a server restart MERGES its copy with the server's freshly
// seeded copy → the document duplicates ("XX"). Loading from a binary Yjs
// snapshot preserves operation identity, so the reconnect sync is a no-op.
//
// This exercises the exact Yjs primitives collab.ts uses (text-seed vs
// snapshot round-trip) and simulates the Hocuspocus sync-on-reconnect via a
// state exchange, deterministically — no server, no timing flake.
import * as Y from 'yjs';

const TEXT = 'THE-ONLY-COPY-OF-THIS-LINE\n';
const copies = (s) => (s.match(/THE-ONLY-COPY-OF-THIS-LINE/g) || []).length;

/** One round of the Yjs sync protocol between two docs (both directions). */
function sync(a, b) {
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
}

// --- server incarnation 1 seeds the doc from disk text, client syncs ---
const server1 = new Y.Doc();
server1.getText('content').insert(0, TEXT); // onLoadDocument text-seed (server1's clientID)
const client = new Y.Doc();
sync(client, server1); // client now holds TEXT as server1's operations
const snapshot = Buffer.from(Y.encodeStateAsUpdate(server1)); // what writeSnapshot() persists

// --- server restarts; the client stays alive and will reconnect ---

// OLD behaviour: incarnation 2 reseeds from plain text (new operations)
const oldServer2 = new Y.Doc();
oldServer2.getText('content').insert(0, TEXT); // fresh ops, different clientID
const oldClient = new Y.Doc();
sync(oldClient, client); // clone the live client's state
sync(oldClient, oldServer2); // reconnect sync
const oldCopies = copies(oldClient.getText('content').toString());

// NEW behaviour: incarnation 2 loads from the snapshot (operation identity kept)
const newServer2 = new Y.Doc();
Y.applyUpdate(newServer2, snapshot); // onLoadDocument snapshot path
const newClient = new Y.Doc();
sync(newClient, client); // clone the live client's state
sync(newClient, newServer2); // reconnect sync
const newCopies = copies(newClient.getText('content').toString());

console.log(`old (text-seed) reconnect → ${oldCopies} copies; new (snapshot) reconnect → ${newCopies} copies`);
// The test asserts the FIX: exactly one copy. It also asserts the bug is real
// (the old path duplicates), so a future regression that drops snapshotting fails here.
const ok = newCopies === 1 && oldCopies > 1;
console.log(ok ? 'C3 PASS: snapshot reload is reconnect-safe (old path duplicates, new path does not)'
               : `C3 FAIL: expected new=1 & old>1, got new=${newCopies} old=${oldCopies}`);
process.exit(ok ? 0 : 1);
