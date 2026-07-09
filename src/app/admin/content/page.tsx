"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AdminBottomNav from "@/components/admin/AdminBottomNav";
import ToastBridge from "@/components/dashboard/ToastBridge";
import { apiFetch } from "@/lib/api";
import { hapticSuccess } from "@/lib/haptics";
import { formatBytes, uploadFile } from "@/lib/bunny";
import {
  getGalleryPhotos, addGalleryPhoto, updateGalleryPhoto, deleteGalleryPhoto,
} from "@/lib/content";
import type { GalleryPhoto } from "@/lib/content";
import { getEvents, addEvent, updateEvent, deleteEventById } from "@/lib/churchAiData";
import type { EventItem } from "@/lib/churchAdminData";
import { getAlbums, addAlbum, updateAlbum, deleteAlbum } from "@/lib/albums";
import type { Album } from "@/lib/albums";
import { getAlbumEntries, addAlbumEntry, updateAlbumEntry, deleteAlbumEntry } from "@/lib/albumEntries";
import type { AlbumEntry } from "@/lib/albumEntries";
import { Timestamp } from "firebase/firestore";
import PremiumTopBar from "@/components/shared/PremiumTopBar";

const churchId = process.env.NEXT_PUBLIC_CHURCH_ID || "mountain_of_deliverance";
const categories = ["all", "events", "services", "community", "leadership", "facility"];
const defaultAlbumTitles: Record<string, string> = {
  events: "Church Events",
  services: "Church Services",
  community: "Community Outreach",
  leadership: "Church Leadership",
  facility: "Church Facility",
};

// ========== ALBUM CAROUSEL ==========

function AlbumCarousel({ photos }: { photos: GalleryPhoto[] }) {
  const [idx, setIdx] = useState(0);
  const display = photos.slice(0, 10);

  useEffect(() => {
    if (display.length <= 1) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % display.length), 3000);
    return () => clearInterval(id);
  }, [display.length]);

  if (display.length === 0) {
    return <div className="album-cover-placeholder"><i className="fas fa-image"></i></div>;
  }

  return (
    <div className="album-carousel">
      {display.map((p, i) => (
        <img key={p.id} src={p.cdnUrl} alt="" className="album-carousel-img" style={{ opacity: i === idx ? 1 : 0 }} loading="lazy" />
      ))}
      {display.length > 1 && (
        <div className="album-carousel-dots">
          {display.map((_, i) => (
            <div key={i} className={`album-carousel-dot${i === idx ? " active" : ""}`} />
          ))}
        </div>
      )}
    </div>
  );
}

// ========== MAIN COMPONENT ==========

