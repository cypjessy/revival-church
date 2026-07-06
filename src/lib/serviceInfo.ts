import { db } from "./firebase";
import {
  doc, getDoc, setDoc, Timestamp,
} from "firebase/firestore";

// ─── Types ────────────────────────────────────────────────────────────────

export interface ServiceSession {
  name: string;
  time: string;
}

/** The shape stored in Firestore at `serviceInfo/main`.
 *  Field names are kept descriptive and flat to make AI queries unambiguous. */
export interface ServiceInfoDoc {
  /** e.g. "Sunday Morning" at "8:00 AM", "Sunday Second Service" at "10:30 AM" */
  sessions: ServiceSession[];
  /** Full street address of the church */
  address: string;
  /** Google Maps link or embed URL */
  mapLink: string;
  /** Free-text directions (entrance, parking, landmarks) */
  directionsNotes: string;
  /** Server timestamp of last update */
  updatedAt: Timestamp | null;
  /** UID of the admin who last updated this */
  updatedBy: string;
}

const DOC_PATH = "serviceInfo/main";

// ─── Read ─────────────────────────────────────────────────────────────────

/** Fetch the service-info document from Firestore.
 *  Returns `null` if the doc doesn't exist yet (first-time setup). */
export async function getServiceInfo(): Promise<ServiceInfoDoc | null> {
  const snap = await getDoc(doc(db, DOC_PATH));
  if (!snap.exists()) return null;
  return snap.data() as ServiceInfoDoc;
}

// ─── Write ────────────────────────────────────────────────────────────────

/** Save (create or overwrite) the service-info document.
 *  `updatedAt` and `updatedBy` are set automatically. */
export async function saveServiceInfo(
  data: Omit<ServiceInfoDoc, "updatedAt" | "updatedBy">,
  adminUid: string,
): Promise<void> {
  await setDoc(doc(db, DOC_PATH), {
    ...data,
    updatedAt: Timestamp.now(),
    updatedBy: adminUid,
  });
}

// ─── Default / Fallback ───────────────────────────────────────────────────

/** Sensible defaults shown before the first save. */
export function defaultServiceInfo(): Omit<ServiceInfoDoc, "updatedAt" | "updatedBy"> {
  return {
    sessions: [
      { name: "Sunday Morning", time: "8:00 AM" },
      { name: "Sunday Second Service", time: "10:30 AM" },
    ],
    address: "",
    mapLink: "",
    directionsNotes: "",
  };
}
