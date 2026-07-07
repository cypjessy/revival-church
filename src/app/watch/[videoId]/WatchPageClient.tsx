"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { auth } from "@/lib/firebase";
import { getVideo, saveUserNote, getUserNote, getAllUserNotes, deleteUserNote } from "@/lib/youtube";
import type { YouTubeVideo, TvNote } from "@/lib/youtube";
import PlyrPlayer from "@/components/tv/PlyrPlayer";

export default function WatchPageClient() {
  const router = useRouter();
  const params = useParams<{ videoId: string }>();
  const videoId = params?.videoId;

  const [video, setVideo] = useState<YouTubeVideo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEnded, setIsEnded] = useState(false);

  useEffect(() => {
    if (!videoId) return;
    let mounted = true;
    const load = async () => {
      try {
        const v = await getVideo(videoId);
        if (!mounted) return;
        if (v) {
          setVideo(v);
        } else {
          setError("Video not found");
        }
      } catch (e) {
        if (mounted) setError("Failed to load video");
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => { mounted = false; };
  }, [videoId]);

  const handleEnded = useCallback(() => {
    setIsEnded(true);
  }, []);

  const handleGoBack = useCallback(() => {
    router.back();
  }, [router]);

  /* ─── Notes state & refs ─── */
  const [noteContent, setNoteContent] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteLastSaved, setNoteLastSaved] = useState<Date | null>(null);
  const notesLoadedRef = useRef(false);
  const noteSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteChangedRef = useRef(false);
  const [notesPreview, setNotesPreview] = useState(false);
  const [allNotes, setAllNotes] = useState<TvNote[]>([]);
  const [allNotesLoading, setAllNotesLoading] = useState(false);

  /* ─── Notes sub-tabs & reader ─── */
  const [notesSubTab, setNotesSubTab] = useState<"write" | "saved">("write");
  const [selectedNote, setSelectedNote] = useState<TvNote | null>(null);
  const [noteSavingExplicit, setNoteSavingExplicit] = useState(false);
  const [notesSearch, setNotesSearch] = useState("");

  /* ─── Export all notes as a downloadable markdown file ─── */
  const handleExportNotes = useCallback(() => {
    if (allNotes.length === 0) return;
    const lines: string[] = [];
    lines.push("# FaithStream Notes Export");
    lines.push("");
    lines.push(`Exported on: ${new Date().toLocaleDateString([], { year: "numeric", month: "long", day: "numeric" })}`);
    lines.push(`Total notes: ${allNotes.length}`);
    lines.push("");
    lines.push("---");
    lines.push("");

    const sorted = [...allNotes].sort((a, b) => (a.videoTitle || "").localeCompare(b.videoTitle || ""));

    for (const note of sorted) {
      lines.push(`## ${note.videoTitle || "Untitled Video"}`);
      if (note.updatedAt) {
        const d = new Date(note.updatedAt as any);
        lines.push(`*Last edited: ${d.toLocaleDateString([], { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}*`);
      }
      lines.push("");
      lines.push(note.content || "*(no content)*");
      lines.push("");
      lines.push("---");
      lines.push("");
    }

    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `faithstream-notes-${new Date().toISOString().split("T")[0]}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [allNotes]);

  /* ─── Load saved notes from Firestore when video changes ─── */
  useEffect(() => {
    if (!video || !auth.currentUser?.uid) return;
    notesLoadedRef.current = false;
    const uid = auth.currentUser.uid;
    const vid = video.id;
    (async () => {
      try {
        const draftKey = `wn_draft_${uid}_${vid}`;
        const draft = typeof window !== "undefined" ? localStorage.getItem(draftKey) : null;
        if (draft !== null) {
          setNoteContent(draft);
        } else {
          const saved = await getUserNote(uid, vid);
          if (saved) setNoteContent(saved.content);
          else setNoteContent("");
        }
      } catch {
        setNoteContent("");
      }
      notesLoadedRef.current = true;
    })();
  }, [video?.id]);

  /* ─── Save draft to localStorage on every keystroke ─── */
  useEffect(() => {
    if (!videoId || !auth.currentUser?.uid) return;
    const uid = auth.currentUser.uid;
    try {
      localStorage.setItem(`wn_draft_${uid}_${videoId}`, noteContent);
    } catch {}
  }, [noteContent, videoId]);

  /* ─── Save notes to Firestore on change (with debounce) ─── */
  useEffect(() => {
    if (!video || !notesLoadedRef.current || !auth.currentUser?.uid) return;
    if (!noteChangedRef.current) return;
    noteChangedRef.current = false;
    const uid = auth.currentUser.uid;
    const vid = video.id;
    const title = video.title;
    if (noteSaveTimerRef.current) clearTimeout(noteSaveTimerRef.current);
    noteSaveTimerRef.current = setTimeout(async () => {
      setNoteSaving(true);
      try {
        await saveUserNote(uid, vid, title, noteContent);
        setNoteLastSaved(new Date());
      } catch {}
      setNoteSaving(false);
    }, 800);
    return () => {
      if (noteSaveTimerRef.current) clearTimeout(noteSaveTimerRef.current);
    };
  }, [noteContent, video?.id]);

  /* ─── Track that notes content has changed ─── */
  const handleNoteChange = useCallback((value: string) => {
    noteChangedRef.current = true;
    setNoteContent(value);
  }, []);

  /* ─── Explicit Save to Library button ─── */
  const handleExplicitSave = useCallback(async () => {
    if (!video || !auth.currentUser?.uid || !noteContent.trim()) return;
    const uid = auth.currentUser.uid;
    const vid = video.id;
    const title = video.title;
    setNoteSavingExplicit(true);
    try {
      await saveUserNote(uid, vid, title, noteContent);
      setNoteLastSaved(new Date());
      noteChangedRef.current = false;
      localStorage.removeItem(`wn_draft_${uid}_${vid}`);
      getAllUserNotes(uid).then(setAllNotes).catch(() => {});
    } catch {}
    setNoteSavingExplicit(false);
  }, [noteContent, video]);

  /* ─── Save on page unload / visibility hidden ─── */
  useEffect(() => {
    const saveNow = async () => {
      if (!video || !auth.currentUser?.uid || !noteChangedRef.current) return;
      const uid = auth.currentUser.uid;
      const vid = video.id;
      const title = video.title;
      try {
        await saveUserNote(uid, vid, title, noteContent);
        setNoteLastSaved(new Date());
        noteChangedRef.current = false;
      } catch {}
    };
    const handleVis = () => {
      if (document.visibilityState === "hidden") saveNow();
    };
    window.addEventListener("beforeunload", saveNow);
    document.addEventListener("visibilitychange", handleVis);
    return () => {
      window.removeEventListener("beforeunload", saveNow);
      document.removeEventListener("visibilitychange", handleVis);
      saveNow();
    };
  }, [noteContent, video]);

  /* ─── Load all my notes ─── */
  useEffect(() => {
    if (!auth.currentUser?.uid) return;
    const uid = auth.currentUser.uid;
    setAllNotesLoading(true);
    getAllUserNotes(uid).then(setAllNotes).catch(() => {}).finally(() => setAllNotesLoading(false));
  }, []);

  /* ─── Insert formatting into notes ─── */
  const insertFormatting = useCallback((before: string, after: string) => {
    const textarea = document.getElementById("wn-notes-textarea") as HTMLTextAreaElement | null;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = noteContent.substring(start, end);
    const newContent = noteContent.substring(0, start) + before + selected + after + noteContent.substring(end);
    setNoteContent(newContent);
    noteChangedRef.current = true;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  }, [noteContent]);

  const handleBold = useCallback(() => insertFormatting("**", "**"), [insertFormatting]);
  const handleItalic = useCallback(() => insertFormatting("*", "*"), [insertFormatting]);
  const handleHeading = useCallback(() => insertFormatting("\n## ", ""), [insertFormatting]);
  const handleBullet = useCallback(() => insertFormatting("\n- ", ""), [insertFormatting]);
  const handleNumbered = useCallback(() => insertFormatting("\n1. ", ""), [insertFormatting]);
  const handleLink = useCallback(() => {
    const textarea = document.getElementById("wn-notes-textarea") as HTMLTextAreaElement | null;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = noteContent.substring(start, end);
    if (selected) {
      insertFormatting("[", "](url)");
    } else {
      insertFormatting("[link text]", "(url)");
    }
  }, [insertFormatting, noteContent]);

  /* ─── Simple markdown-to-HTML renderer ─── */
  const renderNoteContent = useCallback((content: string) => {
    let html = content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    html = html.replace(/^### (.+)$/gm, '<h4 class="wn-md-h4">$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3 class="wn-md-h3">$1</h3>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/`(.+?)`/g, '<code class="wn-md-code">$1</code>');
    html = html.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener" class="wn-md-link">$1</a>');

    const lines = html.split("\n");
    let result = "";
    let inUl = false;
    let inOl = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const ulMatch = line.match(/^\s*[-*]\s+(.+)/);
      const olMatch = line.match(/^\s*\d+\.\s+(.+)/);
      if (ulMatch) {
        if (!inUl) { if (inOl) { result += "</ol>\n"; inOl = false; } result += "<ul class='wn-md-ul'>\n"; inUl = true; }
        result += `<li>${ulMatch[1]}</li>\n`;
      } else if (olMatch) {
        if (!inOl) { if (inUl) { result += "</ul>\n"; inUl = false; } result += "<ol class='wn-md-ol'>\n"; inOl = true; }
        result += `<li>${olMatch[1]}</li>\n`;
      } else {
        if (inUl) { result += "</ul>\n"; inUl = false; }
        if (inOl) { result += "</ol>\n"; inOl = false; }
        if (line.trim() === "") {
          result += "<br />\n";
        } else {
          result += `<p>${line}</p>\n`;
        }
      }
    }
    if (inUl) result += "</ul>\n";
    if (inOl) result += "</ol>\n";
    return result;
  }, []);

  return (
    <div className="watch-page">
      <style>{`
        .watch-page {
          height: 100%;
          display: flex;
          flex-direction: column;
          background: #000;
          overflow: hidden;
        }

        .watch-top-bar {
          display: flex;
          align-items: center;
          padding: 8px 12px;
          gap: 8px;
          background: #0F0F0F;
          border-bottom: 1px solid #2A2A2A;
          flex-shrink: 0;
          z-index: 10;
        }
        .watch-back-btn {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.06);
          color: #A0A0A0;
          font-size: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          flex-shrink: 0;
          transition: all 0.15s ease;
        }
        .watch-back-btn:active {
          background: rgba(255,255,255,0.12);
          transform: scale(0.9);
        }
        .watch-top-title {
          flex: 1;
          font-size: 15px;
          font-weight: 700;
          color: #fff;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          text-align: center;
        }

        .watch-player-wrap {
          position: relative;
          width: 100%;
          aspect-ratio: 16 / 9;
          background: #000;
          overflow: hidden;
          flex-shrink: 0;
        }
        .watch-player-wrap .plyr { width: 100%; height: 100%; }
        .watch-player-wrap .plyr__video-wrapper { height: 100%; }
        .watch-player-wrap .plyr__video-embed { aspect-ratio: auto !important; }
        .watch-player-wrap .plyr__video-embed,
        .watch-player-wrap iframe { width: 100% !important; height: 100% !important; }
        @media (max-width: 480px) {
          .watch-player-wrap { min-height: 240px; }
          .watch-player-wrap .plyr__controls { padding: 6px 4px !important; }
          .watch-player-wrap .plyr__control { padding: 8px 6px !important; min-width: 36px; min-height: 36px; }
          .watch-player-wrap .plyr__control svg { width: 18px; height: 18px; }
          .watch-player-wrap .plyr__time { font-size: 11px; }
        }

        .watch-loading {
          position: absolute; inset: 0;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 12px;
          background: #000;
        }
        .watch-spinner {
          width: 36px; height: 36px;
          border: 3px solid rgba(255,255,255,0.06);
          border-top-color: #E8A838;
          border-radius: 50%;
          animation: watchSpin 0.8s linear infinite;
        }
        @keyframes watchSpin { to { transform: rotate(360deg); } }

        .watch-body {
          flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch;
          background: #0F0F0F;
        }
        .watch-body::-webkit-scrollbar { display: none; }

        .watch-info {
          padding: 16px 16px 12px;
          border-bottom: 1px solid #1A1A1A;
        }
        .watch-title {
          font-size: 17px; font-weight: 700; color: #fff;
          line-height: 1.4; margin-bottom: 6px;
        }
        .watch-meta {
          display: flex; align-items: center; gap: 12px;
          font-size: 12px; color: #6B6B6B;
          margin-bottom: 12px; flex-wrap: wrap;
        }
        .watch-meta-item { display: flex; align-items: center; gap: 4px; }
        .watch-meta-item i { font-size: 11px; color: #E8A838; }
        .watch-desc {
          font-size: 13px; color: #A0A0A0;
          line-height: 1.6; white-space: pre-wrap; word-break: break-word;
        }
        .watch-desc-empty { font-size: 13px; color: #6B6B6B; font-style: italic; }

        .watch-ended-overlay {
          position: absolute; inset: 0;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 16px;
          background: rgba(0,0,0,0.75);
          backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
          animation: watchFadeIn 0.3s ease;
        }
        @keyframes watchFadeIn { from { opacity: 0; } to { opacity: 1; } }
        .watch-ended-icon {
          width: 56px; height: 56px; border-radius: 50%;
          background: rgba(34,197,94,0.12);
          display: flex; align-items: center; justify-content: center;
          font-size: 24px; color: #22C55E;
        }
        .watch-ended-text { font-size: 16px; font-weight: 700; color: #fff; }
        .watch-ended-btn {
          padding: 12px 24px; border-radius: 12px; font-size: 14px; font-weight: 700;
          background: linear-gradient(135deg, #3B82F6, #6366F1);
          border: none; color: #fff; cursor: pointer;
          display: flex; align-items: center; gap: 8px;
          transition: all 0.2s ease;
        }
        .watch-ended-btn:active { transform: scale(0.96); }

        .watch-error {
          height: 100%; display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 12px;
          color: #A0A0A0; font-size: 14px; padding: 24px;
        }
        .watch-error i { font-size: 36px; color: #EF4444; opacity: 0.5; }
        .watch-error-btn {
          margin-top: 8px; padding: 10px 20px; border-radius: 10px; font-size: 13px; font-weight: 600;
          background: #1A1A1A; border: 1px solid #2A2A2A; color: #E8A838;
          cursor: pointer; transition: all 0.15s ease;
        }
        .watch-error-btn:active { background: #242424; }

        .wn-section { padding: 20px 16px; border-top: 1px solid #1A1A1A; }
        .wn-section-title {
          font-size: 15px; font-weight: 700; margin-bottom: 14px;
          display: flex; align-items: center; gap: 8px; color: #fff;
        }
        .wn-section-title i { color: #E8A838; font-size: 14px; }

        .wn-sub-tabs {
          display: flex; gap: 4px; margin-bottom: 14px;
          background: #1A1A1A; border-radius: 12px; padding: 3px;
        }
        .wn-sub-tab {
          flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px;
          padding: 10px 12px; border-radius: 10px; font-size: 12px; font-weight: 600;
          background: none; border: none; color: #6B6B6B; cursor: pointer;
          transition: all 0.2s ease;
        }
        .wn-sub-tab i { font-size: 12px; }
        .wn-sub-tab.active { background: #242424; color: #E8A838; }
        .wn-sub-tab:active:not(.active) { transform: scale(0.95); }

        .wn-current {
          padding: 12px 14px;
          background: #1A1A1A; border: 1px solid #2A2A2A;
          border-radius: 12px; margin-bottom: 14px;
        }
        .wn-current-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #6B6B6B; margin-bottom: 4px; }
        .wn-current-title { font-size: 14px; font-weight: 700; color: #fff; }

        .wn-notes-header {
          display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;
        }
        .wn-notes-label {
          font-size: 13px; font-weight: 700; color: #fff;
          display: flex; align-items: center; gap: 6px;
        }
        .wn-notes-label i { color: #E8A838; font-size: 12px; }
        .wn-notes-actions { display: flex; align-items: center; gap: 8px; }
        .wn-saving { font-size: 11px; color: #6B6B6B; display: flex; align-items: center; gap: 4px; }
        .wn-preview-btn {
          padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 600;
          background: #1A1A1A; border: 1px solid #2A2A2A; color: #6B6B6B;
          cursor: pointer; display: flex; align-items: center; gap: 4px;
          transition: all 0.15s ease;
        }
        .wn-preview-btn:active { transform: scale(0.92); }
        .wn-preview-btn.active { background: rgba(232,168,56,0.1); border-color: rgba(232,168,56,0.2); color: #E8A838; }
        .wn-save-btn {
          padding: 6px 12px; border-radius: 8px; font-size: 11px; font-weight: 700;
          background: linear-gradient(135deg, #E8A838, #D4762A);
          border: none; color: #fff; cursor: pointer;
          display: flex; align-items: center; gap: 5px;
          transition: all 0.15s ease;
        }
        .wn-save-btn:active { transform: scale(0.95); }
        .wn-save-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }

        .wn-toolbar {
          display: flex; align-items: center; gap: 4px;
          padding: 8px 12px;
          background: #1A1A1A; border: 1px solid #2A2A2A;
          border-radius: 12px 12px 0 0; border-bottom: none;
          flex-wrap: wrap;
        }
        .wn-tb-btn {
          width: 32px; height: 32px; border-radius: 6px;
          background: none; border: none;
          color: #A0A0A0; font-size: 13px;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: all 0.15s;
        }
        .wn-tb-btn:hover { background: #242424; color: #fff; }
        .wn-tb-btn:active { transform: scale(0.9); }
        .wn-tb-divider { width: 1px; height: 20px; background: #2A2A2A; margin: 0 2px; }

        .wn-textarea {
          width: 100%; padding: 14px;
          background: #1A1A1A; border: 1px solid #2A2A2A;
          border-radius: 0 0 12px 12px;
          color: #fff; font-size: 14px; line-height: 1.6; font-family: inherit;
          resize: vertical; outline: none; transition: all 0.2s;
          min-height: 160px;
        }
        .wn-textarea:focus { border-color: #E8A838; box-shadow: 0 0 0 3px rgba(232,168,56,0.08); }
        .wn-textarea::placeholder { color: #6B6B6B; }

        .wn-preview {
          padding: 14px;
          background: #1A1A1A;
          border: 1px solid #2A2A2A;
          border-radius: 0 0 12px 12px;
          color: #fff; font-size: 14px; line-height: 1.7;
          min-height: 160px; overflow-y: auto; word-break: break-word;
        }
        .wn-preview p { margin-bottom: 8px; }
        .wn-preview strong { color: #fff; font-weight: 700; }
        .wn-preview em { color: #F5C76B; }
        .wn-md-h3 { font-size: 16px; font-weight: 700; margin: 12px 0 6px; color: #E8A838; }
        .wn-md-h4 { font-size: 14px; font-weight: 700; margin: 10px 0 4px; color: #F5C76B; }
        .wn-md-code {
          padding: 2px 6px; border-radius: 4px;
          background: #242424; font-family: 'SF Mono', 'Monaco', 'Cascadia Code', monospace;
          font-size: 13px; color: #F5C76B;
        }
        .wn-md-link { color: #E8A838; text-decoration: underline; text-underline-offset: 2px; }
        .wn-md-ul { margin: 6px 0; padding-left: 20px; }
        .wn-md-ul li { margin-bottom: 4px; }
        .wn-md-ol { margin: 6px 0; padding-left: 20px; }
        .wn-md-ol li { margin-bottom: 4px; }
        .wn-hint { font-size: 11px; color: #6B6B6B; margin-top: 8px; display: flex; align-items: center; gap: 4px; }
        .wn-hint i { font-size: 10px; }

        .wn-library-header {
          display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;
        }
        .wn-library-title {
          font-size: 13px; font-weight: 700; color: #fff;
          display: flex; align-items: center; gap: 6px;
        }
        .wn-library-title i { color: #E8A838; font-size: 12px; }
        .wn-export-btn {
          width: 28px; height: 28px; border-radius: 6px;
          background: #1A1A1A; border: 1px solid #2A2A2A;
          color: #6B6B6B; font-size: 11px;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: all 0.15s;
          margin-right: auto;
        }
        .wn-export-btn:active { transform: scale(0.9); }
        .wn-export-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .wn-refresh-btn {
          width: 28px; height: 28px; border-radius: 6px;
          background: #1A1A1A; border: 1px solid #2A2A2A;
          color: #6B6B6B; font-size: 11px;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: all 0.15s;
        }
        .wn-refresh-btn:active { transform: scale(0.9); }
        .wn-refresh-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        .wn-search-wrap { position: relative; margin-bottom: 12px; }
        .wn-search-icon {
          position: absolute; left: 14px; top: 50%; transform: translateY(-50%);
          font-size: 13px; color: #6B6B6B; pointer-events: none;
        }
        .wn-search-input {
          width: 100%; padding: 12px 36px 12px 40px;
          background: #1A1A1A; border: 1px solid #2A2A2A;
          border-radius: 10px; color: #fff; font-size: 14px;
          outline: none; transition: all 0.2s;
        }
        .wn-search-input:focus { border-color: #E8A838; box-shadow: 0 0 0 3px rgba(232,168,56,0.08); }
        .wn-search-input::placeholder { color: #6B6B6B; }
        .wn-search-clear {
          position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
          width: 24px; height: 24px; border-radius: 6px;
          background: #242424; border: none; color: #A0A0A0; font-size: 11px;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: all 0.15s;
        }
        .wn-search-clear:active { transform: translateY(-50%) scale(0.85); }

        .wn-empty {
          display: flex; flex-direction: column; align-items: center; gap: 8px;
          padding: 24px 16px; text-align: center;
          color: #6B6B6B; font-size: 13px;
        }
        .wn-empty i { font-size: 28px; opacity: 0.3; }
        .wn-list { display: flex; flex-direction: column; gap: 6px; }
        .wn-list-item {
          padding: 12px 14px;
          background: #1A1A1A; border: 1px solid #2A2A2A;
          border-radius: 12px; transition: all 0.15s;
          cursor: pointer;
        }
        .wn-list-item:active { transform: scale(0.97); background: #202020; }
        .wn-list-item.active { border-color: rgba(232,168,56,0.2); background: rgba(232,168,56,0.04); }
        .wn-list-item-top {
          display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;
        }
        .wn-list-item-title {
          font-size: 13px; font-weight: 700; color: #fff;
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
        }
        .wn-list-item-date { font-size: 10px; color: #6B6B6B; white-space: nowrap; flex-shrink: 0; }
        .wn-list-item-preview {
          font-size: 12px; color: #A0A0A0;
          margin-top: 4px; line-height: 1.5;
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
        }
        .wn-list-item-actions { margin-top: 8px; display: flex; align-items: center; gap: 8px; }
        .wn-list-delete {
          padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 600;
          background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.1);
          color: #EF4444; cursor: pointer;
          display: flex; align-items: center; gap: 4px;
          transition: all 0.15s;
        }
        .wn-list-delete:active { transform: scale(0.95); }
        .wn-list-current-badge { font-size: 10px; font-weight: 700; color: #E8A838; display: flex; align-items: center; gap: 4px; }
        .wn-list-open-btn {
          padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 600;
          background: rgba(232,168,56,0.08); border: 1px solid rgba(232,168,56,0.12);
          color: #E8A838; cursor: pointer;
          display: flex; align-items: center; gap: 4px;
          transition: all 0.15s;
        }
        .wn-list-open-btn:active { transform: scale(0.95); }

        .wn-reader-overlay {
          position: fixed; inset: 0; z-index: 900;
          background: rgba(0,0,0,0.85);
          backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
          display: flex; flex-direction: column;
          animation: wnReaderIn 0.25s ease;
        }
        @keyframes wnReaderIn { from { opacity: 0; } to { opacity: 1; } }
        .wn-reader-top {
          display: flex; align-items: center; gap: 8px;
          padding: 12px 16px;
          background: #0F0F0F;
          border-bottom: 1px solid #2A2A2A;
        }
        .wn-reader-back {
          width: 40px; height: 40px; border-radius: 50%;
          background: rgba(255,255,255,0.06); border: none;
          color: #A0A0A0; font-size: 16px;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: all 0.15s;
        }
        .wn-reader-back:active { background: rgba(255,255,255,0.12); transform: scale(0.9); }
        .wn-reader-title {
          flex: 1; font-size: 15px; font-weight: 700; color: #fff;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .wn-reader-edit-btn {
          padding: 6px 12px; border-radius: 8px; font-size: 11px; font-weight: 600;
          background: rgba(232,168,56,0.08); border: 1px solid rgba(232,168,56,0.12);
          color: #E8A838; cursor: pointer;
          display: flex; align-items: center; gap: 4px;
          transition: all 0.15s;
        }
        .wn-reader-edit-btn:active { transform: scale(0.95); }
        .wn-reader-delete-btn {
          padding: 6px 12px; border-radius: 8px; font-size: 11px; font-weight: 600;
          background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.12);
          color: #EF4444; cursor: pointer;
          display: flex; align-items: center; gap: 4px;
          transition: all 0.15s;
        }
        .wn-reader-delete-btn:active { transform: scale(0.95); }
        .wn-reader-body {
          flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch;
          padding: 20px 16px;
        }
        .wn-reader-body::-webkit-scrollbar { display: none; }
        .wn-reader-meta {
          display: flex; align-items: center; gap: 10px;
          font-size: 11px; color: #6B6B6B;
          margin-bottom: 16px; flex-wrap: wrap;
        }
        .wn-reader-content {
          color: #fff; font-size: 15px; line-height: 1.7;
        }
        .wn-reader-content p { margin-bottom: 10px; }
        .wn-reader-content strong { color: #fff; font-weight: 700; }
        .wn-reader-content em { color: #F5C76B; }
        .wn-reader-content h3 { font-size: 17px; font-weight: 700; margin: 16px 0 8px; color: #E8A838; }
        .wn-reader-content h4 { font-size: 15px; font-weight: 700; margin: 14px 0 6px; color: #F5C76B; }
        .wn-reader-content ul, .wn-reader-content ol { margin: 8px 0; padding-left: 20px; }
        .wn-reader-content li { margin-bottom: 4px; }
        .wn-reader-content a { color: #E8A838; text-decoration: underline; text-underline-offset: 2px; }
        .wn-reader-content code {
          padding: 2px 6px; border-radius: 4px;
          background: #242424; font-family: 'SF Mono', 'Monaco', 'Cascadia Code', monospace;
          font-size: 14px; color: #F5C76B;
        }
        .wn-reader-empty {
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 12px; padding: 60px 20px; color: #6B6B6B; text-align: center;
        }
        .wn-reader-empty i { font-size: 40px; opacity: 0.3; }
      `}</style>

      <div className="watch-top-bar">
        <button className="watch-back-btn" onClick={handleGoBack}>
          <i className="fas fa-arrow-left"></i>
        </button>
        <div className="watch-top-title">
          {video ? "Now Playing" : "Video"}
        </div>
      </div>

      {loading ? (
        <div className="watch-player-wrap">
          <div className="watch-loading">
            <div className="watch-spinner"></div>
            <span style={{ color: "#6B6B6B", fontSize: 13 }}>Loading video...</span>
          </div>
        </div>
      ) : error ? (
        <div className="watch-error">
          <i className="fas fa-exclamation-circle"></i>
          <span>{error}</span>
          <button className="watch-error-btn" onClick={handleGoBack}>
            <i className="fas fa-arrow-left"></i> Go Back
          </button>
        </div>
      ) : video ? (
        <>
          <div className="watch-player-wrap">
            <PlyrPlayer
              videoId={video.id}
              onEnded={handleEnded}
              initialSeek={0}
            />
            {isEnded && (
              <div className="watch-ended-overlay">
                <div className="watch-ended-icon">
                  <i className="fas fa-check"></i>
                </div>
                <div className="watch-ended-text">Finished Watching</div>
                <button className="watch-ended-btn" onClick={handleGoBack}>
                  <i className="fas fa-arrow-left"></i> Go Back
                </button>
              </div>
            )}
          </div>

          <div className="watch-body">
            <div className="watch-info">
              <div className="watch-title">{video.title}</div>
              <div className="watch-meta">
                {video.duration > 0 && (
                  <span className="watch-meta-item">
                    <i className="fas fa-clock"></i>
                    {Math.floor(video.duration / 60)}:{(video.duration % 60).toString().padStart(2, "0")}
                  </span>
                )}
                {video.publishedAt && (
                  <span className="watch-meta-item">
                    <i className="fas fa-calendar"></i>
                    {new Date(video.publishedAt).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" })}
                  </span>
                )}
                {video.channelTitle && (
                  <span className="watch-meta-item">
                    <i className="fab fa-youtube"></i>
                    {video.channelTitle}
                  </span>
                )}
              </div>
              <div className="watch-desc">
                {video.description ? video.description : <span className="watch-desc-empty">No description</span>}
              </div>
            </div>

            <div className="wn-section">
              <div className="wn-section-title">
                <i className="fas fa-pen"></i> Notes
              </div>

              <div className="wn-sub-tabs">
                <button
                  className={`wn-sub-tab ${notesSubTab === "write" ? "active" : ""}`}
                  onClick={() => setNotesSubTab("write")}
                >
                  <i className="fas fa-pen"></i> Write
                </button>
                <button
                  className={`wn-sub-tab ${notesSubTab === "saved" ? "active" : ""}`}
                  onClick={() => setNotesSubTab("saved")}
                >
                  <i className="fas fa-bookmark"></i> Saved Notes ({allNotes.length})
                </button>
              </div>

              {notesSubTab === "write" && (
                <>
                  <div className="wn-current">
                    <div className="wn-current-label">Now Watching</div>
                    <div className="wn-current-title">{video.title}</div>
                  </div>

                  <div className="wn-notes-header">
                    <div className="wn-notes-label">
                      <i className="fas fa-book-bible"></i> Your Notes
                    </div>
                    <div className="wn-notes-actions">
                      {noteSaving && <span className="wn-saving"><i className="fas fa-spinner fa-spin"></i></span>}
                      <button
                        className="wn-save-btn"
                        onClick={handleExplicitSave}
                        disabled={noteSavingExplicit || !noteContent.trim()}
                      >
                        {noteSavingExplicit ? (
                          <i className="fas fa-spinner fa-spin"></i>
                        ) : (
                          <><i className="fas fa-save"></i> Save to Library</>
                        )}
                      </button>
                      <button
                        className={`wn-preview-btn ${notesPreview ? "active" : ""}`}
                        onClick={() => setNotesPreview((p) => !p)}
                        title={notesPreview ? "Edit" : "Preview"}
                      >
                        <i className={`fas fa-${notesPreview ? "edit" : "eye"}`}></i>
                      </button>
                    </div>
                  </div>

                  {!notesPreview && (
                    <div className="wn-toolbar">
                      <button className="wn-tb-btn" onClick={handleBold} title="Bold"><i className="fas fa-bold"></i></button>
                      <button className="wn-tb-btn" onClick={handleItalic} title="Italic"><i className="fas fa-italic"></i></button>
                      <button className="wn-tb-btn" onClick={handleHeading} title="Heading"><i className="fas fa-heading"></i></button>
                      <span className="wn-tb-divider"></span>
                      <button className="wn-tb-btn" onClick={handleBullet} title="Bullet List"><i className="fas fa-list-ul"></i></button>
                      <button className="wn-tb-btn" onClick={handleNumbered} title="Numbered List"><i className="fas fa-list-ol"></i></button>
                      <span className="wn-tb-divider"></span>
                      <button className="wn-tb-btn" onClick={handleLink} title="Insert Link"><i className="fas fa-link"></i></button>
                    </div>
                  )}

                  {notesPreview ? (
                    <div
                      className="wn-preview"
                      dangerouslySetInnerHTML={{
                        __html: noteContent.trim()
                          ? renderNoteContent(noteContent)
                          : '<p style="color: #6B6B6B; font-style: italic;">No notes yet for this video.</p>',
                      }}
                    />
                  ) : (
                    <textarea
                      id="wn-notes-textarea"
                      className="wn-textarea"
                      placeholder="Write your sermon notes, thoughts, or key verses here...\n\nUse the toolbar above to format your notes, or type directly:\n  **bold** and *italic*\n  ## Headings\n  - Bullet lists\n  1. Numbered lists\n  [links](url)"
                      value={noteContent}
                      onChange={(e) => handleNoteChange(e.target.value)}
                      rows={8}
                    />
                  )}

                  <div className="wn-hint">
                    {noteSaving ? (
                      <><i className="fas fa-spinner fa-spin"></i> Saving...</>
                    ) : noteLastSaved ? (
                      <><i className="fas fa-check-circle" style={{ color: "#22C55E" }}></i> Saved {noteLastSaved.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</>
                    ) : (
                      <><i className="fas fa-save"></i> Draft saved locally</>
                    )}
                  </div>
                </>
              )}

              {notesSubTab === "saved" && (
                <div className="wn-library">
                  <div className="wn-library-header">
                    <div className="wn-library-title">
                      <i className="fas fa-bookmark"></i> My Notes Library
                    </div>
                    <button
                      className="wn-export-btn"
                      onClick={handleExportNotes}
                      disabled={allNotes.length === 0}
                      title="Export all notes as markdown"
                    >
                      <i className="fas fa-download"></i>
                    </button>
                    <button
                      className="wn-refresh-btn"
                      onClick={() => {
                        if (!auth.currentUser?.uid) return;
                        setAllNotesLoading(true);
                        getAllUserNotes(auth.currentUser.uid).then(setAllNotes).catch(() => {}).finally(() => setAllNotesLoading(false));
                      }}
                      disabled={allNotesLoading}
                    >
                      <i className={`fas fa-${allNotesLoading ? "spinner fa-spin" : "refresh"}`}></i>
                    </button>
                  </div>

                  <div className="wn-search-wrap">
                    <i className="fas fa-search wn-search-icon"></i>
                    <input
                      className="wn-search-input"
                      type="text"
                      placeholder="Search notes by video title..."
                      value={notesSearch}
                      onChange={(e) => setNotesSearch(e.target.value)}
                    />
                    {notesSearch && (
                      <button className="wn-search-clear" onClick={() => setNotesSearch("")}>
                        <i className="fas fa-times"></i>
                      </button>
                    )}
                  </div>

                  {(() => {
                    const filtered = notesSearch
                      ? allNotes.filter((n) => n.videoTitle?.toLowerCase().includes(notesSearch.toLowerCase()))
                      : allNotes;
                    if (filtered.length === 0) {
                      return (
                        <div className="wn-empty">
                          <i className="fas fa-search"></i>
                          <span>
                            {allNotesLoading ? "Loading your notes..." : notesSearch ? `No notes matching "${notesSearch}"` : "No saved notes yet. Write notes on a video and tap 'Save to Library'!"}
                          </span>
                        </div>
                      );
                    }
                    return (
                      <div className="wn-list">
                        {filtered.map((n) => {
                        const isCurrent = video?.id === n.videoId;
                        return (
                          <div key={n.videoId} className={`wn-list-item ${isCurrent ? "active" : ""}`} onClick={() => setSelectedNote(n)}>
                            <div className="wn-list-item-top">
                              <div className="wn-list-item-title">
                                {n.videoTitle || "Untitled Video"}
                              </div>
                              {n.updatedAt && (
                                <div className="wn-list-item-date">
                                  {new Date(n.updatedAt as any).toLocaleDateString([], { month: "short", day: "numeric" })}
                                </div>
                              )}
                            </div>
                            {n.content && (
                              <div className="wn-list-item-preview">
                                {n.content.substring(0, 120)}{n.content.length > 120 ? "..." : ""}
                              </div>
                            )}
                            <div className="wn-list-item-actions">
                              <button
                                className="wn-list-open-btn"
                                onClick={(e) => { e.stopPropagation(); setSelectedNote(n); }}
                              >
                                <i className="fas fa-book-open"></i> Read
                              </button>
                              {!isCurrent && (
                                <button
                                  className="wn-list-delete"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    if (!auth.currentUser?.uid) return;
                                    try {
                                      await deleteUserNote(auth.currentUser.uid, n.videoId);
                                      setAllNotes((prev) => prev.filter((x) => x.videoId !== n.videoId));
                                    } catch {}
                                  }}
                                >
                                  <i className="fas fa-trash"></i> Delete
                                </button>
                              )}
                              {isCurrent && (
                                <span className="wn-list-current-badge">
                                  <i className="fas fa-play"></i> Now Playing
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>
        </>
      ) : null}

      {selectedNote && (
        <div className="wn-reader-overlay">
          <div className="wn-reader-top">
            <button className="wn-reader-back" onClick={() => setSelectedNote(null)}>
              <i className="fas fa-arrow-left"></i>
            </button>
            <div className="wn-reader-title">
              {selectedNote.videoTitle || "Note"}
            </div>
            <button
              className="wn-reader-edit-btn"
              onClick={() => {
                if (!selectedNote) return;
                setNoteContent(selectedNote.content || "");
                setNotesSubTab("write");
                setSelectedNote(null);
              }}
            >
              <i className="fas fa-pen"></i>
            </button>
            <button
              className="wn-reader-delete-btn"
              onClick={async () => {
                if (!auth.currentUser?.uid) return;
                try {
                  await deleteUserNote(auth.currentUser.uid, selectedNote.videoId);
                  setAllNotes((prev) => prev.filter((x) => x.videoId !== selectedNote.videoId));
                  setSelectedNote(null);
                } catch {}
              }}
            >
              <i className="fas fa-trash"></i>
            </button>
          </div>
          <div className="wn-reader-body">
            <div className="wn-reader-meta">
              {selectedNote.updatedAt && (
                <span>
                  <i className="fas fa-calendar" style={{ marginRight: 4 }}></i>
                  {new Date(selectedNote.updatedAt as any).toLocaleDateString([], {
                    year: "numeric", month: "long", day: "numeric",
                    hour: "2-digit", minute: "2-digit",
                  })}
                </span>
              )}
              {video?.id === selectedNote.videoId && (
                <span style={{ color: "#E8A838" }}>
                  <i className="fas fa-play" style={{ marginRight: 4 }}></i>Now Playing
                </span>
              )}
            </div>
            <div
              className="wn-reader-content"
              dangerouslySetInnerHTML={{
                __html: selectedNote.content
                  ? renderNoteContent(selectedNote.content)
                  : '<p style="color: #6B6B6B; font-style: italic;">This note has no content.</p>',
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