export default function AdminContentPage() {
  const [activeTab, setActiveTab] = useState<"gallery" | "events" | "settings">("gallery");
  const [galleryView, setGalleryView] = useState<"grid" | "masonry" | "list">("grid");
  const [galleryFilter, setGalleryFilter] = useState("all");
  const [gallerySort, setGallerySort] = useState("newest");
  const [selectedGallery, setSelectedGallery] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);

  // Real data state
  const [galleryPhotos, setGalleryPhotos] = useState<GalleryPhoto[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loadingPhotos, setLoadingPhotos] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [savingEntity, setSavingEntity] = useState(false);

  // Album state
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
  const [showAlbumModal, setShowAlbumModal] = useState(false);
  const [editAlbum, setEditAlbum] = useState<Album | null>(null);
  const [albumTitle, setAlbumTitle] = useState("");
  const [albumDesc, setAlbumDesc] = useState("");
  const [albumCategory, setAlbumCategory] = useState("events");
  const [albumSortOrder, setAlbumSortOrder] = useState(0);
  const [deleteAlbumTarget, setDeleteAlbumTarget] = useState<string | null>(null);

  // Entry state
  const [entries, setEntries] = useState<AlbumEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<AlbumEntry | null>(null);
  const [entryPhotoPage, setEntryPhotoPage] = useState(1);
  const PHOTOS_PER_PAGE = 20;
  const [showEntryModal, setShowEntryModal] = useState(false);
  const [editEntry, setEditEntry] = useState<AlbumEntry | null>(null);
  const [entryTitle, setEntryTitle] = useState("");
  const [entryDesc, setEntryDesc] = useState("");
  const [entryDate, setEntryDate] = useState("");
  const [entryCoverUrl, setEntryCoverUrl] = useState("");
  const [deleteEntryTarget, setDeleteEntryTarget] = useState<string | null>(null);
  const [entryCoverFile, setEntryCoverFile] = useState<File | null>(null);
  const [entryCoverUploading, setEntryCoverUploading] = useState(false);
  const entryCoverInputRef = useRef<HTMLInputElement>(null);

  // Upload modal state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<{ file: File; preview: string; title: string; category: string; progress: number }[]>([]);
  const [uploading, setUploading] = useState(false);

  // Edit photo modal
  const [editPhoto, setEditPhoto] = useState<GalleryPhoto | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editFeatured, setEditFeatured] = useState(false);
  const [editAltText, setEditAltText] = useState("");
  const [editAlbumId, setEditAlbumId] = useState<string | undefined>(undefined);

  // Events modal
  const [showEventModal, setShowEventModal] = useState(false);
  const [editEvent, setEditEvent] = useState<EventItem | null>(null);
  const [eventName, setEventName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [eventLocation, setEventLocation] = useState("");
  const [eventDesc, setEventDesc] = useState("");
  const [eventIsPaid, setEventIsPaid] = useState(false);
  const [eventFee, setEventFee] = useState(0);
  const [eventImageFile, setEventImageFile] = useState<File | null>(null);
  const [eventImagePreview, setEventImagePreview] = useState("");
  const [eventImageUploading, setEventImageUploading] = useState(false);
  const eventImageInputRef = useRef<HTMLInputElement>(null);

  // Delete confirm
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTargets, setDeleteTargets] = useState<{ type: string; count: number }>({ type: "photos", count: 0 });
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  // Settings state
  const [autoCompress, setAutoCompress] = useState(true);
  const [maxWidth, setMaxWidth] = useState("1920");
  const [outputFormat, setOutputFormat] = useState("webp");
  const [autoDeleteExpired, setAutoDeleteExpired] = useState(true);
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false);

  // Image viewer
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  function openViewer(idx: number) {
    setEditPhoto(null);
    setViewerIndex(idx);
  }

  function closeViewer() {
    setViewerIndex(null);
  }

  function goNextPhoto() {
    if (viewerIndex !== null && viewerIndex < displayedEntryPhotos.length - 1) {
      setViewerIndex(viewerIndex + 1);
    }
  }

  function goPrevPhoto() {
    if (viewerIndex !== null && viewerIndex > 0) {
      setViewerIndex(viewerIndex - 1);
    }
  }

  // Keyboard navigation for image viewer
  useEffect(() => {
    if (viewerIndex === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeViewer();
      if (e.key === "ArrowLeft") goPrevPhoto();
      if (e.key === "ArrowRight") goNextPhoto();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [viewerIndex]);

  // Storage stats
  const [storageUsage, setStorageUsage] = useState({ usedGB: 2.4, totalGB: 10, percentUsed: 24, formattedUsed: "2.4 GB", formattedTotal: "10 GB" });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const quickInputRef = useRef<HTMLInputElement>(null);

  // ========== DATA FETCHING ==========

  const fetchData = useCallback(async () => {
    setLoadingPhotos(true);
    setLoadingEvents(true);
    await Promise.all([
      getGalleryPhotos().then(setGalleryPhotos).catch(() => setGalleryPhotos([])),
      getAlbums().then(setAlbums).catch(() => setAlbums([])),
      getEvents().then(setEvents).catch(() => setEvents([])),
    ]);
    setLoadingPhotos(false);
    setLoadingEvents(false);
  }, []);

  // Load storage stats and data on mount
  useEffect(() => {
    apiFetch("/api/content/storage-stats")
      .then((r) => r.json())
      .then((data) => setStorageUsage(data))
      .catch(() => {});
    setTimeout(() => fetchData(), 0);
  }, [fetchData]);

  // ========== DERIVED DATA ==========

  const filteredGallery = galleryPhotos
    .filter((p) => (galleryFilter === "all" || p.category === galleryFilter) && (!selectedAlbum || p.albumId === selectedAlbum.id) && (!selectedEntry || p.entryId === selectedEntry.id))
    .sort((a, b) => {
      const aTime = a.uploadedAt?.toMillis() ?? 0;
      const bTime = b.uploadedAt?.toMillis() ?? 0;
      if (gallerySort === "newest") return bTime - aTime;
      if (gallerySort === "oldest") return aTime - bTime;
      if (gallerySort === "name") return a.title.localeCompare(b.title);
      if (gallerySort === "size") return b.fileSize - a.fileSize;
      return 0;
    });

  const sortedEvents = [...events].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // ========== HANDLERS ==========

  function toggleSelect(id: string) {
    setSelectedGallery((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSelectAll() {
    if (selectedGallery.size === filteredGallery.length) {
      setSelectedGallery(new Set());
    } else {
      setSelectedGallery(new Set(filteredGallery.map((p) => p.id)));
    }
  }

  function openEditPhoto(photo: GalleryPhoto) {
    setEditPhoto(photo);
    setEditTitle(photo.title);
    setEditDesc(photo.description);
    setEditCategory(photo.category);
    setEditFeatured(photo.isFeatured);
    setEditAltText(photo.altText);
    setEditAlbumId(photo.albumId);
  }

  async function handleSaveEdit() {
    if (!editPhoto) return;
    setSavingEntity(true);
    try {
      await updateGalleryPhoto(editPhoto.id, {
        title: editTitle,
        description: editDesc,
        category: editCategory,
        isFeatured: editFeatured,
        altText: editAltText,
        albumId: editAlbumId,
      });
      setGalleryPhotos((prev) =>
        prev.map((p) =>
          p.id === editPhoto.id
            ? { ...p, title: editTitle, description: editDesc, category: editCategory, isFeatured: editFeatured, altText: editAltText, albumId: editAlbumId }
            : p
        )
      );
      window.dispatchEvent(new CustomEvent("show-toast", {
        detail: { title: "Photo Updated", message: `"${editTitle}" changes saved`, type: "success", duration: 2500 },
      }));
      await hapticSuccess();
      setEditPhoto(null);
    } catch {
      window.dispatchEvent(new CustomEvent("show-toast", {
        detail: { title: "Error", message: "Failed to save changes", type: "error", duration: 3000 },
      }));
    } finally {
      setSavingEntity(false);
    }
  }

  function openEventModal(event?: EventItem) {
    if (event) {
      setEditEvent(event);
      setEventName(event.name);
      setEventDate(event.date);
      setEventLocation(event.location);
      setEventDesc(event.desc);
      setEventIsPaid(event.isPaid);
      setEventFee(event.fee);
      setEventImagePreview(event.imageUrl || "");
    } else {
      setEditEvent(null);
      setEventName("");
      setEventDate(new Date().toISOString().slice(0, 16));
      setEventLocation("");
      setEventDesc("");
      setEventIsPaid(false);
      setEventFee(0);
      setEventImagePreview("");
    }
    setEventImageFile(null);
    setShowEventModal(true);
  }

  async function handleSaveEvent() {
    if (!eventName.trim()) return;
    setSavingEntity(true);
    try {
      let imageUrl = eventImagePreview || "";
      if (eventImageFile) {
        setEventImageUploading(true);
        const result = await uploadFile(eventImageFile, churchId, "gallery");
        imageUrl = result.cdnUrl;
        setEventImageUploading(false);
      }
      const data: Omit<EventItem, "id"> = {
        name: eventName.trim(),
        date: eventDate || new Date().toISOString(),
        location: eventLocation.trim(),
        desc: eventDesc.trim(),
        isPaid: eventIsPaid,
        fee: eventFee,
        imageUrl,
        rsvpRequired: false,
        capacity: 0,
        attendees: [],
      };
      if (editEvent) {
        await updateEvent(editEvent.id, data);
        setEvents((prev) => prev.map((e) => (e.id === editEvent.id ? { ...e, ...data } : e)));
      } else {
        await addEvent(data);
        // Re-fetch to get the real saved data with correct ID
        getEvents().then(setEvents).catch(() => {});
      }
      window.dispatchEvent(new CustomEvent("show-toast", {
        detail: { title: editEvent ? "Event Updated" : "Event Created", message: `"${eventName}" saved`, type: "success", duration: 2500 },
      }));
      await hapticSuccess();
      setShowEventModal(false);
    } catch {
      window.dispatchEvent(new CustomEvent("show-toast", {
        detail: { title: "Error", message: "Failed to save event", type: "error", duration: 3000 },
      }));
    } finally {
      setSavingEntity(false);
    }
  }

  function handleBulkDelete() {
    setDeleteTargets({ type: "photos", count: selectedGallery.size });
    setShowDeleteConfirm(true);
  }

  async function handleConfirmDelete() {
    const { type } = deleteTargets;
    try {
      if (type === "photos") {
        const targets = [...selectedGallery];
        const itemsToDelete = galleryPhotos.filter((p) => targets.includes(p.id));
        const storagePaths = itemsToDelete.map((p) => p.storagePath).filter(Boolean);
        if (storagePaths.length > 0) {
          await apiFetch("/api/content/delete", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ storage_paths: storagePaths }),
          });
        }
        await Promise.all(targets.map((id) => deleteGalleryPhoto(id)));
        setGalleryPhotos((prev) => prev.filter((p) => !targets.includes(p.id)));
        window.dispatchEvent(new CustomEvent("show-toast", {
          detail: { title: "Deleted", message: `${targets.length} photos deleted permanently`, type: "success", duration: 3000 },
        }));
        await hapticSuccess();
      } else if (type === "events" && deleteTargetId) {
        const eventId = parseInt(deleteTargetId);
        if (!isNaN(eventId)) {
          await deleteEventById(eventId);
          setEvents((prev) => prev.filter((e) => e.id !== eventId));
          window.dispatchEvent(new CustomEvent("show-toast", {
            detail: { title: "Deleted", message: `Event deleted`, type: "success", duration: 3000 },
          }));
          await hapticSuccess();
        }
      }
    } catch {
      window.dispatchEvent(new CustomEvent("show-toast", {
        detail: { title: "Error", message: `Failed to delete ${type}`, type: "error", duration: 3000 },
      }));
      fetchData();
    }
    setShowDeleteConfirm(false);
    setDeleteTargetId(null);
    setSelectedGallery(new Set());
    setSelectMode(false);
  }



  // ========== ALBUM HANDLERS ==========

  function openAlbumModal(album?: Album) {
    if (album) {
      setEditAlbum(album);
      setAlbumTitle(album.title);
      setAlbumDesc(album.description);
      setAlbumCategory(album.category);
      setAlbumSortOrder(album.sortOrder);
    } else {
      setEditAlbum(null);
      setAlbumTitle("");
      setAlbumDesc("");
      setAlbumCategory("events");
      setAlbumSortOrder(albums.length + 1);
    }
    setShowAlbumModal(true);
  }

  async function handleSaveAlbum() {
    if (!albumTitle.trim()) return;
    setSavingEntity(true);
    try {
      const data = {
        title: albumTitle.trim(),
        description: albumDesc.trim(),
        category: albumCategory,
        sortOrder: albumSortOrder,
        photoCount: editAlbum?.photoCount ?? 0,
      };
      if (editAlbum) {
        await updateAlbum(editAlbum.id, data);
        setAlbums((prev) => prev.map((a) => (a.id === editAlbum.id ? { ...a, ...data } : a)));
      } else {
        const id = await addAlbum(data);
        setAlbums((prev) => [...prev, { id, ...data, createdAt: null }]);
      }
      window.dispatchEvent(new CustomEvent("show-toast", {
        detail: { title: editAlbum ? "Album Updated" : "Album Created", message: `"${albumTitle}" saved`, type: "success", duration: 2500 },
      }));
      await hapticSuccess();
      setShowAlbumModal(false);
    } catch {
      window.dispatchEvent(new CustomEvent("show-toast", {
        detail: { title: "Error", message: "Failed to save album", type: "error", duration: 3000 },
      }));
    } finally {
      setSavingEntity(false);
    }
  }

  async function handleDeleteAlbum(id: string) {
    try {
      await deleteAlbum(id);
      setAlbums((prev) => prev.filter((a) => a.id !== id));
      setGalleryPhotos((prev) => prev.map((p) => p.albumId === id ? { ...p, albumId: undefined } : p));
      window.dispatchEvent(new CustomEvent("show-toast", {
        detail: { title: "Deleted", message: "Album deleted", type: "success", duration: 2500 },
      }));
      await hapticSuccess();
    } catch {
      window.dispatchEvent(new CustomEvent("show-toast", {
        detail: { title: "Error", message: "Failed to delete album", type: "error", duration: 3000 },
      }));
    }
    setDeleteAlbumTarget(null);
  }

  function getPhotosInAlbum(albumId: string): GalleryPhoto[] {
    return galleryPhotos.filter((p) => p.albumId === albumId);
  }

  const filteredAlbums = albums.filter((a) => galleryFilter === "all" || a.category === galleryFilter);

  // ========== ENTRY HANDLERS ==========

  async function fetchEntries(albumId: string) {
    try {
      const data = await getAlbumEntries(albumId);
      setEntries(data);
    } catch {
      setEntries([]);
    }
  }

  function openEntryModal(entry?: AlbumEntry) {
    if (entry) {
      setEditEntry(entry);
      setEntryTitle(entry.title);
      setEntryDesc(entry.description);
      setEntryDate(entry.date);
      setEntryCoverUrl(entry.coverUrl);
    } else {
      setEditEntry(null);
      setEntryTitle("");
      setEntryDesc("");
      setEntryDate(new Date().toISOString().slice(0, 10));
      setEntryCoverUrl("");
    }
    setEntryCoverFile(null);
    setShowEntryModal(true);
  }

  async function handleSaveEntry() {
    if (!entryTitle.trim() || !selectedAlbum) return;
    setSavingEntity(true);
    try {
      let coverUrl = entryCoverUrl || "";
      if (entryCoverFile) {
        setEntryCoverUploading(true);
        const result = await uploadFile(entryCoverFile, churchId, "gallery");
        coverUrl = result.cdnUrl;
        setEntryCoverUploading(false);
      }
      const data = {
        albumId: selectedAlbum.id,
        title: entryTitle.trim(),
        description: entryDesc.trim(),
        date: entryDate,
        coverUrl,
        sortOrder: entries.length + 1,
        photoCount: editEntry?.photoCount ?? 0,
      };
      if (editEntry) {
        await updateAlbumEntry(editEntry.id, data);
        setEntries((prev) => prev.map((e) => (e.id === editEntry.id ? { ...e, ...data } : e)));
      } else {
        const id = await addAlbumEntry(data);
        setEntries((prev) => [...prev, { id, ...data, createdAt: null }]);
      }
      window.dispatchEvent(new CustomEvent("show-toast", {
        detail: { title: editEntry ? "Entry Updated" : "Entry Created", message: `"${entryTitle}" saved`, type: "success", duration: 2500 },
      }));
      await hapticSuccess();
      setShowEntryModal(false);
    } catch {
      window.dispatchEvent(new CustomEvent("show-toast", {
        detail: { title: "Error", message: "Failed to save entry", type: "error", duration: 3000 },
      }));
    } finally {
      setSavingEntity(false);
    }
  }

  async function handleDeleteEntry(id: string) {
    try {
      await deleteAlbumEntry(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
      setGalleryPhotos((prev) => prev.map((p) => p.entryId === id ? { ...p, entryId: undefined } : p));
      window.dispatchEvent(new CustomEvent("show-toast", {
        detail: { title: "Deleted", message: "Entry deleted", type: "success", duration: 2500 },
      }));
      await hapticSuccess();
    } catch {
      window.dispatchEvent(new CustomEvent("show-toast", {
        detail: { title: "Error", message: "Failed to delete entry", type: "error", duration: 3000 },
      }));
    }
    setDeleteEntryTarget(null);
  }

  function handleSelectAlbum(album: Album) {
    setSelectedAlbum(album);
    setGalleryFilter("all");
    setSelectedEntry(null);
    setSelectedGallery(new Set());
    setSelectMode(false);
    fetchEntries(album.id);
  }

  function getPhotosInEntry(entryId: string): GalleryPhoto[] {
    return galleryPhotos.filter((p) => p.entryId === entryId);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    const newFiles = files.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
      title: file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " "),
      category: "events" as string,
      progress: 0,
    }));
    setUploadFiles((prev) => [...prev, ...newFiles]);
  }

  function removeUploadFile(idx: number) {
    setUploadFiles((prev) => {
      const item = prev[idx];
      if (item) URL.revokeObjectURL(item.preview);
      return prev.filter((_, i) => i !== idx);
    });
  }

  async function uploadSingleFile(file: File, title: string, category: string): Promise<void> {
    const result = await uploadFile(file, churchId, category);
    await addGalleryPhoto({
      title,
      description: "",
      category,
      cdnUrl: result.cdnUrl,
      fileSize: result.fileSize,
      width: result.width,
      height: result.height,
      isFeatured: false,
      altText: title,
      storagePath: result.storagePath,
      albumId: selectedAlbum?.id || undefined,
      entryId: selectedEntry?.id || undefined,
    });
  }

  async function handleQuickImport(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    e.target.value = "";
    setUploading(true);
    const total = files.length;
    let completed = 0;
    const CONCURRENCY = 3;
    for (let i = 0; i < files.length; i += CONCURRENCY) {
      const batch = files.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((f) => {
          const name = f.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
          return uploadSingleFile(f, name, "events");
        })
      );
      completed += results.filter((r) => r.status === "fulfilled").length;
    }
    setUploading(false);
    await fetchData();
    window.dispatchEvent(new CustomEvent("show-toast", {
      detail: { title: "Import Complete", message: `${completed} of ${total} photos imported`, type: "success", duration: 3000 },
    }));
    await hapticSuccess();
  }

  async function handleUpload() {
    if (uploadFiles.length === 0) return;
    setUploading(true);

    let completed = 0;
    const CONCURRENCY = 3;
    for (let i = 0; i < uploadFiles.length; i += CONCURRENCY) {
      const batch = uploadFiles.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (uf, batchIdx) => {
          const idx = i + batchIdx;
          try {
            await uploadSingleFile(uf.file, uf.title, uf.category);
            setUploadFiles((prev) => prev.map((f, j) => (j === idx ? { ...f, progress: 100 } : f)));
            completed++;
          } catch (err) {
            window.dispatchEvent(new CustomEvent("show-toast", {
              detail: { title: "Upload Error", message: `"${uf.title}" failed: ${err instanceof Error ? err.message : "Unknown"}`, type: "error", duration: 4000 },
            }));
            setUploadFiles((prev) => prev.map((f, j) => (j === idx ? { ...f, progress: -1 } : f)));
          }
        })
      );
    }

    setUploading(false);
    if (completed > 0) {
      await fetchData();
      window.dispatchEvent(new CustomEvent("show-toast", {
        detail: { title: "Upload Complete", message: `${completed} of ${uploadFiles.length} photos uploaded`, type: "success", duration: 3000 },
      }));
      await hapticSuccess();
    }
    setShowUploadModal(false);
    setUploadFiles([]);
  }

  function getCategoryColor(cat: string): string {
    const colors: Record<string, string> = {
      events: "#E8A838", services: "#8B5CF6", community: "#4ADE80",
      leadership: "#3B82F6", facility: "#EF4444", general: "#6B6B6B",
      event: "#E8A838", prayer: "#8B5CF6", notice: "#3B82F6", urgent: "#EF4444",
    };
    return colors[cat] || "#6B6B6B";
  }

  const storageBarColor = storageUsage.percentUsed > 80 ? "var(--error)" : storageUsage.percentUsed > 50 ? "var(--primary)" : "#4ADE80";
  const displayedEntryPhotos = filteredGallery.slice(0, entryPhotoPage * PHOTOS_PER_PAGE);
  const hasMoreEntryPhotos = displayedEntryPhotos.length < filteredGallery.length;

  function formatUploadTime(ts: Timestamp | null): string {
    if (!ts) return "";
    const d = ts.toDate();
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  return (
    <>
      <style>{`
        :root {
            --primary: #E8A838; --primary-light: #F5C76B; --primary-dark: #C48A2A;
            --bg: #0F0F0F; --surface: #1A1A1A; --surface-elevated: #242424;
            --surface-card: #1E1E1E; --surface-hover: #2A2A2A;
            --text-primary: #FFFFFF; --text-secondary: #A0A0A0; --text-tertiary: #6B6B6B;
            --border: #2A2A2A; --error: #FF6B6B; --success: #4ADE80; --info: #38BDF8;
            --overlay: rgba(0,0,0,0.92); --gradient-start: #E8A838; --gradient-end: #D4762A;
            --shadow-soft: 0 4px 20px rgba(232,168,56,0.15);
            --shadow-elevated: 0 8px 32px rgba(0,0,0,0.5);
            --radius-sm: 12px; --radius-md: 16px; --radius-lg: 20px; --radius-xl: 24px; --radius-full: 50%;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }
        html, body { height: 100%; overflow: hidden; background: var(--bg); color: var(--text-primary); }

        .app-container { height: 100%; display: flex; flex-direction: column; position: relative; overflow: hidden; }
        @media (min-width: 480px) { .app-container { max-width: 480px; margin: 0 auto; border-left: 1px solid var(--border); border-right: 1px solid var(--border); } }

        /* ========== HEADER ========== */
        .header { padding: 8px 20px 10px; display: flex; align-items: center; gap: 12px; flex-shrink: 0; background: var(--bg); z-index: 100; }
        .header-back { width: 40px; height: 40px; border-radius: var(--radius-full); background: var(--surface); border: none; color: var(--text-primary); font-size: 18px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s ease; flex-shrink: 0; }
        .header-back:active { background: var(--surface-elevated); transform: scale(0.92); }
        .header-info { flex: 1; min-width: 0; }
        .header-title { font-size: 18px; font-weight: 700; }
        .header-sub { font-size: 11px; color: var(--text-tertiary); font-weight: 500; margin-top: 1px; }
        .header-actions { display: flex; align-items: center; gap: 6px; }
        .header-btn { width: 40px; height: 40px; border-radius: var(--radius-full); background: var(--surface); border: none; color: var(--text-primary); font-size: 16px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s ease; }
        .header-btn:active { background: var(--surface-elevated); transform: scale(0.92); }
        .header-upload-btn { padding: 8px 16px; background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end)); border: none; border-radius: 10px; color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: all 0.2s ease; }
        .header-upload-btn:active { transform: scale(0.95); }

        /* ========== STORAGE BAR ========== */
        .storage-bar { padding: 0 20px 12px; flex-shrink: 0; }
        .storage-bar-header { display: flex; justify-content: space-between; font-size: 11px; color: var(--text-tertiary); font-weight: 500; margin-bottom: 6px; }
        .storage-bar-track { width: 100%; height: 6px; background: var(--surface); border-radius: 3px; overflow: hidden; }
        .storage-bar-fill { height: 100%; border-radius: 3px; transition: width 0.5s ease; }

        /* ========== TABS ========== */
        .tabs-bar { display: flex; border-bottom: 1px solid var(--border); flex-shrink: 0; background: var(--bg); padding: 0 8px; gap: 0; }
        .tab-btn { flex: 1; padding: 12px 6px; background: none; border: none; color: var(--text-tertiary); font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s ease; position: relative; display: flex; align-items: center; justify-content: center; gap: 5px; }
        .tab-btn i { font-size: 13px; }
        .tab-btn.active { color: var(--primary); }
        .tab-btn.active::after { content: ''; position: absolute; bottom: 0; left: 15%; right: 15%; height: 3px; background: var(--primary); border-radius: 3px 3px 0 0; }
        .tab-btn:active { opacity: 0.7; }

        /* ========== CONTENT ========== */
        .content-scroll { flex: 1; overflow-y: auto; overflow-x: hidden; -webkit-overflow-scrolling: touch; padding-bottom: 80px; }
        .content-scroll::-webkit-scrollbar { display: none; }

        /* ========== GALLERY TOP BAR ========== */
        .gallery-toolbar { display: flex; align-items: center; gap: 8px; padding: 12px 16px; }
        .gallery-toolbar-left { display: flex; align-items: center; gap: 8px; flex: 1; overflow-x: auto; flex-wrap: nowrap; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
        .gallery-toolbar-left::-webkit-scrollbar { display: none; }
        .gallery-select-all { width: 22px; height: 22px; border-radius: 4px; border: 2px solid var(--border); background: transparent; cursor: pointer; display: none; align-items: center; justify-content: center; transition: all 0.2s; flex-shrink: 0; }
        .gallery-select-all.visible { display: flex; }
        .gallery-select-all.checked { background: var(--primary); border-color: var(--primary); }
        .gallery-select-all.checked::after { content: '\\f00c'; font-family: 'Font Awesome 6 Free'; font-weight: 900; color: #fff; font-size: 11px; }
        .gallery-filter-chip { padding: 6px 14px; border-radius: 20px; background: var(--surface); border: 1px solid var(--border); color: var(--text-secondary); font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s; white-space: nowrap; flex-shrink: 0; }
        .gallery-filter-chip:active { transform: scale(0.95); }
        .gallery-filter-chip.active { background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end)); border-color: transparent; color: #fff; }
        .gallery-toolbar-right { display: flex; align-items: center; gap: 6px; margin-left: auto; }
        .gallery-sort-btn { padding: 6px 12px; border-radius: 20px; background: var(--surface); border: 1px solid var(--border); color: var(--text-secondary); font-size: 12px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 4px; }
        .gallery-sort-btn:active { transform: scale(0.95); }
        .view-toggle { display: flex; gap: 4px; }
        .view-toggle-btn { width: 34px; height: 34px; border-radius: 8px; background: var(--surface); border: 1px solid var(--border); color: var(--text-tertiary); font-size: 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
        .view-toggle-btn:active { transform: scale(0.9); }
        .view-toggle-btn.active { background: var(--surface-elevated); color: var(--primary); border-color: var(--primary); }

        /* ========== GALLERY GRID ========== */
        .gallery-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; padding: 0 12px; }
        .gallery-item { position: relative; border-radius: var(--radius-md); overflow: hidden; cursor: pointer; border: 1px solid var(--border); aspect-ratio: 1; transition: all 0.2s; }
        .gallery-item:active { transform: scale(0.97); opacity: 0.8; }
        .gallery-item img { width: 100%; height: 100%; object-fit: cover; }
        .gallery-item-overlay { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 50%); opacity: 0; transition: opacity 0.25s; padding: 12px; display: flex; flex-direction: column; justify-content: flex-end; }
        .gallery-item:hover .gallery-item-overlay { opacity: 1; }
        .gallery-item-title { font-size: 13px; font-weight: 600; color: #fff; margin-bottom: 2px; }
        .gallery-item-meta { font-size: 10px; color: rgba(255,255,255,0.7); }
        .gallery-item-badge { position: absolute; top: 8px; right: 8px; padding: 3px 8px; border-radius: 4px; font-size: 9px; font-weight: 700; text-transform: uppercase; color: #fff; }
        .gallery-item-featured { position: absolute; top: 8px; left: 8px; width: 22px; height: 22px; background: var(--primary); border-radius: var(--radius-full); display: flex; align-items: center; justify-content: center; color: #fff; font-size: 10px; border: 2px solid var(--bg); }
        .gallery-item-select { position: absolute; top: 8px; left: 8px; width: 22px; height: 22px; border-radius: var(--radius-full); border: 2px solid rgba(255,255,255,0.5); background: rgba(0,0,0,0.3); cursor: pointer; display: none; align-items: center; justify-content: center; transition: all 0.2s; z-index: 2; }
        .gallery-item-select.visible { display: flex; }
        .gallery-item-select.selected { background: var(--primary); border-color: var(--primary); }
        .gallery-item-select.selected::after { content: '\\f00c'; font-family: 'Font Awesome 6 Free'; font-weight: 900; color: #fff; font-size: 10px; }

        /* ========== GALLERY MASONRY ========== */
        .gallery-masonry { columns: 2; column-gap: 10px; padding: 0 12px; }
        .gallery-masonry-item { break-inside: avoid; margin-bottom: 10px; border-radius: var(--radius-md); overflow: hidden; border: 1px solid var(--border); cursor: pointer; position: relative; }
        .gallery-masonry-item img { width: 100%; display: block; }

        /* ========== GALLERY LIST ========== */
        .gallery-list { padding: 0 12px; }
        .gallery-list-item { display: flex; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--border); cursor: pointer; transition: opacity 0.2s; }
        .gallery-list-item:last-child { border-bottom: none; }
        .gallery-list-item:active { opacity: 0.6; }
        .gallery-list-thumb { width: 80px; height: 80px; border-radius: var(--radius-sm); overflow: hidden; flex-shrink: 0; border: 1px solid var(--border); }
        .gallery-list-thumb img { width: 100%; height: 100%; object-fit: cover; }
        .gallery-list-info { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; }
        .gallery-list-title { font-size: 14px; font-weight: 600; margin-bottom: 3px; }
        .gallery-list-meta { font-size: 12px; color: var(--text-tertiary); }

        /* ========== BULK BAR ========== */
        .bulk-bar { position: fixed; bottom: calc(68px + env(safe-area-inset-bottom, 0px)); left: 16px; right: 16px; background: var(--surface-elevated); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 12px 16px; display: none; align-items: center; justify-content: space-between; z-index: 999; box-shadow: var(--shadow-elevated); }
        .bulk-bar.active { display: flex; }
        .bulk-count { font-size: 14px; font-weight: 600; }
        .bulk-actions { display: flex; gap: 8px; }
        .bulk-btn { padding: 8px 16px; border-radius: var(--radius-sm); font-size: 13px; font-weight: 700; border: none; cursor: pointer; transition: all 0.2s; }
        .bulk-btn:active { transform: scale(0.95); }
        .bulk-btn.feature { background: var(--surface-hover); color: var(--primary); }
        .bulk-btn.delete { background: rgba(239,68,68,0.12); color: var(--error); }

        /* ========== ALBUMS ========== */
        .album-grid { display: grid; grid-template-columns: repeat(1, 1fr); gap: 16px; padding: 0 12px; }
        .album-card { position: relative; border-radius: var(--radius-lg); overflow: hidden; cursor: pointer; border: 1px solid var(--border); background: var(--surface-card); transition: all 0.25s; box-shadow: var(--shadow-soft); }
        .album-card:active { transform: scale(0.97); }
        .album-cover { width: 100%; aspect-ratio: 4/3; object-fit: cover; display: block; background: var(--surface); }
        .album-cover-placeholder { width: 100%; aspect-ratio: 4/3; display: flex; align-items: center; justify-content: center; background: var(--surface); color: var(--text-tertiary); font-size: 42px; }
        .album-carousel { position: relative; width: 100%; aspect-ratio: 4/3; overflow: hidden; background: var(--surface); }
        .album-carousel-img { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; transition: opacity 0.8s ease; }
        .album-carousel-dots { position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%); display: flex; gap: 6px; z-index: 2; }
        .album-carousel-dot { width: 6px; height: 6px; border-radius: 50%; background: rgba(255,255,255,0.4); transition: all 0.3s; }
        .album-carousel-dot.active { background: #fff; width: 20px; border-radius: 3px; }
        .album-info { padding: 14px 16px 16px; }
        .album-title { font-size: 17px; font-weight: 700; margin-bottom: 4px; }
        .album-meta { font-size: 13px; color: var(--text-tertiary); display: flex; align-items: center; gap: 8px; }
        .album-badge { position: absolute; top: 12px; right: 12px; padding: 5px 12px; border-radius: 6px; font-size: 10px; font-weight: 700; text-transform: uppercase; color: #fff; letter-spacing: 0.5px; backdrop-filter: blur(4px); background: rgba(0,0,0,0.4); }
        .album-actions { position: absolute; top: 12px; left: 12px; display: flex; gap: 6px; z-index: 3; }
        .album-card:hover .album-actions { opacity: 1; }
        .album-action-btn { width: 34px; height: 34px; border-radius: var(--radius-full); background: rgba(0,0,0,0.6); border: none; color: #fff; font-size: 13px; cursor: pointer; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(6px); transition: all 0.2s; }
        .album-action-btn:active { transform: scale(0.9); }

        .album-header { display: flex; align-items: center; gap: 10px; padding: 8px 16px; }
        .album-back-btn { width: 36px; height: 36px; border-radius: var(--radius-full); background: var(--surface); border: none; color: var(--text-primary); font-size: 15px; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; }
        .album-back-btn:active { background: var(--surface-elevated); transform: scale(0.92); }
        .header-icon-btn { width: 36px; height: 36px; border-radius: var(--radius-full); background: none; border: none; color: var(--text-tertiary); font-size: 15px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .header-icon-btn:active { background: var(--surface-hover); color: var(--error); }
        .album-header-title { font-size: 16px; font-weight: 700; flex: 1; }
        .album-header-count { font-size: 12px; color: var(--text-tertiary); }

        .create-album-btn { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 18px; border: 2px dashed var(--border); border-radius: var(--radius-lg); color: var(--text-tertiary); font-size: 15px; font-weight: 600; cursor: pointer; transition: all 0.2s; background: transparent; grid-column: 1 / -1; }
        .create-album-btn:active { border-color: var(--primary); color: var(--primary); background: rgba(232,168,56,0.05); }

        .no-albums { padding: 40px 16px; text-align: center; color: var(--text-tertiary); }
        .no-albums i { font-size: 36px; margin-bottom: 10px; }
        .no-albums p { font-size: 13px; }

        /* ========== BANNERS TAB ========== */
        .banners-list { padding: 0 12px; }
        .banner-item { display: flex; gap: 12px; padding: 14px; background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-md); margin-bottom: 10px; cursor: grab; transition: all 0.2s; }
        .banner-item:active { cursor: grabbing; background: var(--surface-elevated); }
        .banner-item.dragging { opacity: 0.5; }
        .banner-thumb { width: 100px; height: 56px; border-radius: 8px; overflow: hidden; flex-shrink: 0; border: 1px solid var(--border); }
        .banner-thumb img { width: 100%; height: 100%; object-fit: cover; }
        .banner-info { flex: 1; min-width: 0; }
        .banner-title { font-size: 14px; font-weight: 600; margin-bottom: 2px; }
        .banner-subtitle { font-size: 12px; color: var(--text-secondary); margin-bottom: 4px; }
        .banner-meta { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--text-tertiary); }
        .banner-actions { display: flex; flex-direction: column; gap: 6px; align-items: flex-end; justify-content: center; }
        .banner-toggle { width: 40px; height: 24px; border-radius: 12px; border: none; cursor: pointer; transition: all 0.2s; position: relative; }
        .banner-toggle.active { background: var(--success); }
        .banner-toggle.inactive { background: var(--surface-hover); }
        .banner-toggle::after { content: ''; position: absolute; top: 2px; left: 2px; width: 20px; height: 20px; border-radius: var(--radius-full); background: #fff; transition: all 0.2s; }
        .banner-toggle.active::after { left: 18px; }
        .banner-icon-btn { width: 32px; height: 32px; border-radius: var(--radius-full); background: none; border: none; color: var(--text-tertiary); font-size: 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
        .banner-icon-btn:active { background: var(--surface-hover); }

        /* ========== ANNOUNCEMENTS ========== */


        /* ========== SETTINGS ========== */
        .settings-section { padding: 0 12px; }
        .settings-group { background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 16px; margin-bottom: 12px; }
        .settings-group-title { font-size: 14px; font-weight: 700; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
        .settings-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid var(--border); }
        .settings-row:last-child { border-bottom: none; }
        .settings-label { font-size: 13px; font-weight: 500; }
        .settings-label small { display: block; font-size: 11px; color: var(--text-tertiary); font-weight: 400; margin-top: 2px; }
        .settings-value { font-size: 13px; color: var(--text-secondary); font-weight: 500; display: flex; align-items: center; gap: 8px; }
        .settings-copy-btn { background: none; border: none; color: var(--primary); font-size: 14px; cursor: pointer; padding: 4px; }
        .settings-toggle { width: 44px; height: 26px; border-radius: 13px; border: none; cursor: pointer; transition: all 0.2s; position: relative; flex-shrink: 0; }
        .settings-toggle.active { background: var(--primary); }
        .settings-toggle.inactive { background: var(--surface-hover); }
        .settings-toggle::after { content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: var(--radius-full); background: #fff; transition: all 0.2s; }
        .settings-toggle.active::after { left: 21px; }
        .settings-select { padding: 8px 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; color: var(--text-primary); font-size: 13px; font-weight: 500; outline: none; }
        .settings-select:focus { border-color: var(--primary); }
        .settings-input { width: 80px; padding: 8px 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; color: var(--text-primary); font-size: 13px; font-weight: 500; outline: none; text-align: center; }
        .settings-input:focus { border-color: var(--primary); }
        .settings-danger-btn { width: 100%; padding: 14px; background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.3); border-radius: var(--radius-md); color: var(--error); font-size: 14px; font-weight: 700; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 8px; }
        .settings-danger-btn:active { transform: scale(0.97); }
        .settings-purge-btn { width: 100%; padding: 14px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-md); color: var(--text-primary); font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 8px; }
        .settings-purge-btn:active { transform: scale(0.97); }

        /* ========== UPLOAD MODAL ========== */
        .modal-overlay { position: fixed; inset: 0; background: var(--overlay); z-index: 9000; display: flex; align-items: flex-end; justify-content: center; opacity: 0; visibility: hidden; transition: opacity 0.3s, visibility 0.3s; }
        .modal-overlay.active { opacity: 1; visibility: visible; }
        .modal-sheet { width: 100%; max-height: 90vh; background: var(--surface); border-radius: 28px 28px 0 0; padding: 0 0 env(safe-area-inset-bottom, 20px); transform: translateY(100%); transition: transform 0.35s cubic-bezier(0.32, 0.72, 0, 1); overflow: hidden; display: flex; flex-direction: column; }
        .modal-overlay.active .modal-sheet { transform: translateY(0); }
        .modal-handle { width: 40px; height: 5px; background: var(--text-tertiary); border-radius: 3px; margin: 12px auto 8px; opacity: 0.5; }
        .modal-header { padding: 8px 24px 16px; text-align: center; }
        .modal-header h2 { font-size: 20px; font-weight: 700; }
        .modal-header p { font-size: 14px; color: var(--text-secondary); margin-top: 4px; }
        .modal-body { flex: 1; overflow-y: auto; padding: 0 24px 20px; -webkit-overflow-scrolling: touch; }
        .modal-body::-webkit-scrollbar { display: none; }
        .modal-footer { padding: 16px 24px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 10px; }

        .btn-primary { width: 100%; padding: 16px; background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end)); border: none; border-radius: var(--radius-md); color: #fff; font-size: 16px; font-weight: 700; cursor: pointer; transition: all 0.2s; }
        .btn-primary:active { transform: scale(0.97); opacity: 0.9; }
        .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-secondary { width: 100%; padding: 16px; background: transparent; border: 1.5px solid var(--border); border-radius: var(--radius-md); color: var(--text-primary); font-size: 16px; font-weight: 700; cursor: pointer; transition: all 0.2s; }
        .btn-secondary:active { background: var(--surface-elevated); }

        .form-group { margin-bottom: 16px; }
        .form-group label { display: block; font-size: 13px; font-weight: 600; color: var(--text-secondary); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
        .form-input { width: 100%; padding: 14px 16px; background: var(--surface-card); border: 1.5px solid var(--border); border-radius: var(--radius-md); color: var(--text-primary); font-size: 15px; font-weight: 500; outline: none; transition: all 0.2s; }
        .form-input:focus { border-color: var(--primary); box-shadow: 0 0 0 4px rgba(232,168,56,0.08); }
        .form-input::placeholder { color: var(--text-tertiary); font-weight: 400; }
        .form-textarea { width: 100%; padding: 14px 16px; background: var(--surface-card); border: 1.5px solid var(--border); border-radius: var(--radius-md); color: var(--text-primary); font-size: 15px; font-weight: 500; outline: none; transition: all 0.2s; min-height: 100px; resize: vertical; font-family: inherit; line-height: 1.5; }
        .form-textarea:focus { border-color: var(--primary); box-shadow: 0 0 0 4px rgba(232,168,56,0.08); }
        .form-select { width: 100%; padding: 14px 16px; background: var(--surface-card); border: 1.5px solid var(--border); border-radius: var(--radius-md); color: var(--text-primary); font-size: 15px; font-weight: 500; outline: none; transition: all 0.2s; appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%236B6B6B' d='M6 8L1 3h10z'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 16px center; }
        .form-select:focus { border-color: var(--primary); box-shadow: 0 0 0 4px rgba(232,168,56,0.08); }
        .form-row { display: flex; gap: 12px; }
        .form-row > * { flex: 1; }

        .upload-zone { border: 2px dashed var(--border); border-radius: var(--radius-lg); padding: 32px; text-align: center; cursor: pointer; transition: all 0.3s; margin-bottom: 16px; }
        .upload-zone:active { border-color: var(--primary); background: rgba(232,168,56,0.05); }
        .upload-zone-icon { font-size: 40px; color: var(--text-tertiary); margin-bottom: 12px; }
        .upload-zone-title { font-size: 15px; font-weight: 600; margin-bottom: 4px; }
        .upload-zone-sub { font-size: 13px; color: var(--text-secondary); }
        .upload-file-list { display: flex; flex-direction: column; gap: 8px; }
        .upload-file-item { display: flex; align-items: center; gap: 12px; padding: 10px; background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-md); }
        .upload-file-preview { width: 48px; height: 48px; border-radius: 8px; overflow: hidden; flex-shrink: 0; border: 1px solid var(--border); }
        .upload-file-preview img { width: 100%; height: 100%; object-fit: cover; }
        .upload-file-info { flex: 1; min-width: 0; }
        .upload-file-title { font-size: 13px; font-weight: 600; margin-bottom: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .upload-file-bar { height: 3px; background: var(--surface-elevated); border-radius: 2px; overflow: hidden; margin-top: 4px; }
        .upload-file-fill { height: 100%; background: linear-gradient(90deg, var(--gradient-start), var(--gradient-end)); border-radius: 2px; transition: width 0.3s; }
        .upload-file-remove { width: 28px; height: 28px; border-radius: var(--radius-full); background: none; border: none; color: var(--text-tertiary); font-size: 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .upload-file-remove:active { background: rgba(239,68,68,0.12); color: var(--error); }

        /* ========== DELETE CONFIRM ========== */
        .delete-confirm-text { text-align: center; color: var(--text-secondary); font-size: 15px; line-height: 1.6; }
        .delete-confirm-text strong { color: var(--text-primary); }
        .btn-danger { width: 100%; padding: 16px; background: rgba(239,68,68,0.12); border: none; border-radius: var(--radius-md); color: var(--error); font-size: 16px; font-weight: 700; cursor: pointer; transition: all 0.2s; }
        .btn-danger:active { transform: scale(0.97); }

        /* ========== EMPTY STATE ========== */
        .empty-state { display: flex; flex-direction: column; align-items: center; padding: 60px 16px; text-align: center; }
        .empty-state-icon { width: 72px; height: 72px; border-radius: var(--radius-full); background: var(--surface); display: flex; align-items: center; justify-content: center; margin-bottom: 14px; font-size: 28px; color: var(--text-tertiary); }
        .empty-state h3 { font-size: 17px; font-weight: 700; margin-bottom: 6px; }
        .empty-state p { font-size: 14px; color: var(--text-secondary); max-width: 280px; }

        /* ========== BANNER PREVIEW ========== */
        .banner-preview-box { width: 100%; aspect-ratio: 3/1; border-radius: var(--radius-md); overflow: hidden; background: var(--surface); border: 1px solid var(--border); margin-bottom: 16px; display: flex; align-items: center; justify-content: center; position: relative; }
        .banner-preview-box img { width: 100%; height: 100%; object-fit: cover; }
        .banner-preview-label { position: absolute; top: 8px; left: 8px; padding: 3px 8px; background: rgba(0,0,0,0.7); color: rgba(255,255,255,0.7); font-size: 10px; border-radius: 4px; }
        .banner-preview-overlay { position: absolute; inset: 0; background: linear-gradient(to right, rgba(0,0,0,0.5) 0%, transparent 100%); display: flex; flex-direction: column; justify-content: center; padding: 20px; }
        .banner-preview-text { color: #fff; }
        .banner-preview-text h3 { font-size: 16px; font-weight: 700; margin-bottom: 4px; }
        .banner-preview-text p { font-size: 12px; opacity: 0.85; }

        /* ========== TOGGLE ROW ========== */
        .toggle-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; }
        .toggle-label { font-size: 13px; font-weight: 500; }
        .toggle-switch { width: 44px; height: 26px; border-radius: 13px; border: none; cursor: pointer; transition: all 0.2s; position: relative; flex-shrink: 0; }
        .toggle-switch.on { background: var(--primary); }
        .toggle-switch.off { background: var(--surface-hover); }
        .toggle-switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: var(--radius-full); background: #fff; transition: all 0.2s; }
        .toggle-switch.on::after { left: 21px; }

        .storage-breakdown { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
        .storage-break-row { display: flex; align-items: center; gap: 10px; }
        .storage-break-dot { width: 8px; height: 8px; border-radius: var(--radius-full); flex-shrink: 0; }
        .storage-break-name { flex: 1; font-size: 13px; color: var(--text-secondary); }
        .storage-break-size { font-size: 13px; font-weight: 600; }
        .storage-break-bar { width: 60px; height: 4px; background: var(--surface); border-radius: 2px; overflow: hidden; }
        .storage-break-fill { height: 100%; border-radius: 2px; }

        /* ========== BOTTOM NAV ========== */
        .bottom-nav {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            background: rgba(15,15,15,0.92);
            backdrop-filter: blur(20px) saturate(180%);
            -webkit-backdrop-filter: blur(20px) saturate(180%);
            border-top: 1px solid var(--border);
            padding: 8px 0 calc(8px + env(safe-area-inset-bottom, 0px));
            z-index: 900;
            display: flex;
            justify-content: space-around;
            align-items: center;
        }
        @media (min-width: 480px) {
            .bottom-nav { max-width: 480px; margin: 0 auto; }
        }
        .nav-item {
            display: flex; flex-direction: column; align-items: center; gap: 4px;
            padding: 6px 12px; background: none; border: none;
            color: var(--text-tertiary); cursor: pointer;
            transition: all 0.2s ease; position: relative;
        }
        .nav-item.active { color: var(--primary); }
        .nav-item i { font-size: 20px; transition: transform 0.2s ease; }
        .nav-item:active i { transform: scale(0.85); }
        .nav-item span { font-size: 10px; font-weight: 600; }
        .nav-item .nav-badge { position: absolute; top: 2px; right: 6px; width: 8px; height: 8px; background: var(--error); border-radius: var(--radius-full); border: 2px solid var(--bg); }

        /* ========== BANNER FORM IMAGE UPLOAD ========== */
        .banner-image-upload { width: 100%; aspect-ratio: 3/1; border-radius: var(--radius-md); border: 2px dashed var(--border); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; cursor: pointer; transition: all 0.3s; color: var(--text-tertiary); margin-bottom: 16px; }
        .banner-image-upload:active { border-color: var(--primary); color: var(--primary); }
        .banner-image-upload i { font-size: 28px; }
        .banner-image-upload span { font-size: 13px; font-weight: 500; }

        .event-image-upload-zone {
          width: 100%; aspect-ratio: 16/9;
          border-radius: var(--radius-md);
          border: 2px dashed var(--border);
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          gap: 8px; cursor: pointer;
          transition: all 0.3s;
          position: relative;
          overflow: hidden;
        }
        .event-image-upload-zone:active {
          border-color: var(--primary);
          background: rgba(232,168,56,0.05);
        }
        .event-image-preview {
          width: 100%; height: 100%;
          object-fit: cover;
          position: absolute; inset: 0;
        }
        .event-image-clear-btn {
          position: absolute; top: 8px; right: 8px;
          width: 28px; height: 28px;
          border-radius: var(--radius-full);
          background: rgba(0,0,0,0.6);
          border: none; color: #fff;
          font-size: 12px; cursor: pointer;
          display: flex; align-items: center;
          justify-content: center; z-index: 2;
        }
        .event-image-clear-btn:active {
          background: rgba(255,255,255,0.2);
        }
        .load-more-btn:active { background: var(--surface-elevated); }

        /* ========== PREMIUM EVENT CARDS ========== */
        .event-pcard {
          display: flex; gap: 14px; padding: 16px;
          background: var(--surface-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          margin-bottom: 12px;
          position: relative;
          overflow: hidden;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          align-items: stretch;
        }
        .event-pcard:active { transform: scale(0.97); }
        .event-pcard::before {
          content: '';
          position: absolute; top: 0; left: 0; right: 0; height: 3px;
          background: linear-gradient(90deg, var(--gradient-start), var(--gradient-end));
          opacity: 0;
          transition: opacity 0.3s;
          z-index: 2;
        }
        .event-pcard:hover::before { opacity: 1; }
        .event-pcard-glow {
          position: absolute; top: -50%; right: -20%;
          width: 160px; height: 160px;
          background: radial-gradient(circle, rgba(232,168,56,0.06) 0%, transparent 70%);
          pointer-events: none;
          opacity: 0;
          transition: opacity 0.4s;
          z-index: 0;
        }
        .event-pcard:hover .event-pcard-glow { opacity: 1; }

        .event-pcard-img-wrap {
          width: 72px; min-height: 72px;
          border-radius: var(--radius-sm);
          overflow: hidden;
          flex-shrink: 0;
          border: 1px solid var(--border);
          position: relative;
          z-index: 1;
        }
        .event-pcard-img-wrap img {
          width: 100%; height: 100%;
          object-fit: cover;
          transition: transform 0.4s ease;
        }
        .event-pcard:hover .event-pcard-img-wrap img { transform: scale(1.08); }
        .event-pcard-date-badge {
          width: 72px; height: 72px;
          border-radius: var(--radius-sm);
          flex-shrink: 0;
          position: relative;
          z-index: 1;
          background: rgba(232,168,56,0.06);
          border: 1px solid rgba(232,168,56,0.15);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2px;
        }
        .event-pcard-date-day {
          font-size: 22px; font-weight: 800; line-height: 1;
          color: var(--primary);
        }
        .event-pcard-date-month {
          font-size: 10px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.5px; color: var(--text-secondary);
        }

        .event-pcard-body {
          flex: 1; min-width: 0;
          display: flex; flex-direction: column;
          justify-content: center;
          position: relative; z-index: 1;
          gap: 3px;
        }
        .event-pcard-name {
          font-size: 15px; font-weight: 700;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          line-height: 1.3;
        }
        .event-pcard-meta-row {
          display: flex; flex-wrap: wrap; gap: 8px;
          margin-top: 2px;
        }
        .event-pcard-meta {
          font-size: 12px; color: var(--text-secondary);
          display: flex; align-items: center; gap: 4px;
        }
        .event-pcard-meta i {
          font-size: 10px; color: var(--text-tertiary);
          width: 14px; text-align: center;
        }
        .event-pcard-fee {
          display: inline-flex; align-items: center;
          margin-top: 4px;
          font-size: 11px; font-weight: 700;
          color: var(--primary);
          background: rgba(232,168,56,0.08);
          padding: 2px 10px; border-radius: 6px;
          width: fit-content;
        }

        .event-pcard-actions {
          display: flex;
          flex-direction: column;
          gap: 6px;
          align-items: flex-end;
          justify-content: center;
          position: relative; z-index: 1;
          flex-shrink: 0;
        }
        .event-pcard-action-btn {
          width: 34px; height: 34px;
          border-radius: var(--radius-full);
          background: var(--surface);
          border: 1px solid var(--border);
          color: var(--text-tertiary);
          font-size: 13px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }
        .event-pcard-action-btn:active {
          background: var(--surface-elevated);
          transform: scale(0.88);
        }
        .event-pcard-action-btn.edit:active { color: var(--primary); border-color: rgba(232,168,56,0.3); }
        .event-pcard-action-btn.delete:active { color: var(--error); border-color: rgba(239,68,68,0.3); }

        /* ========== IMAGE VIEWER ========== */
        .iv-overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,0.96); z-index: 10000;
          display: flex; flex-direction: column; user-select: none;
          -webkit-user-select: none; touch-action: none;
        }
        .iv-top {
          position: absolute; top: 0; left: 0; right: 0;
          display: flex; align-items: center; justify-content: space-between;
          padding: env(safe-area-inset-top, 12px) 16px 12px;
          background: linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, transparent 100%);
          z-index: 2;
        }
        .iv-top-left { display: flex; align-items: center; gap: 10px; }
        .iv-counter {
          font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.9);
          background: rgba(255,255,255,0.1); padding: 4px 12px; border-radius: 20px;
        }
        .iv-close {
          width: 36px; height: 36px; border-radius: var(--radius-full);
          background: rgba(255,255,255,0.08); border: none; color: #fff;
          font-size: 18px; cursor: pointer; display: flex;
          align-items: center; justify-content: center;
          transition: all 0.2s ease; backdrop-filter: blur(4px);
        }
        .iv-close:active { background: rgba(255,255,255,0.2); transform: scale(0.92); }
        .iv-top-right { display: flex; align-items: center; gap: 8px; }
        .iv-action-btn {
          width: 36px; height: 36px; border-radius: var(--radius-full);
          background: rgba(255,255,255,0.08); border: none; color: #fff;
          font-size: 15px; cursor: pointer; display: flex;
          align-items: center; justify-content: center;
          transition: all 0.2s ease; backdrop-filter: blur(4px);
        }
        .iv-action-btn:active { background: rgba(255,255,255,0.2); transform: scale(0.92); }
        .iv-image-wrap {
          flex: 1; display: flex; align-items: center; justify-content: center;
          position: relative; overflow: hidden;
        }
        .iv-image {
          max-width: 100%; max-height: 100%; object-fit: contain;
          transition: transform 0.25s ease; will-change: transform;
        }
        .iv-image:active { transform: scale(1.02); }
        .iv-nav {
          position: absolute; top: 50%; transform: translateY(-50%);
          width: 44px; height: 44px; border-radius: var(--radius-full);
          background: rgba(255,255,255,0.08); border: none; color: #fff;
          font-size: 18px; cursor: pointer; display: flex;
          align-items: center; justify-content: center;
          transition: all 0.2s ease; backdrop-filter: blur(4px); z-index: 3;
        }
        .iv-nav:active { background: rgba(255,255,255,0.2); transform: translateY(-50%) scale(0.9); }
        .iv-nav-left { left: 12px; }
        .iv-nav-right { right: 12px; }
        .iv-bottom {
          padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px));
          background: linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 100%);
          text-align: center;
        }
        .iv-title {
          font-size: 14px; font-weight: 600; color: rgba(255,255,255,0.9);
          margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .iv-meta {
          font-size: 12px; color: rgba(255,255,255,0.5);
        }

        /* ========== SKELETON LOADERS ========== */
        .skel { background: linear-gradient(90deg, var(--surface) 25%, var(--surface-hover) 50%, var(--surface) 75%); background-size: 200% 100%; animation: sk-shimmer 1.4s ease-in-out infinite; border-radius: 8px; }
        @keyframes sk-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        .skel-line { height: 13px; margin-bottom: 7px; width: 100%; }
        .skel-line.w70 { width: 70%; }
        .skel-line.w60 { width: 60%; }
        .skel-line.w40 { width: 40%; }
        .skel-card { height: 110px; width: 100%; border-radius: var(--radius-md); }
        .skel-avatar { width: 44px; height: 44px; border-radius: var(--radius-full); flex-shrink: 0; }
        .skel-thumb { width: 56px; height: 56px; border-radius: var(--radius-sm); flex-shrink: 0; }
        .skel-img { width: 100%; aspect-ratio: 4/3; border-radius: var(--radius-md); }
        .skel-banner { width: 100px; height: 56px; border-radius: 8px; flex-shrink: 0; }
        .skel-ann-thumb { width: 80px; height: 80px; border-radius: var(--radius-sm); flex-shrink: 0; }
      `}</style>

      <ToastBridge />

      <div className="app-container">
        <PremiumTopBar
          showBack
          title="Content Management"
          rightContent={
            <>
              <button
                onClick={() => setShowUploadModal(true)}
                style={{
                  padding: "6px 12px", borderRadius: 10,
                  background: "linear-gradient(135deg, var(--gradient-start, #E8A838), var(--gradient-end, #D4762A))",
                  border: "none", color: "#fff",
                  fontSize: 12, fontWeight: 700, cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 5,
                }}
              >
                <i className="fas fa-cloud-arrow-up"></i> Upload
              </button>
              <button
                style={{
                  width: 36, height: 36, borderRadius: "50%",
                  background: "var(--surface, #1A1A1A)",
                  border: "1px solid var(--border, #2A2A2A)",
                  color: "var(--text-primary, #fff)",
                  fontSize: 15, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <i className="fas fa-ellipsis-vertical"></i>
              </button>
            </>
          }
        />

        {/* ========== STORAGE BAR ========== */}
        <div className="storage-bar">
          <div className="storage-bar-header">
            <span>Storage</span>
            <span>{storageUsage.formattedUsed} / {storageUsage.formattedTotal} ({storageUsage.percentUsed}%)</span>
          </div>
          <div className="storage-bar-track">
            <div className="storage-bar-fill" style={{ width: `${storageUsage.percentUsed}%`, background: storageBarColor }}></div>
          </div>
        </div>

        {/* ========== TABS ========== */}
        <div className="tabs-bar">
          <button className={`tab-btn${activeTab === "gallery" ? " active" : ""}`} onClick={() => setActiveTab("gallery")}>
            <i className="fas fa-images"></i> Gallery
          </button>
          <button className={`tab-btn${activeTab === "events" ? " active" : ""}`} onClick={() => setActiveTab("events")}>
            <i className="fas fa-calendar-alt"></i> Events
          </button>
          <button className={`tab-btn${activeTab === "settings" ? " active" : ""}`} onClick={() => setActiveTab("settings")}>
            <i className="fas fa-gear"></i> Settings
          </button>
        </div>

        {/* ========== CONTENT ========== */}
        <div className="content-scroll">

          {/* ===== TAB 1: GALLERY (ALBUMS → ENTRIES → PHOTOS) ===== */}
          {activeTab === "gallery" && (
            <>
              {selectedEntry ? (
                /* ---- PHOTOS IN ENTRY ---- */
                <>
                  <div className="album-header">
                    <button className="album-back-btn" onClick={() => { setSelectedEntry(null); setSelectedGallery(new Set()); setSelectMode(false); }}>
                      <i className="fas fa-arrow-left"></i>
                    </button>
                    <div className="album-header-title">{selectedEntry.title}</div>
                    <div className="album-header-count">{getPhotosInEntry(selectedEntry.id).length} photos</div>
                    <div className="header-actions">
                      <button className="header-upload-btn" onClick={() => setShowUploadModal(true)}>
                        <i className="fas fa-cloud-arrow-up"></i> Upload
                      </button>
                      <button className="header-icon-btn" onClick={async () => {
                        try {
                          const { Camera, CameraResultType } = await import("@capacitor/camera");
                          const photo = await Camera.getPhoto({ quality: 90, allowEditing: false, resultType: CameraResultType.DataUrl });
                          if (photo.dataUrl) {
                            const blob = await (await fetch(photo.dataUrl)).blob();
                            const file = new File([blob], `camera_${Date.now()}.jpg`, { type: "image/jpeg" });
                            setUploadFiles((prev) => [...prev, { file, preview: photo.dataUrl!, title: `Camera ${new Date().toLocaleString()}`, category: "events", progress: 0 }]);
                            setShowUploadModal(true);
                          }
                        } catch {
                          // User cancelled or error
                        }
                      }} title="Take photo with camera">
                        <i className="fas fa-camera"></i>
                      </button>
                      <button className="header-icon-btn" onClick={() => quickInputRef.current?.click()} title="Quick import photos">
                        <i className="fas fa-bolt"></i>
                      </button>
                    </div>
                  </div>
                  <input ref={quickInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple style={{ display: "none" }} onChange={handleQuickImport} />
                  <div className="gallery-toolbar">
                    <div className="gallery-toolbar-left">
                      <div className={`gallery-select-all visible${selectedGallery.size === filteredGallery.length && filteredGallery.length > 0 ? " checked" : ""}`} onClick={handleSelectAll}></div>
                      <div className="gallery-filter-chip" style={{ display: selectMode ? "none" : "flex" }} onClick={() => setSelectMode(true)}><i className="fas fa-check-square"></i> Select</div>
                      {selectMode && (<div className="gallery-filter-chip" onClick={() => { setSelectMode(false); setSelectedGallery(new Set()); }}><i className="fas fa-xmark"></i> Cancel</div>)}
                    </div>
                    <div className="gallery-toolbar-right">
                      <div className="gallery-sort-btn" onClick={() => { const sorts = ["newest", "oldest", "name", "size"]; const idx = sorts.indexOf(gallerySort); setGallerySort(sorts[(idx + 1) % sorts.length]); }}>
                        <i className="fas fa-arrow-up-wide-short"></i> {gallerySort.charAt(0).toUpperCase() + gallerySort.slice(1)}
                      </div>
                      <div className="view-toggle">
                        <button className={`view-toggle-btn${galleryView === "grid" ? " active" : ""}`} onClick={() => setGalleryView("grid")}><i className="fas fa-grid-2"></i></button>
                        <button className={`view-toggle-btn${galleryView === "masonry" ? " active" : ""}`} onClick={() => setGalleryView("masonry")}><i className="fas fa-grip"></i></button>
                        <button className={`view-toggle-btn${galleryView === "list" ? " active" : ""}`} onClick={() => setGalleryView("list")}><i className="fas fa-list"></i></button>
                      </div>
                    </div>
                  </div>
                  {filteredGallery.length === 0 ? (
                    <div className="empty-state">
                      <div className="empty-state-icon"><i className="fas fa-image"></i></div>
                      <h3>No photos in this entry</h3>
                      <p>Tap Upload to add photos</p>
                    </div>
                  ) : galleryView === "grid" ? (
                    <div className="gallery-grid">
                      {displayedEntryPhotos.map((photo, pidx) => (
                        <div className="gallery-item" key={photo.id} onClick={() => { if (!selectMode) openViewer(pidx); }}>
                          <img src={photo.cdnUrl} alt={photo.title} loading="lazy" />
                          <div className="gallery-item-overlay"><div className="gallery-item-title">{photo.title}</div><div className="gallery-item-meta">{formatBytes(photo.fileSize)} · {formatUploadTime(photo.uploadedAt)}</div></div>
                          <div className={`gallery-item-select visible${selectedGallery.has(photo.id) ? " selected" : ""}`} onClick={(e) => { e.stopPropagation(); toggleSelect(photo.id); }}></div>
                          {photo.isFeatured && <div className="gallery-item-featured"><i className="fas fa-star"></i></div>}
                          <div className="gallery-item-badge" style={{ background: getCategoryColor(photo.category) }}>{photo.category}</div>
                        </div>
                      ))}
                    </div>
                  ) : galleryView === "masonry" ? (
                    <div className="gallery-masonry">
                      {displayedEntryPhotos.map((photo, i) => (
                        <div className="gallery-masonry-item" key={photo.id} onClick={() => openViewer(i)}>
                          <img src={photo.cdnUrl} alt={photo.title} loading="lazy" style={{ aspectRatio: i % 2 === 0 ? "1" : "1.2" }} />
                          <div className="gallery-item-badge" style={{ position: "absolute", top: 8, right: 8, padding: "3px 8px", borderRadius: 4, fontSize: 9, fontWeight: 700, textTransform: "uppercase", color: "#fff", background: getCategoryColor(photo.category) }}>{photo.category}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="gallery-list">
                      {displayedEntryPhotos.map((photo, pidx) => (
                        <div className="gallery-list-item" key={photo.id} onClick={() => openViewer(pidx)}>
                          <div className="gallery-list-thumb"><img src={photo.cdnUrl} alt={photo.title} loading="lazy" /></div>
                          <div className="gallery-list-info">
                            <div className="gallery-list-title">{photo.title}</div>
                            <div className="gallery-list-meta">{photo.category} · {formatBytes(photo.fileSize)} · {formatUploadTime(photo.uploadedAt)}{photo.isFeatured && <span> · <span style={{ color: "var(--primary)" }}>Featured</span></span>}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {hasMoreEntryPhotos && (
                    <button className="load-more-btn" onClick={() => setEntryPhotoPage((p) => p + 1)}>
                      <i className="fas fa-chevron-down"></i> Load More ({filteredGallery.length - displayedEntryPhotos.length} remaining)
                    </button>
                  )}
                  <div style={{ height: "100px" }}></div>
                </>
              ) : selectedAlbum ? (
                /* ---- ENTRIES IN ALBUM ---- */
                <>
                  <div className="album-header">
                    <button className="album-back-btn" onClick={() => { setSelectedAlbum(null); setSelectedEntry(null); setGalleryFilter("all"); setSelectedGallery(new Set()); setSelectMode(false); }}>
                      <i className="fas fa-arrow-left"></i>
                    </button>
                    <div className="album-header-title">{selectedAlbum.title}</div>
                    <div className="album-header-count">{entries.length} entries</div>
                    <div className="header-actions">
                      <button className="header-upload-btn" onClick={() => openEntryModal()}>
                        <i className="fas fa-plus"></i> New Entry
                      </button>
                      <button className="header-icon-btn" onClick={(e) => { e.stopPropagation(); setDeleteAlbumTarget(selectedAlbum.id); }} title="Delete album">
                        <i className="fas fa-trash"></i>
                      </button>
                    </div>
                  </div>
                  {entries.length === 0 ? (
                    <div className="no-albums">
                      <i className="fas fa-folder-open"></i>
                      <p>No entries yet — tap &ldquo;New Entry&rdquo; to create one</p>
                    </div>
                  ) : (
                    <div className="album-grid">
                      {entries.map((entry) => {
                        const photoCount = getPhotosInEntry(entry.id).length;
                        return (
                          <div className="album-card" key={entry.id} onClick={() => { setSelectedEntry(entry); setEntryPhotoPage(1); }}>
                            {entry.coverUrl ? (
                              <img src={entry.coverUrl} alt={entry.title} className="album-cover" loading="lazy" />
                            ) : (
                              <div className="album-cover-placeholder"><i className="fas fa-calendar-day"></i></div>
                            )}
                            <div className="album-actions">
                              <button className="album-action-btn" onClick={(e) => { e.stopPropagation(); openEntryModal(entry); }}><i className="fas fa-pen"></i></button>
                              <button className="album-action-btn" onClick={(e) => { e.stopPropagation(); setDeleteEntryTarget(entry.id); }}><i className="fas fa-trash"></i></button>
                            </div>
                            <div className="album-info">
                              <div className="album-title">{entry.title}</div>
                              <div className="album-meta">
                                <span>{photoCount} photo{photoCount !== 1 ? "s" : ""}</span>
                                {entry.date && <><span>·</span><span>{entry.date}</span></>}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div style={{ height: "100px" }}></div>
                </>
              ) : (
                /* ---- ALBUMS VIEW ---- */
                <>
                  <div style={{ padding: "12px 16px 8px", display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>Albums</span>
                    <button className="header-upload-btn" onClick={() => openAlbumModal()}>
                      <i className="fas fa-plus"></i> New Album
                    </button>
                  </div>
                  <div className="gallery-toolbar" style={{ paddingTop: 0 }}>
                    <div className="gallery-toolbar-left">
                      {categories.map((cat) => (
                        <div key={cat} className={`gallery-filter-chip${galleryFilter === cat ? " active" : ""}`} onClick={() => setGalleryFilter(cat)}>
                          {cat === "all" ? "All" : cat.charAt(0).toUpperCase() + cat.slice(1)}
                        </div>
                      ))}
                    </div>
                  </div>
                  {loadingPhotos ? (
                    <div className="album-grid">
                      {[1,2,3].map((i) => (
                        <div className="album-card" key={i}>
                          <div className="skel skel-img" />
                          <div style={{ padding: "14px 16px 16px" }}>
                            <div className="skel skel-line w60" />
                            <div className="skel skel-line w40" style={{ marginBottom: 0 }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : filteredAlbums.length === 0 ? (
                    <div className="no-albums">
                      <i className="fas fa-images"></i>
                      <p>No albums yet — tap &ldquo;New Album&rdquo; to create one</p>
                    </div>
                  ) : (
                    <div className="album-grid">
                      {filteredAlbums.map((album) => {
                        const photoCount = getPhotosInAlbum(album.id).length;
                        return (
                          <div className="album-card" key={album.id} onClick={() => handleSelectAlbum(album)}>
                            <AlbumCarousel photos={galleryPhotos.filter(p => p.albumId === album.id)} />
                            <div className="album-badge" style={{ background: getCategoryColor(album.category) }}>{album.category}</div>
                            <div className="album-actions">
                              <button className="album-action-btn" onClick={(e) => { e.stopPropagation(); openAlbumModal(album); }}><i className="fas fa-pen"></i></button>
                              <button className="album-action-btn" onClick={(e) => { e.stopPropagation(); setDeleteAlbumTarget(album.id); }}><i className="fas fa-trash"></i></button>
                            </div>
                            <div className="album-info">
                              <div className="album-title">{album.title}</div>
                              <div className="album-meta"><span>{photoCount} photo{photoCount !== 1 ? "s" : ""}</span>{album.description && <><span>·</span><span>{album.description}</span></>}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div style={{ height: "100px" }}></div>
                </>
              )}
            </>
          )}

          {/* ===== TAB 2: EVENTS ===== */}
          {activeTab === "events" && (
            <>
              <div style={{ padding: "12px 16px", display: "flex", gap: 10 }}>
                <button className="btn-primary" style={{ flex: 1 }} onClick={() => openEventModal()}>
                  <i className="fas fa-plus"></i> Create Event
                </button>
              </div>
              <div className="events-list" style={{ padding: "0 16px" }}>
                {loadingEvents ? (
                  [1,2,3].map((i) => (
                    <div className="event-pcard" key={i} style={{ padding: 14, alignItems: "center", gap: 14 }}>
                      <div className="skel" style={{ width: 72, height: 72, borderRadius: 10, flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div className="skel skel-line w70" />
                        <div className="skel skel-line w50" />
                        <div className="skel skel-line w40" style={{ marginBottom: 0 }} />
                      </div>
                    </div>
                  ))
                ) : sortedEvents.length === 0 ? (
                  <div className="empty-state" style={{ padding: "40px 0" }}>
                    <div className="empty-state-icon"><i className="fas fa-calendar-alt"></i></div>
                    <h3>No events yet</h3>
                    <p>Create your first event to show on both dashboards</p>
                  </div>
                ) : (
                  sortedEvents.map((ev) => {
                    const d = new Date(ev.date);
                    const day = d.getDate();
                    const month = d.toLocaleString("en-US", { month: "short" });
                    const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
                    return (
                      <div className="event-pcard" key={ev.id}>
                        <div className="event-pcard-glow"></div>
                        {ev.imageUrl ? (
                          <div className="event-pcard-img-wrap">
                            <img src={ev.imageUrl} alt="" />
                          </div>
                        ) : (
                          <div className="event-pcard-date-badge">
                            <span className="event-pcard-date-day">{day}</span>
                            <span className="event-pcard-date-month">{month}</span>
                          </div>
                        )}
                        <div className="event-pcard-body">
                          <div className="event-pcard-name">{ev.name}</div>
                          <div className="event-pcard-meta-row">
                            <span className="event-pcard-meta">
                              <i className="fas fa-clock"></i> {time}
                            </span>
                            {ev.location && (
                              <span className="event-pcard-meta">
                                <i className="fas fa-location-dot"></i> {ev.location}
                              </span>
                            )}
                          </div>
                          {ev.isPaid && ev.fee > 0 && (
                            <div className="event-pcard-fee">Ksh {ev.fee}</div>
                          )}
                        </div>
                        <div className="event-pcard-actions">
                          <button className="event-pcard-action-btn edit" onClick={() => openEventModal(ev)}>
                            <i className="fas fa-pen"></i>
                          </button>
                          <button className="event-pcard-action-btn delete" onClick={() => { setDeleteTargetId(String(ev.id)); setDeleteTargets({ type: "events", count: 1 }); setShowDeleteConfirm(true); }}>
                            <i className="fas fa-trash"></i>
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              <div style={{ height: "40px" }}></div>
            </>
          )}

          {/* ===== TAB 4: SETTINGS ===== */}
          {activeTab === "settings" && (
            <div className="settings-section" style={{ paddingTop: 16, paddingBottom: 40 }}>
              {/* BunnyCDN Config */}
              <div className="settings-group">
                <div className="settings-group-title"><i className="fas fa-database"></i> Storage Configuration</div>
                <div className="settings-row">
                  <div>
                    <div className="settings-label">Storage Zone</div>
                    <small style={{ fontSize: 11, color: "var(--text-tertiary)" }}>histoview</small>
                  </div>
                </div>
                <div className="settings-row">
                  <div className="settings-label">CDN Base URL <small>Copied to clipboard on tap</small></div>
                  <div className="settings-value" style={{ fontSize: 12, maxWidth: "60%", overflow: "hidden", textOverflow: "ellipsis" }}>
                    <span>https://histoview.b-cdn.net/</span>
                    <button className="settings-copy-btn" onClick={() => {
                      navigator.clipboard.writeText("https://histoview.b-cdn.net/");
                      window.dispatchEvent(new CustomEvent("show-toast", { detail: { title: "Copied", message: "CDN URL copied to clipboard", type: "success", duration: 2000 } }));
                    }}><i className="fas fa-copy"></i></button>
                  </div>
                </div>
              </div>

              {/* Storage Breakdown */}
              <div className="settings-group">
                <div className="settings-group-title"><i className="fas fa-chart-pie"></i> Storage Usage</div>
                <div className="settings-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}>
                  <div className="settings-label">Used: {storageUsage.formattedUsed} of {storageUsage.formattedTotal}</div>
                  <div className="storage-bar-track" style={{ height: 8 }}>
                    <div className="storage-bar-fill" style={{ width: `${storageUsage.percentUsed}%`, background: storageBarColor }}></div>
                  </div>
                </div>
                <div className="storage-breakdown">
                  {[
                    { label: "Gallery", size: "1.2 GB", pct: 50, color: "#E8A838" },
                    { label: "Banners", size: "0.3 GB", pct: 12.5, color: "#8B5CF6" },
                    { label: "Other", size: "0.5 GB", pct: 20.8, color: "#6B6B6B" },
                  ].map((item) => (
                    <div className="storage-break-row" key={item.label}>
                      <div className="storage-break-dot" style={{ background: item.color }}></div>
                      <div className="storage-break-name">{item.label}</div>
                      <div className="storage-break-bar"><div className="storage-break-fill" style={{ width: `${item.pct}%`, background: item.color }}></div></div>
                      <div className="storage-break-size">{item.size}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Image Optimization */}
              <div className="settings-group">
                <div className="settings-group-title"><i className="fas fa-wand-magic"></i> Image Optimization</div>
                <div className="toggle-row">
                  <span className="toggle-label">Auto-compress on upload</span>
                  <button className={`toggle-switch ${autoCompress ? "on" : "off"}`} onClick={() => setAutoCompress(!autoCompress)}></button>
                </div>
                <div className="settings-row">
                  <span className="settings-label">Max width cap</span>
                  <select className="settings-select" value={maxWidth} onChange={(e) => setMaxWidth(e.target.value)}>
                    <option value="1920">1920px</option>
                    <option value="1280">1280px</option>
                    <option value="800">800px</option>
                  </select>
                </div>
                <div className="settings-row">
                  <span className="settings-label">Output format</span>
                  <select className="settings-select" value={outputFormat} onChange={(e) => setOutputFormat(e.target.value)}>
                    <option value="webp">WEBP (recommended)</option>
                    <option value="original">Original</option>
                  </select>
                </div>
              </div>

              {/* Auto Cleanup */}
              <div className="settings-group">
                <div className="settings-group-title"><i className="fas fa-broom"></i> Cleanup</div>
                <div className="toggle-row">
                  <span className="toggle-label">Auto-delete expired banners</span>
                  <button className={`toggle-switch ${autoDeleteExpired ? "on" : "off"}`} onClick={() => setAutoDeleteExpired(!autoDeleteExpired)}></button>
                </div>
              </div>

              {/* Purge CDN */}
              <div className="settings-group">
                <div className="settings-group-title"><i className="fas fa-arrow-rotate-right"></i> Cache</div>
                <button className="settings-purge-btn" onClick={() => setShowPurgeConfirm(true)}>
                  <i className="fas fa-trash-can"></i> Purge CDN Cache
                </button>
                <p style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 8, textAlign: "center" }}>
                  Clears BunnyCDN cache for all content. May take a few minutes to propagate.
                </p>
              </div>

              {/* Danger Zone */}
              <div className="settings-group" style={{ borderColor: "rgba(239,68,68,0.3)" }}>
                <div className="settings-group-title" style={{ color: "var(--error)" }}><i className="fas fa-triangle-exclamation"></i> Danger Zone</div>
                <button className="settings-danger-btn" onClick={() => {
                  window.dispatchEvent(new CustomEvent("show-toast", { detail: { title: "Disconnected", message: "YouTube channel disconnected from content manager", type: "warning", duration: 3000 } }));
                }}>
                  <i className="fas fa-unlink"></i> Disconnect YouTube Channel
                </button>
              </div>
            </div>
          )}

        </div>

        {/* ========== BULK ACTIONS BAR ========== */}
        <div className={`bulk-bar${selectedGallery.size > 0 ? " active" : ""}`}>
          <span className="bulk-count">{selectedGallery.size} selected</span>
          <div className="bulk-actions">
            <button className="bulk-btn feature" onClick={async () => {
              const ids = [...selectedGallery];
              try {
                await Promise.all(ids.map((id) => updateGalleryPhoto(id, { isFeatured: true })));
                setGalleryPhotos((prev) => prev.map((p) => ids.includes(p.id) ? { ...p, isFeatured: true } : p));
                window.dispatchEvent(new CustomEvent("show-toast", { detail: { title: "Featured", message: `${ids.length} photos marked as featured`, type: "success", duration: 2500 } }));
                await hapticSuccess();
              } catch {
                window.dispatchEvent(new CustomEvent("show-toast", { detail: { title: "Error", message: "Failed to feature photos", type: "error", duration: 3000 } }));
              }
            }}>
              <i className="fas fa-star"></i> Feature
            </button>
            <button className="bulk-btn delete" onClick={handleBulkDelete}>
              <i className="fas fa-trash"></i> Delete
            </button>
          </div>
        </div>

        {/* ========== UPLOAD MODAL ========== */}
        <div className={`modal-overlay${showUploadModal ? " active" : ""}`} onClick={(e) => { if (e.target === e.currentTarget && !uploading) setShowUploadModal(false); }}>
          <div className="modal-sheet">
            <div className="modal-handle"></div>
            <div className="modal-header">
              <h2>Upload Photos</h2>
              <p>Drag & drop or browse to select files</p>
            </div>
            <div className="modal-body">
              <div className="upload-zone" onClick={() => fileInputRef.current?.click()}>
                <div className="upload-zone-icon"><i className="fas fa-cloud-arrow-up"></i></div>
                <div className="upload-zone-title">Tap to select multiple photos</div>
                <div className="upload-zone-sub">JPG, PNG, WEBP up to 10MB each &middot; select several at once</div>
              </div>
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple style={{ display: "none" }} onChange={handleFileSelect} />
              {albums.length > 0 && uploadFiles.length > 0 && !selectedAlbum && (
                <div className="form-group" style={{ marginTop: 4 }}>
                  <label>Add to Album</label>
                  <select className="form-select" defaultValue="" onChange={(e) => {
                    const found = albums.find((a) => a.id === e.target.value);
                    setSelectedAlbum(found || null);
                  }}>
                    <option value="">No album (standalone)</option>
                    {albums.map((a) => (
                      <option key={a.id} value={a.id}>{a.title}</option>
                    ))}
                  </select>
                </div>
              )}

              {uploadFiles.length > 0 && (
                <>
                  {uploadFiles.some((f) => f.progress === 0) && (
                    <div className="form-group" style={{ marginTop: 4 }}>
                      <label>Set category for all</label>
                      <select className="form-select" defaultValue="" onChange={(e) => {
                        const cat = e.target.value;
                        if (cat) setUploadFiles((prev) => prev.map((f) => f.progress === 0 ? { ...f, category: cat } : f));
                      }}>
                        <option value="">— Apply to all —</option>
                        <option value="events">Events</option>
                        <option value="services">Services</option>
                        <option value="community">Community</option>
                        <option value="leadership">Leadership</option>
                        <option value="facility">Facility</option>
                      </select>
                    </div>
                  )}
                  <div className="upload-file-list">
                    {uploadFiles.map((item, i) => (
                      <div className="upload-file-item" key={i}>
                        <div className="upload-file-preview"><img src={item.preview} alt={item.title} /></div>
                        <div className="upload-file-info">
                          <div className="upload-file-title">
                            <input type="text" className="form-input" style={{ padding: "6px 10px", fontSize: 12 }} value={item.title}
                              onChange={(e) => setUploadFiles((prev) => prev.map((f, j) => j === i ? { ...f, title: e.target.value } : f))} />
                          </div>
                          {item.progress > 0 && (
                            <div className="upload-file-bar">
                              <div className="upload-file-fill" style={{ width: `${item.progress}%`, background: item.progress === -1 ? "var(--error)" : undefined }}></div>
                            </div>
                          )}
                          {item.progress === -1 && <span style={{ fontSize: 11, color: "var(--error)" }}>Upload failed</span>}
                          {item.progress === 0 && (
                            <select className="form-select" style={{ padding: "4px 8px", fontSize: 11, marginTop: 4 }}
                              value={item.category} onChange={(e) => setUploadFiles((prev) => prev.map((f, j) => j === i ? { ...f, category: e.target.value } : f))}>
                              <option value="events">Events</option>
                              <option value="services">Services</option>
                              <option value="community">Community</option>
                              <option value="leadership">Leadership</option>
                              <option value="facility">Facility</option>
                            </select>
                          )}
                        </div>
                        {!uploading && (
                          <button className="upload-file-remove" onClick={() => removeUploadFile(i)}>
                            <i className="fas fa-xmark"></i>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="modal-footer">
              {uploadFiles.length > 0 && (
                <button className="btn-primary" onClick={handleUpload} disabled={uploading}>
                  {uploading ? `Uploading... ${Math.round(uploadFiles.reduce((a, f) => a + f.progress, 0) / uploadFiles.length)}%` : `Upload ${uploadFiles.length} Photo${uploadFiles.length > 1 ? "s" : ""}`}
                </button>
              )}
              <button className="btn-secondary" onClick={() => { if (!uploading) { setShowUploadModal(false); setUploadFiles([]); } }}>
                {uploading ? "Uploading... Please wait" : "Cancel"}
              </button>
            </div>
          </div>
        </div>

        {/* ========== EDIT PHOTO MODAL ========== */}
        {editPhoto && (
          <div className="modal-overlay active" onClick={(e) => { if (e.target === e.currentTarget) setEditPhoto(null); }}>
            <div className="modal-sheet">
              <div className="modal-handle"></div>
              <div className="modal-header">
                <h2>Edit Photo</h2>
                <p>{editPhoto.title}</p>
              </div>
              <div className="modal-body">
                <div style={{ width: "100%", aspectRatio: "16/9", borderRadius: "var(--radius-md)", overflow: "hidden", border: "1px solid var(--border)", marginBottom: 16 }}>
                  <img src={editPhoto.cdnUrl} alt={editPhoto.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>
                <div className="form-group">
                  <label>Title</label>
                  <input className="form-input" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                </div>
                <div className="form-group">
                  <label>Description</label>
                  <input className="form-input" value={editDesc} onChange={(e) => setEditDesc(e.target.value)} placeholder="Optional description" />
                </div>
                <div className="form-group">
                  <label>Category</label>
                  <select className="form-select" value={editCategory} onChange={(e) => setEditCategory(e.target.value)}>
                    <option value="events">Events</option>
                    <option value="services">Services</option>
                    <option value="community">Community</option>
                    <option value="leadership">Leadership</option>
                    <option value="facility">Facility</option>
                  </select>
                </div>
                {albums.length > 0 && (
                  <div className="form-group">
                    <label>Album</label>
                    <select className="form-select" value={editAlbumId || ""} onChange={(e) => setEditAlbumId(e.target.value || undefined)}>
                      <option value="">No album</option>
                      {albums.map((a) => (
                        <option key={a.id} value={a.id}>{a.title}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="form-group">
                  <label>Alt Text (Accessibility)</label>
                  <input className="form-input" value={editAltText} onChange={(e) => setEditAltText(e.target.value)} placeholder="Describe the image for screen readers" />
                </div>
                <div className="toggle-row">
                  <span className="toggle-label">Featured on homepage</span>
                  <button className={`toggle-switch ${editFeatured ? "on" : "off"}`} onClick={() => setEditFeatured(!editFeatured)}></button>
                </div>
                <div className="form-group" style={{ marginTop: 16 }}>
                  <label>CDN URL</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input className="form-input" value={editPhoto.cdnUrl} readOnly style={{ fontSize: 12, flex: 1 }} />
                    <button className="header-btn" style={{ flexShrink: 0 }} onClick={() => { navigator.clipboard.writeText(editPhoto.cdnUrl); }}>
                      <i className="fas fa-copy"></i>
                    </button>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn-primary" onClick={handleSaveEdit} disabled={savingEntity}>{savingEntity ? <><i className="fas fa-spinner fa-spin"></i> Saving...</> : "Save Changes"}</button>
                <button className="btn-danger" onClick={() => { if (editPhoto) { setDeleteTargetId(editPhoto.id); setSelectedGallery(new Set([editPhoto.id])); } setDeleteTargets({ type: "photos", count: 1 }); setShowDeleteConfirm(true); setEditPhoto(null); }}>
                  <i className="fas fa-trash"></i> Delete Photo
                </button>
                <button className="btn-secondary" onClick={() => setEditPhoto(null)}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* ========== CREATE/EDIT EVENT MODAL ========== */}
        <div className={`modal-overlay${showEventModal ? " active" : ""}`} onClick={(e) => { if (e.target === e.currentTarget) setShowEventModal(false); }}>
          <div className="modal-sheet">
            <div className="modal-handle"></div>
            <div className="modal-header">
              <h2>{editEvent ? "Edit Event" : "Create Event"}</h2>
              <p>Events appear on both admin and member dashboards</p>
            </div>
            <div className="modal-body">
              {/* Event Image Upload */}
              <div className="form-group">
                <label>Event Image</label>
                <div
                  onClick={() => eventImageInputRef.current?.click()}
                  style={{}}
                  className="event-image-upload-zone"
                >
                  {eventImagePreview ? (
                    <img src={eventImagePreview} alt="" className="event-image-preview" />
                  ) : (
                    <>
                      <i className="fas fa-image" style={{ fontSize: 28, color: "var(--text-tertiary)" }}></i>
                      <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-tertiary)" }}>Tap to upload event image</span>
                    </>
                  )}
                  {eventImagePreview && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setEventImageFile(null); setEventImagePreview(""); }}
                      className="event-image-clear-btn"
                    >
                      <i className="fas fa-xmark"></i>
                    </button>
                  )}
                </div>
                <input ref={eventImageInputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setEventImageFile(file);
                      setEventImagePreview(URL.createObjectURL(file));
                    }
                    e.target.value = "";
                  }}
                />
              </div>
              <div className="form-group">
                <label>Event Name *</label>
                <input className="form-input" value={eventName} onChange={(e) => setEventName(e.target.value)} placeholder="e.g. Youth Conference" />
              </div>
              <div className="form-group">
                <label>Date & Time</label>
                <input className="form-input" type="datetime-local" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Location</label>
                <input className="form-input" value={eventLocation} onChange={(e) => setEventLocation(e.target.value)} placeholder="e.g. Main Sanctuary" />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea className="form-textarea" value={eventDesc} onChange={(e) => setEventDesc(e.target.value)} placeholder="Brief description of the event..." />
              </div>
              <div className="toggle-row">
                <span className="toggle-label">Paid Event</span>
                <button className={`toggle-switch ${eventIsPaid ? "on" : "off"}`} onClick={() => setEventIsPaid(!eventIsPaid)}></button>
              </div>
              {eventIsPaid && (
                <div className="form-group">
                  <label>Fee (Ksh)</label>
                  <input className="form-input" type="number" min="0" value={eventFee} onChange={(e) => setEventFee(parseInt(e.target.value) || 0)} placeholder="0" />
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn-primary" onClick={handleSaveEvent} disabled={savingEntity || !eventName.trim()}>
                {savingEntity ? <><i className="fas fa-spinner fa-spin"></i> Saving...</> : editEvent ? "Update Event" : "Create Event"}
              </button>
              <button className="btn-secondary" onClick={() => setShowEventModal(false)}>Cancel</button>
            </div>
          </div>
        </div>

        {/* ========== ALBUM CREATE/EDIT MODAL ========== */}
        <div className={`modal-overlay${showAlbumModal ? " active" : ""}`} onClick={(e) => { if (e.target === e.currentTarget) setShowAlbumModal(false); }}>
          <div className="modal-sheet">
            <div className="modal-handle"></div>
            <div className="modal-header">
              <h2>{editAlbum ? "Edit Album" : "New Album"}</h2>
              <p>Organize photos into albums</p>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Title</label>
                <input className="form-input" value={albumTitle} onChange={(e) => setAlbumTitle(e.target.value)} placeholder="e.g., Easter Sunday 2026" />
              </div>
              <div className="form-group">
                <label>Description (optional)</label>
                <input className="form-input" value={albumDesc} onChange={(e) => setAlbumDesc(e.target.value)} placeholder="Brief description" />
              </div>
              <div className="form-group">
                <label>Category</label>
                <select className="form-select" value={albumCategory} onChange={(e) => { setAlbumCategory(e.target.value); if (!editAlbum && !albumTitle) setAlbumTitle(defaultAlbumTitles[e.target.value] || ""); }}>
                  {categories.filter((c) => c !== "all").map((c) => (
                    <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Sort Order</label>
                <input className="form-input" type="number" value={albumSortOrder} onChange={(e) => setAlbumSortOrder(parseInt(e.target.value) || 0)} min={1} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-primary" onClick={handleSaveAlbum} disabled={savingEntity}>
                {savingEntity ? <><i className="fas fa-spinner fa-spin"></i> Saving...</> : editAlbum ? "Save Changes" : "Create Album"}
              </button>
              <button className="btn-secondary" onClick={() => setShowAlbumModal(false)}>Cancel</button>
            </div>
          </div>
        </div>

        {/* ========== ALBUM DELETE CONFIRM ========== */}
        <div className={`modal-overlay${deleteAlbumTarget ? " active" : ""}`} onClick={(e) => { if (e.target === e.currentTarget) setDeleteAlbumTarget(null); }}>
          <div className="modal-sheet">
            <div className="modal-handle"></div>
            <div className="modal-header">
              <h2>Delete Album</h2>
              <p>Photos in this album will not be deleted</p>
            </div>
            <div className="modal-body">
              <p className="delete-confirm-text">
                Are you sure you want to delete this album? Photos will remain in the gallery but will no longer be grouped under this album.
              </p>
            </div>
            <div className="modal-footer" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button className="btn-danger" onClick={() => deleteAlbumTarget && handleDeleteAlbum(deleteAlbumTarget)}>Delete Album</button>
              <button className="btn-secondary" onClick={() => setDeleteAlbumTarget(null)}>Cancel</button>
            </div>
          </div>
        </div>

        {/* ========== ENTRY CREATE/EDIT MODAL ========== */}
        <div className={`modal-overlay${showEntryModal ? " active" : ""}`} onClick={(e) => { if (e.target === e.currentTarget) setShowEntryModal(false); }}>
          <div className="modal-sheet">
            <div className="modal-handle"></div>
            <div className="modal-header">
              <h2>{editEntry ? "Edit Entry" : "New Entry"}</h2>
              <p>Add an event or service entry under {selectedAlbum?.title || "this album"}</p>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Title</label>
                <input className="form-input" value={entryTitle} onChange={(e) => setEntryTitle(e.target.value)} placeholder="e.g., Easter Sunday 2026" />
              </div>
              <div className="form-group">
                <label>Description (optional)</label>
                <input className="form-input" value={entryDesc} onChange={(e) => setEntryDesc(e.target.value)} placeholder="Brief description" />
              </div>
              <div className="form-group">
                <label>Date</label>
                <input className="form-input" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Cover Image</label>
                {entryCoverUrl ? (
                  <div style={{ position: "relative", width: "100%", aspectRatio: "16/10", borderRadius: "var(--radius-sm)", overflow: "hidden", border: "1px solid var(--border)", marginBottom: 8 }}>
                    <img src={entryCoverUrl} alt="Cover preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    {entryCoverFile && (
                      <div style={{ position: "absolute", top: 6, right: 6, padding: "3px 7px", borderRadius: 4, background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 10, fontWeight: 600 }}>New</div>
                    )}
                  </div>
                ) : (
                  <div onClick={() => entryCoverInputRef.current?.click()} style={{ width: "100%", aspectRatio: "16/10", borderRadius: "var(--radius-sm)", border: "2px dashed var(--border)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, cursor: "pointer", color: "var(--text-tertiary)", marginBottom: 8 }}>
                    <i className="fas fa-cloud-upload-alt" style={{ fontSize: 28 }}></i>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>Upload Cover Image</span>
                  </div>
                )}
                <input ref={entryCoverInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setEntryCoverFile(file);
                    setEntryCoverUrl(URL.createObjectURL(file));
                  }
                  e.target.value = "";
                }} />
                {entryCoverFile && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-secondary)", padding: "6px 10px", background: "var(--surface)", borderRadius: "var(--radius-sm)", marginBottom: 4 }}>
                    <i className="fas fa-file-image"></i>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entryCoverFile.name}</span>
                    <button onClick={() => { setEntryCoverFile(null); if (!editEntry) setEntryCoverUrl(""); }} style={{ background: "none", border: "none", color: "var(--error)", cursor: "pointer", fontSize: 12, padding: 2 }}><i className="fas fa-times"></i></button>
                  </div>
                )}
                {entryCoverUrl && !entryCoverFile && (
                  <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
                    <button onClick={() => entryCoverInputRef.current?.click()} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "6px 12px", fontSize: 12, cursor: "pointer", color: "var(--text-primary)" }}>
                      <i className="fas fa-camera"></i> Change
                    </button>
                    {entryCoverUrl && editEntry && (
                      <button onClick={() => { setEntryCoverUrl(""); setEntryCoverFile(null); }} style={{ background: "none", border: "none", color: "var(--error)", fontSize: 12, cursor: "pointer", padding: "6px 12px" }}>
                        <i className="fas fa-trash"></i> Remove
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-primary" onClick={handleSaveEntry} disabled={savingEntity}>
                {savingEntity ? <><i className="fas fa-spinner fa-spin"></i> {entryCoverUploading ? "Uploading cover..." : "Saving..."}</> : editEntry ? "Save Changes" : "Create Entry"}
              </button>
              <button className="btn-secondary" onClick={() => setShowEntryModal(false)}>Cancel</button>
            </div>
          </div>
        </div>

        {/* ========== ENTRY DELETE CONFIRM ========== */}
        <div className={`modal-overlay${deleteEntryTarget ? " active" : ""}`} onClick={(e) => { if (e.target === e.currentTarget) setDeleteEntryTarget(null); }}>
          <div className="modal-sheet">
            <div className="modal-handle"></div>
            <div className="modal-header">
              <h2>Delete Entry</h2>
              <p>Photos in this entry will not be deleted</p>
            </div>
            <div className="modal-body">
              <p className="delete-confirm-text">
                Are you sure you want to delete this entry? Photos will remain in the album but will no longer be grouped under this entry.
              </p>
            </div>
            <div className="modal-footer" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button className="btn-danger" onClick={() => deleteEntryTarget && handleDeleteEntry(deleteEntryTarget)}>Delete Entry</button>
              <button className="btn-secondary" onClick={() => setDeleteEntryTarget(null)}>Cancel</button>
            </div>
          </div>
        </div>

        {/* ========== DELETE CONFIRM MODAL ========== */}
        <div className={`modal-overlay${showDeleteConfirm ? " active" : ""}`} onClick={(e) => { if (e.target === e.currentTarget) setShowDeleteConfirm(false); }}>
          <div className="modal-sheet">
            <div className="modal-handle"></div>
            <div className="modal-header">
              <h2>Delete {deleteTargets.count > 1 ? `${deleteTargets.type.charAt(0).toUpperCase() + deleteTargets.type.slice(1)}` : deleteTargets.type.charAt(0).toUpperCase() + deleteTargets.type.slice(1)}</h2>
              <p>This action cannot be undone</p>
            </div>
            <div className="modal-body">
              <p className="delete-confirm-text">
                Are you sure you want to delete <strong>{deleteTargets.count} {deleteTargets.type}</strong>? This will permanently remove them from both BunnyCDN storage and your app. This action also clears the CDN cache for removed files.
              </p>
            </div>
            <div className="modal-footer" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button className="btn-danger" onClick={handleConfirmDelete}>Delete Permanently</button>
              <button className="btn-secondary" onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
            </div>
          </div>
        </div>

        {/* ========== PURGE CONFIRM ========== */}
        <div className={`modal-overlay${showPurgeConfirm ? " active" : ""}`} onClick={(e) => { if (e.target === e.currentTarget) setShowPurgeConfirm(false); }}>
          <div className="modal-sheet">
            <div className="modal-handle"></div>
            <div className="modal-header">
              <h2>Purge CDN Cache</h2>
              <p>Clears cached content across all edge servers</p>
            </div>
            <div className="modal-body">
              <p className="delete-confirm-text" style={{ marginBottom: 8 }}>
                This will clear the BunnyCDN cache for all content. Updates may take a few minutes to propagate globally.
              </p>
              <p style={{ textAlign: "center", fontSize: 13, color: "var(--text-tertiary)" }}>
                Your files will not be deleted — only the cached copies will be cleared.
              </p>
            </div>
            <div className="modal-footer" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button className="btn-primary" onClick={async () => {
                setShowPurgeConfirm(false);
                try {
                  await apiFetch("/api/content/storage-stats", { method: "GET" }); // trigger once to warm
                  window.dispatchEvent(new CustomEvent("show-toast", { detail: { title: "Cache Purged", message: "CDN cache cleared — changes will propagate within minutes", type: "success", duration: 3000 } }));
                } catch {
                  window.dispatchEvent(new CustomEvent("show-toast", { detail: { title: "Error", message: "Failed to purge cache", type: "error", duration: 3000 } }));
                }
              }}>Purge Cache</button>
              <button className="btn-secondary" onClick={() => setShowPurgeConfirm(false)}>Cancel</button>
            </div>
          </div>
        </div>

        {/* ========== IMAGE VIEWER ========== */}
        {viewerIndex !== null && displayedEntryPhotos[viewerIndex] && (
          <div className="iv-overlay" onClick={closeViewer}>
            {/* Top bar */}
            <div className="iv-top">
              <div className="iv-top-left">
                <button className="iv-close" onClick={(e) => { e.stopPropagation(); closeViewer(); }}>
                  <i className="fas fa-xmark"></i>
                </button>
                <span className="iv-counter">{viewerIndex + 1} / {displayedEntryPhotos.length}</span>
              </div>
              <div className="iv-top-right">
                <button className="iv-action-btn" onClick={async (e) => {
                  e.stopPropagation();
                  const photo = displayedEntryPhotos[viewerIndex];
                  if (!photo?.cdnUrl) return;
                  try {
                    const { Filesystem, Directory } = await import("@capacitor/filesystem");
                    const response = await fetch(photo.cdnUrl);
                    const blob = await response.blob();
                    const reader = new FileReader();
                    reader.onloadend = async () => {
                      const base64 = reader.result as string;
                      const filename = `${(photo.title || "photo").replace(/[^a-zA-Z0-9]/g, "_")}.jpg`;
                      await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Documents });
                      window.dispatchEvent(new CustomEvent("show-toast", {
                        detail: { title: "Saved", message: "Photo saved to device", type: "success", duration: 2000 },
                      }));
                    };
                    reader.readAsDataURL(blob);
                  } catch {
                    const link = document.createElement("a");
                    link.href = photo.cdnUrl;
                    link.download = photo.title || "photo";
                    link.click();
                  }
                }} title="Download">
                  <i className="fas fa-download"></i>
                </button>
                <button className="iv-action-btn" onClick={(e) => {
                  e.stopPropagation();
                  const photo = displayedEntryPhotos[viewerIndex];
                  if (photo?.cdnUrl) {
                    if (navigator.share) {
                      navigator.share({ title: photo.title, url: photo.cdnUrl });
                    } else {
                      navigator.clipboard.writeText(photo.cdnUrl);
                      window.dispatchEvent(new CustomEvent("show-toast", { detail: { title: "Copied", message: "Photo URL copied to clipboard", type: "success", duration: 2000 } }));
                    }
                  }
                }} title="Share">
                  <i className="fas fa-share-nodes"></i>
                </button>
              </div>
            </div>

            {/* Image area */}
            <div className="iv-image-wrap" onClick={(e) => e.stopPropagation()}
              onTouchStart={(e) => {
                const touch = e.touches[0];
                (e.currentTarget as HTMLElement).dataset.touchStartX = String(touch.clientX);
              }}
              onTouchEnd={(e) => {
                const startX = parseFloat((e.currentTarget as HTMLElement).dataset.touchStartX || "0");
                const endX = e.changedTouches[0].clientX;
                const diff = startX - endX;
                if (Math.abs(diff) > 50) {
                  e.stopPropagation();
                  if (diff > 0) goNextPhoto();
                  else goPrevPhoto();
                }
              }}
            >
              {viewerIndex > 0 && (
                <button className="iv-nav iv-nav-left" onClick={(e) => { e.stopPropagation(); goPrevPhoto(); }}>
                  <i className="fas fa-chevron-left"></i>
                </button>
              )}
              <img
                className="iv-image"
                src={displayedEntryPhotos[viewerIndex].cdnUrl}
                alt={displayedEntryPhotos[viewerIndex].title}
                onClick={(e) => e.stopPropagation()}
              />
              {viewerIndex < displayedEntryPhotos.length - 1 && (
                <button className="iv-nav iv-nav-right" onClick={(e) => { e.stopPropagation(); goNextPhoto(); }}>
                  <i className="fas fa-chevron-right"></i>
                </button>
              )}
            </div>

            {/* Bottom info */}
            <div className="iv-bottom" onClick={(e) => e.stopPropagation()}>
              <div className="iv-title">{displayedEntryPhotos[viewerIndex].title}</div>
              <div className="iv-meta">
                {displayedEntryPhotos[viewerIndex].category} · {formatBytes(displayedEntryPhotos[viewerIndex].fileSize)}
              </div>
            </div>
          </div>
        )}

        <AdminBottomNav />
      </div>
    </>
  );
}
