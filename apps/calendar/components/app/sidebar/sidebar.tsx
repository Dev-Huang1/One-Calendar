'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@zntr/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@zntr/ui/select'
import { useCalendar } from '@/components/providers/calendar-context'
import { useData } from '@/components/providers/data-provider'
import { translations, type Language } from '@zntr/i18n/calendar'
import { Calendar } from '@zntr/ui/calendar'
import { Checkbox } from '@zntr/ui/checkbox'
import { Button } from '@zntr/ui/button'
import { Spinner } from '@zntr/ui/spinner'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@zntr/ui/tooltip'
import { Input } from '@zntr/ui/input'
import { Label } from '@zntr/ui/label'
import {
  ArrowDown,
  ArrowUp,
  Edit2,
  MoreHorizontal,
  Plus,
  Trash2,
} from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { cn } from '@zntr/utils'
import { toast } from 'sonner'
import { ZentraLogo } from '@/components/brand/zentra-logo'
import { api } from '@/lib/api-client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@zntr/ui/dropdown-menu'

import type { ViewType } from '@/lib/calendar-types'

interface SidebarProps {
  onCreateEvent: () => void
  onDateSelect: (date: Date) => void
  onViewChange?: (view: ViewType) => void
  language?: Language
  selectedDate?: Date
  isCollapsed?: boolean
  onToggleCollapse?: () => void
  selectedCategoryFilters?: string[]
  onCategoryFilterChange?: (categoryId: string, checked: boolean) => void
  onCollapseTransitionEnd?: () => void
}

export interface CalendarCategory {
  id: string
  name: string
  color: string
  keywords?: string[]
}

const CALENDAR_COLOR_OPTIONS = [
  { value: 'bg-blue-500', hex: '#3b82f6', labelKey: 'colorBlue' },
  { value: 'bg-green-500', hex: '#10b981', labelKey: 'colorGreen' },
  { value: 'bg-yellow-500', hex: '#f59e0b', labelKey: 'colorYellow' },
  { value: 'bg-red-500', hex: '#ef4444', labelKey: 'colorRed' },
  { value: 'bg-purple-500', hex: '#8b5cf6', labelKey: 'colorPurple' },
  { value: 'bg-pink-500', hex: '#ec4899', labelKey: 'colorPink' },
  { value: 'bg-teal-500', hex: '#14b8a6', labelKey: 'colorTeal' },
] as const

const CALENDAR_COLOR_MAP = Object.fromEntries(
  CALENDAR_COLOR_OPTIONS.map((option) => [option.value, option.hex]),
)

/**
 * The sidebar's contents without the desktop column shell. The desktop
 * `Sidebar` and the mobile drawer both render this, so the two surfaces can
 * never drift apart. All state lives here; the desktop wrapper only owns the
 * collapse transition.
 */
