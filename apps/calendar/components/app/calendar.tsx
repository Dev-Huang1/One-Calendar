'use client'

import { getEventAccentColor } from '@/lib/event-colors'
import { useNotifications } from '@/hooks/use-notifications'
import { anchorRectForClick } from '@/hooks/use-anchored-popover'
import { defaultCreateRange } from '@/components/app/views/selection-range'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
} from '@zntr/ui/select'
import {
  ChevronLeft,
  ChevronRight,
  Search,
  Sparkles,
  PanelLeft,
  CircleHelp,
  ShieldCheck,
  MessageSquare,
  FileText,
  ScrollText,
  House,
  Menu,
  CalendarCheck,
  ArrowLeft,
  Plus,
} from 'lucide-react'
import dynamic from 'next/dynamic'
import UserProfileButton from '@/components/app/profile/user-profile-button'
import type { AccountSection } from '@zntr/auth/account'
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useCalendar } from '@/components/providers/calendar-context'
import {
  useSettings,
  useEvents,
  useBookmarks,
} from '@/components/providers/data-provider'
import { getValidTimezone } from '@/lib/timezone'
import { uuid } from '@/lib/uuid'
import RightSidebar from '@/components/app/sidebar/right-sidebar'
import { addDays, addYears, subDays, subYears } from 'date-fns'
import EventPreview, {
  type EventInvite,
} from '@/components/app/event/event-preview'
import EventEditor from '@/components/app/event/event-editor'
import Sidebar from '@/components/app/sidebar/sidebar'
import MobileSidebarDrawer from '@/components/app/sidebar/mobile-sidebar-drawer'
import { translations, useLanguage } from '@zntr/i18n/calendar'
import { THEME_OPTIONS, type ThemeOption } from '@/lib/theme'
import { useTheme } from 'next-themes'
import { Button } from '@zntr/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@zntr/ui/tooltip'
import { APP_CONFIG } from '@/lib/config'
import {
  CalendarViewType,
  FirstDayOfWeek,
  Language,
  TimeFormat,
  ViewConfig,
  ViewType,
  isCalendarView,
  type CalendarViewTypeValue,
  type FirstDayOfWeekValue,
  type TimeFormatValue,
} from '@/lib/calendar-types'
import { toast } from 'sonner'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@zntr/ui/input-group'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@zntr/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@zntr/ui/alert-dialog'
import { RadioGroup, RadioGroupItem } from '@zntr/ui/radio-group'
import { Label } from '@zntr/ui/label'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@zntr/ui/dialog'

import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth/client'

const loadDayView = () => import('@/components/app/views/day-view')
const loadWeekView = () => import('@/components/app/views/week-view')
const loadMonthView = () => import('@/components/app/views/month-view')
const loadYearView = () => import('@/components/app/views/year-view')
const loadAnalyticsView = () =>
  import('@/components/app/analytics/analytics-view')
const loadSettingsDialog = () =>
  import('@/components/app/settings/settings-dialog')
const loadAiCommandPalette = () =>
  import('@/components/app/ai/ai-command-palette').then(
    (m) => m.AiCommandPalette,
  )
import {
  defaultExpansionWindow,
  optimisticFollowingSplit,
} from '@/lib/recurrence/engine'

const DayView = dynamic(loadDayView)
const WeekView = dynamic(loadWeekView)
const MonthView = dynamic(loadMonthView)
const YearView = dynamic(loadYearView)
const AnalyticsView = dynamic(loadAnalyticsView)
const SettingsDialog = dynamic(loadSettingsDialog)
// ssr: false — the palette carries the chat transport and is pure client
// interaction; there is nothing meaningful to render on the server.
const AiCommandPalette = dynamic(loadAiCommandPalette, { ssr: false })

// Build-time presence flag (next.config.ts): deployments without a Groq
// key get no AI affordances at all — no trigger, no shortcut — instead of
// an entry point that 503s on use.
const AI_ENABLED = process.env.NEXT_PUBLIC_AI_ENABLED === '1'

export interface CalendarEvent {
  id: string
  title: string
  startDate: Date
  endDate: Date
  isAllDay: boolean
  rrule?: string | null
  exdate?: string[] | null
  seriesId?: string | null
  recurrenceId?: string | null
  /** True when this occurrence has its own stored single-instance edit. */
  isOverride?: boolean
  isFirstInstance?: boolean
  location?: string
  participants: string[]
  /**
   * Minutes before the start to remind, or null for no reminder.
   * Zero is a real value — "at the event's start" — not an absent one.
   */
  notification: number | null
  /** Also deliver the reminder by email. See ADR-0010. */
  emailReminder?: boolean
  description?: string
  color: string
  calendarId: string
  viewOnly?: boolean
  organizer?: {
    name: string
    email: string
    image: string | null
  } | null
  invites?: Array<{
    id: string
    email: string
    status: 'pending' | 'accepted' | 'maybe' | 'declined'
    inviteToken: string
    emailSent: boolean
    addedToCalendar: boolean
    userName: string | null
    userImage: string | null
  }>
  /**
   * The event's Meeting, carried on the event rather than fetched per-surface.
   * Undefined means "not known here" (a locally constructed event); null means
   * the server said there is none. Mirrors the declaration in
   * providers/calendar-context.tsx, which this interface duplicates.
   */
  meeting?: { id: string; url: string } | null
}

interface CalendarProps {
  className?: string
}

