import { initializeApp } from "firebase/app";
import { collection, doc, getFirestore, serverTimestamp, setDoc } from "firebase/firestore/lite";

// Web config is public by design; access is limited by firestore.rules (create-only, no reads).
const app = initializeApp({
  apiKey: "AIzaSyA3aAihnqR_u7GMEcvIZozsyxnP44veqsk",
  authDomain: "cmf-check.firebaseapp.com",
  projectId: "cmf-check",
  storageBucket: "cmf-check.firebasestorage.app",
  messagingSenderId: "906251052022",
  appId: "1:906251052022:web:d25d9aeca60f88eb591dd7",
});
const db = getFirestore(app);

type Write = { path: string; data: Record<string, unknown>; tries?: number };
const KEY = "tc.pending";
let queue: Write[] = load();
let flushing = false;
let rejected = 0;
const listeners = new Set<(pending: number) => void>();

function load(): Write[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(queue));
  } catch {
    /* private mode: the in-memory queue still retries while the tab is open */
  }
  listeners.forEach((fn) => fn(queue.length));
}

export const newSessionId = () => doc(collection(db, "sessions")).id;

export function onPending(fn: (pending: number) => void) {
  listeners.add(fn);
  fn(queue.length);
}

export function pendingCount() {
  return queue.length;
}

/** Writes the rules refused on their first attempt: a real data loss, not a landed retry. */
export function rejectedCount() {
  return rejected;
}

// the dev server does not touch the study data unless asked with ?live
const dryRun = import.meta.env.DEV && !new URLSearchParams(location.search).has("live");

/** Queue a create-only write; `at` is stamped by the server. */
export function save(path: string, data: Record<string, unknown>) {
  if (dryRun) return console.info("[dry run]", path, data);
  queue.push({ path, data });
  persist();
  void flush();
}

export async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    while (queue.length) {
      const w = queue[0];
      try {
        await setDoc(doc(db, w.path), { ...w.data, at: serverTimestamp() });
      } catch (e) {
        if ((e as { code?: string }).code !== "permission-denied") {
          w.tries = (w.tries ?? 0) + 1;
          persist();
          break;
        }
        // on a retry, permission-denied means an earlier attempt already landed (create-only)
        if (!w.tries) rejected += 1;
        console.warn("dropped write", w.path, e);
      }
      queue.shift();
      persist();
    }
  } finally {
    flushing = false;
  }
}

window.addEventListener("online", () => void flush());
setInterval(() => queue.length && void flush(), 15000);
