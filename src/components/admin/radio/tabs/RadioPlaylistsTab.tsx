"use client";

import React, { useState } from "react";
import type { Playlist, StationFile } from "@/lib/azuracast";
import { getPlaylists, getStationFiles, createPlaylist as apiCreatePlaylist, updatePlaylist as apiUpdatePlaylist, togglePlaylistEnabled as apiTogglePlaylist, deletePlaylist as apiDeletePlaylist, addSongsToPlaylist as apiAddSongs, removeSongFromPlaylist as apiRemoveSong } from "@/lib/azuracast";
import { hapticSuccess } from "@/lib/haptics";

interface RadioPlaylistsTabProps {
  playlists: Playlist[];
  setPlaylists: React.Dispatch<React.SetStateAction<Playlist[]>>;
  stationFiles: StationFile[];
  setStationFiles: React.Dispatch<React.SetStateAction<StationFile[]>>;
  loadingPlaylists: boolean;
  setLoadingPlaylists: (v: boolean) => void;
  selectedPlId: string | null;
  setSelectedPlId: (v: string | null) => void;
  showEditPlModal: boolean;
  setShowEditPlModal: (v: boolean) => void;
  editingPlId: string | null;
  setEditingPlId: (v: string | null) => void;
  plConfirmDelete: string | null;
  setPlConfirmDelete: (v: string | null) => void;
  plMenuOpen: string | null;
  setPlMenuOpen: (v: string | null) => void;
  showCreatePlaylist: boolean;
  setShowCreatePlaylist: (v: boolean) => void;
  plForm: { name: string; type: string; order: string; weight: number };
  setPlForm: React.Dispatch<React.SetStateAction<{ name: string; type: string; order: string; weight: number }>>;
  plSchedule: { days: string[]; startTime: string; endTime: string };
  setPlSchedule: React.Dispatch<React.SetStateAction<{ days: string[]; startTime: string; endTime: string }>>;
  showSongPicker: boolean;
  setShowSongPicker: (v: boolean) => void;
  addSongsSearch: string;
  setAddSongsSearch: (v: string) => void;
  addSongsSelected: Set<string>;
  setAddSongsSelected: React.Dispatch<React.SetStateAction<Set<string>>>;
  addSongsPlId: string | null;
  setAddSongsPlId: (v: string | null) => void;
  plCreateType: "standard" | "scheduled" | "on_demand";
  setPlCreateType: (v: "standard" | "scheduled" | "on_demand") => void;
  plCreateOrder: "shuffle" | "sequential";
  setPlCreateOrder: (v: "shuffle" | "sequential") => void;
  plFilterTab: string;
  setPlFilterTab: (v: string) => void;
  playlistFilter: string;
  setPlaylistFilter: (v: string) => void;
  showScheduleView: boolean;
  setShowScheduleView: (v: boolean) => void;
  plActionLoading: boolean;
  setPlActionLoading: (v: boolean) => void;
  pcActivePlaylist: string | null;
}

