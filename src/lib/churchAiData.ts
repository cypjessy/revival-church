import { db } from "./firebase";
import {
  doc, getDoc, setDoc, updateDoc, Timestamp,
  collection, addDoc, getDocs, deleteDoc, query, orderBy,
} from "firebase/firestore";
import type {
  AppData, Sermon, Prayer, Ministry, EventItem, Transaction, Conversation,
} from "./churchAdminData";

const MAIN_DOC = "aiData/config";

export async function getAiData(): Promise<AppData | null> {
  const snap = await getDoc(doc(db, MAIN_DOC));
  if (!snap.exists()) return null;
  return snap.data() as AppData;
}

export async function saveAiData(data: AppData, adminUid: string): Promise<void> {
  await setDoc(doc(db, MAIN_DOC), {
    ...data,
    updatedAt: Timestamp.now(),
    updatedBy: adminUid,
  });
}

export async function updateAiDataPartial(
  partial: Partial<AppData>,
  adminUid: string,
): Promise<void> {
  await updateDoc(doc(db, MAIN_DOC), {
    ...partial,
    updatedAt: Timestamp.now(),
    updatedBy: adminUid,
  });
}

// ─── Sermons ───────────────────────────────────────────────────

const SERMONS_COL = "ai_sermons";

export async function getSermons(): Promise<Sermon[]> {
  const q = query(collection(db, SERMONS_COL), orderBy("id", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Sermon);
}

export async function addSermon(
  sermon: Omit<Sermon, "id">,
): Promise<string> {
  const ref = await addDoc(collection(db, SERMONS_COL), { id: Date.now(), ...sermon });
  return ref.id;
}

export async function deleteSermonById(id: number): Promise<void> {
  const q = query(collection(db, SERMONS_COL));
  const snap = await getDocs(q);
  const match = snap.docs.find((d) => (d.data() as Sermon).id === id);
  if (match) await deleteDoc(match.ref);
}

// ─── Prayers ───────────────────────────────────────────────────

const PRAYERS_COL = "ai_prayers";

export async function getPrayers(): Promise<Prayer[]> {
  const q = query(collection(db, PRAYERS_COL), orderBy("id", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Prayer);
}

export async function addPrayer(
  prayer: Omit<Prayer, "id" | "status" | "createdAt"> & { status?: string },
): Promise<string> {
  const ref = await addDoc(collection(db, PRAYERS_COL), {
    ...prayer,
    id: Date.now(),
    status: prayer.status || "new",
    createdAt: new Date().toISOString().split("T")[0],
  });
  return ref.id;
}

export async function updatePrayer(id: number, data: Partial<Prayer>): Promise<void> {
  const q = query(collection(db, PRAYERS_COL));
  const snap = await getDocs(q);
  const match = snap.docs.find((d) => (d.data() as Prayer).id === id);
  if (match) await updateDoc(match.ref, data);
}

export async function deletePrayerById(id: number): Promise<void> {
  const q = query(collection(db, PRAYERS_COL));
  const snap = await getDocs(q);
  const match = snap.docs.find((d) => (d.data() as Prayer).id === id);
  if (match) await deleteDoc(match.ref);
}

// ─── Ministries ────────────────────────────────────────────────

const MINISTRIES_COL = "ai_ministries";

export async function getMinistries(): Promise<Ministry[]> {
  const q = query(collection(db, MINISTRIES_COL), orderBy("id", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Ministry);
}

export async function addMinistry(min: Omit<Ministry, "id">): Promise<string> {
  const ref = await addDoc(collection(db, MINISTRIES_COL), { id: Date.now(), ...min });
  return ref.id;
}

export async function updateMinistry(id: number, data: Partial<Ministry>): Promise<void> {
  const q = query(collection(db, MINISTRIES_COL));
  const snap = await getDocs(q);
  const match = snap.docs.find((d) => (d.data() as Ministry).id === id);
  if (match) await updateDoc(match.ref, data);
}

export async function deleteMinistryById(id: number): Promise<void> {
  const q = query(collection(db, MINISTRIES_COL));
  const snap = await getDocs(q);
  const match = snap.docs.find((d) => (d.data() as Ministry).id === id);
  if (match) await deleteDoc(match.ref);
}

// ─── Events ────────────────────────────────────────────────────

const EVENTS_COL = "ai_events";

export async function getEvents(): Promise<EventItem[]> {
  const q = query(collection(db, EVENTS_COL), orderBy("id", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as EventItem);
}

export async function addEvent(ev: Omit<EventItem, "id">): Promise<string> {
  const ref = await addDoc(collection(db, EVENTS_COL), { id: Date.now(), ...ev });
  return ref.id;
}

export async function updateEvent(id: number, data: Partial<EventItem>): Promise<void> {
  const q = query(collection(db, EVENTS_COL));
  const snap = await getDocs(q);
  const match = snap.docs.find((d) => (d.data() as EventItem).id === id);
  if (match) await updateDoc(match.ref, data);
}

export async function deleteEventById(id: number): Promise<void> {
  const q = query(collection(db, EVENTS_COL));
  const snap = await getDocs(q);
  const match = snap.docs.find((d) => (d.data() as EventItem).id === id);
  if (match) await deleteDoc(match.ref);
}

// ─── Conversations ─────────────────────────────────────────────

const CONVERSATIONS_COL = "ai_conversations";

export async function getConversations(): Promise<Conversation[]> {
  const q = query(collection(db, CONVERSATIONS_COL), orderBy("id", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Conversation);
}

export async function updateConversation(id: number, data: Partial<Conversation>): Promise<void> {
  const q = query(collection(db, CONVERSATIONS_COL));
  const snap = await getDocs(q);
  const match = snap.docs.find((d) => (d.data() as Conversation).id === id);
  if (match) await updateDoc(match.ref, data);
}

// ─── Transactions ──────────────────────────────────────────────

const TRANSACTIONS_COL = "ai_transactions";

export async function getAiTransactions(): Promise<Transaction[]> {
  const q = query(collection(db, TRANSACTIONS_COL), orderBy("id", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Transaction);
}
