import { SignJWT } from "jose";
import { db } from "@/lib/firebase";
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  collection, query, orderBy, where, serverTimestamp,
  Timestamp, addDoc,
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

export interface RSVPEntry {
  id?: string;
  userId: string;
  userName: string;
  status: "yes" | "no" | "maybe";
  respondedAt: Timestamp;
}

export interface AgendaItem {
  id?: string;
  meetingId: string;
  title: string;
  description?: string;
  duration: number; // minutes
  assigneeName?: string;
  sortOrder: number;
  isCompleted: boolean;
}

export interface AttendanceEntry {
  id?: string;
  userId: string;
  userName: string;
  joinedAt: Timestamp;
  leftAt?: Timestamp;
  duration?: number; // seconds
}

const meetingsCol = () => collection(db, "meetings");
const meetingDoc = (id: string) => doc(db, "meetings", id);
const rsvpsCol = (meetingId: string) => collection(db, "meetings", meetingId, "rsvps");
const attendanceCol = (meetingId: string) => collection(db, "meetings", meetingId, "attendance");
const agendaCol = (meetingId: string) => collection(db, "meetings", meetingId, "agenda");
const minutesDoc = (meetingId: string) => doc(db, "meetings", meetingId, "minutes", "data");

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

// ====================== RSVP ======================

/** Submit or update an RSVP for a meeting */
export async function submitRSVP(
  meetingId: string,
  userId: string,
  userName: string,
  status: "yes" | "no" | "maybe"
): Promise<void> {
  const ref = doc(rsvpsCol(meetingId), userId);
  await setDoc(ref, {
    userId,
    userName,
    status,
    respondedAt: serverTimestamp(),
  });
}

