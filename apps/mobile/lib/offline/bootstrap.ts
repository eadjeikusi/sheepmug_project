import type { EventItem, EventTypeRow, Family, Group, Member, TaskItem } from "@sheepmug/shared-api";
import { api } from "../api";
import { setOfflineResourceCache } from "../storage";
import { hydratePayloadWithOfflineImages } from "./imageCache";
import { patchOfflineManifest } from "./manifest";

export type OfflineBootstrapProgress = {
  step: string;
  done: number;
  total: number;
};

export async function runOfflineBootstrap(
  onProgress?: (progress: OfflineBootstrapProgress) => void
): Promise<void> {
  const total = 8;
  let done = 0;
  const tick = (step: string) => {
    done += 1;
    onProgress?.({ step, done, total });
  };

  const nowIso = new Date().toISOString();
  const pageSize = 200;

  async function fetchAllMembers(): Promise<{ members: Member[]; total_count: number }> {
    const out: Member[] = [];
    let offset = 0;
    let total = 0;
    while (true) {
      const page = await api.members.list({ offset, limit: pageSize });
      if (!Array.isArray(page.members) || page.members.length === 0) {
        total = Number(page.total_count || out.length);
        break;
      }
      out.push(...page.members);
      total = Number(page.total_count || out.length);
      if (page.members.length < pageSize || out.length >= total) break;
      offset += pageSize;
    }
    return { members: out, total_count: total || out.length };
  }

  async function fetchAllEvents(): Promise<{ events: EventItem[]; total_count: number }> {
    const out: EventItem[] = [];
    let offset = 0;
    let total = 0;
    while (true) {
      const page = await api.events.list({ offset, limit: pageSize });
      if (!Array.isArray(page.events) || page.events.length === 0) {
        total = Number(page.total_count || out.length);
        break;
      }
      out.push(...page.events);
      total = Number(page.total_count || out.length);
      if (page.events.length < pageSize || out.length >= total) break;
      offset += pageSize;
    }
    return { events: out, total_count: total || out.length };
  }

  async function fetchAllTasks(): Promise<{ tasks: TaskItem[]; total_count: number }> {
    const out: TaskItem[] = [];
    let offset = 0;
    let total = 0;
    while (true) {
      const page = await api.tasks.mine({ status: "all", offset, limit: pageSize });
      if (!Array.isArray(page.tasks) || page.tasks.length === 0) {
        total = Number(page.total_count || out.length);
        break;
      }
      out.push(...page.tasks);
      total = Number(page.total_count || out.length);
      if (page.tasks.length < pageSize || out.length >= total) break;
      offset += pageSize;
    }
    return { tasks: out, total_count: total || out.length };
  }

  async function fetchAllFamilies(): Promise<Family[]> {
    const out: Family[] = [];
    let offset = 0;
    while (true) {
      const page = await api.families.list({ offset, limit: pageSize });
      if (!Array.isArray(page) || page.length === 0) break;
      out.push(...page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }
    return out;
  }

  const membersPayload = await fetchAllMembers();
  const membersPayloadWithImages = await hydratePayloadWithOfflineImages({
    members: membersPayload.members,
    total_count: membersPayload.total_count,
  });
  await setOfflineResourceCache("members:list", membersPayloadWithImages);
  tick("Members");

  const [groups, families] = await Promise.all([
    api.groups.list({ tree: true, limit: 500 }).catch(() => [] as Group[]),
    fetchAllFamilies(),
  ]);
  await setOfflineResourceCache("families:list", await hydratePayloadWithOfflineImages({ families }));
  await setOfflineResourceCache(
    "families:list:all",
    await hydratePayloadWithOfflineImages({ families })
  );
  tick("Groups and families");

  const [eventsPayload, eventTypeRows] = await Promise.all([
    fetchAllEvents(),
    api.eventTypes.list().catch(() => [] as EventTypeRow[]),
  ]);
  await setOfflineResourceCache(
    "events:list",
    await hydratePayloadWithOfflineImages({
      events: eventsPayload.events,
      total_count: eventsPayload.total_count,
      groups,
      event_types: [...eventTypeRows].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))),
    })
  );
  tick("Events");

  const tasksPayload = await fetchAllTasks();
  await setOfflineResourceCache("tasks:list:bootstrap", {
    tasks: tasksPayload.tasks,
    total_count: tasksPayload.total_count,
  });
  await setOfflineResourceCache("tasks:list:mine:open::::::all", {
    tasks: tasksPayload.tasks.filter((t) => String(t.status || "").toLowerCase() !== "done"),
    total_count: tasksPayload.tasks.filter((t) => String(t.status || "").toLowerCase() !== "done").length,
  });
  await setOfflineResourceCache("tasks:list:mine:all::::::all", {
    tasks: tasksPayload.tasks,
    total_count: tasksPayload.total_count,
  });
  tick("Tasks");

  const memberIds = membersPayload.members.map((m) => String(m.id || "")).filter(Boolean);
  for (let i = 0; i < memberIds.length; i += 8) {
    const batch = memberIds.slice(i, i + 8);
    await Promise.all(
      batch.map(async (memberId) => {
        const [detailMember, memberGroups, memberEvents, memberTasks, memberNotes, memberImportantDates] = await Promise.all([
          api.members.get(memberId).catch(() => null),
          api.members.groups(memberId).catch(() => [] as Group[]),
          api.members.events(memberId).catch(() => []),
          api.members.tasks(memberId).catch(() => [] as TaskItem[]),
          api.members.notes.list(memberId).catch(() => []),
          api.members.importantDates.list(memberId).catch(() => []),
        ]);
        await setOfflineResourceCache(
          `member:detail:${memberId}`,
          await hydratePayloadWithOfflineImages({
            member: detailMember,
            ministries: memberGroups,
            events: memberEvents,
            tasks: memberTasks,
            notes: memberNotes,
            importantDates: memberImportantDates,
            statusOpts: [] as never[],
            fieldDefs: [] as never[],
          })
        );
      })
    );
  }
  tick("Member profiles");

  for (const family of families) {
    const familyId = String(family.id || "").trim();
    if (!familyId) continue;
    const members = await api.families.members(familyId).catch(() => [] as Member[]);
    await setOfflineResourceCache(
      `family:members:${familyId}`,
      await hydratePayloadWithOfflineImages({ members })
    );
  }
  tick("Family members");

  for (const group of groups) {
    const groupId = String(group.id || "").trim();
    if (!groupId) continue;
    const [detail, subgroups, memberRows, eventRows, typeRows, taskRows, requestRows] = await Promise.all([
      api.groups.detail(groupId).catch(() => null),
      api.groups.list({ parent_group_id: groupId, limit: 100 }).catch(() => [] as Group[]),
      api.groups.members(groupId).catch(() => []),
      api.groups.events(groupId).catch(() => []),
      Promise.resolve(eventTypeRows),
      api.groups.tasks(groupId).catch(() => [] as TaskItem[]),
      api.groups.requests(groupId).catch(() => []),
    ]);
    await setOfflineResourceCache(
      `ministry:detail:${groupId}`,
      await hydratePayloadWithOfflineImages({
        group: detail,
        subgroups,
        members: memberRows,
        events: eventRows,
        eventTypeRows: typeRows,
        tasks: taskRows,
        requests: requestRows,
      })
    );
  }
  tick("Ministry details");

  await setOfflineResourceCache(
    "search:seed",
    await hydratePayloadWithOfflineImages({
      members: membersPayload.members,
      groups,
    })
  );
  tick("Search data");

  await patchOfflineManifest({
    last_bootstrap_at: nowIso,
    last_delta_at: nowIso,
    bootstrapped_entities: [
      "members:list",
      "member:detail:*",
      "events:list",
      "tasks:list:bootstrap",
      "families:list",
      "family:members:*",
      "ministry:detail:*",
      "search:seed",
    ],
    cursors: {
      members: nowIso,
      events: nowIso,
      tasks: nowIso,
      groups: nowIso,
      families: nowIso,
    },
  });
}
