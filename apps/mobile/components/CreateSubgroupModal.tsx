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
  parentGroupId: string;
  parentGroupName: string;
};

export function CreateSubgroupModal({ visible, onClose, onCreated, parentGroupId, parentGroupName }: Props) {
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
      setGroupType("Subgroup");
      return;
    }
    setGroupType((prev) => {
      if (prev && sortedTypes.some((o) => o.label === prev)) return prev;
      const subLabel =
        sortedTypes.find((o) => /subgroup/i.test(o.label))?.label || sortedTypes[0]?.label || "Subgroup";
      return subLabel;
    });
  }, [visible, sortedTypes]);

  async function submit() {
    const n = name.trim();
    if (!n) {
      Alert.alert("Create subgroup", "Enter a subgroup name.");
      return;
    }
    const pid = parentGroupId.trim();
    if (!pid) {
      Alert.alert("Create subgroup", "Missing parent ministry.");
      return;
    }
    const gt = groupType.trim();
    if (!gt) {
      Alert.alert("Create subgroup", "Choose a group type (add presets in Settings on the web if empty).");
      return;
    }
    setSaving(true);
    try {
      await api.groups.create({
        name: n,
        description: description.trim(),
        group_type: gt,
        parent_group_id: pid,
      });
      onCreated();
      onClose();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Could not create subgroup";
      Alert.alert("Create subgroup", msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormModalShell
      visible={visible}
      onClose={onClose}
      title="Create subgroup"
      subtitle={`Under ${parentGroupName.trim() || "ministry"}`}
      variant="compact"
      footer={
        <Pressable
          onPress={() => void submit()}
          disabled={saving}
          style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed, saving && styles.primaryBtnDisabled]}
          accessibilityRole="button"
          accessibilityLabel="Create subgroup"
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>Create subgroup</Text>
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
            placeholder="e.g. Subgroup"
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
          placeholder="Subgroup name"
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
