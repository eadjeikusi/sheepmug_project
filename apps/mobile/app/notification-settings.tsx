import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import type { NotificationPreferences } from "@sheepmug/shared-api";
import { api } from "../lib/api";
import { useTheme } from "../contexts/ThemeContext";
import { radius, sizes, type } from "../theme";

type PrefSection = {
  key:
    | "tasks_enabled"
    | "attendance_enabled"
    | "events_enabled"
    | "requests_enabled"
    | "assignments_enabled"
    | "permissions_enabled"
    | "member_care_enabled"
    | "leader_updates_enabled";
  label: string;
  description: string;
  examples: { toggleKey: string; title: string; desc: string }[];
};

const sections: PrefSection[] = [
  {
    key: "tasks_enabled",
    label: "Tasks",
    description: "Updates related to assigned work and completion status.",
    examples: [
      { toggleKey: "task_assigned", title: "Task assigned", desc: "Get notified when a task is assigned to you." },
      { toggleKey: "task_completed", title: "Task completed", desc: "See when assigned tasks are completed." },
      { toggleKey: "task_overdue", title: "Task overdue", desc: "Reminders for pending items that passed due date." },
    ],
  },
  {
    key: "attendance_enabled",
    label: "Attendance",
    description: "Reminders and updates for attendance tracking windows.",
    examples: [
      { toggleKey: "attendance_start_reminder", title: "Take attendance reminder", desc: "Alert before an event starts." },
      { toggleKey: "attendance_close_reminder", title: "Closing reminder", desc: "Alert before attendance close time." },
      { toggleKey: "attendance_missed", title: "Attendance missed", desc: "Flag when attendance was not taken on time." },
    ],
  },
  {
    key: "events_enabled",
    label: "Events",
    description: "Changes made to event schedule and details.",
    examples: [
      { toggleKey: "event_created", title: "Event created", desc: "See newly created events for your branch." },
      { toggleKey: "event_updated", title: "Event updated", desc: "Get updates when event time or location changes." },
      { toggleKey: "event_changes_summary", title: "Event changes summary", desc: "Quick view of major event edits." },
    ],
  },
  {
    key: "requests_enabled",
    label: "Requests",
    description: "Approvals and updates for member and group requests.",
    examples: [
      { toggleKey: "member_request", title: "Member requests", desc: "Notify approvers when member requests come in." },
      { toggleKey: "group_join_request", title: "Group join requests", desc: "Notify approvers of pending group join requests." },
      { toggleKey: "request_approval_updates", title: "Approval updates", desc: "See when requests are approved or rejected." },
    ],
  },
  {
    key: "assignments_enabled",
    label: "Assignments",
    description: "Member and group assignment changes.",
    examples: [
      { toggleKey: "member_assigned", title: "Member assigned", desc: "Alert when a member is assigned to a group." },
      { toggleKey: "group_assignment_changes", title: "Group assignment changes", desc: "Track assignment updates to ministries." },
      { toggleKey: "role_assignment_flow", title: "Role assignment flow", desc: "Visibility into assignment actions." },
    ],
  },
  {
    key: "permissions_enabled",
    label: "Permissions",
    description: "Security-relevant updates to access and permissions.",
    examples: [
      { toggleKey: "permission_changed", title: "Permission changed", desc: "Get notified when your access is modified." },
      { toggleKey: "role_updated", title: "Role updated", desc: "See updates to role-based access." },
      { toggleKey: "account_access_changed", title: "Account access changed", desc: "Alert when account status changes." },
    ],
  },
  {
    key: "member_care_enabled",
    label: "Member Care",
    description: "Health alerts for member attendance and follow-up.",
    examples: [
      { toggleKey: "low_attendance_alert", title: "Low attendance alert", desc: "Flag members missing frequent services." },
      { toggleKey: "follow_up_needed", title: "Follow-up needed", desc: "Prompt checkups for members needing attention." },
      { toggleKey: "care_risk_trend", title: "Care risk trend", desc: "Summary of members entering risk state." },
    ],
  },
  {
    key: "leader_updates_enabled",
    label: "Leader Updates",
    description: "Progress updates to help leaders monitor activity.",
    examples: [
      { toggleKey: "team_activity", title: "Team activity", desc: "Leader visibility on team execution progress." },
      { toggleKey: "completion_highlights", title: "Completion highlights", desc: "Celebrate completed actions and milestones." },
      { toggleKey: "stale_action_alerts", title: "Stale action alerts", desc: "Notify leaders when updates are missing." },
    ],
  },
];

const defaultPreferences: NotificationPreferences = {
  mute_all: false,
  tasks_enabled: true,
  attendance_enabled: true,
  events_enabled: true,
  requests_enabled: true,
  assignments_enabled: true,
  permissions_enabled: true,
  member_care_enabled: true,
  leader_updates_enabled: true,
  granular_preferences: {},
};

