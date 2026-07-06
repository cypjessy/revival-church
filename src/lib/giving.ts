"use client";

import { db } from "./firebase";
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, orderBy, where, serverTimestamp, writeBatch,
} from "firebase/firestore";

export interface PaymentMethod {
  id?: string;
  name: string;
  type: "mpesa" | "bank" | "paypal" | "card" | "other";
  details: Record<string, string>;
  icon: string;
  instructions: string;
  enabled: boolean;
  order: number;
  createdAt?: Date | null;
}

export interface Transaction {
  id?: string;
  memberId: string;
  memberName: string;
  amount: number;
  paymentMethodId: string;
  paymentMethodLabel: string;
  confirmationCode: string;
  message?: string;
  status: "pending" | "confirmed" | "rejected";
  adminFeedback: string;
  feedbackAt: Date | null;
  date: string;
  createdAt?: Date | null;
}

const PAYMENT_METHODS_COL = "payment_methods";
const GIVING_COL = "giving";

export async function getPaymentMethods(): Promise<PaymentMethod[]> {
  const q = query(
    collection(db, PAYMENT_METHODS_COL),
    orderBy("order", "asc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as PaymentMethod));
}

export async function getEnabledPaymentMethods(): Promise<PaymentMethod[]> {
  const q = query(
    collection(db, PAYMENT_METHODS_COL),
    where("enabled", "==", true),
    orderBy("order", "asc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as PaymentMethod));
}

export async function addPaymentMethod(data: Omit<PaymentMethod, "id" | "createdAt">): Promise<string> {
  const ref = await addDoc(collection(db, PAYMENT_METHODS_COL), {
    ...data,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updatePaymentMethod(id: string, data: Partial<PaymentMethod>): Promise<void> {
  await updateDoc(doc(db, PAYMENT_METHODS_COL, id), data);
}

export async function deletePaymentMethod(id: string): Promise<void> {
  await deleteDoc(doc(db, PAYMENT_METHODS_COL, id));
}

export async function getTransactions(): Promise<Transaction[]> {
  const q = query(
    collection(db, GIVING_COL),
    orderBy("createdAt", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Transaction));
}

export async function getMemberTransactions(memberId: string): Promise<Transaction[]> {
  const q = query(
    collection(db, GIVING_COL),
    where("memberId", "==", memberId),
    orderBy("createdAt", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Transaction));
}

export async function submitTransaction(data: Omit<Transaction, "id" | "createdAt" | "status" | "adminFeedback" | "feedbackAt">): Promise<string> {
  const ref = await addDoc(collection(db, GIVING_COL), {
    ...data,
    status: "pending",
    adminFeedback: "",
    feedbackAt: null,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateTransactionStatus(
  id: string,
  status: "confirmed" | "rejected",
  adminFeedback: string
): Promise<void> {
  await updateDoc(doc(db, GIVING_COL, id), {
    status,
    adminFeedback,
    feedbackAt: serverTimestamp(),
  });
}
