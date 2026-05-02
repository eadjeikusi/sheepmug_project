import { Skeleton } from '@/components/ui/skeleton';

export function MemberTableBodySkeleton({
  showDeletedMembers,
  rows = 8,
}: {
  showDeletedMembers: boolean;
  rows?: number;
}) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <tr key={i} className="group/skrow border-b border-gray-100">
          <td className="w-10 px-2 py-3">
            <div className="flex justify-center opacity-0 transition-opacity duration-150 group-hover/skrow:opacity-100">
              <Skeleton className="h-[15px] w-[15px] rounded-[3px]" />
            </div>
          </td>
          <td className="w-14 px-2 py-4">
            <Skeleton className="mx-auto h-10 w-10 rounded-full" />
          </td>
          <td className="min-w-0 max-w-[200px] px-4 py-4">
            <Skeleton className="h-4 w-40 max-w-full" />
          </td>
          <td className="min-w-0 px-4 py-4">
            <Skeleton className="h-4 w-28 max-w-full" />
          </td>
          <td className="min-w-0 w-[1%] max-w-[120px] px-4 py-4 sm:max-w-[140px]">
            <Skeleton className="h-4 w-full max-w-[7rem]" />
          </td>
          <td className="min-w-0 max-w-[200px] px-4 py-4">
            <Skeleton className="h-4 w-32 max-w-[10rem]" />
          </td>
          {!showDeletedMembers ? (
            <>
              <td className="px-4 py-4">
                <Skeleton className="h-4 w-24" />
              </td>
              <td className="px-4 py-4">
                <Skeleton className="h-6 w-20 rounded-full" />
              </td>
              <td className="w-14 px-2 py-4 text-center">
                <Skeleton className="mx-auto h-8 w-8 rounded-lg" />
              </td>
            </>
          ) : null}
        </tr>
      ))}
    </>
  );
}

export function EventsTableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="overflow-x-auto touch-pan-x overscroll-x-contain rounded-xl border border-gray-100">
      <table className="w-full min-w-[640px] table-fixed">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50/90">
            <th className="w-[26%] min-w-0 px-3 py-3 text-left text-xs font-semibold text-gray-500 md:px-4 md:py-4">
              Event
            </th>
            <th className="w-[14%] min-w-0 px-3 py-3 text-left text-xs font-semibold text-gray-500 md:px-4 md:py-4">
              Type
            </th>
            <th className="w-[22%] min-w-0 px-3 py-3 text-left text-xs font-semibold text-gray-500 md:px-4 md:py-4">
              When
            </th>
            <th className="w-[18%] min-w-0 px-3 py-3 text-left text-xs font-semibold text-gray-500 md:px-4 md:py-4">
              Location
            </th>
            <th className="w-[12%] min-w-0 px-3 py-3 text-left text-xs font-semibold text-gray-500 md:px-4 md:py-4">
              Ministry
            </th>
            <th className="w-[8%] min-w-0 px-3 py-3 text-right text-xs font-semibold text-gray-500 md:px-4 md:py-4">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, i) => (
            <tr key={i} className="border-b border-gray-100">
              <td className="min-w-0 px-3 py-3 align-middle md:px-4 md:py-4">
                <div className="flex min-w-0 items-center gap-2 md:gap-3">
                  <Skeleton className="h-9 w-9 shrink-0 rounded-full md:h-10 md:w-10" />
                  <Skeleton className="h-4 min-w-0 flex-1" />
                </div>
              </td>
              <td className="min-w-0 px-3 py-3 align-middle md:px-4 md:py-4">
                <Skeleton className="h-6 w-20 rounded-full" />
              </td>
              <td className="min-w-0 px-3 py-3 align-middle md:px-4 md:py-4">
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-full max-w-[10rem]" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </td>
              <td className="min-w-0 px-3 py-3 align-middle md:px-4 md:py-4">
                <Skeleton className="h-4 w-full max-w-[8rem]" />
              </td>
              <td className="min-w-0 px-3 py-3 align-middle md:px-4 md:py-4">
                <Skeleton className="h-4 w-full max-w-[6rem]" />
              </td>
              <td className="min-w-0 px-3 py-3 align-middle text-right md:px-4 md:py-4">
                <div className="flex justify-end gap-1">
                  <Skeleton className="h-8 w-8 rounded-lg" />
                  <Skeleton className="h-8 w-8 rounded-lg" />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MinistryGridSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: cards }, (_, i) => (
        <div
          key={i}
          className="flex min-h-[140px] flex-col rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
        >
          <Skeleton className="h-5 w-[60%] max-w-[14rem]" />
          <Skeleton className="mt-3 h-4 w-full max-w-[18rem]" />
          <Skeleton className="mt-2 h-4 w-[75%] max-w-[12rem]" />
          <div className="mt-auto flex items-center justify-between pt-4">
            <div className="flex -space-x-2">
              <Skeleton className="h-8 w-8 rounded-full ring-2 ring-white" />
              <Skeleton className="h-8 w-8 rounded-full ring-2 ring-white" />
              <Skeleton className="h-8 w-8 rounded-full ring-2 ring-white" />
            </div>
            <Skeleton className="h-5 w-5 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TaskListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <ul className="m-0 list-none space-y-3 p-0" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <Skeleton className="h-4 w-[66%] max-w-md" />
          <Skeleton className="mt-2 h-3 w-48 max-w-full" />
          <div className="mt-3 flex flex-wrap gap-2">
            <Skeleton className="h-5 w-24 rounded-md" />
            <Skeleton className="h-5 w-20 rounded-md" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function MessagesTableBodySkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <tr key={i} className="border-b border-gray-100">
          <td className="px-6 py-4">
            <Skeleton className="h-4 w-48 max-w-full" />
            <Skeleton className="mt-2 h-3 w-full max-w-lg" />
          </td>
          <td className="px-6 py-4">
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-8 rounded-lg" />
              <div className="min-w-0 flex-1 space-y-1">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
          </td>
          <td className="px-6 py-4">
            <Skeleton className="h-4 w-24" />
          </td>
          <td className="px-6 py-4">
            <Skeleton className="h-6 w-16 rounded-full" />
          </td>
          <td className="px-6 py-4">
            <Skeleton className="h-4 w-14" />
          </td>
        </tr>
      ))}
    </>
  );
}

export function DashboardListRowSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-gray-100 p-2">
      <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-40 max-w-full" />
        <Skeleton className="h-3 w-52 max-w-full" />
      </div>
    </div>
  );
}

export function DashboardStatIconStackSkeleton() {
  return (
    <div className="flex shrink-0 items-center">
      <Skeleton className="h-8 w-8 rounded-full ring-2 ring-white" />
      <Skeleton className="-ml-2 h-8 w-8 rounded-full ring-2 ring-white" />
      <Skeleton className="-ml-2 h-8 w-8 rounded-full ring-2 ring-white" />
    </div>
  );
}

export function ImportantDatesListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="divide-y divide-gray-100">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex w-full items-center justify-between gap-3 p-4">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-40 max-w-full" />
            <Skeleton className="h-3.5 w-56 max-w-full" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-6 w-12 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  );
}