export default function NotificationSettingsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["tasks_enabled", "events_enabled"]));

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const payload = await api.notificationPreferences.get();
        if (!mounted) return;
        setPrefs(payload ? { ...defaultPreferences, ...payload } : defaultPreferences);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const switchTrackColor = useMemo(
    () => ({ false: colors.border, true: colors.accent }),
    [colors.accent, colors.border]
  );

  async function patchTopLevel(key: keyof NotificationPreferences, value: boolean) {
    if (!prefs || saving) return;
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    setSaving(true);
    try {
      const res = await api.notificationPreferences.patch({ [key]: value });
      if (res.preferences) setPrefs({ ...defaultPreferences, ...res.preferences });
    } catch {
      setPrefs(prefs);
    } finally {
      setSaving(false);
    }
  }

  async function patchGranular(toggleKey: string, value: boolean) {
    if (!prefs || saving) return;
    const currentGranular = prefs.granular_preferences || {};
    const nextGranular = { ...currentGranular, [toggleKey]: value };
    const nextPrefs = { ...prefs, granular_preferences: nextGranular };
    setPrefs(nextPrefs);
    setSaving(true);
    try {
      const res = await api.notificationPreferences.patch({ granular_preferences: nextGranular });
      if (res.preferences) setPrefs({ ...defaultPreferences, ...res.preferences });
    } catch {
      setPrefs(prefs);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="chevron-back" size={sizes.headerIcon} color={colors.textPrimary} />
          </Pressable>
          <Text style={[styles.pageTitle, { color: colors.textPrimary }]}>Notification Settings</Text>
        </View>

        {loading || !prefs ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.accent} />
            <Text style={[styles.helper, { color: colors.textSecondary }]}>Loading preferences...</Text>
          </View>
        ) : (
          <>
            <View style={[styles.block, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <View style={styles.rowBetween}>
                <View style={styles.rowTextWrap}>
                  <Text style={[styles.rowTitle, { color: colors.textPrimary }]}>Mute all notifications</Text>
                  <Text style={[styles.rowDesc, { color: colors.textSecondary }]}>
                    Pause every in-app notification until you re-enable them.
                  </Text>
                </View>
                <Switch
                  value={Boolean(prefs.mute_all)}
                  onValueChange={(v) => void patchTopLevel("mute_all", v)}
                  trackColor={switchTrackColor}
                  thumbColor={prefs.mute_all ? "#ffffff" : "#f4f3f4"}
                  disabled={saving}
                />
              </View>
            </View>

            {sections.map((section) => {
              const checked = Boolean(prefs[section.key]);
              const isExpanded = expanded.has(section.key);
              return (
                <View key={section.key} style={[styles.block, { borderColor: colors.border, backgroundColor: colors.card }]}>
                  <View style={styles.sectionHeader}>
                    <Pressable
                      style={styles.sectionTitleWrap}
                      onPress={() =>
                        setExpanded((prev) => {
                          const next = new Set(prev);
                          if (next.has(section.key)) next.delete(section.key);
                          else next.add(section.key);
                          return next;
                        })
                      }
                    >
                      <Ionicons
                        name={isExpanded ? "chevron-down" : "chevron-forward"}
                        size={16}
                        color={colors.textSecondary}
                      />
                      <View style={styles.rowTextWrap}>
                        <Text style={[styles.rowTitle, { color: colors.textPrimary }]}>{section.label}</Text>
                        <Text style={[styles.rowDesc, { color: colors.textSecondary }]}>{section.description}</Text>
                      </View>
                    </Pressable>
                    <Switch
                      value={checked}
                      onValueChange={(v) => void patchTopLevel(section.key, v)}
                      trackColor={switchTrackColor}
                      thumbColor={checked ? "#ffffff" : "#f4f3f4"}
                      disabled={saving || prefs.mute_all}
                    />
                  </View>

                  {isExpanded ? (
                    <View style={[styles.examplesWrap, { borderTopColor: colors.border }]}>
                      <Text style={[styles.examplesTitle, { color: colors.textSecondary }]}>Included Notifications</Text>
                      {section.examples.map((example) => {
                        const granularOn = prefs.granular_preferences?.[example.toggleKey] !== false;
                        return (
                          <View key={example.toggleKey} style={[styles.exampleRow, { borderColor: colors.border }]}>
                            <View style={styles.rowTextWrap}>
                              <Text style={[styles.exampleTitle, { color: colors.textPrimary }]}>{example.title}</Text>
                              <Text style={[styles.exampleDesc, { color: colors.textSecondary }]}>{example.desc}</Text>
                            </View>
                            <Switch
                              value={granularOn}
                              onValueChange={(v) => void patchGranular(example.toggleKey, v)}
                              trackColor={switchTrackColor}
                              thumbColor={granularOn ? "#ffffff" : "#f4f3f4"}
                              disabled={saving || prefs.mute_all || !checked}
                            />
                          </View>
                        );
                      })}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { padding: 16, gap: 12, paddingBottom: 24 },
  topBar: { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  pageTitle: {
    fontSize: type.h1.size,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.weight,
    letterSpacing: type.h1.letterSpacing,
  },
  loadingWrap: { paddingVertical: 24, gap: 8, alignItems: "center" },
  helper: {
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    fontWeight: type.caption.weight,
  },
  block: {
    borderWidth: 1,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
    padding: 12,
    alignItems: "center",
  },
  rowTextWrap: { flex: 1, gap: 2 },
  rowTitle: {
    fontSize: type.bodyStrong.size,
    lineHeight: type.bodyStrong.lineHeight,
    fontWeight: type.bodyStrong.weight,
  },
  rowDesc: {
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    fontWeight: type.caption.weight,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 12,
    gap: 10,
  },
  sectionTitleWrap: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  examplesWrap: {
    borderTopWidth: 1,
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 8,
  },
  examplesTitle: {
    fontSize: type.overline.size,
    lineHeight: type.overline.lineHeight,
    fontWeight: type.overline.weight,
    letterSpacing: type.overline.letterSpacing,
    marginTop: 10,
  },
  exampleRow: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
    alignItems: "center",
  },
  exampleTitle: {
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    fontWeight: type.bodyStrong.weight,
  },
  exampleDesc: {
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
  },
});
