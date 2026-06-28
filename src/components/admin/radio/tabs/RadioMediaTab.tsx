"use client";

import React, { useState } from "react";
import type { Playlist, StationFile } from "@/lib/azuracast";
import { getPlaylists, getStationFiles, updateFileMetadata, deleteFile, deleteStationFiles, addSongsToPlaylist as apiAddSongs, uploadFile } from "@/lib/azuracast";
import { hapticSuccess } from "@/lib/haptics";

interface RadioMediaTabProps {
  stationFiles: StationFile[];
  setStationFiles: React.Dispatch<React.SetStateAction<StationFile[]>>;
  mediaSearch: string;
  setMediaSearch: (v: string) => void;
  mediaFilterPlaylist: string;
  setMediaFilterPlaylist: (v: string) => void;
  selectedFileIds: Set<string>;
  setSelectedFileIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  uploadProgress: { id: string; name: string; progress: number }[];
  setUploadProgress: React.Dispatch<React.SetStateAction<{ id: string; name: string; progress: number }[]>>;
  editingFile: string | null;
  setEditingFile: (v: string | null) => void;
  editTitle: string;
  setEditTitle: (v: string) => void;
  editArtist: string;
  setEditArtist: (v: string) => void;
  editAlbum: string;
  setEditAlbum: (v: string) => void;
  showMediaActions: string | null;
  setShowMediaActions: (v: string | null) => void;
  menuPos: { top: number; right: number } | null;
  setMenuPos: (v: { top: number; right: number } | null) => void;
  dragging: boolean;
  setDragging: (v: boolean) => void;
  playlistPickerOpen: boolean;
  setPlaylistPickerOpen: (v: boolean) => void;
  playlists: Playlist[];
  mediaActionLoading: boolean;
  setMediaActionLoading: (v: boolean) => void;
}

