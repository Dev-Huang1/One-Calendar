import { Bookmark } from 'lucide-react'
import { ClockDashed } from '@/components/icons/clock-dashed'
import { Button } from '@zntr/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@zntr/ui/tooltip'
import BookmarkPanel from './bookmark-panel'
import { CountdownTool } from './countdown'
import { useState } from 'react'
import { cn } from '@zntr/utils'

import { translations, useLanguage } from '@zntr/i18n/calendar'
import type { ViewType } from '@/lib/calendar-types'

interface RightSidebarProps {
  onViewChange?: (view: ViewType) => void
  onEventClick: (event: any) => void
}

export default function RightSidebar({
  onViewChange: _onViewChange,
  onEventClick,
}: RightSidebarProps) {
  const [language] = useLanguage()
  const t = translations[language]
  const [bookmarkPanelOpen, setBookmarkPanelOpen] = useState(false)
  const [countdownOpen, setCountdownOpen] = useState(false)

  return (
    <TooltipProvider delayDuration={300}>
      {/* max-md:hidden: on the Mobile Form the bookmark and countdown panels
          live in the left drawer's bottom tabs (ADR-0019); this rail has no
          mobile surface. The main area drops its pr-14 in step. */}
      <div className="w-14 bg-background border-l flex-col items-center py-4 absolute right-0 top-16 bottom-0 z-30 flex max-md:hidden">
        <div className="flex flex-col items-center space-y-6 flex-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="secondary"
                size="icon"
                className="rounded-full size-10"
                onClick={() => setBookmarkPanelOpen(true)}
                aria-label={t.bookmarks}
              >
                <Bookmark className="h-6 w-6 text-black dark:text-white" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t.bookmarks}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="secondary"
                size="icon"
                className={cn(
                  'rounded-full size-10',
                  countdownOpen && 'ring-2 ring-primary',
                )}
                onClick={() => setCountdownOpen(true)}
                aria-label={t.countdownTitle}
              >
                <ClockDashed className="h-6 w-6 text-black dark:text-white" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t.countdownTitle}</TooltipContent>
          </Tooltip>

          <CountdownTool open={countdownOpen} onOpenChange={setCountdownOpen} />
        </div>
      </div>

      <BookmarkPanel
        open={bookmarkPanelOpen}
        onOpenChange={setBookmarkPanelOpen}
        onEventClick={onEventClick}
      />
    </TooltipProvider>
  )
}
