import { useMemo, type ReactNode } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { cn } from '@/components/ui/utils';

function SortableItemRow({
  id,
  disabled,
  className,
  children,
}: {
  id: string;
  disabled?: boolean;
  className?: string;
  children: (dragHandle: ReactNode) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !!disabled,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 2 : undefined,
    position: 'relative' as const,
    opacity: isDragging ? 0.9 : undefined,
  };
  const dragHandle = (
    <button
      type="button"
      className={cn(
        'touch-none shrink-0 p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 cursor-grab active:cursor-grabbing',
        disabled && 'pointer-events-none opacity-40',
      )}
      {...attributes}
      {...listeners}
      aria-label="Drag to reorder"
    >
      <GripVertical className="h-4 w-4" />
    </button>
  );
  return (
    <li ref={setNodeRef} style={style} className={className}>
      {children(dragHandle)}
    </li>
  );
}

export function SortableSettingsOrderList<T extends { id: string }>({
  items,
  disabled,
  onReorder,
  listClassName,
  itemClassName,
  renderItem,
}: {
  items: T[];
  disabled?: boolean;
  onReorder: (next: T[]) => void | Promise<void>;
  listClassName?: string;
  itemClassName?: string;
  renderItem: (item: T, index: number, dragHandle: ReactNode) => ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = useMemo(() => items.map((i) => i.id), [items]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(items, oldIndex, newIndex);
    void Promise.resolve(onReorder(next));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className={listClassName}>
          {items.map((item, index) => (
            <SortableItemRow key={item.id} id={item.id} disabled={disabled} className={itemClassName}>
              {(handle) => renderItem(item, index, handle)}
            </SortableItemRow>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