export function RadioMediaTab(props: RadioMediaTabProps) {
  const {
    stationFiles, setStationFiles,
    mediaSearch, setMediaSearch,
    mediaFilterPlaylist, setMediaFilterPlaylist,
    selectedFileIds, setSelectedFileIds,
    uploadProgress, setUploadProgress,
    editingFile, setEditingFile,
    editTitle, setEditTitle,
    editArtist, setEditArtist,
    editAlbum, setEditAlbum,
    showMediaActions, setShowMediaActions,
    menuPos, setMenuPos,
    dragging, setDragging,
    playlistPickerOpen, setPlaylistPickerOpen,
    playlists,
    mediaActionLoading, setMediaActionLoading,
  } = props;

  const filteredFiles = stationFiles.filter((f) => {
    const matchesSearch =
      !mediaSearch ||
      f.title.toLowerCase().includes(mediaSearch.toLowerCase()) ||
      f.artist.toLowerCase().includes(mediaSearch.toLowerCase()) ||
      f.album.toLowerCase().includes(mediaSearch.toLowerCase());
    const matchesPlaylist =
      !mediaFilterPlaylist ||
      f.playlists.includes(mediaFilterPlaylist);
    return matchesSearch && matchesPlaylist;
  });

  const allSelected = filteredFiles.length > 0 && filteredFiles.every((f) => selectedFileIds.has(f.id));

  const toggleFileSelect = (id: string) => {
    const next = new Set(selectedFileIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedFileIds(next);
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedFileIds(new Set());
    } else {
      setSelectedFileIds(new Set(filteredFiles.map((f) => f.id)));
    }
  };

  const startEdit = (file: StationFile) => {
    setEditingFile(file.id);
    setEditTitle(file.title);
    setEditArtist(file.artist);
    setEditAlbum(file.album);
  };

  const saveEdit = async () => {
    if (!editingFile || mediaActionLoading) return;
    setMediaActionLoading(true);
    const file = stationFiles.find((f) => f.id === editingFile);
    const fileId = file?.unique_id || editingFile;
    const ok = await updateFileMetadata(fileId, {
      title: editTitle,
      artist: editArtist,
      album: editAlbum,
    });
    if (ok) {
      setStationFiles((prev) =>
        prev.map((f) =>
          f.id === editingFile
            ? { ...f, title: editTitle, artist: editArtist, album: editAlbum }
            : f
        )
      );
    }
    window.dispatchEvent(
      new CustomEvent("show-toast", {
        detail: { title: ok ? "Metadata Saved" : "Error", message: ok ? `"${editTitle}" updated successfully` : "Failed to save metadata", type: ok ? "success" : "error", duration: 2500 },
      })
    );
    if (ok) await hapticSuccess();
    setEditingFile(null);
    setMediaActionLoading(false);
  };

  const cancelEdit = () => {
    setEditingFile(null);
  };

  const handleDeleteFile = async () => {
    if (!showMediaActions || mediaActionLoading) return;
    setMediaActionLoading(true);
    const file = stationFiles.find((f) => f.id === showMediaActions);
    if (file) {
      const fileId = file.unique_id || file.id;
      const ok = await deleteFile(fileId);
      if (ok) {
        setStationFiles((prev) => prev.filter((f) => f.id !== file.id));
      }
      window.dispatchEvent(
        new CustomEvent("show-toast", {
          detail: { title: ok ? "File Deleted" : "Error", message: ok ? "Track removed from media library" : "Failed to delete file", type: ok ? "success" : "error", duration: 2500 },
        })
      );
      if (ok) await hapticSuccess();
    }
    setShowMediaActions(null);
    setMediaActionLoading(false);
  };

  const handleBulkDelete = async () => {
    if (selectedFileIds.size === 0 || mediaActionLoading) return;
    setMediaActionLoading(true);
    const filesToDelete = stationFiles.filter((f) => selectedFileIds.has(f.id));
    const filePaths = filesToDelete.map((f) => f.path).filter(Boolean);
    let ok = true;
    if (filePaths.length > 0) {
      ok = await deleteStationFiles(filePaths);
    }
    if (ok) {
      setStationFiles((prev) => prev.filter((f) => !selectedFileIds.has(f.id)));
    }
    window.dispatchEvent(
      new CustomEvent("show-toast", {
        detail: { title: ok ? "Files Deleted" : "Error", message: ok ? `${selectedFileIds.size} tracks removed` : "Failed to delete files", type: ok ? "success" : "error", duration: 2500 },
      })
    );
    if (ok) await hapticSuccess();
    setSelectedFileIds(new Set());
    setMediaActionLoading(false);
  };

  const handleBulkAddPlaylist = () => {
    if (selectedFileIds.size === 0) return;
    setPlaylistPickerOpen(true);
  };

  const addToPlaylist = async (playlistId: string) => {
    if (mediaActionLoading) return;
    setMediaActionLoading(true);
    const pl = playlists.find((p) => p.id === playlistId);
    const songIds = [...selectedFileIds].map((fid) => {
      const file = stationFiles.find((f) => f.id === fid);
      return file?.unique_id || fid;
    }).filter(Boolean) as string[];
    const ok = await apiAddSongs(playlistId, songIds);
    if (ok) {
      setStationFiles((prev) =>
        prev.map((f) =>
          selectedFileIds.has(f.id)
            ? { ...f, playlists: f.playlists.includes(playlistId) ? f.playlists : [...f.playlists, playlistId] }
            : f
        )
      );
    }
    window.dispatchEvent(
      new CustomEvent("show-toast", {
        detail: { title: ok ? "Added to Playlist" : "Error", message: ok ? `${selectedFileIds.size} tracks added to "${pl?.name || ""}"` : "Failed to add tracks to playlist", type: ok ? "success" : "error", duration: 2500 },
      })
    );
    if (ok) await hapticSuccess();
    setPlaylistPickerOpen(false);
    setSelectedFileIds(new Set());
    setMediaActionLoading(false);
  };

  const simulateUpload = async (files?: FileList) => {
    if (files && files.length > 0) {
      let successCount = 0;
      let failCount = 0;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const id = "upload_" + Date.now() + "_" + i;
        setUploadProgress((prev) => [...prev, { id, name: file.name, progress: 0 }]);
        const interval = setInterval(() => {
          setUploadProgress((prev) =>
            prev.map((u) =>
              u.id === id && u.progress < 90
                ? { ...u, progress: u.progress + Math.random() * 6 + 1 }
                : u
            )
          );
        }, 350);
        const uploaded = await uploadFile(file).catch(() => null);
        clearInterval(interval);
        if (uploaded) {
          successCount++;
          setUploadProgress((prev) =>
            prev.map((u) => (u.id === id ? { ...u, progress: 100 } : u))
          );
          setStationFiles((prev) => [...prev, uploaded]);
        } else {
          failCount++;
          setUploadProgress((prev) => prev.filter((u) => u.id !== id));
        }
      }
      if (successCount > 0) {
        window.dispatchEvent(
          new CustomEvent("show-toast", {
            detail: { title: "Upload Complete", message: `${successCount} file${successCount > 1 ? "s" : ""} uploaded${failCount > 0 ? `, ${failCount} failed` : ""}`, type: failCount > 0 ? "error" : "success", duration: 3000 },
          })
        );
        await hapticSuccess();
      } else {
        window.dispatchEvent(
          new CustomEvent("show-toast", {
            detail: { title: "Upload Failed", message: "Could not upload files to AzuraCast", type: "error", duration: 4000 },
          })
        );
      }
      return;
    }
    const id = "upload_" + Date.now();
    const name = "New_Sermon.mp3";
    setUploadProgress((prev) => [...prev, { id, name, progress: 0 }]);
    const interval = setInterval(() => {
      setUploadProgress((prev) =>
        prev.map((u) =>
          u.id === id ? { ...u, progress: Math.min(100, u.progress + Math.random() * 15 + 3) } : u
        )
      );
    }, 300);
    setTimeout(async () => {
      clearInterval(interval);
      setUploadProgress((prev) => prev.filter((u) => u.id !== id));
      window.dispatchEvent(
        new CustomEvent("show-toast", {
          detail: { title: "Upload Complete", message: `"${name}" added to media library`, type: "success", duration: 3000 },
        })
      );
      await hapticSuccess();
    }, 3000);
  };

  return (
    <div className="media-content">
      <style>{`
        .media-content { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
        .upload-zone { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 28px 20px; background: var(--surface-card); border: 2px dashed var(--border); border-radius: var(--radius-lg); cursor: pointer; transition: all 0.25s ease; text-align: center; }
        .upload-zone:active { background: var(--surface-elevated); border-color: var(--primary); }
        .upload-zone.dragging { background: rgba(232,168,56,0.06); border-color: var(--primary); transform: scale(1.01); }
        .upload-zone i { font-size: 36px; color: var(--text-tertiary); transition: all 0.25s ease; }
        .upload-zone.dragging i { color: var(--primary); transform: translateY(-4px); }
        .upload-zone-text h4 { font-size: 15px; font-weight: 600; margin-bottom: 2px; }
        .upload-zone-text p { font-size: 13px; color: var(--text-tertiary); }
        .upload-progress-list { display: flex; flex-direction: column; gap: 10px; }
        .upload-progress-item { background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 12px 14px; animation: fadeSlideUp 0.25s ease; }
        @keyframes fadeSlideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .upload-progress-info { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
        .upload-progress-name { font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
        .upload-progress-name i { color: var(--primary); font-size: 14px; }
        .upload-progress-pct { font-size: 12px; font-weight: 700; color: var(--primary); font-variant-numeric: tabular-nums; }
        .upload-progress-bar { width: 100%; height: 4px; background: var(--surface-elevated); border-radius: 2px; overflow: hidden; }
        .upload-progress-fill { height: 100%; background: linear-gradient(90deg, var(--gradient-start), var(--gradient-end)); border-radius: 2px; transition: width 0.3s ease; }
        .media-toolbar { display: flex; flex-direction: column; gap: 10px; }
        .media-search-wrapper { position: relative; display: flex; align-items: center; }
        .media-search-wrapper > i { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: var(--text-tertiary); font-size: 15px; pointer-events: none; }
        .media-search-input { width: 100%; padding: 12px 40px 12px 42px; background: var(--surface-card); border: 1.5px solid var(--border); border-radius: var(--radius-md); color: var(--text-primary); font-size: 14px; font-weight: 500; outline: none; }
        .media-search-input:focus { border-color: var(--primary); box-shadow: 0 0 0 4px rgba(232,168,56,0.08); }
        .media-search-input::placeholder { color: var(--text-tertiary); font-weight: 400; }
        .media-search-clear { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); width: 28px; height: 28px; border-radius: var(--radius-full); background: var(--surface-elevated); border: none; color: var(--text-secondary); font-size: 12px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
        .media-search-clear:active { background: var(--surface-hover); }
        .media-filter-select { width: 100%; padding: 12px 16px; background: var(--surface-card); border: 1.5px solid var(--border); border-radius: var(--radius-md); color: var(--text-primary); font-size: 13px; font-weight: 500; outline: none; appearance: none; -webkit-appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='%236B6B6B' viewBox='0 0 16 16'%3E%3Cpath d='M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 14px center; padding-right: 40px; }
        .media-filter-select:focus { border-color: var(--primary); box-shadow: 0 0 0 4px rgba(232,168,56,0.08); }
        .media-bulk-bar { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: rgba(232,168,56,0.08); border: 1px solid rgba(232,168,56,0.15); border-radius: var(--radius-md); animation: fadeSlideUp 0.2s ease; }
        .media-bulk-count { font-size: 13px; font-weight: 700; color: var(--primary); flex-shrink: 0; }
        .media-bulk-actions { display: flex; gap: 8px; flex: 1; justify-content: flex-end; }
        .media-bulk-btn { padding: 8px 12px; border-radius: var(--radius-sm); font-size: 12px; font-weight: 600; cursor: pointer; border: none; display: flex; align-items: center; gap: 5px; background: var(--surface-elevated); color: var(--text-primary); transition: all 0.2s ease; }
        .media-bulk-btn:active { transform: scale(0.95); }
        .media-bulk-btn.danger { background: rgba(239,68,68,0.12); color: var(--error); }
        .media-bulk-clear { width: 28px; height: 28px; border-radius: var(--radius-full); background: none; border: none; color: var(--text-tertiary); cursor: pointer; font-size: 14px; display: flex; align-items: center; justify-content: center; }
        .media-bulk-clear:active { background: var(--surface-elevated); }
        .media-count { font-size: 12px; color: var(--text-tertiary); font-weight: 500; text-align: right; }
        .media-file-list { background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; }
        .media-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 40px 20px; text-align: center; }
        .media-empty i { font-size: 32px; color: var(--text-tertiary); }
        .media-empty p { font-size: 14px; color: var(--text-secondary); }
        .media-file-item { display: flex; align-items: flex-start; gap: 12px; padding: 14px; border-bottom: 1px solid var(--border); transition: background 0.2s ease; position: relative; }
        .media-file-item:last-child { border-bottom: none; }
        .media-file-item.selected { background: rgba(232,168,56,0.04); }
        .media-checkbox { width: 22px; height: 22px; border-radius: 6px; border: 2px solid var(--border); flex-shrink: 0; margin-top: 6px; cursor: pointer; transition: all 0.2s ease; display: flex; align-items: center; justify-content: center; }
        .media-checkbox.checked { background: var(--primary); border-color: var(--primary); }
        .media-checkbox i { font-size: 11px; color: #fff; }
        .media-file-cover { width: 44px; height: 44px; border-radius: 8px; overflow: hidden; flex-shrink: 0; border: 1px solid var(--border); }
        .media-file-cover img { width: 100%; height: 100%; object-fit: cover; }
        .media-file-info { flex: 1; min-width: 0; }
        .media-file-title { font-size: 14px; font-weight: 600; line-height: 1.3; margin-bottom: 2px; }
        .media-file-artist { font-size: 12px; color: var(--text-secondary); margin-bottom: 4px; }
        .media-file-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 4px; }
        .media-file-tag { padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; color: var(--text-tertiary); background: var(--surface-elevated); }
        .media-file-playlists { display: flex; gap: 4px; flex-wrap: wrap; }
        .media-playlist-chip { padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; background: rgba(232,168,56,0.1); color: var(--primary); }
        .media-file-actions-relative { position: relative; }
        .media-file-menu { width: 32px; height: 32px; border-radius: var(--radius-full); background: none; border: none; color: var(--text-tertiary); font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .media-file-menu:active { background: var(--surface-elevated); color: var(--text-primary); }
        .media-actions-overlay { position: fixed; inset: 0; z-index: 9999; }
        .media-actions-sheet { z-index: 10000; width: 240px; background: var(--surface-elevated); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 8px; box-shadow: var(--shadow-elevated); animation: fadeSlideUp 0.15s ease; }
        .media-action-btn { display: flex; align-items: center; gap: 10px; padding: 10px 8px; border-radius: 8px; background: none; border: none; color: var(--text-primary); width: 100%; text-align: left; cursor: pointer; transition: background 0.2s ease; }
        .media-action-btn:active { background: var(--surface-hover); }
        .media-action-icon { width: 34px; height: 34px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 15px; flex-shrink: 0; }
        .media-action-icon.blue { background: rgba(59,130,246,0.12); color: var(--gradient-blue); }
        .media-action-icon.gold { background: rgba(232,168,56,0.12); color: var(--primary); }
        .media-action-icon.red { background: rgba(239,68,68,0.12); color: var(--error); }
        .media-action-info { flex: 1; }
        .media-action-info h4 { font-size: 14px; font-weight: 600; }
        .media-action-info p { font-size: 11px; color: var(--text-secondary); margin-top: 1px; }
        .media-edit-fields { display: flex; flex-direction: column; gap: 6px; }
        .media-edit-input { padding: 8px 10px; border-radius: 6px; background: var(--surface-elevated); border: 1.5px solid var(--border); color: var(--text-primary); font-size: 13px; font-weight: 500; outline: none; width: 100%; }
        .media-edit-input:focus { border-color: var(--primary); }
        .media-edit-input::placeholder { color: var(--text-tertiary); }
        .media-edit-actions { display: flex; gap: 6px; margin-top: 2px; }
        .media-edit-save, .media-edit-cancel { padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; border: none; transition: all 0.2s ease; }
        .media-edit-save { background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end)); color: #fff; }
        .media-edit-save:active { transform: scale(0.95); }
        .media-edit-cancel { background: var(--surface-elevated); color: var(--text-secondary); }
        .media-edit-cancel:active { transform: scale(0.95); }
        .media-modal-overlay { position: fixed; inset: 0; background: var(--overlay); z-index: 9000; animation: fadeSlideUp 0.2s ease; }
        .media-modal-sheet { position: fixed; bottom: 0; left: 0; right: 0; z-index: 9001; max-width: 480px; margin: 0 auto; background: var(--surface); border-radius: 28px 28px 0 0; animation: slideUp 0.35s cubic-bezier(0.32, 0.72, 0, 1); max-height: 80vh; display: flex; flex-direction: column; }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        .media-modal-handle { width: 40px; height: 5px; background: var(--text-tertiary); border-radius: 3px; margin: 12px auto 8px; opacity: 0.5; }
        .media-modal-header { padding: 8px 24px 16px; text-align: center; }
        .media-modal-header h2 { font-size: 20px; font-weight: 700; }
        .media-modal-header p { font-size: 13px; color: var(--text-secondary); margin-top: 4px; }
        .media-modal-body { flex: 1; overflow-y: auto; padding: 0 24px 20px; -webkit-overflow-scrolling: touch; }
        .media-modal-body::-webkit-scrollbar { display: none; }
        .media-pl-item { display: flex; align-items: center; gap: 14px; padding: 14px 0; border-bottom: 1px solid var(--border); cursor: pointer; transition: opacity 0.2s ease; }
        .media-pl-item:last-child { border-bottom: none; }
        .media-pl-item:active { opacity: 0.6; }
        .media-pl-icon { width: 40px; height: 40px; border-radius: var(--radius-sm); background: rgba(232,168,56,0.1); color: var(--primary); display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0; }
        .media-pl-info { flex: 1; }
        .media-pl-name { font-size: 15px; font-weight: 600; }
        .media-pl-arrow { font-size: 14px; color: var(--text-tertiary); }
      `}</style>

      <div
        className={`upload-zone ${dragging ? "dragging" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files?.length) simulateUpload(e.dataTransfer.files); }}
        onClick={() => document.getElementById("media-file-input")?.click()}
      >
        <i className={`fas ${dragging ? "fa-file-circle-plus" : "fa-cloud-arrow-up"}`}></i>
        <div className="upload-zone-text">
          <h4>{dragging ? "Drop files here" : "Tap to Upload or Drag & Drop"}</h4>
          <p>MP3, AAC, OGG, FLAC — up to 50MB</p>
        </div>
        <input
          id="media-file-input"
          type="file"
          accept="audio/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => { if (e.target.files?.length) { simulateUpload(e.target.files); e.target.value = ""; } }}
        />
      </div>

      {uploadProgress.length > 0 && (
        <div className="upload-progress-list">
          {uploadProgress.map((u) => (
            <div className="upload-progress-item" key={u.id}>
              <div className="upload-progress-info">
                <span className="upload-progress-name"><i className="fas fa-file-audio"></i> {u.name}</span>
                <span className="upload-progress-pct">{Math.round(u.progress)}%</span>
              </div>
              <div className="upload-progress-bar">
                <div className="upload-progress-fill" style={{ width: `${u.progress}%` }}></div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="media-toolbar">
        <div className="media-search-wrapper">
          <i className="fas fa-search"></i>
          <input
            type="text"
            className="media-search-input"
            placeholder="Search by title, artist, album..."
            value={mediaSearch}
            onChange={(e) => setMediaSearch(e.target.value)}
          />
          {mediaSearch && (
            <button className="media-search-clear" onClick={() => setMediaSearch("")}>
              <i className="fas fa-xmark"></i>
            </button>
          )}
        </div>
        <select
          className="media-filter-select"
          value={mediaFilterPlaylist}
          onChange={(e) => setMediaFilterPlaylist(e.target.value)}
        >
          <option value="">All Playlists</option>
          {playlists.map((pl) => (
            <option key={pl.id} value={pl.id}>{pl.name}</option>
          ))}
        </select>
      </div>

      {selectedFileIds.size > 0 && (
        <div className="media-bulk-bar">
          <span className="media-bulk-count">{selectedFileIds.size} selected</span>
          <div className="media-bulk-actions">
            <button className="media-bulk-btn" onClick={handleBulkAddPlaylist} disabled={mediaActionLoading}>
              {mediaActionLoading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-list"></i>} Add to Playlist
            </button>
            <button className="media-bulk-btn danger" onClick={handleBulkDelete} disabled={mediaActionLoading}>
              {mediaActionLoading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-trash-can"></i>} Delete
            </button>
          </div>
          <button className="media-bulk-clear" onClick={() => setSelectedFileIds(new Set())}>
            <i className="fas fa-xmark"></i>
          </button>
        </div>
      )}

      <div className="media-count">
        {filteredFiles.length} of {stationFiles.length} files
      </div>

      <div className="media-file-list">
        {filteredFiles.length === 0 ? (
          <div className="media-empty">
            <i className="fas fa-music"></i>
            <p>No files found matching your search</p>
          </div>
        ) : (
          filteredFiles.map((file) => {
            const isEditing = editingFile === file.id;
            const isSelected = selectedFileIds.has(file.id);
            return (
              <div className={`media-file-item ${isSelected ? "selected" : ""}`} key={file.id}>
                <div
                  className={`media-checkbox ${isSelected ? "checked" : ""}`}
                  onClick={() => toggleFileSelect(file.id)}
                >
                  {isSelected && <i className="fas fa-check"></i>}
                </div>

                <div className="media-file-cover">
                  <img src={file.albumArt || "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=60&h=60&fit=crop"} alt={file.title} />
                </div>

                <div className="media-file-info">
                  {isEditing ? (
                    <div className="media-edit-fields">
                      <input
                        className="media-edit-input"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        placeholder="Title"
                        autoFocus
                      />
                      <input
                        className="media-edit-input"
                        value={editArtist}
                        onChange={(e) => setEditArtist(e.target.value)}
                        placeholder="Artist"
                      />
                      <input
                        className="media-edit-input"
                        value={editAlbum}
                        onChange={(e) => setEditAlbum(e.target.value)}
                        placeholder="Album"
                      />
                      <div className="media-edit-actions">
                        <button className="media-edit-save" onClick={saveEdit} disabled={mediaActionLoading}>
                          {mediaActionLoading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-check"></i>} Save
                        </button>
                        <button className="media-edit-cancel" onClick={cancelEdit} disabled={mediaActionLoading}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="media-file-title">{file.title}</div>
                      <div className="media-file-artist">{file.artist} · {file.album}</div>
                      <div className="media-file-tags">
                        <span className="media-file-tag">{file.genre}</span>
                        <span className="media-file-tag">{file.duration}</span>
                        <span className="media-file-tag">{file.size}</span>
                      </div>
                      <div className="media-file-playlists">
                        {file.playlists.map((plId) => {
                          const pl = playlists.find((p) => p.id === plId);
                          return pl ? (
                            <span className="media-playlist-chip" key={plId}>{pl.name}</span>
                          ) : null;
                        })}
                      </div>
                    </>
                  )}
                </div>

                <div className="media-file-actions-relative">
                  <button
                    className="media-file-menu"
                    onClick={(e) => {
                      if (showMediaActions === file.id) {
                        setShowMediaActions(null);
                        setMenuPos(null);
                      } else {
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
                        setShowMediaActions(file.id);
                      }
                    }}
                  >
                    <i className="fas fa-ellipsis-h"></i>
                  </button>

                  {showMediaActions === file.id && menuPos && (
                    <>
                      <div className="media-actions-overlay" onClick={() => { setShowMediaActions(null); setMenuPos(null); }}></div>
                      <div className="media-actions-sheet" style={{ position: "fixed", top: menuPos.top, right: menuPos.right, left: "auto", bottom: "auto" }}>
                        <button className="media-action-btn" onClick={() => { startEdit(file); setShowMediaActions(null); setMenuPos(null); }}>
                          <span className="media-action-icon blue"><i className="fas fa-pen"></i></span>
                          <div className="media-action-info">
                            <h4>Edit Metadata</h4>
                            <p>Change title, artist, album, genre</p>
                          </div>
                        </button>
                        <button className="media-action-btn" onClick={() => { setSelectedFileIds(new Set([file.id])); setPlaylistPickerOpen(true); setShowMediaActions(null); setMenuPos(null); }}>
                          <span className="media-action-icon gold"><i className="fas fa-list"></i></span>
                          <div className="media-action-info">
                            <h4>Add to Playlist</h4>
                            <p>Include in a program rotation</p>
                          </div>
                        </button>
                        <button className="media-action-btn" onClick={() => { handleDeleteFile(); setMenuPos(null); }} disabled={mediaActionLoading}>
                          <span className="media-action-icon red">{mediaActionLoading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-trash-can"></i>}</span>
                          <div className="media-action-info">
                            <h4>Delete</h4>
                            <p>Permanently remove this file</p>
                          </div>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {playlistPickerOpen && (
        <>
          <div className="media-modal-overlay" onClick={() => setPlaylistPickerOpen(false)}></div>
          <div className="media-modal-sheet">
            <div className="media-modal-handle"></div>
            <div className="media-modal-header">
              <h2>Add to Playlist</h2>
              <p>Select a playlist for {selectedFileIds.size} track{selectedFileIds.size !== 1 ? "s" : ""}</p>
            </div>
            <div className="media-modal-body">
              {playlists.map((pl) => (
                <div
                  className="media-pl-item"
                  key={pl.id}
                  onClick={() => addToPlaylist(pl.id)}
                  style={{ opacity: mediaActionLoading ? 0.6 : 1, pointerEvents: mediaActionLoading ? "none" : "auto" }}
                >
                  <div className="media-pl-icon">
                    {mediaActionLoading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-list"></i>}
                  </div>
                  <div className="media-pl-info">
                    <div className="media-pl-name">{pl.name}</div>
                  </div>
                  <i className="fas fa-chevron-right media-pl-arrow"></i>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
