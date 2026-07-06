// ─── Types ────────────────────────────────────────────────────────────────

export type Tab = "service" | "radio" | "prayer" | "giving" | "groups" | "events" | "inbox" | "settings";

export interface ServiceSession {
  name: string;
  time: string;
}

export interface ServiceInfo {
  sessions: ServiceSession[];
  address: string;
  mapLink: string;
  directionsNotes: string;
}

export interface Sermon {
  id: number;
  title: string;
  date: string;
  speaker: string;
  duration: string;
  plays: number;
  tags: string[];
}

export interface Prayer {
  id: number;
  name: string;
  phone: string;
  text: string;
  status: "new" | "praying" | "resolved";
  isSensitive: boolean;
  notes: string;
  assignedTo: string;
  createdAt: string;
}

export interface MinistryMember {
  name: string;
  phone: string;
  joined: string;
}

export interface Ministry {
  id: number;
  name: string;
  category: string;
  desc: string;
  contact: string;
  phone: string;
  time: string;
  members: number;
  photoUrl: string;
  memberList: MinistryMember[];
}

export interface Attendee {
  name: string;
  phone: string;
  status: "confirmed" | "pending";
  paid: boolean;
}

export interface EventItem {
  id: number;
  name: string;
  date: string;
  location: string;
  desc: string;
  isPaid: boolean;
  fee: number;
  rsvpRequired: boolean;
  capacity: number;
  attendees: Attendee[];
}

export interface Transaction {
  id: number;
  date: string;
  member: string;
  amount: number;
  type: string;
  mpesaRef: string;
  status: string;
  phone: string;
  metadata: {
    transactionId: string;
    merchantRequestID: string;
    checkoutRequestID: string;
  };
}

export interface Message {
  from: string;
  text: string;
  time: string;
}

export interface Conversation {
  id: number;
  memberPhone: string;
  memberName: string;
  unread: boolean;
  messages: Message[];
  status: string;
  assignedTo: string;
}

export interface MenuLabels {
  service: string;
  radio: string;
  prayer: string;
  giving: string;
  groups: string;
  events: string;
  inbox: string;
  mainMenu: string;
}

export interface AdminUser {
  uid: string;
  name: string;
  role: string;
  email: string;
  phone: string;
}

export interface Settings {
  welcomeMessage: string;
  menuLabels: MenuLabels;
  enabledMenuOptions: string[];
  language: string;
}

export interface AppData {
  serviceInfo: ServiceInfo;
  sermons: Sermon[];
  prayers: Prayer[];
  ministries: Ministry[];
  events: EventItem[];
  transactions: Transaction[];
  conversations: Conversation[];
  settings: Settings;
  admins: AdminUser[];
}

// ─── Constants ────────────────────────────────────────────────────────────

export const menuMeta = [
  { id: "service", icon: "📋", defaultLabel: "Service Info", tab: "service" as Tab },
  { id: "radio", icon: "📻", defaultLabel: "Radio & Sermons", tab: "radio" as Tab },
  { id: "prayer", icon: "🙏", defaultLabel: "Prayer Requests", tab: "prayer" as Tab },
  { id: "giving", icon: "💰", defaultLabel: "Give", tab: "giving" as Tab },
  { id: "groups", icon: "👥", defaultLabel: "Groups & Ministries", tab: "groups" as Tab },
  { id: "events", icon: "📅", defaultLabel: "Events", tab: "events" as Tab },
  { id: "inbox", icon: "💬", defaultLabel: "Talk to Office", tab: "inbox" as Tab },
  { id: "mainMenu", icon: "☰", defaultLabel: "Main Menu", tab: "settings" as Tab },
];

export const bottomNavTabs: { tab: Tab; icon: string; label: string; badge?: boolean }[] = [
  { tab: "service", icon: "📋", label: "Service" },
  { tab: "radio", icon: "📻", label: "Radio" },
  { tab: "prayer", icon: "🙏", label: "Prayer", badge: true },
  { tab: "giving", icon: "💰", label: "Give" },
  { tab: "settings", icon: "⚙️", label: "More" },
];

// ─── Default Data ─────────────────────────────────────────────────────────

