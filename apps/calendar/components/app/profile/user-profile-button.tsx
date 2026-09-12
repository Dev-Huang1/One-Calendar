'use client'

import { CircleUser, Settings, BarChart2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@zntr/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@zntr/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@zntr/ui/tooltip'
import { translations, useLanguage } from '@zntr/i18n/calendar'
import { authClient } from '@/lib/auth/client'
import { cn } from '@zntr/utils'

/**
 * The avatar menu in the calendar header.
 *
 * This file used to be 955 lines and two components in one: this dropdown AND the
 * whole account settings panel, switched by a `mode` prop. The panel moved to
 * `@zntr/auth/account` so meet mounts the identical one; the dropdown stayed
 * because it is this app's chrome — it navigates to the calendar's own analytics
 * and settings views, which meet does not have (ADR 0022).
 */
type UserProfileButtonProps = {
  variant?: React.ComponentProps<typeof Button>['variant']
  className?: string
  onNavigateToView?: (view: 'analytics' | 'settings') => void
}

export default function UserProfileButton({
  variant = 'ghost',
  className = '',
  onNavigateToView,
}: UserProfileButtonProps) {
  const [language] = useLanguage()
  const t = translations[language]
  const { data: session, isPending } = authClient.useSession()
  const user = session?.user
  const isSignedIn = Boolean(user)
  // The same three-state distinction the account panel needs: useSession returns
  // no user while it is in flight, so "no user yet" and "no account" are different
  // answers. Conflating them offered Sign in to a signed-in user for a beat.
  const isResolving = !user && isPending
  const router = useRouter()

  return (
    <TooltipProvider delayDuration={300}>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              {isSignedIn || isResolving ? (
                <Button
                  variant={variant}
                  size="icon"
                  className={cn(
                    'rounded-full overflow-hidden h-8 w-8 p-0',
                    className,
                  )}
                >
                  <img
                    src={user?.image || '/user.png'}
                    alt="avatar"
                    width={32}
                    height={32}
                    className="rounded-full object-cover"
                    referrerPolicy="no-referrer"
                    fetchPriority="high"
                  />
                </Button>
              ) : (
                <Button variant={variant} size="icon" className={className}>
                  <CircleUser className="h-4 w-4" />
                </Button>
              )}
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{t.profile}</TooltipContent>
        </Tooltip>

        <DropdownMenuContent align="end">
          {!isSignedIn && !isResolving ? (
            <>
              <DropdownMenuItem onClick={() => router.push('/sign-in')}>
                {t.signIn}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push('/sign-up')}>
                {t.signUp}
              </DropdownMenuItem>
            </>
          ) : null}
          <DropdownMenuItem onClick={() => onNavigateToView?.('settings')}>
            <Settings className="mr-2 h-4 w-4" />
            {t.settings}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onNavigateToView?.('analytics')}>
            <BarChart2 className="mr-2 h-4 w-4" />
            {t.analytics}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </TooltipProvider>
  )
}