export default function Calendar({ className, ..._props }: CalendarProps) {
  const router = useRouter()
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [isSidebarTransitioning, setIsSidebarTransitioning] = useState(false)
  // Mobile Form only (ADR-0019): the left drawer holding the sidebar content.
  // Opened by the hamburger button, which exists only below the md breakpoint.
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)
  // Mobile Form only: search lives behind a magnifier icon and opens as a
  // full-screen overlay (the universal mobile overlay rule, ADR-0019).
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  // Deferred mount: the palette chunk is only fetched the first time the
  // user opens it, and stays mounted afterwards to keep its conversation.
  const [aiPaletteOpen, setAiPaletteOpen] = useState(false)
  const [aiPaletteMounted, setAiPaletteMounted] = useState(false)
  const openAiPalette = useCallback(() => {
    setAiPaletteMounted(true)
    setAiPaletteOpen(true)
  }, [])
  const [date, setDate] = useState(new Date())
  const [view, setView] = useState<ViewType>('week')
  const [eventEditorOpen, setEventEditorOpen] = useState(false)
  const [editorAnchorEl, setEditorAnchorEl] = useState<HTMLElement | null>(null)
  const [editorAnchorRect, setEditorAnchorRect] = useState<DOMRect | null>(null)
  // The editor is replacing the preview at the same anchor, so its entrance
  // animation is suppressed — the swap should read as one panel changing
  // content, not a flash of two popovers.
  const [editorReplacesPreview, setEditorReplacesPreview] = useState(false)
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null)
  const { events, setEvents, calendars } = useCalendar()
  const [searchTerm, setSearchTerm] = useState('')
  const searchInputRef = useRef<HTMLDivElement>(null)
  const [isSearchFocused, setIsSearchFocused] = useState(false)
  const [selectedCategoryFilters, setSelectedCategoryFilters] = useState<
    string[]
  >([])
  const calendarRef = useRef<HTMLDivElement>(null)
  const [language, setLanguage] = useLanguage()
  const t = translations[language]
  const { settings, updateSettings } = useSettings()
  const { setTheme } = useTheme()
  const { upsertEvent, deleteEvent, refreshEvents } = useEvents()
  const { bookmarks, createBookmark, deleteBookmarkByEvent } = useBookmarks()
  const [firstDayOfWeek, setFirstDayOfWeek] = useState<FirstDayOfWeekValue>(
    (settings.firstDayOfWeek as FirstDayOfWeekValue) ?? 0,
  )

  const handleFirstDayOfWeekChange = (day: FirstDayOfWeek) => {
    setFirstDayOfWeek(day.value)
    updateSettings({ firstDayOfWeek: day.value })
  }
  const [timezone, setTimezone] = useState<string>(
    getValidTimezone(
      settings.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    ),
  )
  const handleTimezoneChange = (tz: string) => {
    const validTz = getValidTimezone(tz)
    setTimezone(validTz)
    updateSettings({ timezone: validTz })
  }
  const [previewEvent, setPreviewEvent] = useState<CalendarEvent | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewAnchorRect, setPreviewAnchorRect] = useState<DOMRect | null>(
    null,
  )
  const [previewAnchorEl, setPreviewAnchorEl] = useState<HTMLElement | null>(
    null,
  )
  const [focusUserProfileSection, setFocusUserProfileSection] =
    useState<AccountSection | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sidebarDate, setSidebarDate] = useState<Date>(new Date())
  const [pendingDeleteEvent, setPendingDeleteEvent] =
    useState<CalendarEvent | null>(null)
  const [pendingDeleteApplyTo, setPendingDeleteApplyTo] = useState<
    'single' | 'following' | 'all' | undefined
  >(undefined)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [pendingRangeMove, setPendingRangeMove] = useState<{
    event: CalendarEvent
    startDate: Date
    endDate: Date
  } | null>(null)
  const [rangeMoveOpen, setRangeMoveOpen] = useState(false)
  const [rangeMoveScope, setRangeMoveScope] = useState<
    'single' | 'following' | 'all'
  >('single')
  // "All events" is only offered on the series' first occurrence (or a raw
  // master row, which IS the series root). Mirrors the save-scope gating in
  // event-editor.tsx.
  const rangeMoveCanAll =
    !!pendingRangeMove &&
    ((!!pendingRangeMove.event.rrule &&
      !pendingRangeMove.event.seriesId &&
      !pendingRangeMove.event.recurrenceId) ||
      pendingRangeMove.event.isFirstInstance === true)
  const [deleteScope, setDeleteScope] = useState<
    'single' | 'following' | 'all'
  >('single')
  const [pendingRemoveInvite, setPendingRemoveInvite] =
    useState<CalendarEvent | null>(null)
  const [removeInviteConfirmOpen, setRemoveInviteConfirmOpen] = useState(false)
  const [pendingInvites, setPendingInvites] = useState<{
    eventId: string
    emails: string[]
    /** Which occurrences the participants apply to, for a recurring event. */
    scope?: 'single' | 'following' | 'all'
  } | null>(null)
  const { data: session } = authClient.useSession()
  const isSignedIn = Boolean(session?.user)

  const updateEvent = (updatedEvent: CalendarEvent) => {
    setEvents((prevEvents) =>
      prevEvents.map((event) =>
        event.id === updatedEvent.id ? updatedEvent : event,
      ),
    )
  }

  const handleEventDrop = (
    event: CalendarEvent,
    newStartDate: Date,
    newEndDate: Date,
  ) => {
    if (event.viewOnly) return
    setPreviewOpen(false)
    setPreviewAnchorRect(null)
    setPreviewAnchorEl(null)
    if (event.rrule || event.seriesId || event.recurrenceId) {
      setPendingRangeMove({
        event,
        startDate: newStartDate,
        endDate: newEndDate,
      })
      setRangeMoveScope('single')
      setRangeMoveOpen(true)
      return
    }
    commitRangeMove(event, newStartDate, newEndDate)
  }

  const commitRangeMove = (
    event: CalendarEvent,
    newStartDate: Date,
    newEndDate: Date,
    scope?: 'single' | 'following' | 'all',
  ) => {
    const updatedEvent = {
      ...event,
      startDate: newStartDate,
      endDate: newEndDate,
    }
    // Same discipline as handleEventUpdate: decide the split ids before
    // touching the store, keep the zustand updater pure, and never let a
    // synchronous planning failure kill the save.
    let splitId: string | null = null
    let oldSeriesId: string | null = null
    let optimisticEvents: CalendarEvent[] | null = null
    if (scope === 'following') {
      try {
        splitId = uuid()
        oldSeriesId =
          updatedEvent.seriesId ?? (updatedEvent.rrule ? updatedEvent.id : null)
        if (updatedEvent.seriesId && updatedEvent.recurrenceId) {
          const window = defaultExpansionWindow()
          const nextMaster = {
            ...updatedEvent,
            id: splitId,
            seriesId: null,
            recurrenceId: null,
            rrule: updatedEvent.rrule ?? null,
          }
          const target = events.find((item) => item.id === updatedEvent.id)
          if (target) {
            optimisticEvents = optimisticFollowingSplit(
              events,
              target,
              nextMaster,
              window.windowStart,
              window.windowEnd,
              undefined,
              timezone,
            )
          }
        }
      } catch {
        splitId = null
        optimisticEvents = null
      }
    }
    if (optimisticEvents) {
      setEvents(optimisticEvents)
    } else {
      updateEvent(updatedEvent)
    }
    upsertEvent(
      {
        id: updatedEvent.id,
        title: updatedEvent.title,
        startDate: updatedEvent.startDate.toISOString(),
        endDate: updatedEvent.endDate.toISOString(),
        isAllDay: updatedEvent.isAllDay,
        location: updatedEvent.location || null,
        participants: updatedEvent.participants?.length
          ? updatedEvent.participants.map((p: any) =>
              typeof p === 'string' ? { name: p } : p,
            )
          : null,
        // `?? null`, not `|| null`: 0 is a real reminder ("at the event's
        // start") and must survive a drag-move.
        notificationMinutes: updatedEvent.notification ?? null,
        emailReminder: updatedEvent.emailReminder === true,
        color: updatedEvent.color || null,
        categoryId: updatedEvent.calendarId || null,
        apply_to: scope,
        split_id: splitId ?? undefined,
        timezone,
      },
      oldSeriesId ? new Set([oldSeriesId]) : undefined,
    ).catch(() => {})
  }

  const confirmRangeMove = (requested: 'single' | 'following' | 'all') => {
    if (!pendingRangeMove) return
    // Belt guard: never commit a scope that isn't offered.
    const scope = requested === 'all' && !rangeMoveCanAll ? 'single' : requested
    commitRangeMove(
      pendingRangeMove.event,
      pendingRangeMove.startDate,
      pendingRangeMove.endDate,
      scope,
    )
    setRangeMoveOpen(false)
    setPendingRangeMove(null)
  }

  const [quickCreateStartTime, setQuickCreateStartTime] = useState<Date | null>(
    null,
  )
  const [quickCreateEndTime, setQuickCreateEndTime] = useState<Date | null>(
    null,
  )
  /**
   * Live draft range coming back from the editor's date/time fields while
   * creating. Takes precedence over the committed quick-create range so the
   * selection box follows the user's edits in real time (CORE-191).
   */
  const [createDraftRange, setCreateDraftRange] = useState<{
    start: Date
    end: Date
  } | null>(null)

  const [defaultView, setDefaultView] = useState<CalendarViewTypeValue>(
    (settings.defaultView as CalendarViewTypeValue) ?? 'week',
  )
  const handleDefaultViewChange = (view: CalendarViewTypeValue) => {
    setDefaultView(view)
    updateSettings({ defaultView: view })
  }
  const [enableShortcuts, setEnableShortcuts] = useState<boolean>(
    settings.enableShortcuts ?? true,
  )
  const handleEnableShortcutsChange = (enabled: boolean) => {
    setEnableShortcuts(enabled)
    updateSettings({ enableShortcuts: enabled })
  }
  const [timeFormat, setTimeFormat] = useState<TimeFormatValue>(
    (settings.timeFormat as TimeFormatValue) ?? '24h',
  )
  const handleTimeFormatChange = (format: TimeFormatValue) => {
    setTimeFormat(format)
    updateSettings({ timeFormat: format })
  }
  const firstDayOfWeekObj = useMemo(
    () => FirstDayOfWeek.create(firstDayOfWeek),
    [firstDayOfWeek],
  )
  const timeFormatObj = useMemo(
    () => TimeFormat.create(timeFormat),
    [timeFormat],
  )
  const languageObj = useMemo(() => Language.create(language), [language])

  const viewConfig = useMemo(
    () =>
      ViewConfig.create({
        firstDayOfWeek: firstDayOfWeekObj,
        timezone,
        timeFormat: timeFormatObj,
        language: languageObj,
        date,
        viewType: isCalendarView(view)
          ? CalendarViewType.create(view as CalendarViewTypeValue)
          : undefined,
      }),
    [firstDayOfWeekObj, timezone, timeFormatObj, languageObj, date, view],
  )

  useEffect(() => {
    setView(isCalendarView(defaultView) ? defaultView : 'week')
  }, [defaultView])

  const settingsInitializedRef = useRef(false)

  useEffect(() => {
    if (settingsInitializedRef.current) return
    if (Object.keys(settings).length === 0) return
    settingsInitializedRef.current = true

    const settingsSync: Array<() => void> = [
      () => {
        if (settings.firstDayOfWeek !== undefined)
          setFirstDayOfWeek(settings.firstDayOfWeek as FirstDayOfWeekValue)
      },
      () => {
        if (settings.timezone) setTimezone(getValidTimezone(settings.timezone))
      },
      () => {
        if (settings.defaultView && isCalendarView(settings.defaultView)) {
          setDefaultView(settings.defaultView as CalendarViewTypeValue)
          setView(settings.defaultView as ViewType)
        }
      },
      () => {
        if (settings.enableShortcuts !== undefined)
          setEnableShortcuts(settings.enableShortcuts)
      },
      () => {
        if (settings.timeFormat)
          setTimeFormat(settings.timeFormat as TimeFormatValue)
      },
      () => {
        if (settings.language)
          setLanguage(settings.language as Parameters<typeof setLanguage>[0])
      },
      () => {
        if (
          settings.theme &&
          THEME_OPTIONS.includes(settings.theme as ThemeOption)
        ) {
          setTheme(settings.theme as ThemeOption)
        }
      },
    ]
    settingsSync.forEach((fn) => fn())
  }, [settings])

  useEffect(() => {
    const handleTimezoneEvent = (event: Event) => {
      const { timezone } = (event as CustomEvent<{ timezone?: string }>).detail
      if (timezone) handleTimezoneChange(timezone)
    }
    const handleFirstDayEvent = (event: Event) => {
      const { firstDay } = (event as CustomEvent<{ firstDay?: number }>).detail
      if (firstDay !== undefined) {
        setFirstDayOfWeek(firstDay as FirstDayOfWeekValue)
        updateSettings({ firstDayOfWeek: firstDay }).catch(() => {})
      }
    }
    const handleViewEvent = (event: Event) => {
      const { view } = (event as CustomEvent<{ view?: string }>).detail
      if (view && isCalendarView(view)) {
        setDefaultView(view as CalendarViewTypeValue)
        setView(view as ViewType)
        updateSettings({ defaultView: view }).catch(() => {})
      }
    }
    const handleTimeFormatEvent = (event: Event) => {
      const { format } = (event as CustomEvent<{ format?: string }>).detail
      if (format === '24h' || format === '12h') {
        setTimeFormat(format)
        updateSettings({ timeFormat: format }).catch(() => {})
      }
    }
    window.addEventListener('timezonechange', handleTimezoneEvent)
    window.addEventListener('firstdaychange', handleFirstDayEvent)
    window.addEventListener('viewchange', handleViewEvent)
    window.addEventListener('timeformatchange', handleTimeFormatEvent)
    return () => {
      window.removeEventListener('timezonechange', handleTimezoneEvent)
      window.removeEventListener('firstdaychange', handleFirstDayEvent)
      window.removeEventListener('viewchange', handleViewEvent)
      window.removeEventListener('timeformatchange', handleTimeFormatEvent)
    }
  }, [])

  useEffect(() => {
    const prefetch = () => {
      void loadDayView()
      void loadWeekView()
      void loadMonthView()
      void loadYearView()
      void loadAnalyticsView()
      void loadSettingsDialog()
    }

    if (typeof window === 'undefined') return

    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(prefetch)
      return () => window.cancelIdleCallback(id)
    }

    const timeoutId = globalThis.setTimeout(prefetch, 800)
    return () => globalThis.clearTimeout(timeoutId)
  }, [])

  // Cmd/Ctrl+K opens the AI palette from anywhere, including inside inputs —
  // that is the universal command-palette convention, so it lives outside
  // the plain-key shortcut handler below (which correctly defers to inputs).
  useEffect(() => {
    if (!AI_ENABLED) return
    const handlePaletteKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setAiPaletteMounted(true)
        setAiPaletteOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handlePaletteKey)
    return () => window.removeEventListener('keydown', handlePaletteKey)
  }, [])

  useEffect(() => {
    if (!enableShortcuts) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement ||
        document.activeElement?.getAttribute('contenteditable') === 'true'
      ) {
        return
      }

      switch (e.key) {
        case 'n':
        case 'N': {
          e.preventDefault()
          // An open dialog/sheet would sit on top of the editor this
          // shortcut opens (and its overlay would swallow the clicks), so
          // dismiss any open Radix layer first. A synthetic Escape reuses
          // each surface's own close path (onOpenChange, focus restore)
          // instead of this component reaching into their open states.
          const openOverlay = document.querySelector(
            '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
          )
          if (openOverlay) {
            document.dispatchEvent(
              new KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true,
              }),
            )
          }
          setSelectedEvent(null)
          // Shared quick-create path: leaves non-calendar views (analytics,
          // settings) for the user's default view and navigates to the
          // period containing the draft.
          handleTimeRangeSelect(new Date())
          break
        }
        case '/': {
          e.preventDefault()

          const searchInput = document.querySelector(
            'input[placeholder="' + t.searchEvents + '"]',
          ) as HTMLInputElement
          if (searchInput) {
            searchInput.focus()
          }
          break
        }
        case 't':
        case 'T':
          e.preventDefault()
          handleTodayClick()
          break
        case '1':
          e.preventDefault()
          setView('day')
          break
        case '2':
          e.preventDefault()
          setView('week')
          break
        case '3':
          e.preventDefault()
          setView('month')
          break
        case '4':
          e.preventDefault()
          setView('year')
          break
        case '5':
          e.preventDefault()
          setView('four-day')
          break
        case 'ArrowRight':
          e.preventDefault()
          handleNext()
          break
        case 'ArrowLeft':
          e.preventDefault()
          handlePrevious()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [enableShortcuts, t.searchEvents, view])

  const toggleSidebar = () => {
    setIsSidebarTransitioning(true)
    setIsSidebarCollapsed((prev) => !prev)
  }

  const handleDateSelect = (date: Date) => {
    setDate(date)
    setSidebarDate(date)
  }

  const handleViewChange = (newView: ViewType) => {
    setView(newView)
  }

  const handleNavigateToView = (target: 'analytics' | 'settings') => {
    if (target === 'settings') {
      setSettingsOpen(true)
      return
    }
    setView(target)
  }

  const handleTodayClick = () => {
    const today = new Date()
    setDate(today)
    setSidebarDate(today)
  }

  const handlePrevious = () => {
    setDate((prevDate) => {
      if (view === 'day') return subDays(prevDate, 1)
      if (view === 'week') return subDays(prevDate, 7)
      if (view === 'four-day') return subDays(prevDate, 4)
      if (view === 'year') return subYears(prevDate, 1)
      return subDays(prevDate, 30)
    })
  }

  const handleNext = () => {
    setDate((prevDate) => {
      if (view === 'day') return addDays(prevDate, 1)
      if (view === 'week') return addDays(prevDate, 7)
      if (view === 'four-day') return addDays(prevDate, 4)
      if (view === 'year') return addYears(prevDate, 1)
      return addDays(prevDate, 30)
    })
  }

  const formatDateDisplay = (date: Date) => {
    if (view === 'year') {
      return date.getFullYear().toString()
    }

    if (view === 'four-day') {
      const startDate = new Date(date)
      const endDate = addDays(startDate, 3)
      const options: Intl.DateTimeFormatOptions = {
        month: 'short',
        day: 'numeric',
      }
      return `${startDate.toLocaleDateString(language, options)} - ${endDate.toLocaleDateString(language, options)}`
    }

    if (language === 'en') {
      const options: Intl.DateTimeFormatOptions = {
        year: 'numeric',
        month: 'long',
      }
      return date.toLocaleDateString(language, options)
    } else {
      const options: Intl.DateTimeFormatOptions = {
        year: 'numeric',
        month: 'long',
      }
      return date.toLocaleDateString(language, options)
    }
  }

  const handleEventClick = (
    event: CalendarEvent,
    anchorEl?: HTMLElement | null,
    clientX?: number,
    clientY?: number,
  ) => {
    if (previewOpen && previewEvent?.id === event.id) {
      setPreviewOpen(false)
      setPreviewAnchorRect(null)
      setPreviewAnchorEl(null)
      return
    }
    setPreviewEvent(event)
    setPreviewAnchorEl(anchorEl ?? null)
    // The popover attaches level with the CLICK, not the block's midpoint —
    // on a tall week-view block the midpoint can be half a screen from the
    // cursor. One rule for every view; the anchor keeps the block's width so
    // side space is judged from its real edges.
    if (anchorEl && clientX !== undefined && clientY !== undefined) {
      setPreviewAnchorRect(
        anchorRectForClick(anchorEl.getBoundingClientRect(), clientX, clientY),
      )
    } else if (clientX !== undefined && clientY !== undefined) {
      setPreviewAnchorRect(
        DOMRect.fromRect({ x: clientX, y: clientY, width: 0, height: 0 }),
      )
    } else {
      setPreviewAnchorRect(anchorEl?.getBoundingClientRect() ?? null)
    }
    setPreviewOpen(true)
  }

  const handleNavigateAndPreview = (event: CalendarEvent) => {
    const eventId = (event as any).eventId ?? event.id
    const realEvent = events.find((e) => e.id === eventId) ?? event
    setDate(new Date(realEvent.startDate))
    setView(defaultView as ViewType)
    setPreviewEvent(realEvent)
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-event-id="${eventId}"]`)
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'instant' })
        requestAnimationFrame(() => {
          setPreviewAnchorRect(el.getBoundingClientRect())
          setPreviewAnchorEl(el as HTMLElement)
          setPreviewOpen(true)
        })
      } else if (calendarRef.current) {
        setPreviewAnchorRect(
          DOMRect.fromRect({
            x: calendarRef.current.getBoundingClientRect().left + 16,
            y: calendarRef.current.getBoundingClientRect().top + 16,
            width: 0,
            height: 0,
          }),
        )
        setPreviewOpen(true)
      } else {
        setPreviewAnchorRect(null)
        setPreviewOpen(true)
      }
    })
  }

  const handleEventAdd = (event: CalendarEvent) => {
    const newEvent = {
      ...event,
      id: event.id || uuid(),
    }

    setEvents((prevEvents) => [...prevEvents, newEvent])
    void upsertEvent({
      id: newEvent.id,
      title: newEvent.title,
      startDate: newEvent.startDate.toISOString(),
      endDate: newEvent.endDate.toISOString(),
      isAllDay: newEvent.isAllDay,
      color: newEvent.color,
      location: newEvent.location,
      description: newEvent.description,
      participants: newEvent.participants?.length
        ? newEvent.participants.map((p: any) =>
            typeof p === 'string' ? { name: p } : p,
          )
        : null,
      notificationMinutes: newEvent.notification,
      emailReminder: newEvent.emailReminder === true,
      categoryId: newEvent.calendarId || null,
      rrule: newEvent.rrule ?? null,
      timezone,
    })
    toast(t.eventCreated)
    setEventEditorOpen(false)
    setSelectedEvent(null)
    setQuickCreateStartTime(null)
    setQuickCreateEndTime(null)
  }

  const handleEventUpdate = (
    updatedEvent: CalendarEvent,
    applyTo?: 'single' | 'following' | 'all',
  ) => {
    // Plan a "this and following" split OUTSIDE the zustand updater: the
    // updater must stay pure, and splitId/oldSeriesId have to be decided
    // exactly once up front — when the event is a raw series master (no
    // seriesId/recurrenceId) the server still splits at the series root,
    // so those ids must be sent or the old series would linger as ghosts.
    // The whole plan is wrapped so a synchronous failure can never kill
    // the save — without splitId the server assigns the new series id and
    // its response reconciles the view.
    let splitId: string | null = null
    let oldSeriesId: string | null = null
    let optimisticEvents: CalendarEvent[] | null = null
    if (applyTo === 'following') {
      try {
        splitId = uuid()
        oldSeriesId =
          updatedEvent.seriesId ?? (updatedEvent.rrule ? updatedEvent.id : null)
        if (updatedEvent.seriesId && updatedEvent.recurrenceId) {
          const window = defaultExpansionWindow()
          const nextMaster = {
            ...updatedEvent,
            id: splitId,
            seriesId: null,
            recurrenceId: null,
            rrule: updatedEvent.rrule ?? null,
          }
          const target = events.find((event) => event.id === updatedEvent.id)
          if (target) {
            optimisticEvents = optimisticFollowingSplit(
              events,
              target,
              nextMaster,
              window.windowStart,
              window.windowEnd,
              undefined,
              timezone,
            )
          }
        }
      } catch {
        splitId = null
        optimisticEvents = null
      }
    }
    if (optimisticEvents) {
      setEvents(optimisticEvents)
    } else {
      setEvents((prevEvents) =>
        prevEvents.map((event) =>
          event.id === updatedEvent.id ? updatedEvent : event,
        ),
      )
    }
    upsertEvent(
      {
        id: updatedEvent.id,
        title: updatedEvent.title,
        startDate: updatedEvent.startDate.toISOString(),
        endDate: updatedEvent.endDate.toISOString(),
        isAllDay: updatedEvent.isAllDay,
        color: updatedEvent.color,
        location: updatedEvent.location,
        description: updatedEvent.description,
        participants: updatedEvent.participants?.length
          ? updatedEvent.participants.map((p: any) =>
              typeof p === 'string' ? { name: p } : p,
            )
          : null,
        notificationMinutes: updatedEvent.notification,
        emailReminder: updatedEvent.emailReminder === true,
        categoryId: updatedEvent.calendarId || null,
        rrule: updatedEvent.rrule ? updatedEvent.rrule : undefined,
        apply_to: applyTo,
        split_id: splitId ?? undefined,
        timezone,
      },
      oldSeriesId ? new Set([oldSeriesId]) : undefined,
    )
    toast(t.eventUpdated)
    setEventEditorOpen(false)
    setSelectedEvent(null)
    setQuickCreateStartTime(null)
    setQuickCreateEndTime(null)
  }

  const handleEventDelete = (
    eventId: string,
    applyTo?: 'single' | 'following' | 'all',
  ) => {
    const targetEvent = events.find((event) => event.id === eventId)
    if (!targetEvent) return
    setPendingDeleteEvent(targetEvent)
    setPendingDeleteApplyTo(applyTo)
    setDeleteScope(applyTo === 'all' ? 'all' : 'single')
    setDeleteConfirmOpen(true)
  }

  const confirmEventDelete = async (
    applyToOverride?: 'single' | 'following' | 'all',
  ) => {
    if (!pendingDeleteEvent) return

    const deletedEvent = pendingDeleteEvent
    const applyTo = applyToOverride ?? pendingDeleteApplyTo
    let cancelled = false

    setEvents((prevEvents) => {
      if (applyTo === 'all' && deletedEvent.seriesId) {
        return prevEvents.filter(
          (event) => event.seriesId !== deletedEvent.seriesId,
        )
      }
      if (
        applyTo === 'following' &&
        deletedEvent.seriesId &&
        deletedEvent.recurrenceId
      ) {
        return prevEvents.filter(
          (event) =>
            event.seriesId !== deletedEvent.seriesId ||
            (event.recurrenceId ?? '') < deletedEvent.recurrenceId!,
        )
      }
      return prevEvents.filter((event) => event.id !== deletedEvent.id)
    })

    void deleteEvent(deletedEvent.id, applyTo, timezone, {
      deferNetwork: true,
    }).catch(() => {})

    const deleteTimer = window.setTimeout(() => {
      if (cancelled) return
      void (async () => {
        try {
          await deleteBookmarkByEvent(deletedEvent.id)
        } catch {}
        try {
          await deleteEvent(deletedEvent.id, applyTo, timezone)
        } catch {}
      })()
    }, 6000)

    toast.success(t.eventDeleted, {
      description: deletedEvent.title,
      duration: 6000,
      action: {
        label: t.undo,
        onClick: () => {
          cancelled = true
          window.clearTimeout(deleteTimer)
          if (
            deletedEvent.rrule ||
            deletedEvent.seriesId ||
            deletedEvent.recurrenceId
          ) {
            void refreshEvents()
            toast(t.deletionUndone)
            return
          }
          setEvents((prevEvents) => {
            if (prevEvents.some((event) => event.id === deletedEvent.id))
              return prevEvents
            return [...prevEvents, deletedEvent].sort(
              (a, b) =>
                new Date(a.startDate).getTime() -
                new Date(b.startDate).getTime(),
            )
          })
          upsertEvent({
            id: deletedEvent.id,
            title: deletedEvent.title,
            startDate: deletedEvent.startDate.toISOString(),
            endDate: deletedEvent.endDate.toISOString(),
            isAllDay: deletedEvent.isAllDay,
            location: deletedEvent.location || null,
            participants: deletedEvent.participants?.length
              ? deletedEvent.participants.map((p: any) =>
                  typeof p === 'string' ? { name: p } : p,
                )
              : null,
            // `?? null`, not `|| null`: 0 is a real reminder and must survive
            // an undo-restore.
            notificationMinutes: deletedEvent.notification ?? null,
            emailReminder: deletedEvent.emailReminder === true,
            color: deletedEvent.color || null,
            categoryId: deletedEvent.calendarId || null,
            timezone,
          }).catch(() => {})
          toast(t.deletionUndone)
        },
      },
    })

    setEventEditorOpen(false)
    setSelectedEvent(null)
    setPreviewOpen(false)
    setDeleteConfirmOpen(false)
    setPendingDeleteEvent(null)
  }

  const reAddInviteToCalendar = async (
    targetEvent: CalendarEvent,
    inviteToken?: string,
  ) => {
    if (inviteToken) {
      // Session-authenticated: undoing a removal must work even after the
      // emailed link expired, because the grant outlives the link (ADR-0013).
      await fetch('/api/invites/self', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inviteToken,
          categoryId: targetEvent.calendarId ?? '__uncategorized__',
        }),
      }).catch(() => {})
    }
    setEvents((prevEvents) => {
      if (prevEvents.some((event) => event.id === targetEvent.id))
        return prevEvents
      return [...prevEvents, targetEvent].sort(
        (a, b) =>
          new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
      )
    })
  }

  const confirmRemoveInvite = async () => {
    if (!pendingRemoveInvite) return

    const targetEvent = pendingRemoveInvite
    const ownInvite = targetEvent.invites?.find(
      (i) => i.email === session?.user?.email?.toLowerCase(),
    )
    const inviteToken = ownInvite?.inviteToken

    setEvents((prevEvents) =>
      prevEvents.filter((event) => event.id !== targetEvent.id),
    )
    setRemoveInviteConfirmOpen(false)
    setPendingRemoveInvite(null)

    let undone = false
    toast(t.eventDeleted, {
      description: targetEvent.title,
      action: {
        label: t.undo,
        onClick: () => {
          undone = true
          void reAddInviteToCalendar(targetEvent, inviteToken)
          toast(t.deletionUndone)
        },
      },
    })

    try {
      await fetch(
        `/api/invites?eventId=${encodeURIComponent(targetEvent.id)}`,
        { method: 'DELETE' },
      )
    } catch {}

    if (undone && inviteToken) {
      await reAddInviteToCalendar(targetEvent, inviteToken)
    }
  }

  const handleImportEvents = (importedEvents: CalendarEvent[]) => {
    const newEvents = importedEvents.map((event) => ({
      ...event,
      id: event.id || Math.random().toString(36).substring(7),
    })) as CalendarEvent[]
    setEvents((prevEvents) => [...prevEvents, ...newEvents])
  }

  const handleEventEdit = (event?: CalendarEvent) => {
    const targetEvent = event ?? previewEvent
    if (targetEvent) {
      setSelectedEvent(targetEvent)
      setQuickCreateStartTime(null)
      setQuickCreateEndTime(null)
      // Hand the preview's anchor to the editor. Without this the editor
      // falls back to querying [data-event-id] — which for a multi-day event
      // returns the FIRST rendered segment, not the one the user clicked, so
      // editing from day 2 opened the popover at day 1's block.
      setEditorAnchorEl(previewAnchorEl)
      setEditorAnchorRect(previewAnchorRect)
      setEditorReplacesPreview(previewOpen)
      setEventEditorOpen(true)
      setPreviewOpen(false)
      setPreviewAnchorRect(null)
      setPreviewAnchorEl(null)
    }
  }

  const handleEventDuplicate = (event: CalendarEvent) => {
    const duplicatedEvent = {
      ...event,
      id: Math.random().toString(36).substring(7),
    }
    setEvents((prevEvents) => [...prevEvents, duplicatedEvent])
    setPreviewOpen(false)
    setPreviewAnchorRect(null)
    setPreviewAnchorEl(null)
  }

  const handleTimeRangeSelect = (startTime: Date, endTime?: Date) => {
    setQuickCreateStartTime(startTime)
    // Always a concrete range: the views render it as the blue selection box
    // the editor popover anchors to (CORE-191). The default 30-minute range
    // is clamped to the start's own day — creating at 23:40 must not spill
    // into a day that may not even be on screen.
    setQuickCreateEndTime(endTime ?? defaultCreateRange(startTime).end)

    // Creating from the sidebar or the N shortcut while viewing another
    // week/month left the blue box (and the editor's anchor) outside the
    // visible period. Navigate to the period that contains the new event.
    // Only for those entry points: a drag passes endTime and is by
    // definition already in view — and in the four-day view, whose window
    // starts at `date`, navigating on drag would shift the window under
    // the user's cursor.
    if (endTime === undefined) setDate(startTime)

    // Those same entry points also exist on non-calendar screens (analytics,
    // settings), where the editor would open over a page with no grid to
    // anchor to. Return to the user's preferred calendar view so the
    // selection box and the created event are visible.
    if (!isCalendarView(view)) {
      setView(isCalendarView(defaultView) ? defaultView : 'week')
    }

    setSelectedEvent(null)
    setEditorAnchorEl(null)
    setEditorAnchorRect(null)
    setEditorReplacesPreview(false)
    setPreviewOpen(false)
    setPreviewAnchorRect(null)
    setPreviewAnchorEl(null)
    setEventEditorOpen(true)
  }

  const handleInvitesAdded = (
    eventId: string,
    emails: string[],
    scope?: 'single' | 'following' | 'all',
  ) => {
    if (emails.length === 0) return
    setPendingInvites({ eventId, emails, scope })
  }

  const handleSendInvites = async () => {
    if (!pendingInvites) return
    const { eventId, emails, scope } = pendingInvites
    setPendingInvites(null)
    try {
      const response = await fetch('/api/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, emails, scope, timezone }),
      })
      if (!response.ok) {
        const message = await response
          .json()
          .then((d) => d?.error)
          .catch(() => null)
        throw new Error(message ?? 'failed')
      }
      await refreshEventInvites(eventId)
      toast.success(t.invitationsSent)
    } catch (error) {
      toast.error(
        error instanceof Error && error.message !== 'failed'
          ? error.message
          : t.invitationSendFailed,
      )
    }
  }

  const handleSkipInvites = async () => {
    if (!pendingInvites) return
    const { eventId, emails, scope } = pendingInvites
    setPendingInvites(null)
    try {
      const response = await fetch('/api/invites/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, emails, scope, timezone }),
      })
      if (!response.ok) throw new Error('failed')
      await refreshEventInvites(eventId)
    } catch {
      toast.error(t.addParticipantsFailed)
    }
  }

  const refreshEventInvites = async (eventId: string) => {
    try {
      const response = await fetch(
        `/api/invites?eventId=${encodeURIComponent(eventId)}`,
      )
      if (!response.ok) return
      const data = await response.json()
      const invites = data?.invites
      if (!Array.isArray(invites)) return
      setEvents((prevEvents) =>
        prevEvents.map((event) =>
          event.id === eventId ? { ...event, invites } : event,
        ),
      )
      setPreviewEvent((prev) =>
        prev?.id === eventId ? { ...prev, invites } : prev,
      )
      setSelectedEvent((prev) =>
        prev?.id === eventId ? { ...prev, invites } : prev,
      )
    } catch {}
  }

  const handlePreviewInvitesChange = useCallback(
    (eventId: string, invites: EventInvite[]) => {
      setEvents((prevEvents) =>
        prevEvents.map((event) =>
          event.id === eventId ? { ...event, invites } : event,
        ),
      )
      setPreviewEvent((prev) =>
        prev?.id === eventId ? { ...prev, invites } : prev,
      )
      setSelectedEvent((prev) =>
        prev?.id === eventId ? { ...prev, invites } : prev,
      )
    },
    [],
  )

  const handlePreviewCategoryChange = useCallback(
    (eventId: string, calendarId: string | null) => {
      setEvents((prevEvents) =>
        prevEvents.map((event) =>
          event.id === eventId
            ? { ...event, calendarId: calendarId ?? '' }
            : event,
        ),
      )
      setPreviewEvent((prev) =>
        prev?.id === eventId ? { ...prev, calendarId: calendarId ?? '' } : prev,
      )
      setSelectedEvent((prev) =>
        prev?.id === eventId ? { ...prev, calendarId: calendarId ?? '' } : prev,
      )
    },
    [],
  )

  const toggleBookmark = async (event: CalendarEvent) => {
    const isBookmarked = bookmarks.some((b) => b.eventId === event.id)
    if (isBookmarked) {
      await deleteBookmarkByEvent(event.id)
    } else {
      await createBookmark({ eventId: event.id })
    }
  }

  const eventsByCategory = useMemo(() => {
    if (selectedCategoryFilters.length === 0) return events

    return events.filter((event) => {
      if (!event.calendarId) {
        return selectedCategoryFilters.includes('__uncategorized__')
      }

      const hasCategory = calendars.some((cal) => cal.id === event.calendarId)
      if (!hasCategory)
        return selectedCategoryFilters.includes('__uncategorized__')
      return selectedCategoryFilters.includes(event.calendarId)
    })
  }, [events, selectedCategoryFilters, calendars])

  // The committed create range, shown as the blue selection box the editor
  // popover anchors to (CORE-191). Only while creating — editing anchors to
  // the event block itself.
  const createSelectionRange = useMemo(() => {
    if (!eventEditorOpen || selectedEvent) return null
    // The editor's draft (live date/time fields) wins over the committed
    // quick-create range, so the box follows the user's edits.
    if (createDraftRange) {
      const { start, end } = createDraftRange
      // Tolerate inverted input while the user is mid-edit.
      return start <= end ? { start, end } : { start: end, end: start }
    }
    if (!quickCreateStartTime) return null
    return {
      start: quickCreateStartTime,
      end: quickCreateEndTime ?? defaultCreateRange(quickCreateStartTime).end,
    }
  }, [
    eventEditorOpen,
    selectedEvent,
    quickCreateStartTime,
    quickCreateEndTime,
    createDraftRange,
  ])

  const filteredEvents = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase()
    if (!keyword) return eventsByCategory

    return eventsByCategory
      .filter((event) => {
        const title = event.title?.toLowerCase() || ''
        const location = event.location?.toLowerCase() || ''
        const description = event.description?.toLowerCase() || ''
        return (
          title.includes(keyword) ||
          location.includes(keyword) ||
          description.includes(keyword)
        )
      })
      .sort(
        (a, b) =>
          new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
      )
  }, [eventsByCategory, searchTerm])

  const searchResultEvents = useMemo(() => {
    if (!searchTerm.trim()) return []
    return filteredEvents.slice(0, 8)
  }, [filteredEvents, searchTerm])

  useNotifications(events)

  return (
    <div className={className}>
      <div className="relative flex h-dvh overflow-hidden bg-background">
        {}
        <Sidebar
          onCreateEvent={() => {
            setSelectedEvent(null)
            // Same path as drag-to-create: a synthetic 30-minute range shows
            // the same blue box, and the editor anchors to it (CORE-191).
            handleTimeRangeSelect(new Date())
          }}
          onDateSelect={handleDateSelect}
          onViewChange={handleViewChange}
          language={language}
          selectedDate={sidebarDate}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={toggleSidebar}
          selectedCategoryFilters={selectedCategoryFilters}
          onCategoryFilterChange={(categoryId, checked) => {
            setSelectedCategoryFilters((prev) => {
              if (checked) {
                return prev.includes(categoryId) ? prev : [...prev, categoryId]
              }
              return prev.filter((id) => id !== categoryId)
            })
          }}
          onCollapseTransitionEnd={() => setIsSidebarTransitioning(false)}
        />

        <MobileSidebarDrawer
          open={mobileDrawerOpen}
          onOpenChange={setMobileDrawerOpen}
          onCreateEvent={() => {
            setSelectedEvent(null)
            handleTimeRangeSelect(new Date())
          }}
          onDateSelect={handleDateSelect}
          onViewChange={handleViewChange}
          onEventClick={(event) => {
            handleNavigateAndPreview(event)
          }}
          language={language}
          selectedDate={sidebarDate}
          selectedCategoryFilters={selectedCategoryFilters}
          onCategoryFilterChange={(categoryId, checked) => {
            setSelectedCategoryFilters((prev) => {
              if (checked) {
                return prev.includes(categoryId) ? prev : [...prev, categoryId]
              }
              return prev.filter((id) => id !== categoryId)
            })
          }}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {' '}
          {/*
            `overflow-x-auto` is the last-resort defence: when the window is
            narrower than the header's shrink floors (nav controls + compressed
            search + icon buttons), the row scrolls instead of clipping the
            trailing buttons out of reach. With no overflow it renders nothing —
            no scrollbar, no layout change. Every popup in here (select, search
            results, menus) is portalled to <body>, so the overflow container
            cannot clip them.
          */}
          <header className="flex items-center px-4 h-16 border-b relative z-40 bg-background overflow-x-auto">
            {/* Cover strip for the right rail's slice of the header border.
                The rail has no mobile surface, so neither does this. */}
            <div className="pointer-events-none absolute right-0 bottom-0 h-px w-14 bg-background max-md:hidden" />
            {/*
              `min-w-0` on the left cluster and `shrink-0` on the controls
              inside it. The header is one fixed-height non-wrapping row, so
              whichever child could not shrink pushed the rest out: "Today" is
              "I dag" in Norwegian but "Секојдневно"-length words live in this
              row too, and the long date beside it is the part that should give
              way, not the navigation.
            */}
            <div className="flex min-w-0 items-center space-x-4 max-md:space-x-2">
              {/*
                Two mutually exclusive leading buttons: the desktop collapse
                toggle and the mobile hamburger that opens the drawer
                (ADR-0019). Swapped by breakpoint, never both visible.
              */}
              <Button
                variant="outline"
                onClick={toggleSidebar}
                size="sm"
                className="shrink-0 max-md:hidden"
              >
                <PanelLeft />
              </Button>
              <Button
                variant="outline"
                onClick={() => setMobileDrawerOpen(true)}
                size="sm"
                className="shrink-0 md:hidden"
                aria-label={t.menu}
              >
                <Menu />
              </Button>
              {/*
                The Mobile Form's top bar is a single iconified row: "today"
                becomes an icon and the prev/next arrows disappear —
                navigation happens via "today" and the drawer's mini calendar.
              */}
              <Button
                variant="outline"
                size="sm"
                onClick={handleTodayClick}
                className="shrink-0 max-md:hidden"
              >
                {t.today}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleTodayClick}
                className="shrink-0 md:hidden"
                aria-label={t.today}
              >
                <CalendarCheck />
              </Button>
              {view !== 'analytics' && (
                <>
                  <div className="flex shrink-0 items-center space-x-1 max-md:hidden">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handlePrevious}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={handleNext}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                  <span className="min-w-0 truncate text-lg max-md:text-base">
                    {formatDateDisplay(date)}
                  </span>
                </>
              )}
            </div>

            {/*
              `max-xl:shrink`: below the 1280px reference width the cluster may
              give up width — the search box (the only shrinkable child, see
              its min-w floor) compresses before the header falls back to
              scrolling. At ≥1280px `shrink-0` still wins, so wide desktops
              cannot re-distribute space differently than before, even in
              locales whose long date string already truncates there.
            */}
            <div className="ml-auto flex shrink-0 max-xl:shrink items-center space-x-2">
              <TooltipProvider delayDuration={300}>
                <div className="relative z-50 shrink-0">
                  <Select
                    value={
                      view === 'day' ||
                      view === 'week' ||
                      view === 'four-day' ||
                      view === 'month' ||
                      view === 'year'
                        ? view
                        : defaultView === 'day' ||
                            defaultView === 'week' ||
                            defaultView === 'four-day' ||
                            defaultView === 'month' ||
                            defaultView === 'year'
                          ? defaultView
                          : 'week'
                    }
                    onValueChange={(value) => {
                      if (isCalendarView(value)) {
                        setView(value)
                      }
                    }}
                  >
                    {/*
                    `min-w-` not `w-`: the longest option is "Four Days" in
                    English but "Τέσσερις Ημέρες" in Greek and "Секоја година"
                    in Macedonian. At a fixed 100px the trigger clipped the
                    selected view — the one label the user needs to read to know
                    which view they are in. 100px stays the floor so the control
                    does not shrink to the width of "Day".
                  */}
                    <SelectTrigger className="min-w-[100px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="day">{t.day}</SelectItem>
                        <SelectItem value="week">{t.week}</SelectItem>
                        <SelectItem value="month">{t.month}</SelectItem>
                        <SelectItem value="year">{t.year}</SelectItem>
                        <SelectItem value="four-day">{t.fourDay}</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
                {/*
                The search box is the one child of this cluster allowed to
                compress. Below the 1280px reference width the wrapper takes
                the same 12rem basis the InputGroup always had but may shrink
                to a 7rem floor; a flex item never shrinks unless the row is
                actually short of space, so an uncompressed window renders
                exactly as before. At ≥1280px none of these classes apply.
              */}
                <div
                  className="relative z-50 max-xl:w-48 max-xl:min-w-28 max-xl:shrink max-md:hidden"
                  ref={searchInputRef}
                >
                  <InputGroup className="w-48 max-xl:w-full">
                    <InputGroupAddon>
                      <Search className="h-5 w-5 text-gray-400" />
                    </InputGroupAddon>
                    <InputGroupInput
                      type="text"
                      placeholder={t.searchEvents}
                      value={searchTerm}
                      onFocus={() => setIsSearchFocused(true)}
                      onBlur={() => {
                        window.setTimeout(() => setIsSearchFocused(false), 120)
                      }}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      onKeyDown={(e) => {
                        if (
                          e.key === 'Enter' &&
                          searchResultEvents.length > 0
                        ) {
                          handleNavigateAndPreview(searchResultEvents[0])
                          setSearchTerm('')
                          setIsSearchFocused(false)
                        }
                      }}
                      className="pr-4"
                    />
                  </InputGroup>
                  {isSearchFocused &&
                    !!searchTerm &&
                    searchInputRef.current &&
                    typeof document !== 'undefined' &&
                    createPortal(
                      <div
                        className="fixed z-[100] w-80 rounded-md border bg-popover p-1 shadow-md"
                        style={{
                          left: searchInputRef.current.getBoundingClientRect()
                            .right,
                          top:
                            searchInputRef.current.getBoundingClientRect()
                              .bottom + 6,
                          transform: 'translateX(-100%)',
                        }}
                      >
                        {searchResultEvents.length > 0 ? (
                          <div className="min-h-0 max-h-[320px] overflow-y-auto">
                            <div className="space-y-1">
                              {searchResultEvents.map((event) => (
                                <button
                                  key={event.id}
                                  type="button"
                                  className="flex w-full cursor-pointer items-start gap-2 rounded-sm px-2 py-2 text-left hover:bg-accent"
                                  onMouseDown={(e) => {
                                    e.preventDefault()
                                    handleNavigateAndPreview(event)
                                    setSearchTerm('')
                                    setIsSearchFocused(false)
                                  }}
                                >
                                  <div
                                    className="mt-0.5 h-4 w-1 shrink-0 rounded-full"
                                    style={{
                                      backgroundColor: getEventAccentColor(
                                        event.color,
                                      ),
                                    }}
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-medium leading-none">
                                      {event.title || t.unnamedEvent}
                                    </div>
                                    <div className="mt-1 text-xs text-muted-foreground">
                                      {formatDateDisplay(
                                        new Date(event.startDate),
                                      )}
                                    </div>
                                    {event.location && (
                                      <div className="truncate text-xs text-muted-foreground">
                                        {event.location}
                                      </div>
                                    )}
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="px-2 py-3 text-center text-sm text-muted-foreground">
                            {t.noMatchingEvents}
                          </div>
                        )}
                      </div>,
                      document.body,
                    )}
                </div>
                {/* AI palette trigger: one affordance on every form factor.
                  Desktop users also reach it via Cmd/Ctrl+K. Hidden when
                  the deployment has no Groq key. */}
                {AI_ENABLED && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        className="rounded-full h-8 w-8"
                        aria-label={t.aiAssistant}
                        onClick={openAiPalette}
                      >
                        <Sparkles className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t.aiAssistant}</TooltipContent>
                  </Tooltip>
                )}
                {/* Mobile Form: search collapses to an icon that opens the
                  full-screen overlay rendered after the header. */}
                <Button
                  variant="outline"
                  size="icon"
                  className="rounded-full h-8 w-8 md:hidden"
                  aria-label={t.searchEvents}
                  onClick={() => setMobileSearchOpen(true)}
                >
                  <Search className="h-4 w-4" />
                </Button>
                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        {/* Not part of the Mobile Form's single-row top bar
                          (ADR-0019): hamburger, date, today, view, search,
                          profile. Help stays desktop-only. */}
                        <Button
                          variant="outline"
                          size="icon"
                          className="rounded-full h-8 w-8 max-md:hidden"
                          aria-label={t.help}
                        >
                          <CircleHelp className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent>{t.help}</TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="end">
                    {isSignedIn ? (
                      <DropdownMenuItem onClick={() => router.push('/landing')}>
                        <House className="mr-2 h-4 w-4" />
                        {t.home}
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem
                      onClick={() =>
                        window.open(
                          APP_CONFIG.contact.statusPageUrl,
                          '_blank',
                          'noopener,noreferrer',
                        )
                      }
                    >
                      <ShieldCheck className="mr-2 h-4 w-4" />
                      {t.status}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        window.location.href = `mailto:${APP_CONFIG.contact.feedbackEmail}`
                      }}
                    >
                      <MessageSquare className="mr-2 h-4 w-4" />
                      {t.feedback}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => router.push('/privacy')}>
                      <FileText className="mr-2 h-4 w-4" />
                      {t.privacy}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => router.push('/terms')}>
                      <ScrollText className="mr-2 h-4 w-4" />
                      {t.tos}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <UserProfileButton
                  variant="outline"
                  className="rounded-full h-8 w-8"
                  onNavigateToView={handleNavigateToView}
                />
              </TooltipProvider>
            </div>
          </header>
          {/* Mobile Form: full-screen search overlay with a back arrow — the
              universal mobile overlay rule (ADR-0019). md:hidden guarantees
              it can never exist on desktop even while open. */}
          {mobileSearchOpen && (
            <div className="fixed inset-0 z-[100] flex flex-col bg-background md:hidden animate-in fade-in-0 slide-in-from-bottom-4 duration-200">
              <div className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t.back}
                  onClick={() => {
                    setMobileSearchOpen(false)
                    setSearchTerm('')
                  }}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <InputGroup className="flex-1">
                  <InputGroupAddon>
                    <Search className="h-5 w-5 text-gray-400" />
                  </InputGroupAddon>
                  <InputGroupInput
                    type="text"
                    placeholder={t.searchEvents}
                    value={searchTerm}
                    autoFocus
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && searchResultEvents.length > 0) {
                        handleNavigateAndPreview(searchResultEvents[0])
                        setSearchTerm('')
                        setMobileSearchOpen(false)
                      }
                    }}
                  />
                </InputGroup>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {searchTerm ? (
                  searchResultEvents.length > 0 ? (
                    <div className="space-y-1">
                      {searchResultEvents.map((event) => (
                        <button
                          key={event.id}
                          type="button"
                          className="flex w-full cursor-pointer items-start gap-2 rounded-sm px-2 py-2 text-left hover:bg-accent"
                          onClick={() => {
                            handleNavigateAndPreview(event)
                            setSearchTerm('')
                            setMobileSearchOpen(false)
                          }}
                        >
                          <div
                            className="mt-0.5 h-4 w-1 shrink-0 rounded-full"
                            style={{
                              backgroundColor: getEventAccentColor(event.color),
                            }}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium leading-none">
                              {event.title || t.unnamedEvent}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {formatDateDisplay(new Date(event.startDate))}
                            </div>
                            {event.location && (
                              <div className="truncate text-xs text-muted-foreground">
                                {event.location}
                              </div>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="px-2 py-3 text-center text-sm text-muted-foreground">
                      {t.noMatchingEvents}
                    </div>
                  )
                ) : null}
              </div>
            </div>
          )}
          <div
            className="relative flex-1 overflow-auto pr-14 max-md:pr-0"
            ref={calendarRef}
          >
            {view === 'day' && (
              <DayView
                date={date}
                events={filteredEvents}
                onEventClick={handleEventClick}
                onTimeSlotClick={handleTimeRangeSelect}
                config={viewConfig}
                onEditEvent={handleEventEdit}
                onDeleteEvent={(event) => handleEventDelete(event.id)}
                onBookmarkEvent={toggleBookmark}
                onEventDrop={handleEventDrop}
                onBackToCalendar={() => setView(defaultView)}
                selection={createSelectionRange}
              />
            )}
            {view === 'week' && (
              <WeekView
                date={date}
                events={filteredEvents}
                onEventClick={handleEventClick}
                onTimeSlotClick={handleTimeRangeSelect}
                config={viewConfig}
                onEditEvent={handleEventEdit}
                onDeleteEvent={(event) => handleEventDelete(event.id)}
                onBookmarkEvent={toggleBookmark}
                onEventDrop={handleEventDrop}
                selection={createSelectionRange}
              />
            )}
            {view === 'four-day' && (
              <WeekView
                date={date}
                events={filteredEvents}
                onEventClick={handleEventClick}
                onTimeSlotClick={handleTimeRangeSelect}
                config={viewConfig}
                daysToShow={4}
                fixedStartDate={date}
                onEditEvent={handleEventEdit}
                onDeleteEvent={(event) => handleEventDelete(event.id)}
                onBookmarkEvent={toggleBookmark}
                onEventDrop={handleEventDrop}
                selection={createSelectionRange}
              />
            )}
            {view === 'month' && (
              <MonthView
                date={date}
                events={filteredEvents}
                onEventClick={handleEventClick}
                config={viewConfig}
                selection={createSelectionRange}
              />
            )}
            {view === 'year' && (
              <YearView
                date={date}
                events={filteredEvents}
                onEventClick={handleEventClick}
                config={viewConfig}
                selection={createSelectionRange}
              />
            )}
            {view === 'analytics' && (
              <AnalyticsView
                events={events}
                onCreateEvent={(startDate) => {
                  setSelectedEvent(null)
                  // Route through the shared quick-create path: it switches
                  // back to the user's calendar view and navigates to the
                  // period containing the draft, so the editor has a visible
                  // grid to anchor to instead of opening over the report.
                  handleTimeRangeSelect(startDate)
                }}
                onBackToCalendar={() => setView(defaultView)}
                isSidebarTransitioning={isSidebarTransitioning}
              />
            )}
          </div>
        </div>

        {/* Mobile Form (ADR-0019): the floating create button — the mobile
            stand-in for the sidebar's Create Event button and drag-to-create,
            both of which have no surface below the md breakpoint. Hidden on
            the analytics report, which has its own create affordance. */}
        {view !== 'analytics' && (
          <Button
            size="icon"
            className="fixed right-4 bottom-4 z-40 hidden size-12 rounded-full shadow-lg max-md:flex"
            aria-label={t.createEvent}
            onClick={() => {
              setSelectedEvent(null)
              handleTimeRangeSelect(new Date())
            }}
          >
            <Plus className="size-5" />
          </Button>
        )}

        {}
        <RightSidebar
          onViewChange={handleViewChange}
          onEventClick={(event) => {
            handleNavigateAndPreview(event)
          }}
        />

        {}
        <EventPreview
          event={previewEvent}
          open={previewOpen}
          onOpenChange={(open) => {
            setPreviewOpen(open)
            if (!open) {
              setPreviewAnchorRect(null)
              setPreviewAnchorEl(null)
            }
          }}
          onEdit={handleEventEdit}
          onDelete={() => {
            if (previewEvent) {
              if (previewEvent.viewOnly) {
                setPendingRemoveInvite(previewEvent)
                setRemoveInviteConfirmOpen(true)
              } else {
                handleEventDelete(previewEvent.id)
              }
              setPreviewOpen(false)
              setPreviewAnchorRect(null)
              setPreviewAnchorEl(null)
            }
          }}
          _onDuplicate={() => {
            if (previewEvent) {
              handleEventDuplicate(previewEvent)
            }
          }}
          language={language}
          _timezone={timezone}
          anchorRect={previewAnchorRect}
          anchorElement={previewAnchorEl}
          scrollContainerRef={calendarRef}
          onInvitesChange={handlePreviewInvitesChange}
          onCategoryChange={handlePreviewCategoryChange}
        />

        <EventEditor
          open={eventEditorOpen}
          onOpenChange={(open) => {
            setEventEditorOpen(open)
            if (!open) {
              // Clearing the range removes the blue anchor box in the views.
              setQuickCreateStartTime(null)
              setQuickCreateEndTime(null)
              setCreateDraftRange(null)
              setEditorAnchorEl(null)
              setEditorAnchorRect(null)
              setEditorReplacesPreview(false)
            }
          }}
          onEventAdd={handleEventAdd}
          onEventUpdate={(event, applyTo) => handleEventUpdate(event, applyTo)}
          onEventDelete={(eventId, applyTo) =>
            handleEventDelete(eventId, applyTo)
          }
          onInvitesAdded={handleInvitesAdded}
          initialDate={quickCreateStartTime || date}
          initialEndDate={quickCreateEndTime}
          onDraftRangeChange={setCreateDraftRange}
          event={selectedEvent}
          config={viewConfig}
          replacesPreview={editorReplacesPreview}
          anchorElement={editorAnchorEl}
          anchorRect={editorAnchorRect}
          scrollContainerRef={calendarRef}
        />

        <Dialog
          open={!!pendingInvites}
          onOpenChange={(open) => {
            if (!open) setPendingInvites(null)
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t.sendInvitationsTitle}</DialogTitle>
            </DialogHeader>
            {/*
              One interpolated sentence, not English pluralisation glued
              together in JSX. The `+ 's'` branch produced "1 participants" in
              every locale that does not form plurals that way, which is most
              of them.
            */}
            <p className="text-sm text-muted-foreground">
              {t.sendInvitationsDescription.replace(
                '{count}',
                String(pendingInvites?.emails.length ?? 0),
              )}
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={handleSkipInvites}>
                {t.notNow}
              </Button>
              <Button onClick={handleSendInvites}>{t.send}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          language={languageObj.code}
          setLanguage={(lang: string) => {
            setLanguage(lang as Parameters<typeof setLanguage>[0])
            updateSettings({ language: lang }).catch(() => {})
          }}
          firstDayOfWeek={firstDayOfWeekObj}
          setFirstDayOfWeek={handleFirstDayOfWeekChange}
          timezone={timezone}
          setTimezone={handleTimezoneChange}
          defaultView={CalendarViewType.create(
            defaultView as CalendarViewTypeValue,
          )}
          setDefaultView={(view: CalendarViewType) =>
            handleDefaultViewChange(view.value as CalendarViewTypeValue)
          }
          enableShortcuts={enableShortcuts}
          setEnableShortcuts={handleEnableShortcutsChange}
          timeFormat={timeFormatObj}
          setTimeFormat={(format: TimeFormat) =>
            handleTimeFormatChange(format.value as TimeFormatValue)
          }
          events={events}
          onImportEvents={handleImportEvents}
          focusSection={focusUserProfileSection}
          onFocusSectionHandled={() => setFocusUserProfileSection(null)}
        />

        <AlertDialog open={rangeMoveOpen} onOpenChange={setRangeMoveOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t.repeatScope}</AlertDialogTitle>
              <AlertDialogDescription>
                {t.moveEventScopeDescription}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <RadioGroup
              value={rangeMoveScope}
              onValueChange={(value) =>
                setRangeMoveScope(value as 'single' | 'following' | 'all')
              }
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="single" id="range-move-scope-single" />
                <Label htmlFor="range-move-scope-single">
                  {t.repeatScopeSingle}
                </Label>
              </div>
              {!rangeMoveCanAll && (
                <div className="flex items-center gap-2">
                  <RadioGroupItem
                    value="following"
                    id="range-move-scope-following"
                  />
                  <Label htmlFor="range-move-scope-following">
                    {t.repeatScopeFollowing}
                  </Label>
                </div>
              )}
              {rangeMoveCanAll && (
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="all" id="range-move-scope-all" />
                  <Label htmlFor="range-move-scope-all">
                    {t.repeatScopeAll}
                  </Label>
                </div>
              )}
            </RadioGroup>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setPendingRangeMove(null)}>
                {t.cancel}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => confirmRangeMove(rangeMoveScope)}
              >
                {t.confirm}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog
          open={deleteConfirmOpen}
          onOpenChange={setDeleteConfirmOpen}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t.deleteEventConfirmTitle}</AlertDialogTitle>
              <AlertDialogDescription>
                {t.deleteEventConfirmDescription}
                {pendingDeleteEvent &&
                  (pendingDeleteEvent.rrule ||
                    pendingDeleteEvent.seriesId ||
                    pendingDeleteEvent.recurrenceId) &&
                  ` ${t.deleteEventConfirmRecurring}`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {pendingDeleteEvent &&
            (pendingDeleteEvent.rrule ||
              pendingDeleteEvent.seriesId ||
              pendingDeleteEvent.recurrenceId) ? (
              <RadioGroup
                value={deleteScope}
                onValueChange={(value) =>
                  setDeleteScope(value as 'single' | 'following' | 'all')
                }
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="single" id="delete-scope-single" />
                  <Label htmlFor="delete-scope-single">
                    {t.repeatDeleteThisOccurrence}
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem
                    value="following"
                    id="delete-scope-following"
                  />
                  <Label htmlFor="delete-scope-following">
                    {t.repeatScopeFollowing}
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="all" id="delete-scope-all" />
                  <Label htmlFor="delete-scope-all">
                    {t.repeatDeleteAllOccurrences}
                  </Label>
                </div>
              </RadioGroup>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setPendingDeleteEvent(null)}>
                {t.cancel}
              </AlertDialogCancel>
              {pendingDeleteEvent &&
              (pendingDeleteEvent.rrule ||
                pendingDeleteEvent.seriesId ||
                pendingDeleteEvent.recurrenceId) ? (
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground"
                  onClick={() => confirmEventDelete(deleteScope)}
                >
                  {t.delete}
                </AlertDialogAction>
              ) : (
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground"
                  onClick={() => confirmEventDelete()}
                >
                  {t.delete}
                </AlertDialogAction>
              )}
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog
          open={removeInviteConfirmOpen}
          onOpenChange={setRemoveInviteConfirmOpen}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t.deleteEventConfirmTitle}</AlertDialogTitle>
              <AlertDialogDescription>
                {t.deleteEventConfirmDescription}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setPendingRemoveInvite(null)}>
                {t.cancel}
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground"
                onClick={confirmRemoveInvite}
              >
                {t.delete}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Mounted on first open only (chunk is lazy); kept mounted after so
            the conversation survives close/reopen within the session. */}
        {aiPaletteMounted && (
          <AiCommandPalette
            open={aiPaletteOpen}
            onOpenChange={setAiPaletteOpen}
            onEventsMutated={() => void refreshEvents()}
            actions={{
              setView: (v) => setView(v),
              goToToday: handleTodayClick,
              createEvent: () => {
                setSelectedEvent(null)
                handleTimeRangeSelect(new Date())
              },
              openAnalytics: () => handleNavigateToView('analytics'),
              openSettings: () => handleNavigateToView('settings'),
            }}
          />
        )}
      </div>
    </div>
  )
}