export function defaultData(): AppData {
  return {
    serviceInfo: {
      sessions: [{ name: "First Service", time: "8:00 AM" }, { name: "Second Service", time: "10:30 AM" }],
      address: "123 Faith Street, Nairobi",
      mapLink: "",
      directionsNotes: "Entrance is on the west side, ample parking",
    },
    sermons: [
      { id: 1, title: "Faith Over Fear", date: "2025-06-22", speaker: "Pastor John", duration: "45 min", plays: 128, tags: ["faith"] },
      { id: 2, title: "The Power of Prayer", date: "2025-06-15", speaker: "Pastor Mary", duration: "38 min", plays: 96, tags: ["prayer"] },
    ],
    prayers: [
      { id: 1, name: "Jane Doe", phone: "+254712345678", text: "Please pray for my healing from back pain.", status: "new", isSensitive: false, notes: "", assignedTo: "", createdAt: "2025-07-01" },
      { id: 2, name: "Anonymous", phone: "", text: "Praying for financial breakthrough this month.", status: "praying", isSensitive: true, notes: "Follow up next week", assignedTo: "Pastor John", createdAt: "2025-06-28" },
      { id: 3, name: "Peter K.", phone: "+254723456789", text: "My son is sitting for his final exams.", status: "resolved", isSensitive: false, notes: "", assignedTo: "", createdAt: "2025-06-20" },
    ],
    ministries: [
      { id: 1, name: "Youth Ministry", category: "Youth", desc: "Ages 13-25", contact: "Bro. James", phone: "+254711111111", time: "Sundays 2 PM", members: 24, photoUrl: "", memberList: [
        { name: "Alice M.", phone: "+254712345678", joined: "2025-01-15" },
        { name: "Bob N.", phone: "+254723456789", joined: "2025-02-20" },
      ]},
      { id: 2, name: "Choir", category: "Choir", desc: "Worship team", contact: "Sis. Grace", phone: "+254722222222", time: "Wednesdays 6 PM", members: 18, photoUrl: "", memberList: [
        { name: "Carol W.", phone: "+254734567890", joined: "2024-11-10" },
      ]},
    ],
    events: [
      { id: 1, name: "Youth Conference 2025", date: "2025-08-15T09:00", location: "Church Hall", desc: "Annual youth gathering", isPaid: true, fee: 500, rsvpRequired: true, capacity: 200, attendees: [
        { name: "John", phone: "+254712345678", status: "confirmed", paid: true },
        { name: "Mary", phone: "+254723456789", status: "confirmed", paid: false },
        { name: "Peter", phone: "+254734567890", status: "pending", paid: false },
      ]},
      { id: 2, name: "Midweek Prayer", date: "2025-07-09T18:00", location: "Sanctuary", desc: "Weekly prayer meeting", isPaid: false, fee: 0, rsvpRequired: false, capacity: 0, attendees: [] },
    ],
    transactions: [
      { id: 1, date: "2025-07-01", member: "John Doe", amount: 1000, type: "Tithe", mpesaRef: "RHJ9X8", status: "completed", phone: "+254712345678", metadata: { transactionId: "TXN123456", merchantRequestID: "MRID789", checkoutRequestID: "CRID456" } },
      { id: 2, date: "2025-06-28", member: "Jane Smith", amount: 500, type: "Offering", mpesaRef: "TGK2M4", status: "completed", phone: "+254723456789", metadata: { transactionId: "TXN123457", merchantRequestID: "MRID790", checkoutRequestID: "CRID457" } },
      { id: 3, date: "2025-06-25", member: "Unknown", amount: 200, type: "Pledge", mpesaRef: "PLZ7N1", status: "pending", phone: "", metadata: { transactionId: "TXN123458", merchantRequestID: "MRID791", checkoutRequestID: "CRID458" } },
    ],
    conversations: [
      { id: 1, memberPhone: "+254712345678", memberName: "Alice M.", unread: true, messages: [
        { from: "member", text: "Hello, I would like to speak to someone about baptism classes.", time: "10:30 AM" },
        { from: "bot", text: "I have forwarded your message to the church office. Someone will be in touch shortly.", time: "10:31 AM" },
      ], status: "open", assignedTo: "" },
      { id: 2, memberPhone: "+254798765432", memberName: "Robert K.", unread: false, messages: [
        { from: "member", text: "Thank you for the prayer.", time: "Yesterday" },
        { from: "admin", text: "You are welcome! God bless you.", time: "Yesterday" },
      ], status: "resolved", assignedTo: "Pastor John" },
    ],
    settings: {
      welcomeMessage: "Welcome to Grace Community Church! 🙏\n\nHow can we help you today?",
      menuLabels: {
        service: "Service Info", radio: "Radio & Sermons", prayer: "Prayer Requests",
        giving: "Give", groups: "Groups & Ministries", events: "Events",
        inbox: "Talk to Office", mainMenu: "Main Menu",
      },
      enabledMenuOptions: ["service", "radio", "prayer", "giving", "groups", "events", "inbox"],
      language: "en",
    },
    admins: [
      { uid: "1", name: "Pastor John", role: "Senior Admin", email: "john@church.com", phone: "+254711111111" },
      { uid: "2", name: "Sis. Mary", role: "Office Staff", email: "mary@church.com", phone: "+254722222222" },
      { uid: "3", name: "Bro. Peter", role: "Prayer Team", email: "peter@church.com", phone: "+254733333333" },
    ],
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

export function getCategoryIcon(cat: string): string {
  const map: Record<string, string> = {
    Youth: "🧑‍🤝‍🧑", Choir: "🎵", Ushering: "🚪",
    "Men's Fellowship": "👨", "Women's Fellowship": "👩",
    Children: "🧒", Other: "⭐",
  };
  return map[cat] || "⭐";
}

export function getCategoryIconClass(cat: string): string {
  const map: Record<string, string> = {
    Youth: "fa-people-group", Choir: "fa-music", Ushering: "fa-door-open",
    "Men's Fellowship": "fa-person", "Women's Fellowship": "fa-person-dress",
    Children: "fa-child", Other: "fa-star",
  };
  return map[cat] || "fa-star";
}
