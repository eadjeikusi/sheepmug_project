import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { ApiError } from "@sheepmug/shared-api";
import { api } from "../lib/api";
import { useGroupTypeOptions } from "../hooks/useGroupTypeOptions";
import { displayMemberWords } from "../lib/memberDisplayFormat";
import { colors, radius, type } from "../theme";
import type { AnchorRect } from "./FilterPickerModal";
import { FilterPickerModal } from "./FilterPickerModal";
import { FilterTriggerButton } from "./FilterTriggerButton";
import { FormModalShell } from "./FormModalShell";

type Props = {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
};

export function AddMinistryModal({ visible, onClose, onCreated }: Props) {
  const { options: groupTypeOpts } = useGroupTypeOptions(visible);
  const sortedTypes = useMemo(
    () =>
      [...groupTypeOpts].sort(
        (a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label),
      ),
    [groupTypeOpts],
  );
  const typePickerOptions = useMemo(
    () => sortedTypes.map((o) => ({ value: o.label, label: o.label })),
    [sortedTypes],
  );
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [groupType, setGroupType] = useState("");
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const typeTriggerRef = useRef<View>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName("");
    setDescription("");
    setSaving(false);
    setTypeMenuOpen(false);
    setAnchor(null);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    if (sortedTypes.length === 0) {
      setGroupType("Ministry");
      return;
    }
    setGroupType((prev) => {
      if (prev && sortedTypes.some((o) => o.label === prev)) return prev;
      return sortedTypes[0].label;
    });
  }, [visible, sortedTypes]);

  async function submit() {
    const n = name.trim();
    if (!n) {
      Alert.alert("Add ministry", "Enter a group name.");
      return;
    }
    const gt = groupType.trim();
    if (!gt) {
      Alert.alert("Add ministry", "Choose a group type (add presets in Settings on the web if empty).");
      return;
    }
    setSaving(true);
    try {
      await api.groups.create({ name: n, description: description.trim(), group_type: gt });
      onCreated();
      onClose();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Could not create ministry";
      Alert.alert("Add ministry", msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormModalShell
      visible={visible}
      onClose={onClose}
      title="Create New Ministry"
      subtitle="Add a ministry to your branch."
      variant="compact"
      dynamicHeight
      backdropColor="transparent"
      footer={
        <Pressable
          onPress={() => void submit()}
          disabled={saving}
          style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed, saving && styles.primaryBtnDisabled]}
          accessibilityRole="button"
          accessibilityLabel="Create ministry"
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>Create Ministry</Text>
          )}
        </Pressable>
      }
    >
      <View style={styles.field}>
        <Text style={styles.label}>{displayMemberWords("Group type")}</Text>
        {sortedTypes.length === 0 ? (
          <TextInput
            value={groupType}
            onChangeText={setGroupType}
            placeholder="e.g. Ministry"
            placeholderTextColor={colors.textSecondary}
            style={styles.input}
            autoCorrect={false}
            editable={!saving}
          />
        ) : (
          <>
            <FilterTriggerButton
              ref={typeTriggerRef}
              open={typeMenuOpen}
              valueLabel={groupType || "Select"}
              accessibilityLabel="Group type"
              onPress={() => {
                typeTriggerRef.current?.measureInWindow((x, y, w, h) => {
                  setAnchor({ x, y, width: w, height: h });
                  setTypeMenuOpen(true);
                });
              }}
            />
            <FilterPickerModal
              visible={typeMenuOpen && anchor !== null}
              title="Group type"
              options={typePickerOptions}
              selectedValue={groupType}
              anchorRect={anchor}
              onSelect={(v) => {
                setGroupType(v);
                setTypeMenuOpen(false);
                setAnchor(null);
              }}
              onClose={() => {
                setTypeMenuOpen(false);
                setAnchor(null);
              }}
            />
          </>
        )}
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>{displayMemberWords("Name")}</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Ministry name"
          placeholderTextColor={colors.textSecondary}
          style={styles.input}
          autoCorrect={false}
          editable={!saving}
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>{displayMemberWords("Description")}</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="Optional description"
          placeholderTextColor={colors.textSecondary}
          style={[styles.input, styles.textArea]}
          multiline
          textAlignVertical="top"
          editable={!saving}
        />
      </View>
    </FormModalShell>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: 16 },
  label: {
    fontSize: type.caption.size,
    fontWeight: "600",
    color: colors.textSecondary,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: colors.textPrimary,
    backgroundColor: colors.bg,
  },
  textArea: { minHeight: 100, paddingTop: 10 },
  primaryBtn: {
    backgroundColor: "#111827",
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnPressed: { opacity: 0.9 },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText: {
    color: "#ffffff",
    fontSize: type.bodyStrong.size,
    fontWeight: "700",
  },
});
