import { db } from "@/lib/firebase";
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  collection, query, orderBy, where, serverTimestamp,
  Timestamp,
} from "firebase/firestore";

export interface Meeting {
  id?: string;
  title: string;
  description: string;
  date: string; // ISO date string YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  roomName: string; // LiveKit room name
  hostId: string;
  hostName: string;
  status: "scheduled" | "active" | "ended";
  maxParticipants: number;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

const meetingsCol = () => collection(db, "meetings");
const meetingDoc = (id: string) => doc(db, "meetings", id);

/** Get all meetings ordered by date descending */
export async function getMeetings(): Promise<Meeting[]> {
  const q = query(meetingsCol(), orderBy("date", "desc"), orderBy("startTime", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Meeting));
}

/** Get upcoming meetings (today or future) */
export async function getUpcomingMeetings(): Promise<Meeting[]> {
  const today = new Date().toISOString().slice(0, 10);
  const q = query(
    meetingsCol(),
    where("date", ">=", today),
    orderBy("date", "asc"),
    orderBy("startTime", "asc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Meeting));
}

/** Get a single meeting by ID */
export async function getMeeting(id: string): Promise<Meeting | null> {
  const snap = await getDoc(meetingDoc(id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as Meeting;
}

/** Create a new meeting */
export async function createMeeting(
  meeting: Omit<Meeting, "id" | "createdAt" | "updatedAt">
): Promise<string> {
  const ref = doc(meetingsCol());
  await setDoc(ref, {
    ...meeting,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

/** Update a meeting */
export async function updateMeeting(
  id: string,
  data: Partial<Meeting>
): Promise<void> {
  await updateDoc(meetingDoc(id), { ...data, updatedAt: serverTimestamp() });
}

/** Delete a meeting */
export async function deleteMeeting(id: string): Promise<void> {
  await deleteDoc(meetingDoc(id));
}

/** Generate a unique room name for a meeting */
export function generateRoomName(meetingId: string): string {
  return `meeting-${meetingId}`;
}
