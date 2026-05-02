import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ApiError } from "@sheepmug/shared-api";
import { api } from "../lib/api";
import { ymdToDueAtIso } from "../lib/dateTimeFormat";
import { radius, type } from "../theme";
import { DatePickerField } from "./datetime/DatePickerField";

export type LeaderAssignMode = "member" | "group";

type MemberRow = { id: string; first_name: string | null; last_name: string | null };
type GroupRow = { id: string; name: string };

type Props = {
  visible: boolean;
  mode: LeaderAssignMode;
  leaderProfileId: string;
  members: MemberRow[];
  groups: GroupRow[];
  onClose: () => void;
  onSuccess: () => void;
};

function memberName(m: MemberRow): string {
  const n = `${String(m.first_name || "").trim()} ${String(m.last_name || "").trim()}`.trim();
  return n || "Member";
}

export function LeaderAssignTaskModal({
  visible,
  mode,
  leaderProfileId,
  members,
  groups,
  onClose,
  onSuccess,
}: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueYmd, setDueYmd] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setTitle("");
    setDescription("");
    setDueYmd("");
    setSelectedMemberId(members[0]?.id ?? null);
    setSelectedGroupId(groups[0]?.id ?? null);
  }, [visible, mode, members, groups]);

  const closeAndReset = () => {
    setTitle("");
    setDescription("");
    setDueYmd("");
    onClose();
  };

  const submit = async () => {
    const t = title.trim();
    if (!t) {
      Alert.alert("Task title required", "Enter a task title.");
      return;
    }
    if (!leaderProfileId) {
      Alert.alert("Error", "Missing leader.");
      return;
    }
    setSubmitting(true);
    try {
      if (mode === "member") {
        if (!selectedMemberId) {
          Alert.alert("Select a member", "Choose which member this task is about.");
          setSubmitting(false);
          return;
        }
        await api.members.createTask(selectedMemberId, {
          title: t,
          description: description.trim() || undefined,
          assignee_profile_ids: [leaderProfileId],
          due_at: ymdToDueAtIso(dueYmd),
        });
      } else {
        if (!selectedGroupId) {
          Alert.alert("Select a group", "Choose which group this task is about.");
          setSubmitting(false);
          return;
        }
        await api.groups.createTask(selectedGroupId, {
          title: t,
          description: description.trim() || undefined,
          assignee_profile_ids: [leaderProfileId],
          due_at: ymdToDueAtIso(dueYmd),
        });
      }
      Alert.alert("Task assigned", "The leader will see this in their tasks.");
      closeAndReset();
      onSuccess();
    } catch (e: unknown) {
      const msg =
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Could not assign task";
      Alert.alert("Task assignment", msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={closeAndReset}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.backdrop}
      >
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{mode === "member" ? "Member task" : "Group task"}</Text>
            <Pressable onPress={closeAndReset} hitSlop={12}>
              <Ionicons name="close" size={26} color="#64748b" />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
            {mode === "member" ? (
              <View style={styles.block}>
                <Text style={styles.label}>Member</Text>
                <ScrollView style={styles.picker} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                  {members.length === 0 ? (
                    <Text style={styles.muted}>No members in scope.</Text>
                  ) : (
                    members.map((m) => (
                      <Pressable
                        key={m.id}
                        style={[styles.pickRow, selectedMemberId === m.id && styles.pickRowOn]}
                        onPress={() => setSelectedMemberId(m.id)}
                      >
                        <Ionicons
                          name={selectedMemberId === m.id ? "radio-button-on" : "radio-button-off"}
                          size={20}
                          color={selectedMemberId === m.id ? "#7c3aed" : "#94a3b8"}
                        />
                        <Text style={styles.pickLabel}>{memberName(m)}</Text>
                      </Pressable>
                    ))
                  )}
                </ScrollView>
              </View>
            ) : (
              <View style={styles.block}>
                <Text style={styles.label}>Group</Text>
                <ScrollView style={styles.picker} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                  {groups.length === 0 ? (
                    <Text style={styles.muted}>No groups in scope.</Text>
                  ) : (
                    groups.map((g) => (
                      <Pressable
                        key={g.id}
                        style={[styles.pickRow, selectedGroupId === g.id && styles.pickRowOn]}
                        onPress={() => setSelectedGroupId(g.id)}
                      >
                        <Ionicons
                          name={selectedGroupId === g.id ? "radio-button-on" : "radio-button-off"}
                          size={20}
                          color={selectedGroupId === g.id ? "#7c3aed" : "#94a3b8"}
                        />
                        <Text style={styles.pickLabel}>{g.name}</Text>
                      </Pressable>
                    ))
                  )}
                </ScrollView>
              </View>
            )}

            <Text style={styles.label}>Title</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="Task title"
              placeholderTextColor="#94a3b8"
            />
            <Text style={styles.label}>Description (optional)</Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              value={description}
              onChangeText={setDescription}
              placeholder=""
              placeholderTextColor="#94a3b8"
              multiline
            />
            <Text style={styles.label}>Due (optional)</Text>
            <DatePickerField value={dueYmd} onChange={setDueYmd} placeholder="Select date" />
          </ScrollView>
          <View style={styles.footer}>
            <Pressable style={styles.btnGhost} onPress={closeAndReset} disabled={submitting}>
              <Text style={styles.btnGhostText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.btnPrimary, submitting && { opacity: 0.6 }]}
              onPress={() => void submit()}
              disabled={submitting}
            >
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryText}>Assign</Text>}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: "88%",
    paddingBottom: Platform.OS === "ios" ? 28 : 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e2e8f0",
  },
  headerTitle: { ...type.bodyStrong, fontSize: 17 },
  body: { padding: 18, gap: 10, paddingBottom: 24 },
  block: { marginBottom: 4 },
  label: { ...type.caption, color: "#64748b", marginBottom: 6 },
  muted: { ...type.body, color: "#94a3b8" },
  picker: { maxHeight: 160, borderWidth: 1, borderColor: "#e2e8f0", borderRadius: radius.md },
  pickRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#f1f5f9",
  },
  pickRowOn: { backgroundColor: "#f5f3ff" },
  pickLabel: { ...type.body, flex: 1 },
  input: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: "#0f172a",
  },
  textarea: { minHeight: 72, textAlignVertical: "top" },
  footer: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
    paddingHorizontal: 18,
    paddingTop: 8,
  },
  btnGhost: { paddingVertical: 12, paddingHorizontal: 16 },
  btnGhostText: { ...type.body, color: "#64748b" },
  btnPrimary: {
    backgroundColor: "#7c3aed",
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: radius.pill,
    minWidth: 100,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPrimaryText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
