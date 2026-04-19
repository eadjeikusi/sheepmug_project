import { useState } from "react";
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
import { colors, radius, type } from "../theme";
import { DatePickerField } from "./datetime/DatePickerField";

type Props = {
  visible: boolean;
  memberIds: string[];
  assigneeProfileId: string;
  onClose: () => void;
  onSuccess: () => void;
};

export function MemberBulkTaskAssignModal({
  visible,
  memberIds,
  assigneeProfileId,
  onClose,
  onSuccess,
}: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueYmd, setDueYmd] = useState("");
  const [checklistLines, setChecklistLines] = useState<string[]>([""]);
  const [submitting, setSubmitting] = useState(false);

  const closeAndReset = () => {
    setTitle("");
    setDescription("");
    setDueYmd("");
    setChecklistLines([""]);
    onClose();
  };

  const submit = async () => {
    const t = title.trim();
    if (!t) {
      Alert.alert("Task title required", "Enter a task title.");
      return;
    }
    if (!assigneeProfileId) {
      Alert.alert("Not signed in", "Please sign in again.");
      return;
    }
    if (memberIds.length === 0) return;
    setSubmitting(true);
    try {
      const primaryId = memberIds[0];
      const related = memberIds.length > 1 ? memberIds.slice(1) : undefined;
      const checklist = checklistLines
        .map((s) => s.trim())
        .filter(Boolean)
        .map((label) => ({ label, done: false as const }));
      await api.members.createTask(primaryId, {
        title: t,
        description: description.trim() || undefined,
        assignee_profile_ids: [assigneeProfileId],
        due_at: ymdToDueAtIso(dueYmd),
        ...(related && related.length > 0 ? { related_member_ids: related } : {}),
        ...(checklist.length > 0 ? { checklist } : {}),
      });
      Alert.alert(
        "Task assignment complete",
        memberIds.length > 1
          ? `One task assigned linking ${memberIds.length} members.`
          : "Task assigned to 1 member."
      );
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
        <View style={styles.card}>
          <Text style={styles.title}>Assign task to {memberIds.length} member(s)</Text>
          <ScrollView
            style={styles.cardScroll}
            contentContainerStyle={styles.cardScrollContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Task title"
              placeholderTextColor={colors.textSecondary}
              style={styles.input}
            />
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Description (optional)"
              placeholderTextColor={colors.textSecondary}
              style={[styles.input, styles.inputMultiline]}
              multiline
              textAlignVertical="top"
            />
            <Text style={styles.fieldLabel}>Due date (optional)</Text>
            <DatePickerField value={dueYmd} onChange={setDueYmd} placeholder="Select date" />
            <Text style={styles.checklistHeading}>To-do items (optional)</Text>
            {checklistLines.map((line, idx) => (
              <View key={`todo-${idx}`} style={styles.checklistRow}>
                <TextInput
                  value={line}
                  onChangeText={(text) =>
                    setChecklistLines((prev) => prev.map((x, j) => (j === idx ? text : x)))
                  }
                  placeholder={`To-do ${idx + 1}`}
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
            <Pressable
              onPress={() => setChecklistLines((prev) => [...prev, ""])}
              style={styles.addTodoBtn}
            >
              <Ionicons name="add-circle-outline" size={20} color={colors.accent} />
              <Text style={styles.addTodoText}>Add to-do</Text>
            </Pressable>
          </ScrollView>
          <Pressable
            style={[styles.primaryBtn, submitting && { opacity: 0.75 }]}
            onPress={() => void submit()}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Text style={styles.primaryBtnText}>Assign task</Text>
                <Ionicons name="arrow-forward" size={16} color="#fff" />
              </>
            )}
          </Pressable>
          <Pressable style={styles.cancelBtn} onPress={closeAndReset}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(17, 17, 17, 0.35)",
    justifyContent: "flex-end",
    padding: 16,
  },
  card: {
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: 10,
    maxHeight: "96%",
    minHeight: 440,
    width: "100%",
  },
  cardScroll: {
    maxHeight: 420,
    width: "100%",
  },
  cardScrollContent: {
    gap: 10,
    paddingBottom: 8,
  },
  fieldLabel: {
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    fontWeight: type.caption.weight,
    color: colors.textSecondary,
    marginTop: 2,
    marginBottom: 2,
  },
  checklistHeading: {
    fontSize: type.subtitle.size,
    lineHeight: type.subtitle.lineHeight,
    fontWeight: type.bodyStrong.weight,
    color: colors.textPrimary,
    marginTop: 4,
  },
  checklistRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
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
  },
  addTodoText: {
    fontSize: type.body.size,
    fontWeight: type.bodyStrong.weight,
    color: colors.accent,
  },
  title: {
    fontSize: type.title.size,
    lineHeight: type.title.lineHeight,
    fontWeight: type.title.weight,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: type.body.size,
    color: colors.textPrimary,
    backgroundColor: colors.bg,
  },
  inputMultiline: { minHeight: 72, textAlignVertical: "top" },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 14,
    marginTop: 6,
  },
  primaryBtnText: {
    color: "#fff",
    fontSize: type.bodyStrong.size,
    fontWeight: type.bodyStrong.weight,
  },
  cancelBtn: {
    alignItems: "center",
    paddingVertical: 12,
  },
  cancelBtnText: {
    fontSize: type.body.size,
    color: colors.textSecondary,
    fontWeight: "600",
  },
});
