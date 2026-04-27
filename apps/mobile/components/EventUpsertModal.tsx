import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import type { EventItem, EventTypeRow, EventUpsertPayload, Group, Member } from "@sheepmug/shared-api";
import { FormModalShell } from "./FormModalShell";
import { DateTimePickerField } from "./datetime/DateTimePickerField";
import { api } from "../lib/api";
import { fetchAllMembersPaged } from "../lib/fetchMembersPaged";
import { normalizeLocationTypeInput } from "../lib/eventLocation";
import { normalizeEventTypeSlug } from "../lib/eventTypeDisplay";
import { usePermissions } from "../hooks/usePermissions";
import { colors, radius, type } from "../theme";
import { displayMemberWords } from "../lib/memberDisplayFormat";
import { normalizeImageUri } from "../lib/imageUri";
import { uploadEventFileWithProgress } from "../lib/uploadEventFile";
import { ensurePhotoLibraryPermission } from "../lib/photoLibraryAccess";
import { uploadMemberImageFromUri } from "../lib/uploadMemberImage";
import { eventAttachmentStoragePath, shareEventAttachmentDownload } from "../lib/downloadEventAttachment";

type Props = {
  visible: boolean;
  editingEvent?: EventItem | null;
  onClose: () => void;
  onSaved: () => void;
};

type GroupTreeRow = {
  id: string;
  name: string;
  depth: number;
  hasChildren: boolean;
  nodeKey: string;
  ancestorKeys: string[];
  subtitle: string;
};

const EVENT_FILE_MAX_BYTES = 50 * 1024 * 1024;
const MAX_EVENT_ATTACHMENTS = 30;

type EventAttachmentRow = {
  storage_path?: string;
  url?: string;
  name: string;
  size_bytes?: number;
  content_type?: string | null;
  uploaded_at?: string | null;
};

function parseAttachmentsFromEditing(raw: unknown): EventAttachmentRow[] {
  if (!Array.isArray(raw)) return [];
  const out: EventAttachmentRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const storage_path = typeof o.storage_path === "string" ? o.storage_path.trim() : "";
    const url = typeof o.url === "string" ? o.url.trim() : "";
    const name = typeof o.name === "string" ? o.name.trim() : "";
    if (!name || (!storage_path && !url)) continue;
    const row: EventAttachmentRow = { name };
    if (storage_path) row.storage_path = storage_path;
    if (url) row.url = url;
    if (typeof o.size_bytes === "number" && Number.isFinite(o.size_bytes)) row.size_bytes = o.size_bytes;
    if (typeof o.content_type === "string") row.content_type = o.content_type || null;
    if (typeof o.uploaded_at === "string") row.uploaded_at = o.uploaded_at || null;
    out.push(row);
  }
  return out;
}

