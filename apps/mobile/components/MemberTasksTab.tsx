import type { Dispatch, SetStateAction } from "react";
import type { TaskItem } from "@sheepmug/shared-api";
import { TaskAssignmentList } from "./TaskAssignmentList";

type Props = {
  tasks: TaskItem[];
  setTasks: Dispatch<SetStateAction<TaskItem[]>>;
  /** Initial member screen load. */
  pageLoading: boolean;
  memberId: string;
  /** Shown in add-task flow (same modal pattern as main Tasks → Member task). */
  primaryMemberDisplayName?: string;
};

export function MemberTasksTab(props: Props) {
  return <TaskAssignmentList variant="member" {...props} />;
}
