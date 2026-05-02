import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Member, TaskItem } from "@sheepmug/shared-api";
import { ApiError } from "@sheepmug/shared-api";
import { FormModalShell } from "./FormModalShell";
import { YmdDateField } from "./YmdDateField";
import { api } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { useBranch } from "../contexts/BranchContext";
import { displayMemberWords } from "../lib/memberDisplayFormat";
import { colors, radius, type } from "../theme";

type StaffRow = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  branch_id: string | null;
};

function staffDisplayName(s: StaffRow): string {
  const n = [s.first_name, s.last_name].filter(Boolean).join(" ").trim();
  if (n) return n;
  if (s.email?.trim()) return s.email.trim();
  return s.id.slice(0, 8);
}

function memberLabel(m: Member): string {
  const fn = displayMemberWords(String(m.first_name || "").trim());
  const ln = displayMemberWords(String(m.last_name || "").trim());
  const name = [fn, ln].filter(Boolean).join(" ").trim();
  if (name) return name;
  const em = (m.email || "").trim();
  if (em) return em.toLowerCase();
  return m.id.slice(0, 8);
}

function memberSearchBlob(m: Member): string {
  return [m.first_name, m.last_name, m.email, m.phone].map((x) => String(x || "").toLowerCase()).join(" ");
}

/** Due date as ISO string at local noon for stable API parsing. */
function ymdToDueAtIso(ymd: string): string | null {
  const t = ymd.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Receives created task when the API returns one (optional). */
  onSuccess: (createdTask?: TaskItem) => void;
  /** When set (e.g. member profile), task is always for this member; UI shows linked members + assignees only. */
  lockedPrimaryMemberId?: string;
  lockedPrimaryMemberLabel?: string;
};