function formatFileSize(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function memberPhotoUri(m: Member): string | null {
  const r = m as Record<string, unknown>;
  const raw =
    (typeof r.profile_image === "string" && r.profile_image.trim()) ||
    (typeof r.avatar_url === "string" && r.avatar_url.trim()) ||
    (typeof r.memberimage_url === "string" && r.memberimage_url.trim()) ||
    "";
  return normalizeImageUri(raw || null);
}

const LOCATION_MODE_OPTIONS: { value: "InPerson" | "Online" | "Hybrid"; label: string }[] = [
  { value: "InPerson", label: "In person" },
  { value: "Online", label: "Online" },
  { value: "Hybrid", label: "Hybrid" },
];

function normalizeEventTitle(event: EventItem | null | undefined): string {
  if (!event) return "";
  const raw = String(((event as Record<string, unknown>).title as string) || event.name || "").trim();
  return raw;
}

function toMemberLabel(m: Member): string {
  return displayMemberWords(`${m.first_name || ""} ${m.last_name || ""}`.trim() || "Unnamed member");
}

function buildGroupTreeRows(groups: Group[]): GroupTreeRow[] {
  const byId = new Map<string, Group>();
  for (const g of groups) byId.set(String(g.id), g);
  const childrenByParent = new Map<string, Group[]>();
  const roots: Group[] = [];
  for (const g of groups) {
    const raw = (g as Record<string, unknown>).parent_group_id ?? (g as Record<string, unknown>).parent_id;
    const parentId = typeof raw === "string" && raw ? raw : "";
    if (!parentId || !byId.has(parentId)) roots.push(g);
    else {
      const arr = childrenByParent.get(parentId) || [];
      arr.push(g);
      childrenByParent.set(parentId, arr);
    }
  }
  const sortByName = (a: Group, b: Group) => String(a.name || "").localeCompare(String(b.name || ""));
  roots.sort(sortByName);
  for (const [, arr] of childrenByParent) arr.sort(sortByName);

  const rows: GroupTreeRow[] = [];
  const walk = (node: Group, depth: number, ancestors: string[]) => {
    const id = String(node.id);
    const key = `group:${id}`;
    const kids = childrenByParent.get(id) || [];
    rows.push({
      id,
      name: String(node.name || "Group"),
      depth,
      hasChildren: kids.length > 0,
      nodeKey: key,
      ancestorKeys: ancestors,
      subtitle: depth > 0 ? "Subgroup" : "Main group",
    });
    for (const child of kids) walk(child, depth + 1, [...ancestors, key]);
  };
  for (const r of roots) walk(r, 0, []);
  return rows;
}

export function EventUpsertModal({ visible, editingEvent = null, onClose, onSaved }: Props) {
  const { can, isOrgOwner } = usePermissions();
  const canAssignEventMembers = isOrgOwner || can("assign_event_members");
  const isEdit = Boolean(editingEvent?.id);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [selectedEventTypeSlug, setSelectedEventTypeSlug] = useState("");
  const [locationType, setLocationType] = useState("");
  const [locationDetails, setLocationDetails] = useState("");
  const [onlineMeetingUrl, setOnlineMeetingUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [branchMembers, setBranchMembers] = useState<Member[]>([]);
  const [groupMemberCoverage, setGroupMemberCoverage] = useState<Set<string>>(new Set());
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  const [assignedMemberIds, setAssignedMemberIds] = useState<Set<string>>(new Set());
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [groupSearch, setGroupSearch] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [eventTypeRows, setEventTypeRows] = useState<EventTypeRow[]>([]);
  const [eventAttachments, setEventAttachments] = useState<EventAttachmentRow[]>([]);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [attachmentUploadProgress, setAttachmentUploadProgress] = useState(0);
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [coverUploading, setCoverUploading] = useState(false);
  const [attachmentDownloadIdx, setAttachmentDownloadIdx] = useState<number | null>(null);

  const eventScheduleMinDate = useMemo(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [groupRows, membersList, typeRows] = await Promise.all([
          api.groups.list({ tree: true, limit: 100 }).catch(() => [] as Group[]),
          fetchAllMembersPaged(api).catch(() => [] as Member[]),
          api.eventTypes.list().catch(() => [] as EventTypeRow[]),
        ]);
        if (cancelled) return;
        setGroups(groupRows);
        setBranchMembers(membersList);
        const sorted = [...typeRows].sort((a, b) =>
          String(a.name || "").localeCompare(String(b.name || ""))
        );
        setEventTypeRows(sorted);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    if (!editingEvent) {
      setTitle("");
      setStartTime("");
      setEndTime("");
      setSelectedEventTypeSlug("");
      setLocationType("");
      setLocationDetails("");
      setOnlineMeetingUrl("");
      setNotes("");
      setSelectedGroupIds(new Set());
      setAssignedMemberIds(new Set());
      setEventAttachments([]);
      setAttachmentUploadProgress(0);
      setCoverImageUrl("");
      setCoverUploading(false);
      return;
    }
    const row = editingEvent as Record<string, unknown>;
    setTitle(normalizeEventTitle(editingEvent));
    setStartTime(String((row.start_time as string) || editingEvent.start_date || "").trim());
    setEndTime(String((row.end_time as string) || editingEvent.end_date || "").trim());
    const rawLt = String((row.location_type as string) || "").trim();
    setLocationType(normalizeLocationTypeInput(rawLt) || "");
    setLocationDetails(String((row.location_details as string) || editingEvent.location || "").trim());
    setOnlineMeetingUrl(String((row.online_meeting_url as string) || "").trim());
    setNotes(String((row.notes as string) || "").trim());
    const groupIds =
      Array.isArray(row.group_ids) && row.group_ids.length > 0
        ? (row.group_ids as string[])
        : typeof row.group_id === "string" && row.group_id
          ? [row.group_id]
          : [];
    setSelectedGroupIds(new Set(groupIds));
    setAssignedMemberIds(new Set(Array.isArray(row.assigned_member_ids) ? (row.assigned_member_ids as string[]) : []));
    setEventAttachments(parseAttachmentsFromEditing(row.attachments));
    setAttachmentUploadProgress(0);
    setCoverImageUrl(String((row.cover_image_url as string) || "").trim());
    setCoverUploading(false);
  }, [visible, editingEvent]);

  useEffect(() => {
    if (!visible) return;
    if (!canAssignEventMembers) {
      setAssignedMemberIds(new Set());
    }
  }, [visible, canAssignEventMembers]);

  useEffect(() => {
    if (!visible || !editingEvent) return;
    if (loading) return;
    const raw = String((editingEvent as Record<string, unknown>).event_type || "").trim();
    const slug = raw ? normalizeEventTypeSlug(raw) : "";
    if (!slug) {
      setSelectedEventTypeSlug("");
      return;
    }
    const hit = eventTypeRows.find((r) => normalizeEventTypeSlug(r.slug) === slug);
    setSelectedEventTypeSlug(hit ? slug : "");
  }, [visible, editingEvent, eventTypeRows, loading]);

  const storedEditingTypeSlug = useMemo(() => {
    if (!editingEvent) return null;
    const raw = String((editingEvent as Record<string, unknown>).event_type || "").trim();
    return raw ? normalizeEventTypeSlug(raw) : null;
  }, [editingEvent]);

  const hasOrphanEventType = Boolean(
    isEdit &&
      storedEditingTypeSlug &&
      eventTypeRows.length > 0 &&
      !eventTypeRows.some((r) => normalizeEventTypeSlug(r.slug) === storedEditingTypeSlug)
  );

  const groupTreeRows = useMemo(() => buildGroupTreeRows(groups), [groups]);

  const descendantsByGroupId = useMemo(() => {
    const childrenByParent = new Map<string, string[]>();
    for (const g of groups) {
      const id = String(g.id);
      const raw = (g as Record<string, unknown>).parent_group_id ?? (g as Record<string, unknown>).parent_id;
      const parent = typeof raw === "string" ? raw : "";
      if (!parent) continue;
      const arr = childrenByParent.get(parent) || [];
      arr.push(id);
      childrenByParent.set(parent, arr);
    }
    const out = new Map<string, string[]>();
    function walk(id: string): string[] {
      if (out.has(id)) return out.get(id)!;
      const kids = childrenByParent.get(id) || [];
      const all: string[] = [];
      for (const kid of kids) {
        all.push(kid, ...walk(kid));
      }
      out.set(id, all);
      return all;
    }
    for (const g of groups) walk(String(g.id));
    return out;
  }, [groups]);

  const visibleGroupRows = useMemo(() => {
    const q = groupSearch.trim().toLowerCase();
    if (!q) {
      return groupTreeRows.filter((row) => row.depth === 0 || row.ancestorKeys.every((x) => expandedNodes.has(x)));
    }
    const include = new Set<string>();
    for (const row of groupTreeRows) {
      if (row.name.toLowerCase().includes(q) || row.subtitle.toLowerCase().includes(q)) {
        include.add(row.nodeKey);
        for (const k of row.ancestorKeys) include.add(k);
      }
    }
    return groupTreeRows.filter((row) => include.has(row.nodeKey));
  }, [expandedNodes, groupSearch, groupTreeRows]);

  useEffect(() => {
    if (!visible || selectedGroupIds.size === 0) {
      setGroupMemberCoverage(new Set());
      return;
    }
    let cancelled = false;
    (async () => {
      const ids = [...selectedGroupIds];
      const coverage = new Set<string>();
      const rows = await Promise.all(ids.map((gid) => api.groups.members(gid).catch(() => [])));
      if (cancelled) return;
      for (const list of rows) {
        for (const r of list as Array<Record<string, unknown>>) {
          const mid = typeof r.member_id === "string" ? r.member_id : typeof r.id === "string" ? r.id : "";
          if (mid) coverage.add(mid);
        }
      }
      setGroupMemberCoverage(coverage);
      setAssignedMemberIds((prev) => new Set([...prev].filter((id) => !coverage.has(id))));
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedGroupIds, visible]);

  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    return branchMembers.filter((m) => {
      if (!q) return true;
      return toMemberLabel(m).toLowerCase().includes(q);
    });
  }, [branchMembers, memberSearch]);

  const assignedMembersStrip = useMemo(() => {
    const out: Member[] = [];
    for (const id of assignedMemberIds) {
      const m = branchMembers.find((x) => x.id === id);
      if (m) out.push(m);
    }
    return out;
  }, [assignedMemberIds, branchMembers]);

  function toggleGroup(row: GroupTreeRow) {
    const id = row.id;
    const descendants = descendantsByGroupId.get(id) || [];
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      const selected = next.has(id);
      if (selected) {
        next.delete(id);
        for (const d of descendants) next.delete(d);
      } else {
        next.add(id);
        for (const d of descendants) next.add(d);
      }
      return next;
    });
  }

  async function handlePickCoverImage() {
    if (coverUploading) return;
    if (!(await ensurePhotoLibraryPermission())) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: false,
      quality: 0.9,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    setCoverUploading(true);
    try {
      const url = await uploadMemberImageFromUri(result.assets[0].uri);
      setCoverImageUrl(url);
    } catch (e: unknown) {
      Alert.alert("Cover image", e instanceof Error ? e.message : "Upload failed");
    } finally {
      setCoverUploading(false);
    }
  }

  const pickAndUploadAttachments = useCallback(async () => {
    if (attachmentUploading) return;
    if (eventAttachments.length >= MAX_EVENT_ATTACHMENTS) {
      Alert.alert("Attachments", `You can attach at most ${MAX_EVENT_ATTACHMENTS} files per event.`);
      return;
    }
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (result.canceled) return;
      const assets = result.assets ?? [];
      if (assets.length === 0) return;

      const slotsLeft = MAX_EVENT_ATTACHMENTS - eventAttachments.length;
      const toUpload = assets.slice(0, slotsLeft);
      if (assets.length > slotsLeft) {
        Alert.alert("Attachments", `Only ${slotsLeft} more file${slotsLeft === 1 ? "" : "s"} can be attached.`);
      }

      setAttachmentUploading(true);
      setAttachmentUploadProgress(0);
      const total = toUpload.length;
      let done = 0;
      for (const a of toUpload) {
        const uri = a.uri;
        const name = (a.name && String(a.name).trim()) || "file";
        const size = typeof a.size === "number" && Number.isFinite(a.size) ? a.size : null;
        if (size != null && size > EVENT_FILE_MAX_BYTES) {
          Alert.alert("File too large", `${name} must be 50 MB or smaller.`);
          done += 1;
          continue;
        }
        const mimeType = typeof a.mimeType === "string" ? a.mimeType : null;
        const data = await uploadEventFileWithProgress(
          { uri, name, mimeType },
          (pct) => {
            setAttachmentUploadProgress(Math.round(((done + pct / 100) / total) * 100));
          },
        ).catch((err: unknown) => {
          Alert.alert("Upload failed", err instanceof Error ? err.message : String(err));
          return null;
        });
        done += 1;
        setAttachmentUploadProgress(Math.round((done / total) * 100));
        if (!data) continue;
        const storage_path = String((data as { storage_path?: string }).storage_path || "").trim();
        const size_bytes = (data as { size_bytes?: number }).size_bytes;
        const content_type = (data as { content_type?: string | null }).content_type ?? null;
        const uploaded_at = (data as { uploaded_at?: string | null }).uploaded_at ?? null;
        if (!storage_path) continue;
        setEventAttachments((prev) => [
          ...prev,
          {
            storage_path,
            name: String((data as { name?: string }).name || name),
            size_bytes: typeof size_bytes === "number" ? size_bytes : undefined,
            content_type,
            uploaded_at,
          },
        ]);
      }
    } finally {
      setAttachmentUploading(false);
      setAttachmentUploadProgress(0);
    }
  }, [attachmentUploading, eventAttachments.length]);

  function toggleAssignedMember(id: string) {
    if (groupMemberCoverage.has(id)) return;
    setAssignedMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit() {
    if (!title.trim()) {
      Alert.alert("Required", "Enter an event title.");
      return;
    }
    if (!startTime.trim()) {
      Alert.alert("Required", "Choose a start date/time.");
      return;
    }
    if (canAssignEventMembers) {
      if (selectedGroupIds.size === 0 && assignedMemberIds.size === 0) {
        Alert.alert("Required", "Choose at least one group or assign at least one specific member.");
        return;
      }
    } else if (selectedGroupIds.size === 0) {
      Alert.alert("Required", "Choose at least one group.");
      return;
    }
    if (eventTypeRows.length === 0) {
      Alert.alert(
        "Event types",
        "Add at least one event type in organization settings (web) before saving events."
      );
      return;
    }
    const sel = normalizeEventTypeSlug(selectedEventTypeSlug);
    const typeRow = eventTypeRows.find((r) => normalizeEventTypeSlug(r.slug) === sel);
    if (!typeRow?.slug) {
      Alert.alert("Required", "Choose an event type from the list.");
      return;
    }
    if (!locationType.trim()) {
      Alert.alert("Required", "Choose how the event is held (in person, online, or hybrid).");
      return;
    }
    const mode = normalizeLocationTypeInput(locationType);
    if (!mode) {
      Alert.alert("Required", "Choose how the event is held (in person, online, or hybrid).");
      return;
    }
    if (mode === "InPerson" && !locationDetails.trim()) {
      Alert.alert("Required", "Enter a location or address.");
      return;
    }
    if (mode === "Online" && !onlineMeetingUrl.trim()) {
      Alert.alert("Required", "Paste the meeting or livestream link.");
      return;
    }
    if (mode === "Hybrid" && (!locationDetails.trim() || !onlineMeetingUrl.trim())) {
      Alert.alert("Required", "Enter both the physical location and the online link.");
      return;
    }
    let locDetails: string | null = null;
    let meetUrl: string | null = null;
    if (mode === "InPerson") {
      locDetails = locationDetails.trim() || null;
    } else if (mode === "Online") {
      meetUrl = onlineMeetingUrl.trim() || null;
    } else if (mode === "Hybrid") {
      locDetails = locationDetails.trim() || null;
      meetUrl = onlineMeetingUrl.trim() || null;
    }
    const payload: EventUpsertPayload = {
      title: title.trim(),
      start_time: new Date(startTime).toISOString(),
      end_time: endTime.trim() ? new Date(endTime).toISOString() : null,
      event_type: String(typeRow.slug).trim(),
      location_type: mode,
      location_details: locDetails,
      online_meeting_url: meetUrl,
      notes: notes.trim() || null,
      cover_image_url: coverImageUrl.trim() || null,
      group_scope: "group",
      group_id: [...selectedGroupIds][0] || null,
      group_ids: [...selectedGroupIds],
      assigned_member_ids: canAssignEventMembers ? [...assignedMemberIds] : [],
      attachments: eventAttachments.map((a) => {
        const row: Record<string, unknown> = { name: a.name };
        if (a.storage_path) row.storage_path = a.storage_path;
        if (a.url) row.url = a.url;
        if (typeof a.size_bytes === "number") row.size_bytes = a.size_bytes;
        if (a.content_type != null) row.content_type = a.content_type;
        if (a.uploaded_at != null) row.uploaded_at = a.uploaded_at;
        return row;
      }),
    };

    setSubmitting(true);
    try {
      if (isEdit && editingEvent?.id) {
        await api.events.update(editingEvent.id, payload);
      } else {
        await api.events.create(payload);
      }
      onSaved();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not save event.";
      Alert.alert("Event", msg);
    } finally {
      setSubmitting(false);
    }
  }

  const footer = (
    <View style={styles.footer}>
      <Pressable onPress={onClose} style={[styles.footerBtn, styles.footerBtnSecondary]}>
        <Text style={styles.footerBtnSecondaryText}>Cancel</Text>
      </Pressable>
      <Pressable
        style={[styles.footerBtn, styles.footerBtnPrimary, submitting && { opacity: 0.7 }]}
        onPress={() => void handleSubmit()}
        disabled={submitting}
      >
        <Text style={styles.footerBtnPrimaryText}>{isEdit ? "Save event" : "Create event"}</Text>
      </Pressable>
    </View>
  );

  return (
    <FormModalShell
      visible={visible}
      onClose={onClose}
      title={isEdit ? "Edit Event" : "Create Event"}
      subtitle="Basics and assignment"
      headerIcon="calendar-outline"
      variant="full"
      footer={footer}
    >
      {loading ? (
        <View style={{ paddingVertical: 30 }}>
          <Text style={styles.helper}>Loading form data...</Text>
        </View>
      ) : (
        <View style={styles.content}>
          <Text style={styles.sectionLabel}>Basics</Text>
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>Event title</Text>
            <TextInput value={title} onChangeText={setTitle} style={styles.input} />
          </View>
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>Cover image (optional)</Text>
            <Text style={styles.helper}>Shown on event cards.</Text>
            <View style={styles.coverRow}>
              <View style={styles.coverThumbWrap}>
                {coverUploading ? (
                  <ActivityIndicator color={colors.accent} />
                ) : coverImageUrl.trim() ? (
                  <Image
                    source={{ uri: normalizeImageUri(coverImageUrl.trim()) || coverImageUrl.trim() }}
                    style={styles.coverThumb}
                    resizeMode="cover"
                  />
                ) : (
                  <Ionicons name="image-outline" size={32} color={colors.textSecondary} />
                )}
              </View>
              <View style={styles.coverActions}>
                <Pressable
                  style={[styles.coverActionBtn, coverUploading && { opacity: 0.6 }]}
                  onPress={() => void handlePickCoverImage()}
                  disabled={coverUploading}
                >
                  <Text style={styles.coverActionBtnText}>{coverImageUrl.trim() ? "Replace image" : "Upload image"}</Text>
                </Pressable>
                {coverImageUrl.trim() && !coverUploading ? (
                  <Pressable style={styles.coverRemoveBtn} onPress={() => setCoverImageUrl("")}>
                    <Text style={styles.coverRemoveBtnText}>Remove</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          </View>
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>Event type</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
              {eventTypeRows.map((row) => {
                const slug = String(row.slug || "").trim();
                const key = slug || String(row.id);
                const active = normalizeEventTypeSlug(selectedEventTypeSlug) === normalizeEventTypeSlug(slug);
                const isDefault = Boolean((row as { is_default?: boolean }).is_default);
                const label = displayMemberWords(String(row.name || slug || "Type"));
                return (
                  <Pressable
                    key={key}
                    style={[styles.pill, active && styles.pillActive]}
                    onPress={() => setSelectedEventTypeSlug(normalizeEventTypeSlug(slug))}
                  >
                    <Text style={[styles.pillText, active && styles.pillTextActive]}>
                      {label}
                      {isDefault ? " · default" : ""}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {eventTypeRows.length === 0 ? (
              <Text style={styles.helper}>No event types found. Add event types in settings on the web.</Text>
            ) : null}
            {hasOrphanEventType ? (
              <Text style={styles.helper}>
                This event’s type is no longer in settings. Choose a current type to save.
              </Text>
            ) : null}
          </View>

          <Text style={styles.sectionLabel}>When and where</Text>
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>Start date and time</Text>
            <DateTimePickerField
              value={startTime}
              onChange={setStartTime}
              minimumDate={isEdit ? undefined : eventScheduleMinDate}
            />
          </View>
          <View style={styles.fieldBlock}>
            <View style={styles.endTimeHeader}>
              <Text style={[styles.fieldLabel, styles.fieldLabelRow]}>End date and time</Text>
              {endTime.trim() ? (
                <Pressable onPress={() => setEndTime("")} hitSlop={8}>
                  <Text style={styles.clearEndLink}>Clear</Text>
                </Pressable>
              ) : null}
            </View>
            <DateTimePickerField
              value={endTime}
              onChange={setEndTime}
              minimumDate={isEdit ? undefined : eventScheduleMinDate}
            />
          </View>
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>Location</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
              {LOCATION_MODE_OPTIONS.map((opt) => {
                const active = locationType === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    style={[styles.pill, active && styles.pillActive]}
                    onPress={() => {
                      setLocationType(opt.value);
                      if (opt.value === "Online") setLocationDetails("");
                      if (opt.value === "InPerson") setOnlineMeetingUrl("");
                    }}
                  >
                    <Text style={[styles.pillText, active && styles.pillTextActive]}>{opt.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
          {(locationType === "InPerson" || locationType === "Hybrid") ? (
            <View style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>{locationType === "Hybrid" ? "Physical location" : "Location"}</Text>
              <TextInput value={locationDetails} onChangeText={setLocationDetails} style={styles.input} />
            </View>
          ) : null}
          {(locationType === "Online" || locationType === "Hybrid") ? (
            <View style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>Online meeting link</Text>
              <TextInput
                value={onlineMeetingUrl}
                onChangeText={setOnlineMeetingUrl}
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
            </View>
          ) : null}
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>About Event</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              style={[styles.input, styles.inputMultiline]}
              multiline
              textAlignVertical="top"
              placeholder="Short description for attendees…"
            />
          </View>

          <Text style={styles.sectionLabel}>Files</Text>
          <Text style={styles.helper}>Attach PDFs and documents (up to 50 MB each, {MAX_EVENT_ATTACHMENTS} total).</Text>
          <Pressable
            style={[styles.attachBtn, attachmentUploading && { opacity: 0.7 }]}
            onPress={() => void pickAndUploadAttachments()}
            disabled={attachmentUploading || eventAttachments.length >= MAX_EVENT_ATTACHMENTS}
          >
            {attachmentUploading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.attachBtnText}>Upload files</Text>
            )}
          </Pressable>
          {attachmentUploading ? (
            <View style={{ marginTop: 8 }}>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${attachmentUploadProgress}%` }]} />
              </View>
              <Text style={styles.helper}>Uploading… {attachmentUploadProgress}%</Text>
            </View>
          ) : null}
          <Text style={[styles.helper, { marginTop: 6 }]}>
            {eventAttachments.length} / {MAX_EVENT_ATTACHMENTS} files
          </Text>
          {eventAttachments.length > 0 ? (
            <View style={{ marginTop: 8, gap: 6 }}>
              {eventAttachments.map((a, idx) => (
                <View key={`${a.storage_path ?? a.url ?? idx}-${idx}`} style={styles.attachmentRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.attachmentName} numberOfLines={1}>
                      {a.name}
                    </Text>
                    <Text style={styles.attachmentMeta}>
                      {typeof a.size_bytes === "number" ? formatFileSize(a.size_bytes) : "—"}
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Pressable
                      hitSlop={8}
                      disabled={attachmentDownloadIdx === idx}
                      onPress={() => {
                        void (async () => {
                          setAttachmentDownloadIdx(idx);
                          try {
                            const path = eventAttachmentStoragePath({
                              storage_path: a.storage_path ?? null,
                              url: a.url ?? null,
                            });
                            if (path) {
                              await shareEventAttachmentDownload({
                                storagePath: path,
                                filename: a.name,
                                contentType: a.content_type ?? null,
                              });
                            } else if (a.url?.trim()) {
                              const u = a.url.trim();
                              const withScheme = /^https?:\/\//i.test(u) ? u : `https://${u}`;
                              await Linking.openURL(withScheme);
                            } else {
                              Alert.alert("Files", "This file cannot be downloaded.");
                            }
                          } catch (e: unknown) {
                            Alert.alert("Download", e instanceof Error ? e.message : "Failed");
                          } finally {
                            setAttachmentDownloadIdx(null);
                          }
                        })();
                      }}
                      style={styles.attachDownload}
                    >
                      {attachmentDownloadIdx === idx ? (
                        <ActivityIndicator size="small" color={colors.accent} />
                      ) : (
                        <Ionicons name="download-outline" size={20} color={colors.accent} />
                      )}
                    </Pressable>
                    <Pressable
                      hitSlop={8}
                      onPress={() => setEventAttachments((prev) => prev.filter((_, j) => j !== idx))}
                      style={styles.attachRemove}
                    >
                      <Text style={styles.attachRemoveText}>×</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          <Text style={styles.sectionLabel}>Assignment</Text>
          <Text style={styles.helper}>
            {canAssignEventMembers
              ? "Select ministries (tree). Members already in a selected ministry appear checked and dimmed. To roster everyone in the branch, an owner can assign you the \"All Members\" system ministry in Settings."
              : "Select groups. Only organization owners and staff with \"Assign event members\" can assign specific members."}
          </Text>
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>Groups</Text>
            <TextInput value={groupSearch} onChangeText={setGroupSearch} style={styles.input} />
            <ScrollView style={styles.groupList} nestedScrollEnabled>
              {visibleGroupRows.map((row) => {
                const selected = selectedGroupIds.has(row.id);
                const expanded = expandedNodes.has(row.nodeKey);
                return (
                  <View key={row.nodeKey} style={styles.groupRowWrap}>
                    <Pressable style={styles.groupRow} onPress={() => toggleGroup(row)}>
                      <View style={styles.groupRowLeft}>
                        <View style={{ width: row.depth * 18 }} />
                        <Ionicons name={selected ? "checkbox" : "square-outline"} size={18} color={selected ? colors.accent : colors.textSecondary} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.groupName}>{displayMemberWords(row.name)}</Text>
                          <Text style={styles.groupSub}>{row.subtitle}</Text>
                        </View>
                      </View>
                    </Pressable>
                    {row.hasChildren ? (
                      <Pressable
                        style={styles.groupExpandBtn}
                        onPress={() =>
                          setExpandedNodes((prev) => {
                            const next = new Set(prev);
                            if (next.has(row.nodeKey)) next.delete(row.nodeKey);
                            else next.add(row.nodeKey);
                            return next;
                          })
                        }
                      >
                        <Ionicons name={expanded ? "chevron-down" : "chevron-forward"} size={16} color={colors.textSecondary} />
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
            </ScrollView>
          </View>

          {canAssignEventMembers ? (
            <View style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>Specific members</Text>
              {assignedMembersStrip.length > 0 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.memberStripRow}
                >
                  {assignedMembersStrip.map((m) => {
                    const uri = memberPhotoUri(m);
                    const label = toMemberLabel(m);
                    return (
                      <View key={m.id} style={styles.memberStripItem}>
                        <View style={styles.memberStripAvatarWrap}>
                          {uri ? (
                            <Image source={{ uri }} style={styles.memberStripAvatar} />
                          ) : (
                            <View style={[styles.memberStripAvatar, styles.memberStripAvatarPlaceholder]}>
                              <Ionicons name="person" size={18} color={colors.textSecondary} />
                            </View>
                          )}
                          <Pressable
                            style={styles.memberStripRemove}
                            hitSlop={6}
                            onPress={() => toggleAssignedMember(m.id)}
                          >
                            <Text style={styles.memberStripRemoveText}>×</Text>
                          </Pressable>
                        </View>
                        <Text style={styles.memberStripName} numberOfLines={2}>
                          {label}
                        </Text>
                      </View>
                    );
                  })}
                </ScrollView>
              ) : null}
              <TextInput value={memberSearch} onChangeText={setMemberSearch} style={styles.input} />
              <ScrollView style={styles.memberList} nestedScrollEnabled>
                {filteredMembers.map((m) => {
                  const covered = groupMemberCoverage.has(m.id);
                  const selected = assignedMemberIds.has(m.id);
                  const checked = covered || selected;
                  const uri = memberPhotoUri(m);
                  return (
                    <Pressable
                      key={m.id}
                      style={[styles.memberRow, covered && styles.memberRowCovered]}
                      onPress={() => toggleAssignedMember(m.id)}
                      disabled={covered}
                    >
                      <Ionicons
                        name={checked ? "checkbox" : "square-outline"}
                        size={18}
                        color={checked ? colors.accent : colors.textSecondary}
                      />
                      {uri ? (
                        <Image source={{ uri }} style={styles.memberRowAvatar} />
                      ) : (
                        <View style={[styles.memberRowAvatar, styles.memberStripAvatarPlaceholder]}>
                          <Ionicons name="person" size={16} color={colors.textSecondary} />
                        </View>
                      )}
                      <Text style={[styles.memberName, covered && styles.memberNameCovered]}>{toMemberLabel(m)}</Text>
                      {covered ? (
                        <Text style={styles.memberCoveredTag} numberOfLines={1}>
                          In ministry
                        </Text>
                      ) : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
              <Text style={styles.helper}>Assigned specific members: {assignedMemberIds.size}</Text>
            </View>
          ) : null}
        </View>
      )}
    </FormModalShell>
  );
}

const styles = StyleSheet.create({
  content: { gap: 6, paddingBottom: 10 },
  sectionLabel: {
    fontSize: type.overline.size,
    fontWeight: "700",
    color: colors.accent,
    marginTop: 14,
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  fieldBlock: { marginBottom: 10 },
  fieldLabel: {
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    fontWeight: type.caption.weight,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  input: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: "#f8fafc",
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.textPrimary,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
  },
  inputMultiline: { minHeight: 82 },
  fieldLabelRow: { marginBottom: 0, flex: 1 },
  endTimeHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 4,
  },
  clearEndLink: {
    fontSize: type.caption.size,
    fontWeight: "600",
    color: colors.accent,
  },
  pillRow: { flexDirection: "row", gap: 8, paddingVertical: 4 },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: "#f8fafc",
  },
  pillActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  pillText: {
    fontSize: type.caption.size,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  pillTextActive: { color: "#fff" },
  helper: { fontSize: type.caption.size, color: colors.textSecondary },
  coverRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: "#f8fafc",
  },
  coverThumbWrap: {
    width: 72,
    height: 72,
    borderRadius: radius.sm,
    overflow: "hidden",
    backgroundColor: "#e5e7eb",
    alignItems: "center",
    justifyContent: "center",
  },
  coverThumb: { width: "100%", height: "100%" },
  coverActions: { flex: 1, minWidth: 0, gap: 8 },
  coverActionBtn: {
    alignSelf: "flex-start",
    backgroundColor: colors.accent,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: radius.sm,
  },
  coverActionBtnText: { color: "#fff", fontSize: type.body.size, fontWeight: "600" },
  coverRemoveBtn: {
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  coverRemoveBtnText: { fontSize: type.caption.size, fontWeight: "600", color: colors.textPrimary },
  attachBtn: {
    alignSelf: "flex-start",
    marginTop: 6,
    backgroundColor: colors.accent,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: radius.sm,
    minWidth: 140,
    alignItems: "center",
    justifyContent: "center",
  },
  attachBtnText: { color: "#fff", fontSize: type.body.size, fontWeight: "600" },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: "#e5e7eb",
    overflow: "hidden",
  },
  progressFill: { height: 6, backgroundColor: colors.accent },
  attachmentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: "#f8fafc",
  },
  attachmentName: { fontSize: type.body.size, color: colors.textPrimary, fontWeight: "600" },
  attachmentMeta: { fontSize: 11, color: colors.textSecondary },
  attachDownload: { paddingHorizontal: 6, paddingVertical: 2 },
  attachRemove: { paddingHorizontal: 6, paddingVertical: 2 },
  attachRemoveText: { fontSize: 20, fontWeight: "700", color: colors.textSecondary, lineHeight: 22 },
  memberStripRow: { gap: 12, paddingVertical: 6, paddingRight: 8 },
  memberStripItem: { width: 76, alignItems: "center" },
  memberStripAvatarWrap: { position: "relative", marginBottom: 4 },
  memberStripAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#e5e7eb",
  },
  memberStripAvatarPlaceholder: { alignItems: "center", justifyContent: "center" },
  memberStripRemove: {
    position: "absolute",
    right: -4,
    top: -4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#1f2937",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  memberStripRemoveText: { color: "#fff", fontSize: 12, fontWeight: "800", lineHeight: 14, marginTop: -1 },
  memberStripName: {
    fontSize: 10,
    fontWeight: "600",
    color: colors.textPrimary,
    textAlign: "center",
    width: "100%",
  },
  memberRowAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#e5e7eb",
  },
  groupList: { maxHeight: 220 },
  groupRowWrap: {
    flexDirection: "row",
    alignItems: "stretch",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: "#f8fafc",
    marginBottom: 6,
  },
  groupRow: {
    flex: 1,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  groupRowLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  groupName: { fontSize: type.body.size, color: colors.textPrimary, fontWeight: type.bodyStrong.weight },
  groupSub: { fontSize: type.caption.size, color: colors.textSecondary },
  groupExpandBtn: {
    width: 34,
    alignItems: "center",
    justifyContent: "center",
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
  },
  memberList: { maxHeight: 220 },
  memberRow: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: "#f8fafc",
    marginBottom: 6,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  memberName: { flex: 1, minWidth: 0, fontSize: type.body.size, color: colors.textPrimary, fontWeight: type.bodyStrong.weight },
  memberNameCovered: { opacity: 0.75 },
  memberRowCovered: { opacity: 0.72 },
  memberCoveredTag: {
    flexShrink: 0,
    fontSize: 11,
    fontWeight: "600",
    color: colors.textSecondary,
    maxWidth: "38%",
  },
  footer: { flexDirection: "row", justifyContent: "flex-end", gap: 12 },
  footerBtn: { paddingVertical: 12, paddingHorizontal: 20, borderRadius: radius.sm, minWidth: 120, alignItems: "center" },
  footerBtnSecondary: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.card },
  footerBtnSecondaryText: { fontSize: type.body.size, fontWeight: "600", color: colors.textPrimary },
  footerBtnPrimary: { backgroundColor: colors.accent },
  footerBtnPrimaryText: { fontSize: type.body.size, fontWeight: "600", color: "#fff" },
});
