import { useMemo } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { displayMemberWords } from "../../lib/memberDisplayFormat";
import { buildChildrenByParent, rootGroupsInScope, toggleGroupSelection, type ReportGroupRow } from "../../lib/reportGroupTree";
import { colors, radius, type as typography } from "../../theme";

type Props = {
  visible: boolean;
  onClose: () => void;
  groups: ReportGroupRow[];
  selectedIds: string[];
  onChangeSelectedIds: (ids: string[]) => void;
};

function RowNode({
  node,
  groupsById,
  childrenByParent,
  selectedIds,
  onToggle,
  depth,
}: {
  node: ReportGroupRow;
  groupsById: Map<string, ReportGroupRow>;
  childrenByParent: Map<string, string[]>;
  selectedIds: string[];
  onToggle: (id: string) => void;
  depth: number;
}) {
  const kids = childrenByParent.get(node.id) || [];
  const checked = selectedIds.includes(node.id);
  return (
    <View>
      <Pressable
        onPress={() => onToggle(node.id)}
        style={[styles.row, { paddingLeft: 12 + depth * 14 }]}
        accessibilityRole="button"
        accessibilityState={{ selected: checked }}
      >
        <Ionicons name={checked ? "checkbox" : "square-outline"} size={20} color={checked ? colors.accent : colors.textSecondary} />
        <Text style={styles.rowLabel} numberOfLines={2}>
          {displayMemberWords(node.name || "Group")}
        </Text>
      </Pressable>
      {kids.map((cid) => {
        const ch = groupsById.get(cid);
        if (!ch) return null;
        return (
          <RowNode
            key={cid}
            node={ch}
            groupsById={groupsById}
            childrenByParent={childrenByParent}
            selectedIds={selectedIds}
            onToggle={onToggle}
            depth={depth + 1}
          />
        );
      })}
    </View>
  );
}

/**
 * Hierarchical group picker: selecting a row selects that group and all nested children (same as web).
 */
export function ReportGroupTreeModal({ visible, onClose, groups, selectedIds, onChangeSelectedIds }: Props) {
  const groupsById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const childrenByParent = useMemo(() => buildChildrenByParent(groups), [groups]);
  const roots = useMemo(() => rootGroupsInScope(groups), [groups]);

  const onToggle = (id: string) => {
    onChangeSelectedIds(toggleGroupSelection(id, selectedIds, childrenByParent));
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          style={styles.dim}
          onPress={onClose}
          accessibilityLabel="Close"
          accessibilityRole="button"
        />
        <View style={styles.sheetWrap} pointerEvents="box-none">
          <View style={styles.sheet}>
            <View style={styles.header}>
              <Text style={styles.title}>Select groups</Text>
              <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Done">
                <Text style={styles.done}>Done</Text>
              </Pressable>
            </View>
            <Text style={styles.hint}>Tap a group to select it and all nested subgroups.</Text>
            <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
              {roots.length === 0 ? <Text style={styles.empty}>No groups in your scope.</Text> : null}
              {roots.map((r) => (
                <RowNode
                  key={r.id}
                  node={r}
                  groupsById={groupsById}
                  childrenByParent={childrenByParent}
                  selectedIds={selectedIds}
                  onToggle={onToggle}
                  depth={0}
                />
              ))}
            </ScrollView>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  dim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
  },
  sheetWrap: {
    zIndex: 1,
    maxHeight: "85%",
  },
  sheet: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    maxHeight: "100%",
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: { ...typography.bodyStrong, color: colors.textPrimary },
  done: { ...typography.caption, color: colors.accent, fontWeight: "700" },
  hint: { ...typography.caption, color: colors.textSecondary, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  scroll: { maxHeight: 420 },
  scrollContent: { paddingBottom: 16, paddingHorizontal: 8 },
  empty: { ...typography.caption, color: colors.textSecondary, padding: 16, textAlign: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingRight: 8,
  },
  rowLabel: { ...typography.caption, color: colors.textPrimary, flex: 1, fontWeight: "500" },
});
