import type { EventItem, EventTypeRow, Family, Group, Member, TaskItem } from "@sheepmug/shared-api";
import { api } from "../api";
import { setOfflineResourceCache } from "../storage";

export type OfflineBootstrapProgress = {
  step: string;
  done: number;
  total: number;
};

export async function runOfflineBootstrap(
  onProgress?: (progress: OfflineBootstrapProgress) => void
): Promise<void> {
  const total = 5;
  let done = 0;
  const tick = (step: string) => {
    done += 1;
    onProgress?.({ step, done, total });
  };

  const membersPayload = await api.members.list({ limit: 100 });
  await setOfflineResourceCache("members:list", {
    members: membersPayload.members,
    total_count: membersPayload.total_count,
  });
  await setOfflineResourceCache("search:seed", {
    members: membersPayload.members,
    groups: [] as Group[],
  });
  tick("Members");

  const [groups, families] = await Promise.all([
    api.groups.list({ tree: true, limit: 100 }).catch(() => [] as Group[]),
    api.families.list({ limit: 100 }).catch(() => [] as Family[]),
  ]);
  await setOfflineResourceCache("families:list", { families });
  tick("Groups and families");

  const [eventsPayload, eventTypeRows] = await Promise.all([
    api.events.list({ offset: 0, limit: 100 }).catch(() => ({ events: [] as EventItem[], total_count: 0 })),
    api.eventTypes.list().catch(() => [] as EventTypeRow[]),
  ]);
  await setOfflineResourceCache("events:list", {
    events: eventsPayload.events,
    total_count: eventsPayload.total_count,
    groups,
    event_types: [...eventTypeRows].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))),
  });
  tick("Events");

  const tasksPayload = await api.tasks.mine({ status: "all", limit: 100 }).catch(() => ({
    tasks: [] as TaskItem[],
    total_count: 0,
  }));
  await setOfflineResourceCache("tasks:list:bootstrap", {
    tasks: tasksPayload.tasks,
    total_count: tasksPayload.total_count,
  });
  tick("Tasks");

  await setOfflineResourceCache("search:seed", {
    members: membersPayload.members,
    groups,
  });
  tick("Search data");
}
