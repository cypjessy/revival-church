import { SignJWT } from "jose";
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

/** Mute a participant's audio track(s) via the server API */
export async function muteParticipant(
  roomName: string,
  identity: string,
  trackSid?: string
): Promise<void> {
  const res = await fetch("/api/livekit/mute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomName, identity, trackSid: trackSid || null }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || "Failed to mute participant");
  }
}

/** Get the LiveKit server URL from env */
export function getLiveKitUrl(): string {
  try {
    return process.env.NEXT_PUBLIC_LIVEKIT_URL || "";
  } catch {
    return "";
  }
}

/** Get the LiveKit API key from env */
export function getLiveKitApiKey(): string {
  try {
    return process.env.NEXT_PUBLIC_LIVEKIT_API_KEY || "";
  } catch {
    return "";
  }
}

/** Get the LiveKit API secret from env */
export function getLiveKitApiSecret(): string {
  try {
    return process.env.NEXT_PUBLIC_LIVEKIT_API_SECRET || "";
  } catch {
    return "";
  }
}

/**
 * Generate a LiveKit access token directly in the browser (like AzuraCast).
 * The token is a signed JWT that grants access to a specific room.
 */
export async function generateLiveKitToken(
  roomName: string,
  identity: string
): Promise<{ token: string; url: string }> {
  const apiKey = getLiveKitApiKey();
  const apiSecret = getLiveKitApiSecret();
  const url = getLiveKitUrl();

  if (!apiKey || !apiSecret) {
    throw new Error("LiveKit credentials not configured");
  }
  if (!url) {
    throw new Error("LiveKit server URL not configured");
  }

  const secret = new TextEncoder().encode(apiSecret);

  const token = await new SignJWT({
    iss: apiKey,
    sub: identity,
    name: identity,
    video: {
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secret);

  return { token, url };
}
