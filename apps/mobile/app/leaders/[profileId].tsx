import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../lib/api";
import { usePermissions } from "../../hooks/usePermissions";
import { canAccessLeadersDirectory } from "@sheepmug/permissions-helpers";
import { useAuth } from "../../contexts/AuthContext";
import { useTheme } from "../../contexts/ThemeContext";
import { MemberInitialAvatar } from "../../components/MemberInitialAvatar";
import { LeaderAssignTaskModal, type LeaderAssignMode } from "../../components/LeaderAssignTaskModal";
import { displayMemberWords } from "../../lib/memberDisplayFormat";
import { radius, sizes, type } from "../../theme";

const GROUP_GRID_COLUMNS = 2;
const GROUP_GRID_GAP = 10;
const H_PAD = 16;

type TaskRow = NonNullable<Awaited<ReturnType<typeof api.reports.leaderDetail>>["tasks"]>[number];
type TaskKindFilter = "all" | "member" | "group";
type LeaderTab = "groups" | "members" | "tasks";

function memberLabel(m: { first_name: string | null; last_name: string | null }): string {
  const n = `${String(m.first_name || "").trim()} ${String(m.last_name || "").trim()}`.trim();
  return n || "Member";
}

function formatDue(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function leaderReturnQuery(leaderProfileId: string): string {
  return `returnTo=${encodeURIComponent(`/leaders/${leaderProfileId}`)}`;
}

function taskContextLine(t: TaskRow): string {
  if (t.task_type === "member") {
    const m = t.members?.[0];
    return m ? displayMemberWords(memberLabel(m)) : "Member follow-up";
  }
  const g = t.groups?.[0];
  return g?.name ? displayMemberWords(String(g.name)) : "Group follow-up";
}

export default function LeaderDetailScreen() {
  const { profileId } = useLocalSearchParams<{ profileId: string }>();
  const id = typeof profileId === "string" ? profileId : Array.isArray(profileId) ? profileId[0] : "";
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const { user } = useAuth();
  const { can } = usePermissions();
  const { colors: themeColors } = useTheme();
  const canSee = canAccessLeadersDirectory(can);
  const canRunLeaderReport = can("report_leaders");
  const canViewLeaderTasks =
    user?.is_org_owner === true ||
    user?.is_super_admin === true ||
    can("monitor_member_tasks") ||
    can("monitor_group_tasks") ||
    can("report_leaders");
  const canAssignMemberTask = can("add_member_tasks");
  const canAssignGroupTask = can("add_group_tasks");

  const groupTileWidth = Math.max(
    140,
    Math.floor((windowWidth - H_PAD * 2 - GROUP_GRID_GAP * (GROUP_GRID_COLUMNS - 1)) / GROUP_GRID_COLUMNS),
  );

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<Awaited<ReturnType<typeof api.reports.leaderDetail>> | null>(null);
  const [assignMode, setAssignMode] = useState<LeaderAssignMode | null>(null);
  const [tab, setTab] = useState<LeaderTab>("groups");
  const [taskFilter, setTaskFilter] = useState<TaskKindFilter>("all");
  const [groupSearch, setGroupSearch] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [taskSearch, setTaskSearch] = useState("");

  const load = useCallback(async () => {
    if (!canSee || !id) {
      setPayload(null);
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const data = await api.reports.leaderDetail(id);
      setPayload(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load leader");
      setPayload(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [canSee, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const tasks = payload?.tasks ?? [];
  const filteredTasks = useMemo(() => {
    if (taskFilter === "all") return tasks;
    return tasks.filter((t) => t.task_type === taskFilter);
  }, [tasks, taskFilter]);

  const filteredGroupsList = useMemo(() => {
    if (!payload) return [];
    const q = groupSearch.trim().toLowerCase();
    if (!q) return payload.groups;
    return payload.groups.filter((g) => {
      const name = String(g.name || "").toLowerCase();
      const mc = String(g.member_count ?? "");
      return name.includes(q) || mc.includes(q);
    });
  }, [payload?.groups, groupSearch]);

  const filteredMembersList = useMemo(() => {
    if (!payload) return [];
    const q = memberSearch.trim().toLowerCase();
    if (!q) return payload.members;
    return payload.members.filter((m) => memberLabel(m).toLowerCase().includes(q));
  }, [payload?.members, memberSearch]);

  const searchedTasks = useMemo(() => {
    const q = taskSearch.trim().toLowerCase();
    if (!q) return filteredTasks;
    return filteredTasks.filter((t) => {
      const due = formatDue(t.due_at) || "";
      const blob = `${t.title} ${t.status} ${taskContextLine(t)} ${due}`.toLowerCase();
      return blob.includes(q);
    });
  }, [filteredTasks, taskSearch]);

  const title =
    payload?.leader &&
    displayMemberWords(
      `${String(payload.leader.first_name || "").trim()} ${String(payload.leader.last_name || "").trim()}`.trim() ||
        String(payload.leader.email || "Leader"),
    );

  if (!canSee) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.bg }]}>
        <Text style={{ color: themeColors.textSecondary }}>You do not have permission to view this page.</Text>
      </View>
    );
  }

  const renderGroupsOnly = () =>
    payload ? (
      <>
        <View
          style={[
            styles.searchFieldWrap,
            { borderColor: themeColors.border, backgroundColor: themeColors.card },
          ]}
        >
          <Ionicons name="search" size={sizes.headerIcon} color={themeColors.textSecondary} style={styles.searchIcon} />
          <TextInput
            value={groupSearch}
            onChangeText={setGroupSearch}
            placeholder="Search assigned groups"
            placeholderTextColor={themeColors.textSecondary}
            style={[styles.searchInput, { color: themeColors.textPrimary }]}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>
        {payload.groups.length === 0 ? (
          <Text style={[styles.empty, { color: themeColors.textSecondary }]}>
            No groups tied to this leader in your scope.
          </Text>
        ) : filteredGroupsList.length === 0 ? (
          <Text style={[styles.empty, { color: themeColors.textSecondary }]}>No groups match your search.</Text>
        ) : (
          <View style={[styles.groupGridRow, { gap: GROUP_GRID_GAP }]}>
            {filteredGroupsList.map((g) => (
              <Pressable
                key={g.id}
                style={[
                  styles.groupCard,
                  {
                    width: groupTileWidth,
                    borderColor: themeColors.border,
                    backgroundColor: themeColors.card,
                  },
                ]}
                onPress={() => router.push(`/ministry/${g.id}?${leaderReturnQuery(id)}`)}
              >
                <Text style={[styles.groupCardTitle, { color: themeColors.textPrimary }]} numberOfLines={2}>
                  {displayMemberWords(g.name)}
                </Text>
                <Text style={[styles.groupCardDesc, { color: themeColors.textSecondary }]} numberOfLines={2}>
                  No description provided.
                </Text>
                {Array.isArray(g.member_preview) && g.member_preview.length > 0 ? (
                  <View style={styles.groupPreviewRow}>
                    {g.member_preview.map((p, i) => {
                      const uri = p.image_url?.trim();
                      return (
                        <View
                          key={p.member_id || String(i)}
                          style={[
                            styles.groupPreviewFace,
                            { borderColor: themeColors.card },
                            i > 0 && styles.groupPreviewFaceOverlap,
                          ]}
                        >
                          {uri ? (
                            <Image source={{ uri }} style={styles.groupPreviewImage} />
                          ) : (
                            <View style={[styles.groupPreviewImage, { backgroundColor: themeColors.accentSurface }]}>
                              <Text style={[styles.groupPreviewInitialsText, { color: themeColors.textPrimary }]}>
                                {(p.initials || "?").slice(0, 2)}
                              </Text>
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                ) : null}
                <View style={styles.groupCardMetaRow}>
                  <Ionicons name="people-outline" size={16} color={themeColors.accent} />
                  <Text style={[styles.groupCardMetaText, { color: themeColors.textSecondary }]}>
                    {g.member_count} {g.member_count === 1 ? "member" : "members"}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={themeColors.textSecondary} style={styles.groupChevron} />
              </Pressable>
            ))}
          </View>
        )}
      </>
    ) : null;

  const renderMembersOnly = () =>
    payload ? (
      <>
        <Text style={[styles.sectionTitle, { color: themeColors.textPrimary, marginTop: 0 }]}>
          Members in those groups
        </Text>
        <View
          style={[
            styles.searchFieldWrap,
            { borderColor: themeColors.border, backgroundColor: themeColors.card },
          ]}
        >
          <Ionicons name="search" size={sizes.headerIcon} color={themeColors.textSecondary} style={styles.searchIcon} />
          <TextInput
            value={memberSearch}
            onChangeText={setMemberSearch}
            placeholder="Search members"
            placeholderTextColor={themeColors.textSecondary}
            style={[styles.searchInput, { color: themeColors.textPrimary }]}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>
        {payload.members.length === 0 ? (
          <Text style={[styles.empty, { color: themeColors.textSecondary }]}>No members found (or none visible to you).</Text>
        ) : filteredMembersList.length === 0 ? (
          <Text style={[styles.empty, { color: themeColors.textSecondary }]}>No members match your search.</Text>
        ) : (
          <View style={[styles.block, { borderColor: themeColors.border }]}>
            {filteredMembersList.map((m, idx) => {
              const initials =
                `${String(m.first_name || "").trim()[0] || ""}${String(m.last_name || "").trim()[0] || ""}`.toUpperCase() ||
                "?";
              const uri = (m as { image_url?: string | null }).image_url?.trim();
              return (
                <Pressable
                  key={m.id}
                  style={[
                    styles.rowLine,
                    styles.memberRowPressable,
                    idx === filteredMembersList.length - 1 && { borderBottomWidth: 0 },
                    { borderBottomColor: themeColors.border },
                  ]}
                  onPress={() => router.push(`/member/${m.id}?${leaderReturnQuery(id)}`)}
                >
                  {uri ? (
                    <Image source={{ uri }} style={styles.memberRowAvatar} />
                  ) : (
                    <MemberInitialAvatar
                      initial={(initials[0] || "M").toUpperCase()}
                      size={40}
                      textStyle={{ fontSize: 15, fontWeight: "700", color: themeColors.textPrimary }}
                    />
                  )}
                  <Text style={[styles.memberName, { color: themeColors.textPrimary, flex: 1, minWidth: 0 }]}>
                    {displayMemberWords(memberLabel(m))}
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color={themeColors.textSecondary} />
                </Pressable>
              );
            })}
          </View>
        )}
      </>
    ) : null;

  const renderTasks = () =>
    payload ? (
      <View style={{ gap: 12 }}>
        <View
          style={[
            styles.searchFieldWrap,
            { borderColor: themeColors.border, backgroundColor: themeColors.card },
          ]}
        >
          <Ionicons name="search" size={sizes.headerIcon} color={themeColors.textSecondary} style={styles.searchIcon} />
          <TextInput
            value={taskSearch}
            onChangeText={setTaskSearch}
            placeholder="Search tasks"
            placeholderTextColor={themeColors.textSecondary}
            style={[styles.searchInput, { color: themeColors.textPrimary }]}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>
        <View style={[styles.segmentWrap, { backgroundColor: themeColors.headerIconCircleBg }]}>
          {(["all", "member", "group"] as const).map((k) => (
            <Pressable
              key={k}
              style={[
                styles.segmentBtn,
                taskFilter === k && styles.segmentBtnActive,
                taskFilter === k && { backgroundColor: themeColors.card },
              ]}
              onPress={() => setTaskFilter(k)}
            >
              <Text
                style={[
                  styles.segmentBtnText,
                  { color: taskFilter === k ? themeColors.textPrimary : themeColors.textSecondary },
                ]}
              >
                {k === "all" ? "All tasks" : k === "member" ? "Member tasks" : "Group tasks"}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.assignBtnRow}>
          {canAssignMemberTask && payload.members.length > 0 ? (
            <Pressable
              style={[styles.smallBtn, { borderColor: themeColors.border, backgroundColor: themeColors.card }]}
              onPress={() => setAssignMode("member")}
            >
              <Text style={[styles.smallBtnText, { color: themeColors.accent }]}>Member task</Text>
            </Pressable>
          ) : null}
          {canAssignGroupTask && payload.groups.length > 0 ? (
            <Pressable
              style={[styles.smallBtn, { borderColor: themeColors.border, backgroundColor: themeColors.card }]}
              onPress={() => setAssignMode("group")}
            >
              <Text style={[styles.smallBtnText, { color: themeColors.accent }]}>Group task</Text>
            </Pressable>
          ) : null}
        </View>

        {tasks.length === 0 ? (
          <Text style={[styles.empty, { color: themeColors.textSecondary }]}>
            No tasks assigned to this leader in your branch scope.
          </Text>
        ) : filteredTasks.length === 0 ? (
          <Text style={[styles.empty, { color: themeColors.textSecondary }]}>No tasks in this filter.</Text>
        ) : searchedTasks.length === 0 ? (
          <Text style={[styles.empty, { color: themeColors.textSecondary }]}>No tasks match your search.</Text>
        ) : (
          <View style={[styles.block, { borderColor: themeColors.border }]}>
            {searchedTasks.map((t, idx) => {
              const due = formatDue(t.due_at);
              const isLast = idx === searchedTasks.length - 1;
              return (
                <View
                  key={t.id}
                  style={[
                    styles.taskRow,
                    { borderBottomColor: themeColors.border },
                    isLast && { borderBottomWidth: 0 },
                  ]}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.taskTitle, { color: themeColors.textPrimary }]} numberOfLines={2}>
                      {displayMemberWords(t.title)}
                    </Text>
                    <Text style={[styles.taskMeta, { color: themeColors.textSecondary }]} numberOfLines={2}>
                      {t.task_type === "member" ? "Member task" : "Group task"} · {taskContextLine(t)}
                    </Text>
                    {due ? (
                      <Text style={[styles.taskDue, { color: themeColors.textSecondary }]}>Due {due}</Text>
                    ) : null}
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 6 }}>
                    <Text style={[styles.statusPill, { backgroundColor: themeColors.border }]}>
                      {String(t.status).replace(/_/g, " ")}
                    </Text>
                    {t.task_type === "member" && t.member_id ? (
                      <Pressable onPress={() => router.push(`/member/${t.member_id}?${leaderReturnQuery(id)}`)}>
                        <Text style={[styles.linkText, { color: themeColors.accent }]}>Open member</Text>
                      </Pressable>
                    ) : null}
                    {t.task_type === "group" && t.group_id ? (
                      <Pressable onPress={() => router.push(`/ministry/${t.group_id}?${leaderReturnQuery(id)}`)}>
                        <Text style={[styles.linkText, { color: themeColors.accent }]}>Open group</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </View>
    ) : null;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: themeColors.bg }}
      contentContainerStyle={styles.scrollPad}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
    >
      <Pressable style={styles.backRow} onPress={() => router.back()}>
        <Ionicons name="chevron-back" size={22} color={themeColors.accent} />
        <Text style={[styles.backText, { color: themeColors.accent }]}>Leaders</Text>
      </Pressable>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 24 }} color={themeColors.accent} />
      ) : error ? (
        <Text style={[styles.err, { color: "#b91c1c" }]}>{error}</Text>
      ) : !payload ? (
        <Text style={{ color: themeColors.textSecondary }}>Leader not found.</Text>
      ) : (
        <>
          <View style={[styles.hero, { borderColor: themeColors.border, backgroundColor: themeColors.card }]}>
            {payload.leader.avatar_url?.trim() ? (
              <Image source={{ uri: payload.leader.avatar_url.trim() }} style={styles.heroAvatar} />
            ) : (
              <MemberInitialAvatar
                initial={(title?.[0] || "L").toUpperCase()}
                size={72}
                textStyle={{ fontSize: 26, fontWeight: "700", color: themeColors.textPrimary }}
              />
            )}
            <View style={styles.heroText}>
              <Text style={[styles.heroTitle, { color: themeColors.textPrimary }]}>{title}</Text>
              {payload.leader.email ? (
                <Text style={[styles.heroEmail, { color: themeColors.textSecondary }]}>{payload.leader.email}</Text>
              ) : null}
            </View>
          </View>

          {canRunLeaderReport ? (
            <Pressable
              style={[styles.reportBtn, { backgroundColor: themeColors.accent }]}
              onPress={() => router.push(`/reports?leader=${encodeURIComponent(payload.leader.id)}`)}
            >
              <Ionicons name="bar-chart-outline" size={20} color="#fff" />
              <Text style={styles.reportBtnText}>Generate report</Text>
            </Pressable>
          ) : null}

          {canViewLeaderTasks ? (
            <>
              <View style={[styles.tabBar, { backgroundColor: themeColors.headerIconCircleBg }]}>
                <Pressable
                  style={[styles.tabItem, tab === "groups" && [styles.tabItemActive, { backgroundColor: themeColors.card }]]}
                  onPress={() => setTab("groups")}
                >
                  <Text
                    style={[
                      styles.tabItemText,
                      styles.tabItemTextMultiline,
                      { color: tab === "groups" ? themeColors.textPrimary : themeColors.textSecondary },
                    ]}
                    numberOfLines={2}
                  >
                    Groups assigned ({payload.groups.length})
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.tabItem, tab === "members" && [styles.tabItemActive, { backgroundColor: themeColors.card }]]}
                  onPress={() => setTab("members")}
                >
                  <Text
                    style={[
                      styles.tabItemText,
                      styles.tabItemTextMultiline,
                      { color: tab === "members" ? themeColors.textPrimary : themeColors.textSecondary },
                    ]}
                    numberOfLines={2}
                  >
                    Members ({payload.members.length})
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.tabItem, tab === "tasks" && [styles.tabItemActive, { backgroundColor: themeColors.card }]]}
                  onPress={() => setTab("tasks")}
                >
                  <Text
                    style={[
                      styles.tabItemText,
                      { color: tab === "tasks" ? themeColors.textPrimary : themeColors.textSecondary },
                    ]}
                  >
                    Tasks
                  </Text>
                </Pressable>
              </View>

              {tab === "groups" ? renderGroupsOnly() : tab === "members" ? renderMembersOnly() : renderTasks()}
            </>
          ) : (
            <>
              <View style={[styles.tabBar, { backgroundColor: themeColors.headerIconCircleBg }]}>
                <Pressable
                  style={[styles.tabItem, tab === "groups" && [styles.tabItemActive, { backgroundColor: themeColors.card }]]}
                  onPress={() => setTab("groups")}
                >
                  <Text
                    style={[
                      styles.tabItemText,
                      styles.tabItemTextMultiline,
                      { color: tab === "groups" ? themeColors.textPrimary : themeColors.textSecondary },
                    ]}
                    numberOfLines={2}
                  >
                    Groups assigned ({payload.groups.length})
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.tabItem, tab === "members" && [styles.tabItemActive, { backgroundColor: themeColors.card }]]}
                  onPress={() => setTab("members")}
                >
                  <Text
                    style={[
                      styles.tabItemText,
                      styles.tabItemTextMultiline,
                      { color: tab === "members" ? themeColors.textPrimary : themeColors.textSecondary },
                    ]}
                    numberOfLines={2}
                  >
                    Members ({payload.members.length})
                  </Text>
                </Pressable>
              </View>
              {tab === "groups" ? renderGroupsOnly() : renderMembersOnly()}
            </>
          )}

          <LeaderAssignTaskModal
            visible={assignMode != null}
            mode={assignMode ?? "member"}
            leaderProfileId={payload.leader.id}
            members={payload.members}
            groups={payload.groups.map((g) => ({ id: g.id, name: g.name }))}
            onClose={() => setAssignMode(null)}
            onSuccess={() => {
              setAssignMode(null);
              void load();
            }}
          />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  scrollPad: { padding: H_PAD, paddingBottom: 40, gap: 12 },
  backRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 4 },
  backText: { ...type.bodyStrong, fontSize: 16 },
  err: { ...type.body, marginTop: 8 },
  hero: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 14,
  },
  heroAvatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: "#e5e7eb" },
  heroText: { flex: 1, minWidth: 0 },
  heroTitle: { ...type.h2, fontSize: 19 },
  heroEmail: { ...type.caption, marginTop: 2 },
  reportBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: radius.pill,
    paddingVertical: 14,
  },
  reportBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  tabBar: {
    flexDirection: "row",
    borderRadius: radius.lg,
    padding: 3,
    gap: 4,
  },
  tabItem: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  tabItemActive: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  tabItemText: { ...type.caption, fontWeight: "600", textAlign: "center" },
  tabItemTextMultiline: { fontSize: 11, lineHeight: 14 },
  sectionTitle: { ...type.bodyStrong, fontSize: 15, marginTop: 8 },
  empty: { ...type.caption, marginBottom: 4 },
  block: { borderWidth: 1, borderRadius: radius.md, overflow: "hidden" },
  rowLine: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  memberName: { ...type.body },
  memberRowPressable: { flexDirection: "row", alignItems: "center", gap: 12 },
  memberRowAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#e5e7eb" },
  groupPreviewRow: { flexDirection: "row", alignItems: "center", marginTop: 10, paddingLeft: 2 },
  groupPreviewFace: { borderRadius: 18, borderWidth: 2 },
  groupPreviewFaceOverlap: { marginLeft: -10 },
  groupPreviewImage: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  groupPreviewInitialsText: { fontSize: 11, fontWeight: "700" },
  groupGridRow: { flexDirection: "row", flexWrap: "wrap" },
  groupCard: {
    position: "relative",
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: GROUP_GRID_GAP,
  },
  groupCardTitle: { ...type.bodyStrong, fontSize: 16, paddingRight: 20 },
  groupCardDesc: { ...type.caption, marginTop: 6, lineHeight: 18 },
  groupCardMetaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 },
  groupCardMetaText: { ...type.caption, fontSize: 12 },
  groupChevron: { position: "absolute", right: 12, top: 18 },
  segmentWrap: {
    flexDirection: "row",
    borderRadius: radius.lg,
    padding: 3,
    gap: 4,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: radius.md,
    alignItems: "center",
  },
  segmentBtnActive: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  segmentBtnText: { ...type.caption, fontWeight: "600", textAlign: "center" },
  assignBtnRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  smallBtn: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  smallBtnText: { ...type.caption, fontWeight: "600" },
  taskRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  taskTitle: { ...type.bodyStrong, fontSize: 15 },
  taskMeta: { ...type.caption, marginTop: 4 },
  taskDue: { ...type.caption, marginTop: 2 },
  statusPill: {
    ...type.caption,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    overflow: "hidden",
    textTransform: "capitalize" as const,
  },
  linkText: { ...type.caption, fontWeight: "600" },
  searchFieldWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    minHeight: 44,
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    paddingVertical: 8,
  },
});