export function MemberCreateTaskModal({
  visible,
  onClose,
  onSuccess,
  lockedPrimaryMemberId,
  lockedPrimaryMemberLabel,
}: Props) {
  const { user } = useAuth();
  const { selectedBranch } = useBranch();
  const [loading, setLoading] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [staffOptions, setStaffOptions] = useState<StaffRow[]>([]);

  /** Order preserved: first id is POST path; rest are related_member_ids. */
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [assigneeIds, setAssigneeIds] = useState<Set<string>>(() => new Set());

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueYmd, setDueYmd] = useState("");
  const [urgency, setUrgency] = useState<"low" | "urgent" | "high">("low");
  const [checklistLines, setChecklistLines] = useState<string[]>([""]);
  const [submitting, setSubmitting] = useState(false);

  const reset = useCallback(() => {
    setMembers([]);
    setStaffOptions([]);
    setSelectedMemberIds(lockedPrimaryMemberId ? [lockedPrimaryMemberId] : []);
    setMemberSearch("");
    setAssigneeIds(new Set());
    setTitle("");
    setDescription("");
    setDueYmd("");
    setUrgency("low");
    setChecklistLines([""]);
    setSubmitting(false);
  }, [lockedPrimaryMemberId]);

  useEffect(() => {
    if (!visible) return;
    reset();
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const [staffRows, memberPayload] = await Promise.all([
          api.org.staff().catch(() => [] as StaffRow[]),
          api.members.list({ limit: 100 }).catch(() => ({ members: [] as Member[], total_count: 0 })),
        ]);
        if (cancelled) return;
        const bid = selectedBranch?.id?.trim() || null;
        const staffFiltered = bid
          ? staffRows.filter((r) => !r.branch_id || String(r.branch_id) === bid)
          : staffRows;
        setStaffOptions(staffFiltered);
        const bm = memberPayload.members.filter((m) => {
          const mb = (m as { branch_id?: string | null }).branch_id;
          if (!bid) return true;
          return mb != null && String(mb) === bid;
        });
        setMembers(bm);
        if (!cancelled && user?.id) {
          setAssigneeIds(new Set([user.id]));
        }
      } catch {
        if (!cancelled) {
          setStaffOptions([]);
          setMembers([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, selectedBranch?.id, reset, user?.id]);

  const closeAndReset = () => {
    reset();
    onClose();
  };

  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => memberSearchBlob(m).includes(q));
  }, [members, memberSearch]);

  const toggleMember = (id: string) => {
    if (lockedPrimaryMemberId) {
      if (id === lockedPrimaryMemberId) return;
      setSelectedMemberIds((prev) => {
        const p = lockedPrimaryMemberId;
        const linked = prev.filter((x) => x !== p);
        if (linked.includes(id)) {
          return [p, ...linked.filter((x) => x !== id)];
        }
        return [p, ...linked, id];
      });
      return;
    }
    setSelectedMemberIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleAssignee = (id: string) => {
    setAssigneeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    const t = title.trim();
    if (!t) {
      Alert.alert("Task title required", "Enter a task title.");
      return;
    }
    const ids = selectedMemberIds.filter(Boolean);
    const primaryId = lockedPrimaryMemberId ?? ids[0];
    if (!primaryId) {
      Alert.alert("Members required", "Select at least one member.");
      return;
    }
    if (assigneeIds.size === 0) {
      Alert.alert("Assignees required", "Choose at least one leader.");
      return;
    }
    const related =
      lockedPrimaryMemberId
        ? ids.filter((x) => x !== lockedPrimaryMemberId)
        : ids.length > 1
          ? ids.slice(1)
          : undefined;
    const checklist = checklistLines
      .map((s) => s.trim())
      .filter(Boolean)
      .map((label) => ({ label, done: false as const }));
    const dueIso = dueYmd.trim() ? ymdToDueAtIso(dueYmd) : null;
    setSubmitting(true);
    try {
      const createResult = await api.members.createTask(primaryId, {
        title: t,
        description: description.trim() || undefined,
        assignee_profile_ids: [...assigneeIds],
        due_at: dueIso,
        urgency,
        ...(related && related.length > 0 ? { related_member_ids: related } : {}),
        ...(checklist.length > 0 ? { checklist } : {}),
      });
      Alert.alert("Task created", "The member task was created.");
      closeAndReset();
      onSuccess(createResult.task as TaskItem | undefined);
    } catch (e: unknown) {
      const msg =
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Could not create task";
      Alert.alert("Create task", msg);
    } finally {
      setSubmitting(false);
    }
  };

  const footer = (
    <View style={styles.footer}>
      <Pressable onPress={closeAndReset} disabled={submitting} style={[styles.footerBtn, styles.footerBtnSecondary]}>
        <Text style={styles.footerBtnSecondaryText}>Cancel</Text>
      </Pressable>
      <Pressable
        onPress={() => void submit()}
        disabled={submitting}
        style={[styles.footerBtn, styles.footerBtnPrimary, submitting && { opacity: 0.75 }]}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.footerBtnPrimaryText}>Create task</Text>
        )}
      </Pressable>
    </View>
  );

  const filteredLinkedOnly = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    const base = lockedPrimaryMemberId
      ? members.filter((m) => m.id !== lockedPrimaryMemberId)
      : members;
    if (!q) return base;
    return base.filter((m) => memberSearchBlob(m).includes(q));
  }, [members, memberSearch, lockedPrimaryMemberId]);

  const primaryMemberRowLabel = useMemo(() => {
    if (!lockedPrimaryMemberId) return "";
    if (lockedPrimaryMemberLabel?.trim()) return lockedPrimaryMemberLabel.trim();
    const m = members.find((x) => x.id === lockedPrimaryMemberId);
    return m ? memberLabel(m) : lockedPrimaryMemberId.slice(0, 8);
  }, [lockedPrimaryMemberId, lockedPrimaryMemberLabel, members]);

  return (
    <FormModalShell
      visible={visible}
      onClose={closeAndReset}
      title="Member task"
      subtitle={
        lockedPrimaryMemberId
          ? `For ${primaryMemberRowLabel} — add linked members if needed`
          : "Assign a follow-up linked to members"
      }
      headerIcon="person-outline"
      footer={footer}
    >
      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.hint}>Loading…</Text>
        </View>
      ) : null}

      <Text style={styles.sectionLabel}>{displayMemberWords("Task")}</Text>
      <View style={styles.fieldBlock}>
        <Text style={styles.fieldLabel}>{displayMemberWords("Title")}</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder=""
          placeholderTextColor={colors.textSecondary}
          style={styles.input}
        />
      </View>
      <View style={styles.fieldBlock}>
        <Text style={styles.fieldLabel}>{displayMemberWords("Description (optional)")}</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder=""
          placeholderTextColor={colors.textSecondary}
          style={[styles.input, styles.inputMultiline]}
          multiline
          textAlignVertical="top"
        />
      </View>
      <YmdDateField label="Due date (optional)" value={dueYmd} onChange={setDueYmd} placeholder="" />

      <Text style={styles.sectionLabel}>{displayMemberWords("Urgency")}</Text>
      <View style={styles.urgencyRow}>
        {(
          [
            { id: "low" as const, label: "Low" },
            { id: "urgent" as const, label: "Urgent" },
            { id: "high" as const, label: "High" },
          ] as const
        ).map(({ id, label }) => {
          const on = urgency === id;
          return (
            <Pressable
              key={id}
              onPress={() => setUrgency(id)}
              style={[styles.urgencyChip, on && styles.urgencyChipOn]}
            >
              <Text style={[styles.urgencyChipText, on && styles.urgencyChipTextOn]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.sectionLabel}>{displayMemberWords("Checklist (optional)")}</Text>
      {checklistLines.map((line, idx) => (
        <View key={`todo-${idx}`} style={styles.checklistRow}>
          <TextInput
            value={line}
            onChangeText={(text) =>
              setChecklistLines((prev) => prev.map((x, j) => (j === idx ? text : x)))
            }
            placeholder=""
            placeholderTextColor={colors.textSecondary}
            style={[styles.input, styles.checklistLineInput]}
          />
          {checklistLines.length > 1 ? (
            <Pressable
              onPress={() =>
                setChecklistLines((prev) =>
                  prev.length <= 1 ? [""] : prev.filter((_, j) => j !== idx)
                )
              }
              style={styles.checklistRemove}
              hitSlop={8}
            >
              <Ionicons name="close-circle" size={22} color="#9ca3af" />
            </Pressable>
          ) : null}
        </View>
      ))}
      <Pressable onPress={() => setChecklistLines((prev) => [...prev, ""])} style={styles.addTodoBtn}>
        <Ionicons name="add-circle-outline" size={20} color={colors.accent} />
        <Text style={styles.addTodoText}>Add to-do</Text>
      </Pressable>

      {lockedPrimaryMemberId ? (
        <>
          <Text style={styles.sectionLabel}>{displayMemberWords("Member")}</Text>
          <Text style={styles.hint}>This task is for this profile.</Text>
          <View style={[styles.memberList, styles.memberListReadOnly]}>
            <View style={styles.memberRowReadOnly}>
              <Ionicons name="person" size={20} color={colors.accent} />
              <Text style={styles.memberRowText} numberOfLines={2}>
                {primaryMemberRowLabel}
              </Text>
            </View>
          </View>
          <Text style={styles.sectionLabel}>{displayMemberWords("Linked members (optional)")}</Text>
          <Text style={styles.hint}>Link household or related members to the same task.</Text>
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>{displayMemberWords("Search")}</Text>
            <TextInput
              value={memberSearch}
              onChangeText={setMemberSearch}
              placeholder=""
              placeholderTextColor={colors.textSecondary}
              style={styles.input}
              autoCorrect={false}
              autoCapitalize="none"
            />
          </View>
          <View style={styles.memberList}>
            <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={styles.memberScroll}>
              {filteredLinkedOnly.slice(0, 100).map((m) => {
                const on = selectedMemberIds.includes(m.id);
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => toggleMember(m.id)}
                    style={[styles.memberRow, on && styles.memberRowSelected]}
                  >
                    <Ionicons
                      name={on ? "checkbox" : "square-outline"}
                      size={22}
                      color={on ? colors.accent : colors.textSecondary}
                    />
                    <Text style={styles.memberRowText} numberOfLines={1}>
                      {memberLabel(m)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </>
      ) : (
        <>
          <Text style={styles.sectionLabel}>{displayMemberWords("Members")}</Text>
          <Text style={styles.hint}>Select one or more members.</Text>
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>{displayMemberWords("Search")}</Text>
            <TextInput
              value={memberSearch}
              onChangeText={setMemberSearch}
              placeholder=""
              placeholderTextColor={colors.textSecondary}
              style={styles.input}
              autoCorrect={false}
              autoCapitalize="none"
            />
          </View>
          <View style={styles.memberList}>
            <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={styles.memberScroll}>
              {filteredMembers.slice(0, 100).map((m) => {
                const on = selectedMemberIds.includes(m.id);
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => toggleMember(m.id)}
                    style={[styles.memberRow, on && styles.memberRowSelected]}
                  >
                    <Ionicons
                      name={on ? "checkbox" : "square-outline"}
                      size={22}
                      color={on ? colors.accent : colors.textSecondary}
                    />
                    <Text style={styles.memberRowText} numberOfLines={1}>
                      {memberLabel(m)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </>
      )}

      <Text style={styles.sectionLabel}>{displayMemberWords("Assignees")}</Text>
      <Text style={styles.hint}>Select one or more leaders.</Text>
      <View style={styles.memberList}>
        <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={styles.memberScroll}>
          {staffOptions.map((s) => {
            const on = assigneeIds.has(s.id);
            return (
              <Pressable
                key={s.id}
                onPress={() => toggleAssignee(s.id)}
                style={[styles.memberRow, on && styles.memberRowSelected]}
              >
                <Ionicons
                  name={on ? "checkbox" : "square-outline"}
                  size={22}
                  color={on ? colors.accent : colors.textSecondary}
                />
                <Text style={styles.memberRowText} numberOfLines={1}>
                  {staffDisplayName(s)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </FormModalShell>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    fontSize: type.overline.size,
    fontWeight: "700",
    color: colors.accent,
    marginTop: 14,
    marginBottom: 10,
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
  hint: {
    fontSize: type.caption.size,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: colors.textPrimary,
    backgroundColor: "#f8fafc",
  },
  inputMultiline: { minHeight: 72, textAlignVertical: "top" },
  memberList: {
    maxHeight: 220,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.sm,
    overflow: "hidden",
    backgroundColor: "#f8fafc",
    marginBottom: 8,
  },
  memberScroll: { maxHeight: 220 },
  memberListReadOnly: { marginBottom: 8 },
  memberRowReadOnly: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.accentSurface,
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  memberRowSelected: { backgroundColor: colors.accentSurface },
  memberRowText: { flex: 1, minWidth: 0, fontSize: type.body.size, color: colors.textPrimary },
  checklistRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  checklistLineInput: {
    flex: 1,
    minWidth: 0,
  },
  checklistRemove: {
    padding: 4,
  },
  addTodoBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingVertical: 6,
    marginBottom: 8,
  },
  addTodoText: {
    fontSize: type.body.size,
    fontWeight: type.bodyStrong.weight,
    color: colors.accent,
  },
  urgencyRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  urgencyChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: "#f8fafc",
  },
  urgencyChipOn: {
    borderColor: colors.accent,
    backgroundColor: "rgba(59, 130, 246, 0.12)",
  },
  urgencyChipText: { fontSize: type.caption.size, fontWeight: "600", color: colors.textSecondary },
  urgencyChipTextOn: { color: colors.accent },
  footer: { flexDirection: "row", justifyContent: "flex-end", gap: 12 },
  footerBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: radius.sm,
    minWidth: 100,
    alignItems: "center",
  },
  footerBtnSecondary: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  footerBtnSecondaryText: {
    fontSize: type.body.size,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  footerBtnPrimary: { backgroundColor: colors.accent },
  footerBtnPrimaryText: {
    fontSize: type.body.size,
    fontWeight: "600",
    color: "#fff",
  },
});
