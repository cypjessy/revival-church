import { db } from "./firebase";
import {
  doc, getDoc, setDoc, Timestamp,
} from "firebase/firestore";

// ─── Types ────────────────────────────────────────────────────────────────

/** The shape stored in Firestore at `radioConfig/main`.
 *  Field names are kept descriptive and flat to make AI queries unambiguous. */
export interface RadioConfigDoc {
  /** Display name of the station, e.g. "MOUNTAIN OF DELIVERANCE CHURCH Radio" */
  stationName: string;
  /** Short description/tagline */
  description: string;
  /** AzuraCast station ID (numeric) */
  stationId: string;
  /** AzuraCast public embed URL for the iframe player */
  embedUrl: string;
  /** Livestream audio URL (for AudioContext playback) */
  streamUrl: string;
  /** Server timestamp of last update */
  updatedAt: Timestamp | null;
  /** UID of the admin who last updated this */
  updatedBy: string;
}

const DOC_PATH = "radioConfig/main";

// ─── Read ─────────────────────────────────────────────────────────────────

/** Fetch the radio config from Firestore.
 *  Returns `null` if the doc doesn't exist yet. */
export async function getRadioConfig(): Promise<RadioConfigDoc | null> {
  const snap = await getDoc(doc(db, DOC_PATH));
  if (!snap.exists()) return null;
  return snap.data() as RadioConfigDoc;
}

// ─── Write ────────────────────────────────────────────────────────────────

/** Save (create or overwrite) the radio config document.
 *  `updatedAt` and `updatedBy` are set automatically. */
export async function saveRadioConfig(
  data: Omit<RadioConfigDoc, "updatedAt" | "updatedBy">,
  adminUid: string,
): Promise<void> {
  await setDoc(doc(db, DOC_PATH), {
    ...data,
    updatedAt: Timestamp.now(),
    updatedBy: adminUid,
  });
}

// ─── Default / Fallback ───────────────────────────────────────────────────

/** Sensible defaults for the radio config. */
export function defaultRadioConfig(): Omit<RadioConfigDoc, "updatedAt" | "updatedBy"> {
  return {
    stationName: "MOUNTAIN OF DELIVERANCE CHURCH Radio",
    description: "MOUNTAIN OF DELIVERANCE CHURCH Radio Station",
    stationId: "4",
    embedUrl: "https://azuracast.histoview.co.ke/public/mountain_of_delivarance_church/embed?autoplay=1&rounded=1&allow_popup=1&continuous=1",
    streamUrl: "",
  };
}