export function SidebarBody({
  onCreateEvent,
  onDateSelect,
  onViewChange: _onViewChange,
  language = 'zh-CN',
  selectedDate,
  selectedCategoryFilters = [],
  onCategoryFilterChange,
}: Omit<
  SidebarProps,
  'isCollapsed' | 'onToggleCollapse' | 'onCollapseTransitionEnd'
>) {
  const {
    calendars,
    events,
    setEvents,
    addCategory: addCategoryToStore,
    removeCategory: removeCategoryFromStore,
    updateCategory: updateCategoryInStore,
    moveCategory: moveCategoryInContext,
  } = useCalendar()

  const { createCategory, deleteCategory, deleteEvent } = useData()

  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryColor, setNewCategoryColor] = useState('bg-blue-500')
  const [showAddCategory, setShowAddCategory] = useState(false)
  const [creatingCategory, setCreatingCategory] = useState(false)
  const categoryCreationPending = useRef(false)
  const [localSelectedDate, setLocalSelectedDate] = useState<Date | undefined>(
    selectedDate || new Date(),
  )
  const [manageCategoriesOpen, setManageCategoriesOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [categoryToDelete, setCategoryToDelete] = useState<string | null>(null)
  const [deleteCategoryEvents, setDeleteCategoryEvents] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(
    null,
  )
  const [editingCategoryName, setEditingCategoryName] = useState('')
  const [editingCategoryColor, setEditingCategoryColor] =
    useState('bg-blue-500')
  const t = translations[language || 'zh-CN']
  const weekdayNames = t.sidebarCalendarWeekdaysShort
  const monthNames = t.sidebarCalendarMonthsLong
  const monthYearTemplate = t.sidebarCalendarMonthYearFormat

  const formatCalendarCaption = (date: Date) => {
    const month = monthNames[date.getMonth()]
    const year = new Intl.NumberFormat(language, { useGrouping: false }).format(
      date.getFullYear(),
    )
    return monthYearTemplate
      .replace('{{month}}', month)
      .replace('{{year}}', year)
  }

  const deleteText = {
    title: t.deleteConfirmationTitle,
    description: t.deleteConfirmationDescription,
    cancel: t.cancel,
    delete: t.delete,
    toastSuccess: t.categoryDeleted,
    toastDescription: t.categoryDeletedDescription,
  }
  // No `|| '…'` fallbacks: `translations` already spreads `en` beneath every
  // locale, so a key missing from a translation resolves to English rather than
  // undefined. The old Chinese fallbacks were unreachable, and being unreachable
  // they were never translated either.
  const deleteCategoryEventsLabel = t.deleteCategoryEvents
  const moveUpText = t.moveUp
  const moveDownText = t.moveDown

  useEffect(() => {
    if (selectedDate) {
      setLocalSelectedDate((prev) => {
        if (!prev || prev.getTime() !== selectedDate.getTime()) {
          return selectedDate
        }
        return prev
      })
    }
  }, [selectedDate])

  const addCategory = async () => {
    if (categoryCreationPending.current) return
    if (newCategoryName.trim()) {
      categoryCreationPending.current = true
      setCreatingCategory(true)
      const name = newCategoryName.trim()
      const color = newCategoryColor
      try {
        const res = await createCategory({ name, color })
        addCategoryToStore({
          id: res.id,
          name: res.name,
          color: res.color,
        })
        setNewCategoryName('')
        setNewCategoryColor('bg-blue-500')
        setShowAddCategory(false)
        setManageCategoriesOpen(false)
        toast(t.categoryAdded, {
          description: `${t.categoryAddedDesc} "${name}" ${t.category}`,
        })
      } catch {
        toast.error(t.createCategoryFailed)
      } finally {
        categoryCreationPending.current = false
        setCreatingCategory(false)
      }
    }
  }

  const handleDeleteClick = (id: string) => {
    setCategoryToDelete(id)
    setDeleteCategoryEvents(false)
    setDeleteDialogOpen(true)
  }

  const handleEditClick = (id: string) => {
    const category = calendars.find((calendar) => calendar.id === id)
    if (!category) return
    setEditingCategoryId(id)
    setEditingCategoryName(category.name)
    setEditingCategoryColor(category.color)
    setEditDialogOpen(true)
  }

  const saveCategoryEdit = async () => {
    if (!editingCategoryId || !editingCategoryName.trim()) return
    const id = editingCategoryId
    const name = editingCategoryName.trim()
    const color = editingCategoryColor
    try {
      await createCategory({ id, name, color })
      updateCategoryInStore(id, { name, color })
      setEditDialogOpen(false)
      setEditingCategoryId(null)
      toast(t.categoryUpdated)
    } catch {
      toast.error(t.updateCategoryFailed)
    }
  }

  const handleMoveCategory = (id: string, direction: 'up' | 'down') => {
    const currentIndex = calendars.findIndex((cal) => cal.id === id)
    if (currentIndex === -1) return
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
    if (targetIndex < 0 || targetIndex >= calendars.length) return

    const nextCalendars = [...calendars]
    const [moved] = nextCalendars.splice(currentIndex, 1)
    nextCalendars.splice(targetIndex, 0, moved)

    moveCategoryInContext(id, direction)

    nextCalendars.forEach((cal, i) => {
      api.categories
        .create({
          id: cal.id,
          name: cal.name,
          color: cal.color,
          sortOrder: i,
        })
        .catch(() => {})
    })

    toast(direction === 'up' ? moveUpText : moveDownText, {
      description: direction === 'up' ? t.categoryMovedUp : t.categoryMovedDown,
    })
  }

  const confirmDelete = async () => {
    if (categoryToDelete) {
      const id = categoryToDelete
      const shouldDeleteEvents = deleteCategoryEvents
      try {
        if (shouldDeleteEvents) {
          const eventsToDelete = events.filter(
            (event) => event.calendarId === id,
          )
          setEvents(events.filter((event) => event.calendarId !== id))
          await Promise.all(
            eventsToDelete.map((e) => deleteEvent(e.id).catch(() => {})),
          )
        } else {
          setEvents(events.filter((event) => event.calendarId !== id))
        }
        await deleteCategory(id)
        removeCategoryFromStore(id)
        setDeleteDialogOpen(false)
        setCategoryToDelete(null)
        setDeleteCategoryEvents(false)
        toast(deleteText.toastSuccess, {
          description: shouldDeleteEvents
            ? t.categoryDeletedWithEvents
            : deleteText.toastDescription,
        })
      } catch {
        toast.error('Failed to delete category')
      }
    }
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="p-4">
        <div className="mb-3 flex items-center">
          {/* Decorative: the <h1> beside it already names the brand. */}
          {/* size-7 (28px), one step over the 24px it replaced: the artwork has
              a gradient plate with padding baked in, so it reads smaller than
              the old bare glyph did at the same box. */}
          <ZentraLogo decorative className="mr-2 size-7 shrink-0" />
          <h1 className="text-lg font-semibold">Zentra Calendar</h1>
        </div>

        {/*
          The hover is overridden too, not just the base. `variant="secondary"`
          derives its hover from `--secondary` via color-mix, so setting only the
          background would make the button jump back to the stock gray on hover.
        */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className="mx-auto mb-4 h-10 w-full justify-center bg-cal-create hover:bg-[color-mix(in_oklch,var(--cal-create),var(--foreground)_5%)]"
              onClick={onCreateEvent}
              variant="secondary"
            >
              {t.createEvent}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t.createEvent}</TooltipContent>
        </Tooltip>

        <div className="mt-2">
          <Calendar
            mode="single"
            selected={localSelectedDate}
            formatters={{
              formatCaption: (date) => formatCalendarCaption(date),
              formatWeekdayName: (date) => weekdayNames[date.getDay()],
            }}
            onSelect={(date) => {
              setLocalSelectedDate(date)
              if (date) onDateSelect(date)
            }}
            className="rounded-lg border"
            captionLayout="dropdown"
          />
        </div>

        <div className="mt-8 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{t.myCalendars}</span>
          </div>
          {calendars.map((calendar) => (
            <div
              key={calendar.id}
              className="flex items-center justify-between"
            >
              <div className="flex items-center space-x-2">
                <Checkbox
                  checked={selectedCategoryFilters.includes(calendar.id)}
                  onCheckedChange={(checked) =>
                    onCategoryFilterChange?.(calendar.id, checked === true)
                  }
                  className="h-4 w-4 rounded-md border-0 data-checked:text-white"
                  style={{
                    backgroundColor:
                      CALENDAR_COLOR_MAP[calendar.color] ?? '#3b82f6',
                  }}
                />
                <span className="text-sm">{calendar.name}</span>
              </div>
              <div className="flex items-center">
                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label={`${t.more}: ${calendar.name}`}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t.more}: {calendar.name}
                    </TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => handleEditClick(calendar.id)}
                    >
                      <Edit2 className="mr-2 h-4 w-4" />
                      {t.edit}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleDeleteClick(calendar.id)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      {t.delete}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleMoveCategory(calendar.id, 'up')}
                      disabled={
                        calendars.findIndex(
                          (item) => item.id === calendar.id,
                        ) === 0
                      }
                    >
                      <ArrowUp className="mr-2 h-4 w-4" />
                      {moveUpText}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleMoveCategory(calendar.id, 'down')}
                      disabled={
                        calendars.findIndex(
                          (item) => item.id === calendar.id,
                        ) ===
                        calendars.length - 1
                      }
                    >
                      <ArrowDown className="mr-2 h-4 w-4" />
                      {moveDownText}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
          {calendars.length > 0 && (
            <div className="flex items-center space-x-2">
              <Checkbox
                checked={selectedCategoryFilters.includes('__uncategorized__')}
                onCheckedChange={(checked) =>
                  onCategoryFilterChange?.(
                    '__uncategorized__',
                    checked === true,
                  )
                }
                className="h-4 w-4 rounded-md border border-muted-foreground/60"
              />
              <span className="text-sm text-muted-foreground">
                {t.uncategorized}
              </span>
            </div>
          )}
          {showAddCategory ? (
            <div className="flex items-center space-x-2">
              <Input
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder={t.categoryName}
                className="text-sm"
              />
              <Button
                size="sm"
                onClick={addCategory}
                disabled={creatingCategory || !newCategoryName.trim()}
                aria-busy={creatingCategory}
              >
                {creatingCategory && <Spinner className="size-4" />}
                {t.addCategory}
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-muted-foreground"
              onClick={() => setManageCategoriesOpen(true)}
            >
              <Plus className="mr-2 h-4 w-4" />
              {t.addNewCalendar}
            </Button>
          )}
        </div>
      </div>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{deleteText.title}</DialogTitle>
            <DialogDescription>
              {deleteText.description}
              <div className="mt-3 flex items-center space-x-2">
                <Checkbox
                  id="delete-category-events"
                  checked={deleteCategoryEvents}
                  onCheckedChange={(checked) =>
                    setDeleteCategoryEvents(checked === true)
                  }
                />
                <Label htmlFor="delete-category-events">
                  {deleteCategoryEventsLabel}
                </Label>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
            >
              {deleteText.cancel}
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              {deleteText.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={manageCategoriesOpen}
        onOpenChange={(open) => {
          if (!categoryCreationPending.current) setManageCategoriesOpen(open)
        }}
      >
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t.createCategories}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="category-name">{t.categoryName}</Label>
              <Input
                id="category-name"
                disabled={creatingCategory}
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder={t.categoryName}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="category-color">{t.color}</Label>
              <Select
                value={newCategoryColor}
                disabled={creatingCategory}
                onValueChange={setNewCategoryColor}
              >
                <SelectTrigger id="category-color">
                  <SelectValue placeholder={t.selectColor} />
                </SelectTrigger>
                <SelectContent>
                  {CALENDAR_COLOR_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      <div className="flex items-center">
                        <div
                          className="w-4 h-4 rounded-full mr-2"
                          style={{
                            backgroundColor: CALENDAR_COLOR_MAP[option.value],
                          }}
                        />
                        {t[option.labelKey]}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="justify-end">
            <Button
              variant="outline"
              onClick={() => setManageCategoriesOpen(false)}
              disabled={creatingCategory}
            >
              {t.cancel}
            </Button>
            <Button
              onClick={addCategory}
              disabled={creatingCategory || !newCategoryName.trim()}
              aria-busy={creatingCategory}
            >
              {creatingCategory ? (
                <Spinner className="mr-2 size-4" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              {t.addCategory}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t.editCategory}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-category-name">{t.categoryName}</Label>
              <Input
                id="edit-category-name"
                value={editingCategoryName}
                onChange={(e) => setEditingCategoryName(e.target.value)}
                placeholder={t.categoryName}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-category-color">{t.color}</Label>
              <Select
                value={editingCategoryColor}
                onValueChange={setEditingCategoryColor}
              >
                <SelectTrigger id="edit-category-color">
                  <SelectValue placeholder={t.selectColor} />
                </SelectTrigger>
                <SelectContent>
                  {CALENDAR_COLOR_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      <div className="flex items-center">
                        <div
                          className="w-4 h-4 rounded-full mr-2"
                          style={{
                            backgroundColor: CALENDAR_COLOR_MAP[option.value],
                          }}
                        />
                        {t[option.labelKey]}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              {t.cancel}
            </Button>
            <Button
              onClick={saveCategoryEdit}
              disabled={!editingCategoryName.trim()}
            >
              {t.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  )
}

export default function Sidebar({
  isCollapsed = false,
  onCollapseTransitionEnd,
  ...bodyProps
}: SidebarProps) {
  return (
    <div
      style={{ '--sidebar-calendar-width': '17rem' } as CSSProperties}
      className={cn(
        // `shrink-0`: without it a narrow window flex-shrinks the sidebar
        // below 247px and the fixed-cell mini calendar overflows its edge.
        // At comfortable widths flex never shrinks it, so this is inert —
        // the main area (`min-w-0 flex-1`) is the side that gives way.
        // `max-md:hidden`: below the 768px breakpoint the drawer (see
        // MobileSidebarDrawer) is the sidebar's only surface (ADR-0018).
        'max-md:hidden shrink-0 border-r bg-background overflow-y-auto transition-all duration-300 ease-in-out',
        isCollapsed ? 'w-0 opacity-0 overflow-hidden' : 'w-[247px] opacity-100',
      )}
      onTransitionEnd={(event) => {
        if (
          event.target === event.currentTarget &&
          event.propertyName === 'width'
        ) {
          onCollapseTransitionEnd?.()
        }
      }}
    >
      <SidebarBody {...bodyProps} />
    </div>
  )
}