/** Get all RSVPs for a meeting */
export async function getRSVPs(
  meetingId: string
): Promise<RSVPEntry[]> {
  const q = query(rsvpsCol(meetingId), orderBy("respondedAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as RSVPEntry));
}

/** Get RSVP counts for a meeting (yes/no/maybe counts) */
export async function getRSVPSummary(
  meetingId: string
): Promise<{ yes: number; no: number; maybe: number }> {
  const snap = await getDocs(rsvpsCol(meetingId));
  let yes = 0, no = 0, maybe = 0;
  snap.docs.forEach((d) => {
    const data = d.data();
    if (data.status === "yes") yes++;
    else if (data.status === "no") no++;
    else if (data.status === "maybe") maybe++;
  });
  return { yes, no, maybe };
}

/** Get the current user's RSVP status for a meeting */
export async function getMyRSVP(
  meetingId: string,
  userId: string
): Promise<"yes" | "no" | "maybe" | null> {
  const ref = doc(rsvpsCol(meetingId), userId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return snap.data().status as "yes" | "no" | "maybe";
}

/** Get all RSVPs for multiple meetings at once (for listing pages) */
export async function getRSVPsForMeetings(
  meetingIds: string[],
  userId: string
): Promise<Record<string, "yes" | "no" | "maybe" | null>> {
  const result: Record<string, "yes" | "no" | "maybe" | null> = {};
  await Promise.all(
    meetingIds.map(async (id) => {
      result[id] = await getMyRSVP(id, userId);
    })
  );
  return result;
}

// ====================== ATTENDANCE ======================

/** Log a user joining a meeting (creates attendance record) */
export async function logAttendanceJoin(
  meetingId: string,
  userId: string,
  userName: string
): Promise<void> {
  const ref = doc(attendanceCol(meetingId), userId);
  await setDoc(ref, {
    userId,
    userName,
    joinedAt: serverTimestamp(),
  });
}

/** Log a user leaving a meeting (updates attendance record with leave time + duration) */
export async function logAttendanceLeave(
  meetingId: string,
  userId: string
): Promise<void> {
  const ref = doc(attendanceCol(meetingId), userId);
  // Use approximate duration by reading the join time client-side
  // Firestore serverTimestamp won't be available until next read
  await updateDoc(ref, {
    leftAt: serverTimestamp(),
  });
}

/** Get all attendance records for a meeting */
export async function getAttendance(
  meetingId: string
): Promise<AttendanceEntry[]> {
  const q = query(attendanceCol(meetingId), orderBy("joinedAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as AttendanceEntry));
}

/** Get attendance count for a meeting */
export async function getAttendanceCount(
  meetingId: string
): Promise<number> {
  const snap = await getDocs(attendanceCol(meetingId));
  return snap.size;
}

// ====================== AGENDA ======================

/** Get all agenda items for a meeting ordered by sortOrder */
export async function getAgenda(meetingId: string): Promise<AgendaItem[]> {
  const q = query(agendaCol(meetingId), orderBy("sortOrder", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as AgendaItem));
}

/** Add an agenda item to a meeting */
export async function addAgendaItem(
  meetingId: string,
  item: Omit<AgendaItem, "id" | "meetingId">
): Promise<string> {
  const ref = doc(agendaCol(meetingId));
  await setDoc(ref, {
    ...item,
    meetingId,
  });
  return ref.id;
}

/** Update an agenda item */
export async function updateAgendaItem(
  meetingId: string,
  itemId: string,
  data: Partial<AgendaItem>
): Promise<void> {
  await updateDoc(doc(agendaCol(meetingId), itemId), data);
}

/** Delete an agenda item */
export async function deleteAgendaItem(
  meetingId: string,
  itemId: string
): Promise<void> {
  await deleteDoc(doc(agendaCol(meetingId), itemId));
}

/** Toggle agenda item completion status */
export async function toggleAgendaItem(
  meetingId: string,
  itemId: string
): Promise<void> {
  const snap = await getDoc(doc(agendaCol(meetingId), itemId));
  if (!snap.exists()) return;
  const current = snap.data().isCompleted as boolean;
  await updateDoc(doc(agendaCol(meetingId), itemId), { isCompleted: !current });
}

// ====================== AGENDA COUNT (lightweight) ======================

/** Get the number of agenda items for a meeting (minimal data transfer) */
export async function getAgendaCount(meetingId: string): Promise<number> {
  const snap = await getDocs(agendaCol(meetingId));
  return snap.size;
}

// ====================== ACTION ITEMS ======================

export interface ActionItem {
  id?: string;
  meetingId: string;
  title: string;
  description?: string;
  assigneeName?: string;
  dueDate?: string; // ISO date string YYYY-MM-DD
  priority: "low" | "medium" | "high";
  status: "open" | "in_progress" | "completed";
  createdBy: string;
  createdByName: string;
  createdAt: Timestamp;
  completedAt?: Timestamp;
}

const actionItemsCol = (meetingId: string) => collection(db, "meetings", meetingId, "actionItems");

/** Get all action items for a meeting ordered by createdAt desc */
export async function getActionItems(meetingId: string): Promise<ActionItem[]> {
  const q = query(actionItemsCol(meetingId), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ActionItem));
}

/** Create a new action item */
export async function createActionItem(
  meetingId: string,
  item: Omit<ActionItem, "id" | "meetingId" | "createdAt">
): Promise<string> {
  const ref = doc(actionItemsCol(meetingId));
  await setDoc(ref, {
    ...item,
    meetingId,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

/** Update an action item */
export async function updateActionItem(
  meetingId: string,
  itemId: string,
  data: Partial<ActionItem>
): Promise<void> {
  await updateDoc(doc(actionItemsCol(meetingId), itemId), data);
}

/** Delete an action item */
export async function deleteActionItem(
  meetingId: string,
  itemId: string
): Promise<void> {
  await deleteDoc(doc(actionItemsCol(meetingId), itemId));
}

/** Mark an action item as completed */
export async function completeActionItem(
  meetingId: string,
  itemId: string
): Promise<void> {
  await updateDoc(doc(actionItemsCol(meetingId), itemId), {
    status: "completed",
    completedAt: serverTimestamp(),
  });
}

/** Reopen a completed action item */
export async function reopenActionItem(
  meetingId: string,
  itemId: string
): Promise<void> {
  await updateDoc(doc(actionItemsCol(meetingId), itemId), {
    status: "open",
    completedAt: null,
  });
}

// ====================== MINUTES ======================

export interface MeetingMinutes {
  content: string;
  lastSavedBy: string;
  lastSavedByName: string;
  lastSavedAt: Timestamp;
  wordCount?: number;
}

/** Get meeting minutes */
export async function getMinutes(meetingId: string): Promise<MeetingMinutes | null> {
  const snap = await getDoc(minutesDoc(meetingId));
  if (!snap.exists()) return null;
  return snap.data() as MeetingMinutes;
}

/** Save meeting minutes */
export async function saveMinutes(
  meetingId: string,
  content: string,
  userId: string,
  userName: string
): Promise<void> {
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  await setDoc(minutesDoc(meetingId), {
    content,
    lastSavedBy: userId,
    lastSavedByName: userName,
    lastSavedAt: serverTimestamp(),
    wordCount,
  });
}

/** Generate a unique room name for a meeting */
export function generateRoomName(meetingId: string): string {
  return `meeting-${meetingId}`;
}

/**
 * Mute a remote participant by revoking their publish permission via LiveKit REST API.
 * This prevents them from re-enabling their mic (unlike `muted: true` which is one-time).
 */
export async function muteParticipant(
  roomName: string,
  identity: string,
): Promise<void> {
  const apiKey = getLiveKitApiKey();
  const apiSecret = getLiveKitApiSecret();
  const livekitUrl = getLiveKitUrl();

  if (!apiKey || !apiSecret || !livekitUrl) {
    throw new Error("LiveKit credentials not configured");
  }

  const secret = new TextEncoder().encode(apiSecret);
  const adminToken = await new SignJWT({
    iss: apiKey,
    sub: "admin",
    video: {
      room: roomName,
      roomAdmin: true,
      roomJoin: false,
      canPublish: false,
      canSubscribe: false,
    },
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secret);

  const httpBase = livekitUrl.replace(/^wss?:\/\//, "https://");

  const body = JSON.stringify({
    room: roomName,
    identity,
    permission: {
      canPublish: false,
      canSubscribe: true,
      canPublishData: false,
    },
  });

  const res = await fetch(`${httpBase}/twirp/livekit.RoomService/UpdateParticipant`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to mute participant: ${res.status} ${text}`);
  }
}

/**
 * Restore a participant's ability to publish audio (undoes muteParticipant).
 */
export async function unmuteParticipant(
  roomName: string,
  identity: string,
): Promise<void> {
  const apiKey = getLiveKitApiKey();
  const apiSecret = getLiveKitApiSecret();
  const livekitUrl = getLiveKitUrl();

  if (!apiKey || !apiSecret || !livekitUrl) {
    throw new Error("LiveKit credentials not configured");
  }

  const secret = new TextEncoder().encode(apiSecret);
  const adminToken = await new SignJWT({
    iss: apiKey,
    sub: "admin",
    video: {
      room: roomName,
      roomAdmin: true,
      roomJoin: false,
      canPublish: false,
      canSubscribe: false,
    },
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secret);

  const httpBase = livekitUrl.replace(/^wss?:\/\//, "https://");

  const body = JSON.stringify({
    room: roomName,
    identity,
    permission: {
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
  });

  const res = await fetch(`${httpBase}/twirp/livekit.RoomService/UpdateParticipant`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to unmute participant: ${res.status} ${text}`);
  }
}

/**
 * Update a participant's metadata on a LiveKit room via the REST API.
 * Used by the admin to clear handRaised status when approving/dismissing.
 */
export async function updateParticipantMetadata(
  roomName: string,
  identity: string,
  metadata: object,
): Promise<void> {
  const apiKey = getLiveKitApiKey();
  const apiSecret = getLiveKitApiSecret();
  const livekitUrl = getLiveKitUrl();

  if (!apiKey || !apiSecret || !livekitUrl) {
    throw new Error("LiveKit credentials not configured");
  }

  const secret = new TextEncoder().encode(apiSecret);
  const adminToken = await new SignJWT({
    iss: apiKey,
    sub: "admin",
    video: {
      room: roomName,
      roomAdmin: true,
      roomJoin: false,
      canPublish: false,
      canSubscribe: false,
    },
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secret);

  const httpBase = livekitUrl.replace(/^wss?:\/\//, "https://");

  const body = JSON.stringify({
    room: roomName,
    identity,
    metadata: JSON.stringify(metadata),
  });

  const res = await fetch(`${httpBase}/twirp/livekit.RoomService/UpdateParticipant`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to update participant metadata: ${res.status} ${text}`);
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