export function RadioPlaylistsTab(props: RadioPlaylistsTabProps) {
  const {
    playlists, setPlaylists,
    stationFiles, setStationFiles,
    loadingPlaylists, setLoadingPlaylists,
    selectedPlId, setSelectedPlId,
    showEditPlModal, setShowEditPlModal,
    editingPlId, setEditingPlId,
    plConfirmDelete, setPlConfirmDelete,
    plMenuOpen, setPlMenuOpen,
    showCreatePlaylist, setShowCreatePlaylist,
    plForm, setPlForm,
    plSchedule, setPlSchedule,
    showSongPicker, setShowSongPicker,
    addSongsSearch, setAddSongsSearch,
    addSongsSelected, setAddSongsSelected,
    addSongsPlId, setAddSongsPlId,
    plCreateType, setPlCreateType,
    plCreateOrder, setPlCreateOrder,
    plFilterTab, setPlFilterTab,
    playlistFilter, setPlaylistFilter,
    showScheduleView, setShowScheduleView,
    plActionLoading, setPlActionLoading,
    pcActivePlaylist,
  } = props;

  const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  const plSongsFor = (plId: string) =>
    stationFiles.filter((f) => f.playlists.includes(plId));

  const createPlaylist = async () => {
    if (plActionLoading) return;
    setPlActionLoading(true);
    try {
      const newPl = await apiCreatePlaylist({
        name: plForm.name || "New Playlist",
        type: plCreateType,
        order: plCreateOrder,
        weight: plForm.weight,
        schedule: plCreateType === "scheduled"
          ? { days: plSchedule.days.map((d: string) => DAYS.indexOf(d)), startTime: plSchedule.startTime, endTime: plSchedule.endTime }
          : undefined,
      });
      setPlaylists([...playlists, newPl]);
      setShowCreatePlaylist(false);
      setPlForm({ name: "", type: "standard", order: "shuffle", weight: 10 });
      setPlSchedule({ days: [], startTime: "09:00", endTime: "17:00" });
      window.dispatchEvent(new CustomEvent("show-toast", { detail: { title: "Playlist Created", message: `"${newPl.name}" created successfully`, type: "success", duration: 2500 } }));
      await hapticSuccess();
    } catch {
      window.dispatchEvent(new CustomEvent("show-toast", { detail: { title: "Error", message: "Failed to create playlist \u2014 try again", type: "error", duration: 3000 } }));
    }
    setPlActionLoading(false);
  };

  const saveEditedPlaylist = async () => {
    if (!editingPlId || plActionLoading) return;
    setPlActionLoading(true);
    try {
      const updated = await apiUpdatePlaylist(editingPlId, {
        name: plForm.name,
        type: plCreateType,
        order: plCreateOrder,
        weight: plForm.weight,
        schedule: plCreateType === "scheduled"
          ? { days: plSchedule.days.map((d: string) => DAYS.indexOf(d)), startTime: plSchedule.startTime, endTime: plSchedule.endTime }
          : undefined,
      });
      setPlaylists(playlists.map((p) => p.id === editingPlId ? { ...p, ...updated } : p));
      setShowEditPlModal(false);
      setEditingPlId(null);
      window.dispatchEvent(new CustomEvent("show-toast", { detail: { title: "Changes Saved", message: "Playlist updated", type: "success", duration: 2500 } }));
      await hapticSuccess();
    } catch {
      window.dispatchEvent(new CustomEvent("show-toast", { detail: { title: "Error", message: "Failed to update playlist", type: "error", duration: 3000 } }));
    }
    setPlActionLoading(false);
  };

  const togglePlaylistEnabled = async (id: string) => {
    if (plActionLoading) return;
    setPlActionLoading(true);
    try {
      const updated = await apiTogglePlaylist(id);
      setPlaylists(playlists.map((p) => p.id === id ? updated : p));
      await hapticSuccess();
    } catch {
      window.dispatchEvent(new CustomEvent("show-toast", { detail: { title: "Error", message: "Failed to toggle playlist", type: "error", duration: 3000 } }));
    }
    setPlActionLoading(false);
  };

  const deletePlaylist = async (id: string) => {
    if (plActionLoading) return;
    setPlActionLoading(true);
    try {
      await apiDeletePlaylist(id);
      setPlaylists(playlists.filter((p) => p.id !== id));
      if (selectedPlId === id) setSelectedPlId(null);
      window.dispatchEvent(new CustomEvent("show-toast", { detail: { title: "Playlist Deleted", message: "Playlist removed", type: "success", duration: 2500 } }));
      await hapticSuccess();
    } catch {
      window.dispatchEvent(new CustomEvent("show-toast", { detail: { title: "Error", message: "Failed to delete playlist", type: "error", duration: 3000 } }));
    }
    setPlActionLoading(false);
    setPlConfirmDelete(null);
  };

  const removeSongFromPlaylist = async (plId: string, songId: string) => {
    if (plActionLoading) return;
    setPlActionLoading(true);
    const ok = await apiRemoveSong(plId, songId);
    if (ok) {
      setStationFiles(stationFiles.map((f) =>
        f.id === songId ? { ...f, playlists: f.playlists.filter((p) => p !== plId) } : f
      ));
      window.dispatchEvent(new CustomEvent("show-toast", { detail: { title: "Song Removed", message: "Song removed from playlist", type: "success", duration: 2500 } }));
    } else {
      window.dispatchEvent(new CustomEvent("show-toast", { detail: { title: "Error", message: "Failed to remove song", type: "error", duration: 3000 } }));
    }
    setPlActionLoading(false);
  };

  const addSongsToPlaylist = async () => {
    if (!addSongsPlId || addSongsSelected.size === 0 || plActionLoading) return;
    setPlActionLoading(true);
    try {
      await apiAddSongs(addSongsPlId, [...addSongsSelected]);
      setStationFiles(stationFiles.map((f) =>
        addSongsSelected.has(f.id) && !f.playlists.includes(addSongsPlId)
          ? { ...f, playlists: [...f.playlists, addSongsPlId] }
          : f
      ));
      window.dispatchEvent(new CustomEvent("show-toast", { detail: { title: "Songs Added", message: `${addSongsSelected.size} songs added to playlist`, type: "success", duration: 2500 } }));
      setShowSongPicker(false);
      setAddSongsPlId(null);
      setAddSongsSearch("");
      setAddSongsSelected(new Set());
    } catch {
      window.dispatchEvent(new CustomEvent("show-toast", { detail: { title: "Error", message: "Something went wrong \u2014 try again", type: "error", duration: 3000 } }));
    }
    setPlActionLoading(false);
  };

  const toggleScheduleDay = (day: string) => {
    setPlSchedule((prev) => ({
      ...prev,
      days: prev.days.includes(day) ? prev.days.filter((d) => d !== day) : [...prev.days, day],
    }));
  };

  const refreshPlaylistData = async () => {
    setLoadingPlaylists(true);
    await Promise.all([
      getPlaylists().then(setPlaylists),
      getStationFiles().then(setStationFiles),
    ]).catch(() => {}).finally(() => setLoadingPlaylists(false));
  };

  const countByType = (type: string) => type === "all" ? playlists.length : playlists.filter((p) => p.type === type).length;
  const filteredByTab = playlists.filter((p) => plFilterTab === "all" || p.type === plFilterTab);
  const filteredPlaylists = filteredByTab.filter(
    (p) => !playlistFilter || p.name.toLowerCase().includes(playlistFilter.toLowerCase())
  );
  const getStatus = (pl: Playlist): "active" | "scheduled" | "general" | "disabled" => {
    if (!pl.enabled) return "disabled";
    if (pl.enabled && pl.type === "standard") return "general";
    if (pl.type === "scheduled") return "scheduled";
    return "general";
  };

  const selectedPl = selectedPlId ? playlists.find((p) => p.id === selectedPlId) : null;
  const selectedSongs = selectedPl ? plSongsFor(selectedPl.id) : [];
  const scheduledPlaylists = playlists.filter((p) => p.type === "scheduled" && p.schedule);
  const playlistColors: Record<string, string> = {};
  scheduledPlaylists.forEach((pl, i) => {
    const palette = ["#E8A838","#3B82F6","#8B5CF6","#10B981","#F43F5E","#14B8A6","#F97316"];
    playlistColors[pl.id] = palette[i % palette.length];
  });

  const openEditModal = (pl: Playlist) => {
    setEditingPlId(pl.id);
    setPlForm({ name: pl.name, type: pl.type, order: pl.order, weight: pl.weight });
    setPlCreateType(pl.type as any);
    setPlCreateOrder(pl.order as any);
    if (pl.schedule) {
      setPlSchedule({ days: pl.schedule.days.map((d) => DAYS[d] || DAYS[0]), startTime: pl.schedule.startTime, endTime: pl.schedule.endTime });
    } else {
      setPlSchedule({ days: [], startTime: "09:00", endTime: "17:00" });
    }
    setShowEditPlModal(true);
  };

  if (loadingPlaylists) {
    return (
      <div className="pl-content">
        <style>{`
          .pl-content { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
          .skeleton-loading { background: linear-gradient(90deg, var(--surface) 25%, var(--surface-hover) 50%, var(--surface) 75%); background-size: 200% 100%; animation: shimmer 1.5s ease-in-out infinite; border-radius: var(--radius-md); }
          .skeleton-line { height: 14px; width: 100%; margin-bottom: 8px; }
          .skeleton-line.w60 { width: 60%; }
          .skeleton-line.w40 { width: 40%; }
          .skeleton-line.w80 { width: 80%; }
          .skeleton-line.w30 { width: 30%; }
          .skeleton-line.h24 { height: 24px; }
          .skeleton-line.h40 { height: 40px; }
          .skeleton-card { background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; }
          @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        `}</style>
        <div style={{ padding: "16px 0" }}>
          <div className="skeleton-loading skeleton-line w40 h24" style={{ marginBottom: 16 }}></div>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <div className="skeleton-loading skeleton-line w20 h32" style={{ borderRadius: 8 }}></div>
            <div className="skeleton-loading skeleton-line w20 h32" style={{ borderRadius: 8 }}></div>
            <div className="skeleton-loading skeleton-line w20 h32" style={{ borderRadius: 8 }}></div>
          </div>
          {[1,2,3].map((i) => (
            <div key={i} className="skeleton-card" style={{ padding: 14, marginBottom: 10, display: "flex", alignItems: "center", gap: 12 }}>
              <div className="skeleton-loading" style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0 }}></div>
              <div style={{ flex: 1 }}>
                <div className="skeleton-loading skeleton-line w60 h20" style={{ marginBottom: 6 }}></div>
                <div className="skeleton-loading skeleton-line w40"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const nowPlayingPlaylistId = pcActivePlaylist;

  return (
    <div className="pl-content-new">
      <style>{`
        .pl-content-new { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
        .pl-new-header { display: flex; align-items: center; justify-content: space-between; }
        .pl-new-heading { font-size: 22px; font-weight: 800; }
        .pl-filter-tabs { display: flex; gap: 6px; align-items: center; overflow-x: auto; -webkit-overflow-scrolling: touch; }
        .pl-filter-tabs::-webkit-scrollbar { display: none; }
        .pl-filter-tab { display: flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; border: none; background: transparent; color: var(--text-secondary); cursor: pointer; white-space: nowrap; transition: all 0.2s ease; }
        .pl-filter-tab:active { transform: scale(0.95); }
        .pl-filter-tab.active { background: var(--surface-card); border: 1px solid var(--border); color: var(--text-primary); }
        .pl-filter-count { padding: 1px 7px; border-radius: 8px; font-size: 11px; font-weight: 700; background: var(--surface-elevated); color: var(--text-tertiary); }
        .pl-create-btn { display: flex; align-items: center; gap: 6px; padding: 10px 16px; background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end)); border: none; border-radius: var(--radius-md); color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; transition: all 0.2s ease; white-space: nowrap; box-shadow: var(--shadow-soft); }
        .pl-create-btn:active { transform: scale(0.95); }
        .pl-search-wrapper { position: relative; flex: 1; }
        .pl-search-wrapper > i { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--text-tertiary); font-size: 14px; pointer-events: none; }
        .pl-search-input { width: 100%; padding: 10px 12px 10px 36px; background: var(--surface-card); border: 1.5px solid var(--border); border-radius: var(--radius-md); color: var(--text-primary); font-size: 13px; font-weight: 500; outline: none; }
        .pl-search-input:focus { border-color: var(--primary); }
        .pl-sched-view-toggle { display: flex; align-items: center; gap: 8px; }
        .pl-sched-toggle-btn { display: flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; border: 1.5px solid var(--border); background: var(--surface-card); color: var(--text-secondary); cursor: pointer; transition: all 0.2s ease; }
        .pl-sched-toggle-btn:active { transform: scale(0.95); }
        .pl-sched-toggle-btn.active { border-color: var(--primary); color: var(--primary); }
        .pl-schedule-view { display: flex; flex-direction: column; gap: 10px; }
        .pl-sv-header { display: flex; align-items: center; justify-content: space-between; }
        .pl-sv-title { font-size: 16px; font-weight: 700; }
        .pl-sv-grid-wrapper { overflow-x: auto; -webkit-overflow-scrolling: touch; }
        .pl-sv-grid-wrapper::-webkit-scrollbar { display: none; }
        .pl-sv-grid { display: grid; grid-template-columns: 50px repeat(7, 1fr); gap: 1px; background: var(--border); border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden; min-width: 600px; }
        .pl-sv-corner { background: var(--surface-card); }
        .pl-sv-day-header { background: var(--surface-card); padding: 8px 4px; text-align: center; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-secondary); }
        .pl-sv-day-header.today { background: rgba(232,168,56,0.1); color: var(--primary); }
        .pl-sv-time { background: var(--surface-card); padding: 2px 6px; font-size: 9px; color: var(--text-tertiary); font-weight: 500; text-align: right; display: flex; align-items: flex-start; justify-content: flex-end; }
        .pl-sv-cell { background: var(--surface-elevated); min-height: 24px; padding: 1px; position: relative; cursor: default; }
        .pl-sv-cell.today { background: rgba(232,168,56,0.03); }
        .pl-sv-cell.has-block { padding: 1px; }
        .pl-sv-block { border-radius: 3px; padding: 1px 4px; font-size: 8px; font-weight: 700; color: #fff; margin-bottom: 1px; cursor: pointer; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; line-height: 1.4; }
        .pl-sv-block:active { opacity: 0.8; }
        .pl-two-panel { display: flex; gap: 14px; min-height: 400px; }
        .pl-left-panel { flex: 1; min-width: 0; }
        .pl-left-compact { max-width: 400px; }
        .pl-right-panel { flex: 1; min-width: 0; background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 18px; display: flex; flex-direction: column; gap: 18px; align-self: flex-start; }
        .pl-card-list { display: flex; flex-direction: column; gap: 6px; }
        .pl-card-new { display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px; background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-lg); cursor: pointer; transition: all 0.2s ease; position: relative; }
        .pl-card-new:active { transform: scale(0.98); }
        .pl-card-new.selected { border-color: var(--primary); border-left: 3px solid var(--primary); padding-left: 12px; }
        .pl-card-new.now-playing { border-left: 3px solid var(--success); padding-left: 12px; }
        .pl-card-new.default { background: rgba(232,168,56,0.03); }
        .pl-card-status-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; margin-top: 5px; }
        .pl-card-status-dot.active { background: var(--success); box-shadow: 0 0 6px var(--success); animation: livePulse 1.5s ease-in-out infinite; }
        .pl-card-status-dot.scheduled { background: var(--primary); }
        .pl-card-status-dot.general { background: var(--text-tertiary); }
        .pl-card-status-dot.disabled { background: var(--error); opacity: 0.5; }
        @keyframes livePulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(1.5); } }
        .pl-card-new-body { flex: 1; min-width: 0; }
        .pl-card-new-top { display: flex; align-items: center; gap: 8px; }
        .pl-card-new-name { font-size: 15px; font-weight: 600; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .pl-card-new-meta { font-size: 12px; color: var(--text-tertiary); margin-top: 3px; }
        .pl-card-new-tag { display: inline-flex; align-items: center; gap: 4px; margin-top: 6px; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; background: rgba(232,168,56,0.08); color: var(--primary); }
        .pl-card-new-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
        .pl-card-edit-btn { width: 30px; height: 30px; border-radius: 50%; background: none; border: none; color: var(--text-tertiary); font-size: 13px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
        .pl-card-edit-btn:active { background: var(--surface-elevated); color: var(--text-primary); }
        .pl-card-menu-wrapper { position: relative; }
        .pl-card-menu-btn { width: 30px; height: 30px; border-radius: 50%; background: none; border: none; color: var(--text-tertiary); font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
        .pl-card-menu-btn:active { background: var(--surface-elevated); }
        .pl-menu-overlay { position: fixed; inset: 0; z-index: 100; }
        .pl-menu-dropdown { position: absolute; top: 100%; right: 0; margin-top: 4px; background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-md); box-shadow: var(--shadow-lg); z-index: 101; min-width: 140px; overflow: hidden; }
        .pl-menu-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 10px 14px; font-size: 13px; font-weight: 500; border: none; background: none; color: var(--text-primary); cursor: pointer; text-align: left; }
        .pl-menu-item:active { background: var(--surface-hover); }
        .pl-menu-item.danger { color: var(--error); }
        .pl-card-now-playing-badge { position: absolute; top: -1px; right: -1px; padding: 2px 8px; font-size: 10px; font-weight: 700; background: var(--success); color: #fff; border-radius: 0 var(--radius-lg) 0 6px; }
        .pl-detail-header { display: flex; align-items: center; gap: 10px; }
        .pl-detail-back { width: 32px; height: 32px; border-radius: 50%; border: none; background: var(--surface-elevated); color: var(--text-secondary); font-size: 14px; cursor: pointer; display: none; align-items: center; justify-content: center; }
        .pl-detail-back:active { transform: scale(0.92); }
        .pl-detail-header-info { flex: 1; display: flex; align-items: center; gap: 8px; }
        .pl-detail-name { font-size: 20px; font-weight: 700; }
        .pl-detail-header-actions { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
        .pl-detail-edit-btn { display: flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: var(--radius-sm); font-size: 12px; font-weight: 600; border: 1px solid var(--border); background: transparent; color: var(--text-secondary); cursor: pointer; }
        .pl-detail-edit-btn:active { background: var(--surface-elevated); }
        .pl-detail-section-title { font-size: 13px; font-weight: 600; color: var(--text-secondary); display: flex; align-items: center; gap: 6px; }
        .pl-detail-schedule { background: rgba(232,168,56,0.04); border: 1px solid rgba(232,168,56,0.1); border-radius: var(--radius-md); padding: 14px; display: flex; flex-direction: column; gap: 10px; }
        .pl-detail-schedule-body { display: flex; flex-direction: column; gap: 8px; }
        .pl-detail-days { display: flex; gap: 4px; flex-wrap: wrap; }
        .pl-detail-day-pill { padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 600; background: var(--surface-elevated); color: var(--text-tertiary); }
        .pl-detail-day-pill.active { background: var(--primary); color: #fff; }
        .pl-detail-time { font-size: 14px; font-weight: 700; color: var(--text-primary); }
        .pl-detail-next-run { font-size: 12px; color: var(--text-tertiary); display: flex; align-items: center; gap: 6px; }
        .pl-detail-songs { display: flex; flex-direction: column; gap: 10px; }
        .pl-detail-songs-header { display: flex; align-items: center; justify-content: space-between; }
        .pl-detail-add-songs-btn { display: flex; align-items: center; gap: 4px; padding: 8px 14px; border-radius: var(--radius-sm); font-size: 12px; font-weight: 600; border: 1.5px dashed var(--border); background: transparent; color: var(--primary); cursor: pointer; }
        .pl-detail-add-songs-btn:active { border-color: var(--primary); background: rgba(232,168,56,0.03); }
        .pl-detail-empty-songs { text-align: center; padding: 30px 0; color: var(--text-tertiary); }
        .pl-detail-empty-songs i { font-size: 32px; opacity: 0.4; margin-bottom: 8px; display: block; }
        .pl-detail-empty-songs p { font-size: 15px; font-weight: 600; margin: 0 0 4px; }
        .pl-detail-empty-songs span { font-size: 13px; }
        .pl-detail-song-list { display: flex; flex-direction: column; gap: 4px; }
        .pl-detail-song-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: var(--radius-sm); transition: background 0.15s ease; }
        .pl-detail-song-item:active { background: var(--surface-hover); }
        .pl-detail-song-drag { color: var(--text-tertiary); font-size: 14px; cursor: grab; flex-shrink: 0; }
        .pl-detail-song-cover { width: 36px; height: 36px; border-radius: 6px; object-fit: cover; flex-shrink: 0; border: 1px solid var(--border); }
        .pl-detail-song-info { flex: 1; min-width: 0; }
        .pl-detail-song-title { font-size: 14px; font-weight: 600; }
        .pl-detail-song-artist { font-size: 12px; color: var(--text-secondary); }
        .pl-detail-song-duration { font-size: 12px; color: var(--text-tertiary); font-weight: 500; flex-shrink: 0; }
        .pl-detail-song-remove { width: 26px; height: 26px; border-radius: 50%; border: none; background: none; color: var(--text-tertiary); font-size: 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; opacity: 0; transition: all 0.2s ease; }
        .pl-detail-song-item:hover .pl-detail-song-remove { opacity: 1; }
        .pl-detail-song-remove:active { background: rgba(239,68,68,0.1); color: var(--error); }
        .pl-detail-total-duration { font-size: 12px; font-weight: 600; color: var(--text-tertiary); padding: 8px 8px 0; border-top: 1px solid var(--border); margin-top: 4px; }
        .pl-empty-state { text-align: center; padding: 50px 20px; color: var(--text-tertiary); }
        .pl-empty-state i { font-size: 40px; opacity: 0.3; margin-bottom: 12px; display: block; }
        .pl-empty-state h4 { font-size: 16px; font-weight: 700; margin: 0 0 6px; color: var(--text-primary); }
        .pl-empty-state p { font-size: 13px; margin: 0 0 16px; }
        .pl-type-badge { padding: 3px 10px; border-radius: 6px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; flex-shrink: 0; }
        .pl-type-badge.standard { background: rgba(59,130,246,0.12); color: #3B82F6; }
        .pl-type-badge.scheduled { background: rgba(232,168,56,0.12); color: var(--primary); }
        .pl-type-badge.ondemand { background: rgba(139,92,246,0.12); color: #8B5CF6; }
        .pl-form-row { display: flex; flex-direction: column; gap: 6px; }
        .pl-form-row label { font-size: 12px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
        .pl-form-input { padding: 11px 14px; background: var(--surface-elevated); border: 1.5px solid var(--border); border-radius: var(--radius-sm); color: var(--text-primary); font-size: 14px; font-weight: 500; outline: none; color-scheme: dark; }
        .pl-form-input:focus { border-color: var(--primary); }
        .pl-form-input[type="time"]::-webkit-calendar-picker-indicator { filter: invert(0.7); cursor: pointer; }
        .pl-form-input[type="time"]::-webkit-datetime-edit { color: var(--text-primary); }
        .pl-form-range { width: 100%; height: 6px; -webkit-appearance: none; appearance: none; background: var(--surface-elevated); border-radius: 3px; outline: none; }
        .pl-form-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 20px; height: 20px; border-radius: 50%; background: var(--primary); cursor: pointer; box-shadow: var(--shadow-soft); }
        .pl-form-actions { display: flex; gap: 8px; margin-top: 4px; }
        .pl-form-save { padding: 10px 20px; background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end)); border: none; border-radius: var(--radius-sm); color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; transition: all 0.2s ease; }
        .pl-form-save:active { transform: scale(0.95); }
        .pl-form-cancel { padding: 10px 20px; background: var(--surface-elevated); border: none; border-radius: var(--radius-sm); color: var(--text-secondary); font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s ease; }
        .pl-form-cancel:active { transform: scale(0.95); }
        .pl-schedule-config { background: var(--surface-elevated); border-radius: var(--radius-md); padding: 14px; display: flex; flex-direction: column; gap: 12px; }
        .pl-day-chips { display: flex; gap: 6px; flex-wrap: wrap; }
        .pl-day-chip { padding: 6px 12px; border-radius: 8px; font-size: 12px; font-weight: 600; border: 1.5px solid var(--border); background: transparent; color: var(--text-secondary); cursor: pointer; transition: all 0.2s ease; }
        .pl-day-chip:active { transform: scale(0.95); }
        .pl-day-chip.active { background: var(--primary); border-color: var(--primary); color: #fff; }
        .pl-time-row { display: flex; gap: 12px; }
        .pl-time-row > div { flex: 1; display: flex; flex-direction: column; gap: 6px; }
        .pl-time-row label { font-size: 11px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; }
        .pl-type-options { display: flex; flex-direction: column; gap: 6px; }
        .pl-type-option { display: flex; flex-direction: column; gap: 2px; padding: 12px 14px; border: 1.5px solid var(--border); border-radius: var(--radius-md); cursor: pointer; transition: all 0.2s ease; }
        .pl-type-option:active { transform: scale(0.98); }
        .pl-type-option.active { border-color: var(--primary); background: rgba(232,168,56,0.03); }
        .pl-type-option input { display: none; }
        .pl-type-option-label { font-size: 14px; font-weight: 600; }
        .pl-type-option-desc { font-size: 12px; color: var(--text-tertiary); }
        .pl-order-options { display: flex; gap: 8px; }
        .pl-order-option { display: flex; align-items: center; gap: 6px; padding: 10px 16px; border: 1.5px solid var(--border); border-radius: var(--radius-md); cursor: pointer; font-size: 13px; font-weight: 600; transition: all 0.2s ease; }
        .pl-order-option:active { transform: scale(0.95); }
        .pl-order-option.active { border-color: var(--primary); background: rgba(232,168,56,0.03); }
        .pl-order-option input { display: none; }
        .pl-form-danger { padding: 10px 20px; background: rgba(239,68,68,0.1); border: none; border-radius: var(--radius-sm); color: var(--error); font-size: 13px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: all 0.2s ease; }
        .pl-form-danger:active { background: rgba(239,68,68,0.2); }
        .pl-form-danger:disabled { opacity: 0.5; cursor: not-allowed; }
        .pl-toggle { position: relative; display: inline-block; width: 42px; height: 24px; cursor: pointer; }
        .pl-toggle input { display: none; }
        .pl-toggle-slider { position: absolute; inset: 0; background: var(--surface-elevated); border-radius: 12px; transition: all 0.25s ease; }
        .pl-toggle-slider::before { content: ''; position: absolute; left: 3px; top: 3px; width: 18px; height: 18px; background: var(--text-tertiary); border-radius: 50%; transition: all 0.25s ease; }
        .pl-toggle input:checked + .pl-toggle-slider { background: var(--primary); }
        .pl-toggle input:checked + .pl-toggle-slider::before { background: #fff; transform: translateX(18px); }
        .media-modal-overlay { position: fixed; inset: 0; background: var(--overlay); z-index: 9000; animation: fadeSlideUp 0.2s ease; }
        @keyframes fadeSlideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .media-modal-sheet { position: fixed; bottom: 0; left: 0; right: 0; z-index: 9001; max-width: 480px; margin: 0 auto; background: var(--surface); border-radius: 28px 28px 0 0; animation: slideUp 0.35s cubic-bezier(0.32, 0.72, 0, 1); max-height: 80vh; display: flex; flex-direction: column; }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        .media-modal-handle { width: 40px; height: 5px; background: var(--text-tertiary); border-radius: 3px; margin: 12px auto 8px; opacity: 0.5; }
        .media-modal-header { padding: 8px 24px 16px; text-align: center; }
        .media-modal-header h2 { font-size: 20px; font-weight: 700; }
        .media-modal-header p { font-size: 13px; color: var(--text-secondary); margin-top: 4px; }
        .media-modal-body { flex: 1; overflow-y: auto; padding: 0 24px 20px; -webkit-overflow-scrolling: touch; }
        .media-modal-body::-webkit-scrollbar { display: none; }
        .media-modal-close { width: 32px; height: 32px; border-radius: 50%; border: none; background: var(--surface-elevated); color: var(--text-secondary); font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .media-modal-close:active { background: var(--surface-hover); }
        .pl-picker-toolbar { position: relative; margin: 0 20px 8px; }
        .pl-picker-toolbar > i { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--text-tertiary); font-size: 14px; pointer-events: none; }
        .pl-picker-search { width: 100%; padding: 10px 12px 10px 36px; background: var(--surface-elevated); border: 1.5px solid var(--border); border-radius: var(--radius-md); color: var(--text-primary); font-size: 13px; outline: none; box-sizing: border-box; }
        .pl-picker-search:focus { border-color: var(--primary); }
        .pl-picker-item { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--border); cursor: pointer; transition: opacity 0.2s ease; }
        .pl-picker-item:last-child { border-bottom: none; }
        .pl-picker-item.disabled { opacity: 0.4; cursor: default; }
        .pl-picker-item:not(.disabled):active { opacity: 0.6; }
        .pl-picker-cover { width: 36px; height: 36px; border-radius: 6px; object-fit: cover; border: 1px solid var(--border); }
        .pl-picker-info { flex: 1; min-width: 0; }
        .pl-picker-title { font-size: 14px; font-weight: 600; }
        .pl-picker-artist { font-size: 12px; color: var(--text-secondary); }
        .pl-picker-checkbox { width: 20px; height: 20px; border-radius: 4px; border: 2px solid var(--border); display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 11px; color: #fff; background: transparent; }
        .pl-picker-checkbox.checked { background: var(--primary); border-color: var(--primary); }
        .pl-picker-already { font-size: 11px; color: var(--text-tertiary); font-weight: 500; flex-shrink: 0; }
        .pl-picker-footer { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; border-top: 1px solid var(--border); }
        .pl-picker-count { font-size: 13px; font-weight: 600; color: var(--text-secondary); }
        .skeleton-loading { background: linear-gradient(90deg, var(--surface) 25%, var(--surface-hover) 50%, var(--surface) 75%); background-size: 200% 100%; animation: shimmer 1.5s ease-in-out infinite; border-radius: var(--radius-md); }
        .skeleton-line { height: 14px; width: 100%; margin-bottom: 8px; }
        .skeleton-line.w60 { width: 60%; }
        .skeleton-line.w40 { width: 40%; }
        .skeleton-line.w80 { width: 80%; }
        .skeleton-line.w30 { width: 30%; }
        .skeleton-line.h24 { height: 24px; }
        .skeleton-line.h40 { height: 40px; }
        .skeleton-card { background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; }
        @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        @media (max-width: 767px) {
          .pl-two-panel { flex-direction: column; }
          .pl-left-compact { max-width: 100%; }
          .pl-detail-back { display: flex; }
          .pl-right-panel { margin-left: 0; }
          .pl-filter-tab { font-size: 12px; padding: 6px 10px; }
        }
      `}</style>

      <div className="pl-new-header">
        <h2 className="pl-new-heading">Playlists</h2>
        <button className="pl-create-btn" onClick={() => { setShowCreatePlaylist(true); setPlCreateType("standard"); setPlCreateOrder("shuffle"); setPlForm({ name: "", type: "standard", order: "shuffle", weight: 10 }); setPlSchedule({ days: [], startTime: "09:00", endTime: "17:00" }); }}>
          <i className="fas fa-plus"></i> New Playlist
        </button>
      </div>

      <div className="pl-filter-tabs">
        {[
          { id: "all", label: "All" },
          { id: "scheduled", label: "Scheduled" },
          { id: "standard", label: "General" },
          { id: "on_demand", label: "On Demand" },
        ].map((tab) => (
          <button
            key={tab.id}
            className={`pl-filter-tab ${plFilterTab === tab.id ? "active" : ""}`}
            onClick={() => { setPlFilterTab(tab.id); setSelectedPlId(null); }}
          >
            {tab.label}
            {countByType(tab.id) > 0 && <span className="pl-filter-count">{countByType(tab.id)}</span>}
          </button>
        ))}
        <div className="pl-search-wrapper" style={{ marginLeft: "auto", maxWidth: 200 }}>
          <i className="fas fa-search"></i>
          <input type="text" className="pl-search-input" placeholder="Search..." value={playlistFilter}
            onChange={(e) => setPlaylistFilter(e.target.value)} />
        </div>
      </div>

      {plFilterTab === "scheduled" && (
        <div className="pl-sched-view-toggle">
          <button
            className={`pl-sched-toggle-btn ${showScheduleView ? "active" : ""}`}
            onClick={() => setShowScheduleView(!showScheduleView)}
          >
            <i className={`fas ${showScheduleView ? "fa-list" : "fa-calendar-week"}`}></i>
            {showScheduleView ? "List View" : "Schedule View"}
          </button>
        </div>
      )}

      {plFilterTab === "scheduled" && showScheduleView && (
        <div className="pl-schedule-view">
          <div className="pl-sv-header">
            <h3 className="pl-sv-title">Weekly Schedule</h3>
          </div>
          <div className="pl-sv-grid-wrapper">
            <div className="pl-sv-grid">
              <div className="pl-sv-corner"></div>
              {DAYS.map((d, i) => {
                const todayIdx = new Date().getDay();
                const dayNum = i === 6 ? 0 : i + 1;
                const isToday = dayNum === todayIdx;
                return (
                  <div key={d} className={`pl-sv-day-header ${isToday ? "today" : ""}`}>
                    {d}
                  </div>
                );
              })}
              {Array.from({ length: 24 }, (_, hour) => (
                <React.Fragment key={hour}>
                  <div className="pl-sv-time">{hour === 0 ? "12AM" : hour < 12 ? `${hour}AM` : hour === 12 ? "12PM" : `${hour - 12}PM`}</div>
                  {DAYS.map((d, dayIdx) => {
                    const dayNum = dayIdx === 6 ? 0 : dayIdx + 1;
                    const todayIdx = new Date().getDay();
                    const isToday = dayNum === todayIdx;
                    const hourStart = `${String(hour).padStart(2, "0")}:00`;
                    const hourEnd = `${String(hour + 1).padStart(2, "0")}:00`;
                    const blocks = scheduledPlaylists.filter((pl) => {
                      if (!pl.schedule) return false;
                      return pl.schedule.days.includes(dayNum) &&
                        pl.schedule.startTime <= hourEnd &&
                        pl.schedule.endTime > hourStart;
                    });
                    return (
                      <div key={`${d}-${hour}`} className={`pl-sv-cell ${isToday ? "today" : ""} ${blocks.length > 0 ? "has-block" : ""}`}
                        style={blocks.length > 0 ? { background: `rgba(232,168,56,${Math.min(0.08 * blocks.length, 0.25)})` } : {}}>
                        {blocks.map((pl) => (
                          <div
                            key={pl.id}
                            className="pl-sv-block"
                            style={{ background: playlistColors[pl.id] || "#E8A838" }}
                            title={`${pl.name} (${pl.schedule!.startTime} - ${pl.schedule!.endTime})`}
                            onClick={() => setSelectedPlId(pl.id)}
                          >
                            {pl.name}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      )}

      {!(plFilterTab === "scheduled" && showScheduleView) && (
      <div className="pl-two-panel">
        <div className={`pl-left-panel ${selectedPlId ? "pl-left-compact" : ""}`}>
          {playlists.length === 0 ? (
            <div className="pl-empty-state">
              <i className="fas fa-list"></i>
              <h4>No playlists yet</h4>
              <p>Create your first playlist to start organizing your music</p>
              <button className="pl-create-btn" onClick={() => { setShowCreatePlaylist(true); setPlCreateType("standard"); setPlForm({ name: "", type: "standard", order: "shuffle", weight: 10 }); }}>
                <i className="fas fa-plus"></i> Create Playlist
              </button>
            </div>
          ) : filteredPlaylists.length === 0 ? (
            <div className="pl-empty-state">
              <i className="fas fa-filter"></i>
              <p>No playlists match this filter</p>
            </div>
          ) : (
            <div className="pl-card-list">
              {filteredPlaylists.map((pl) => {
                const isSelected = selectedPlId === pl.id;
                const isPlaying = nowPlayingPlaylistId === pl.id;
                const status = getStatus(pl);
                return (
                  <div
                    key={pl.id}
                    className={`pl-card-new ${isSelected ? "selected" : ""} ${isPlaying ? "now-playing" : ""} ${pl.name === "Default" ? "default" : ""}`}
                    onClick={() => setSelectedPlId(isSelected ? null : pl.id)}
                  >
                    <div className={`pl-card-status-dot ${status}`}></div>
                    <div className="pl-card-new-body">
                      <div className="pl-card-new-top">
                        <div className="pl-card-new-name">{pl.name}</div>
                        <span className={`pl-type-badge ${pl.type}`}>{pl.type === "on_demand" ? "On Demand" : pl.type === "scheduled" ? "Scheduled" : "General"}</span>
                      </div>
                      <div className="pl-card-new-meta">
                        {pl.songCount} songs
                        {pl.schedule && <span> &middot; {pl.schedule.days.map((d: number) => DAYS[d] || DAYS[0]).join(", ")} &middot; {pl.schedule.startTime}\u2013{pl.schedule.endTime}</span>}
                        {!pl.schedule && <span> &middot; {pl.type === "standard" ? "Always playing as fallback" : "Triggered manually"}</span>}
                      </div>
                      {pl.name === "Default" && (
                        <div className="pl-card-new-tag">
                          <i className="fas fa-thumbtack"></i> Fallback playlist \u2014 always keep active
                        </div>
                      )}
                    </div>
                    <div className="pl-card-new-actions" onClick={(e) => e.stopPropagation()}>
                      <button className="pl-card-edit-btn" onClick={() => openEditModal(pl)}>
                        <i className="fas fa-pen"></i>
                      </button>
                      <div className="pl-card-menu-wrapper">
                        <button className="pl-card-menu-btn" onClick={() => setPlMenuOpen(plMenuOpen === pl.id ? null : pl.id)}>
                          <i className="fas fa-ellipsis"></i>
                        </button>
                        {plMenuOpen === pl.id && (
                          <>
                            <div className="pl-menu-overlay" onClick={() => setPlMenuOpen(null)}></div>
                            <div className="pl-menu-dropdown">
                              <button className="pl-menu-item" onClick={() => { togglePlaylistEnabled(pl.id); setPlMenuOpen(null); }}>
                                <i className={`fas ${pl.enabled ? "fa-pause" : "fa-play"}`}></i>
                                {pl.enabled ? "Disable" : "Enable"}
                              </button>
                              {pl.name !== "Default" && (
                                <button className="pl-menu-item danger" onClick={() => { setPlConfirmDelete(pl.id); setPlMenuOpen(null); }}>
                                  <i className="fas fa-trash-can"></i> Delete
                                </button>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                    {isPlaying && <div className="pl-card-now-playing-badge">Now Playing</div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {selectedPl && (
          <div className="pl-right-panel">
            <div className="pl-detail-header">
              <button className="pl-detail-back" onClick={() => setSelectedPlId(null)}>
                <i className="fas fa-chevron-left"></i>
              </button>
              <div className="pl-detail-header-info">
                <div className="pl-detail-name">{selectedPl.name}</div>
                <span className={`pl-type-badge ${selectedPl.type}`}>{selectedPl.type === "on_demand" ? "On Demand" : selectedPl.type === "scheduled" ? "Scheduled" : "General"}</span>
              </div>
              <div className="pl-detail-header-actions">
                <label className="pl-toggle">
                  <input type="checkbox" checked={selectedPl.enabled} disabled={plActionLoading}
                    onChange={() => togglePlaylistEnabled(selectedPl.id)} />
                  <span className="pl-toggle-slider"></span>
                </label>
                <button className="pl-detail-edit-btn" onClick={() => openEditModal(selectedPl)}>
                  <i className="fas fa-pen"></i> Edit
                </button>
              </div>
            </div>

            {selectedPl.schedule && (
              <div className="pl-detail-schedule">
                <div className="pl-detail-section-title"><i className="fas fa-calendar"></i> Schedule</div>
                <div className="pl-detail-schedule-body">
                  <div className="pl-detail-days">
                    {DAYS.map((d) => (
                      <span key={d} className={`pl-detail-day-pill ${selectedPl.schedule!.days.includes(DAYS.indexOf(d)) ? "active" : ""}`}>{d}</span>
                    ))}
                  </div>
                  <div className="pl-detail-time">
                    {selectedPl.schedule.startTime} \u2192 {selectedPl.schedule.endTime}
                  </div>
                  <div className="pl-detail-next-run">
                    <i className="fas fa-hourglass-half"></i> Next run: Scheduled daily
                  </div>
                </div>
              </div>
            )}

            <div className="pl-detail-songs">
              <div className="pl-detail-songs-header">
                <span className="pl-detail-section-title"><i className="fas fa-music"></i> Songs ({selectedSongs.length})</span>
                <button className="pl-detail-add-songs-btn" onClick={() => { setAddSongsPlId(selectedPl.id); setAddSongsSearch(""); setAddSongsSelected(new Set()); setShowSongPicker(true); }}>
                  <i className="fas fa-plus"></i> Add Songs
                </button>
              </div>
              {selectedSongs.length === 0 ? (
                <div className="pl-detail-empty-songs">
                  <i className="fas fa-music"></i>
                  <p>No songs yet</p>
                  <span>Tap \u201c+ Add Songs\u201d to add music to this playlist</span>
                </div>
              ) : (
                <div className="pl-detail-song-list">
                  {selectedSongs.map((song) => (
                    <div className="pl-detail-song-item" key={song.id}>
                      <span className="pl-detail-song-drag"><i className="fas fa-grip-vertical"></i></span>
                      <img className="pl-detail-song-cover" src={song.albumArt || "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=40&h=40&fit=crop"} alt={song.title} />
                      <div className="pl-detail-song-info">
                        <div className="pl-detail-song-title">{song.title}</div>
                        <div className="pl-detail-song-artist">{song.artist || "Unknown Artist"}</div>
                      </div>
                      <span className="pl-detail-song-duration">{song.duration}</span>
                      <button className="pl-detail-song-remove" onClick={() => removeSongFromPlaylist(selectedPl.id, song.id)} title="Remove">
                        <i className="fas fa-xmark"></i>
                      </button>
                    </div>
                  ))}
                  <div className="pl-detail-total-duration">
                    Total duration: {Math.floor(selectedSongs.reduce((acc, s) => acc + (parseInt(s.duration) || 0), 0) / 60)} mins {selectedSongs.reduce((acc, s) => acc + (parseInt(s.duration) || 0), 0) % 60} secs
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      )}

      {(showCreatePlaylist || showEditPlModal) && (
        <>
          <div className="media-modal-overlay" onClick={() => { setShowCreatePlaylist(false); setShowEditPlModal(false); setEditingPlId(null); }}></div>
          <div className="media-modal-sheet">
            <div className="media-modal-handle"></div>
            <div className="media-modal-header">
              <h2>{showEditPlModal ? "Edit Playlist" : "Create New Playlist"}</h2>
              <button className="media-modal-close" onClick={() => { setShowCreatePlaylist(false); setShowEditPlModal(false); setEditingPlId(null); }}><i className="fas fa-xmark"></i></button>
            </div>
            <div className="media-modal-body" style={{ padding: "0 20px 20px" }}>
              <div className="pl-form-row" style={{ marginBottom: 14 }}>
                <label>Playlist Name</label>
                <input type="text" className="pl-form-input" value={plForm.name} maxLength={100}
                  onChange={(e) => setPlForm({ ...plForm, name: e.target.value })} placeholder="e.g. Morning Devotion" />
              </div>
              <div className="pl-form-row" style={{ marginBottom: 14 }}>
                <label>Type</label>
                <div className="pl-type-options">
                  <label className={`pl-type-option ${plCreateType === "standard" ? "active" : ""}`}>
                    <input type="radio" name="plType" checked={plCreateType === "standard"} onChange={() => setPlCreateType("standard")} />
                    <span className="pl-type-option-label">General Rotation</span>
                    <span className="pl-type-option-desc">Always plays as fallback</span>
                  </label>
                  <label className={`pl-type-option ${plCreateType === "scheduled" ? "active" : ""}`}>
                    <input type="radio" name="plType" checked={plCreateType === "scheduled"} onChange={() => setPlCreateType("scheduled")} />
                    <span className="pl-type-option-label">Scheduled</span>
                    <span className="pl-type-option-desc">Plays at set times</span>
                  </label>
                  <label className={`pl-type-option ${plCreateType === "on_demand" ? "active" : ""}`}>
                    <input type="radio" name="plType" checked={plCreateType === "on_demand"} onChange={() => setPlCreateType("on_demand")} />
                    <span className="pl-type-option-label">On Demand</span>
                    <span className="pl-type-option-desc">Triggered manually</span>
                  </label>
                </div>
              </div>
              <div className="pl-form-row" style={{ marginBottom: 14 }}>
                <label>Play Order</label>
                <div className="pl-order-options">
                  <label className={`pl-order-option ${plCreateOrder === "shuffle" ? "active" : ""}`}>
                    <input type="radio" name="plOrder" checked={plCreateOrder === "shuffle"} onChange={() => setPlCreateOrder("shuffle")} />
                    <span>Shuffle</span>
                  </label>
                  <label className={`pl-order-option ${plCreateOrder === "sequential" ? "active" : ""}`}>
                    <input type="radio" name="plOrder" checked={plCreateOrder === "sequential"} onChange={() => setPlCreateOrder("sequential")} />
                    <span>Sequential</span>
                  </label>
                </div>
              </div>
              <div className="pl-form-row" style={{ marginBottom: 14 }}>
                <label>Weight ({plForm.weight})</label>
                <input type="range" min="1" max="20" className="pl-form-range" value={plForm.weight}
                  onChange={(e) => setPlForm({ ...plForm, weight: parseInt(e.target.value) })} />
              </div>
              {plCreateType === "scheduled" && (
                <div className="pl-schedule-config" style={{ marginBottom: 14 }}>
                  <label>Schedule</label>
                  <div className="pl-day-chips">
                    {DAYS.map((d) => (
                      <button key={d} className={`pl-day-chip ${plSchedule.days.includes(d) ? "active" : ""}`}
                        onClick={() => toggleScheduleDay(d)}>{d}</button>
                    ))}
                  </div>
                  <div className="pl-time-row" style={{ marginTop: 10 }}>
                    <div>
                      <label>Start Time</label>
                      <input type="time" className="pl-form-input" value={plSchedule.startTime}
                        onChange={(e) => setPlSchedule({ ...plSchedule, startTime: e.target.value })} />
                    </div>
                    <div>
                      <label>End Time</label>
                      <input type="time" className="pl-form-input" value={plSchedule.endTime}
                        onChange={(e) => setPlSchedule({ ...plSchedule, endTime: e.target.value })} />
                    </div>
                  </div>
                </div>
              )}
              <div className="pl-form-actions" style={{ justifyContent: "flex-end", marginTop: 8 }}>
                {showEditPlModal && (
                  <button className="pl-form-danger" onClick={() => { if (editingPlId) setPlConfirmDelete(editingPlId); }} disabled={plActionLoading || (editingPlId ? (playlists.find(p => p.id === editingPlId)?.name === "Default") : false)}>
                    <i className="fas fa-trash-can"></i> Delete
                  </button>
                )}
                <button className="pl-form-cancel" onClick={() => { setShowCreatePlaylist(false); setShowEditPlModal(false); setEditingPlId(null); }} disabled={plActionLoading}>
                  Cancel
                </button>
                <button className="pl-form-save" onClick={showEditPlModal ? saveEditedPlaylist : createPlaylist}
                  disabled={plActionLoading || !plForm.name.trim()}>
                  {plActionLoading ? <i className="fas fa-spinner fa-spin"></i> : null}
                  {plActionLoading ? " Saving..." : showEditPlModal ? "Save Changes" : "Create Playlist"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {plConfirmDelete && (
        <>
          <div className="media-modal-overlay" onClick={() => setPlConfirmDelete(null)}></div>
          <div className="media-modal-sheet" style={{ maxWidth: 360 }}>
            <div className="media-modal-handle"></div>
            <div className="media-modal-header">
              <h2>Delete Playlist?</h2>
            </div>
            <div className="media-modal-body" style={{ padding: "0 20px 20px", textAlign: "center" }}>
              <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: "8px 0 16px" }}>
                This will permanently remove &quot;{playlists.find(p => p.id === plConfirmDelete)?.name}&quot; and remove it from the rotation.
              </p>
              <div className="pl-form-actions" style={{ justifyContent: "center" }}>
                <button className="pl-form-cancel" onClick={() => setPlConfirmDelete(null)}>Cancel</button>
                <button className="pl-form-danger" onClick={() => deletePlaylist(plConfirmDelete)} disabled={plActionLoading}>
                  {plActionLoading ? <i className="fas fa-spinner fa-spin"></i> : null}
                  {plActionLoading ? " Deleting..." : "Delete"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {showSongPicker && (
        <>
          <div className="media-modal-overlay" onClick={() => { setShowSongPicker(false); setAddSongsPlId(null); setAddSongsSearch(""); setAddSongsSelected(new Set()); }}></div>
          <div className="media-modal-sheet">
            <div className="media-modal-handle"></div>
            <div className="media-modal-header">
              <h2>Add Songs to {playlists.find(p => p.id === addSongsPlId)?.name || "Playlist"}</h2>
              <button className="media-modal-close" onClick={() => { setShowSongPicker(false); setAddSongsPlId(null); setAddSongsSearch(""); setAddSongsSelected(new Set()); }}><i className="fas fa-xmark"></i></button>
            </div>
            <div className="pl-picker-toolbar">
              <i className="fas fa-search"></i>
              <input type="text" className="pl-picker-search" placeholder="Search songs..." value={addSongsSearch}
                onChange={(e) => setAddSongsSearch(e.target.value)} />
            </div>
            <div className="media-modal-body">
              {stationFiles.length === 0 ? (
                <div style={{ textAlign: "center", padding: 20, color: "#888" }}>
                  <i className="fas fa-music" style={{ fontSize: 28, marginBottom: 8, opacity: 0.4 }}></i>
                  <div>No media files found. Upload music first.</div>
                </div>
              ) : (
                stationFiles
                  .filter((s) => !addSongsSearch || s.title.toLowerCase().includes(addSongsSearch.toLowerCase()) || s.artist?.toLowerCase().includes(addSongsSearch.toLowerCase()))
                  .map((song) => {
                    const alreadyInPlaylist = addSongsPlId && song.playlists.includes(addSongsPlId);
                    const isChecked = addSongsSelected.has(song.id);
                    return (
                      <div
                        className={`pl-picker-item ${alreadyInPlaylist ? "disabled" : ""} ${isChecked ? "selected" : ""}`}
                        key={song.id}
                        onClick={() => {
                          if (alreadyInPlaylist) return;
                          const next = new Set(addSongsSelected);
                          if (next.has(song.id)) next.delete(song.id);
                          else next.add(song.id);
                          setAddSongsSelected(next);
                        }}
                      >
                        <div className={`pl-picker-checkbox ${isChecked ? "checked" : ""}`}>
                          {isChecked && <i className="fas fa-check"></i>}
                        </div>
                        <img className="pl-picker-cover" src={song.albumArt || "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=40&h=40&fit=crop"} alt={song.title} />
                        <div className="pl-picker-info">
                          <div className="pl-picker-title">{song.title}</div>
                          <div className="pl-picker-artist">{song.artist || "Unknown"} &middot; {song.duration}</div>
                        </div>
                        {alreadyInPlaylist && <span className="pl-picker-already">In playlist</span>}
                      </div>
                    );
                  })
              )}
            </div>
            <div className="pl-picker-footer">
              <span className="pl-picker-count">{addSongsSelected.size} song{addSongsSelected.size !== 1 ? "s" : ""} selected</span>
              <div className="pl-form-actions">
                <button className="pl-form-cancel" onClick={() => { setShowSongPicker(false); setAddSongsPlId(null); setAddSongsSearch(""); setAddSongsSelected(new Set()); }}>Cancel</button>
                <button className="pl-form-save" onClick={addSongsToPlaylist} disabled={addSongsSelected.size === 0 || plActionLoading}>
                  {plActionLoading ? <i className="fas fa-spinner fa-spin"></i> : null}
                  {plActionLoading ? " Adding..." : "Add to Playlist"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
