import { NextResponse } from 'next/server'
import { toNextJsHandler } from '@zntr/auth'
import {
  authRouteIsExposed,
  authRoutePath,
  oauthRouteIsExposed,
} from '@zntr/auth/route-policy'
import { auth } from '@/lib/auth'
import {
  invalidateCachedSession,
  sessionTokenFromCookieHeader,
} from '@/lib/cache/session'
import { getDb } from '@/lib/drizzle/client'
import { user as users } from '@/lib/drizzle/schema'
import { anonymousAuditActor, withEvlog, useLogger } from '@/lib/evlog'
import {
  captchaIsGuarded,
  isTurnstileConfigured,
  verifyTurnstile,
  type TurnstileVerifyResult,
} from '@/lib/turnstile'
import { eq } from 'drizzle-orm'
import {
  checkFixedWindowLimit,
  clientIpFrom,
  rateLimitedResponse,
} from '@/lib/rate-limit'

const authHandlers = toNextJsHandler(auth)

type AuthLimit = {
  limit: number
  windowSeconds: number
  failClosed?: boolean
  globalLimit?: number
}

const LIMITS: Record<string, AuthLimit> = {
  'sign-in/email': { limit: 10, windowSeconds: 60 },
  'sign-up/email': { limit: 5, windowSeconds: 300 },
  'forget-password': { limit: 3, windowSeconds: 300 },
  'email-otp/send-verification-otp': { limit: 3, windowSeconds: 300 },
  'email-otp/request-password-reset': { limit: 3, windowSeconds: 300 },
  'email-otp/request-email-change': { limit: 3, windowSeconds: 300 },
  'oauth2/authorize': {
    limit: 30,
    windowSeconds: 60,
    globalLimit: 600,
  },
  'oauth2/register': {
    limit: 20,
    windowSeconds: 3600,
    globalLimit: 100,
  },
  'oauth2/token': { limit: 30, windowSeconds: 60 },
  'oauth2/introspect': { limit: 60, windowSeconds: 60 },
  'oauth2/revoke': { limit: 60, windowSeconds: 60 },
  'device/code': {
    limit: 10,
    windowSeconds: 60,
    globalLimit: 300,
  },
}

function notFound() {
  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}

async function authRateLimit(request: Request, path: string) {
  const budget = LIMITS[path]
  if (!budget) return null
  const failClosed = budget.failClosed && process.env.NODE_ENV === 'production'

  const result = await checkFixedWindowLimit({
    name: `auth:${path}`,
    subject: clientIpFrom(request),
    limit: budget.limit,
    windowSeconds: budget.windowSeconds,
    ...(failClosed ? { failClosed: true } : {}),
  })
  if (!result.allowed) return rateLimitedResponse(result.retryAfter)

  if (budget.globalLimit) {
    const global = await checkFixedWindowLimit({
      name: `auth:${path}:global`,
      subject: 'all',
      limit: budget.globalLimit,
      windowSeconds: budget.windowSeconds,
      ...(failClosed ? { failClosed: true } : {}),
    })
    if (!global.allowed) return rateLimitedResponse(global.retryAfter)
  }

  return null
}

type AuthAuditSubject = {
  actor:
    | typeof anonymousAuditActor
    | { type: 'user'; id: string; email?: string }
  target: { type: 'auth_identity'; id: string; email?: string }
}

async function readAuthBody(request: Request) {
  if (request.method !== 'POST') return null
  try {
    return (await request.clone().json()) as Record<string, unknown>
  } catch {
    return null
  }
}

function authAction(pathname: string) {
  if (pathname.endsWith('/sign-in/email')) return 'auth.login'
  if (pathname.endsWith('/sign-out')) return 'auth.logout'
  if (pathname.endsWith('/sign-up/email')) return 'auth.register'
  if (pathname.includes('/reset-password')) return 'auth.password_reset'
  return null
}

async function findUserByEmail(email: string) {
  const [result] = await getDb()
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)
  return result ?? null
}

async function getExistingSessionSubject(
  request: Request,
): Promise<AuthAuditSubject | null> {
  const session = await auth.api.getSession({ headers: request.headers })
  const user = session?.user
  if (!user?.id) return null

  return {
    actor: {
      type: 'user',
      id: user.id,
      ...(user.email ? { email: user.email } : {}),
    },
    target: {
      type: 'auth_identity',
      id: user.id,
      ...(user.email ? { email: user.email } : {}),
    },
  }
}

async function resolveAuthSubject(
  request: Request,
  email?: string,
): Promise<AuthAuditSubject> {
  const sessionSubject = await getExistingSessionSubject(request)
  if (sessionSubject) return sessionSubject

  if (email) {
    const user = await findUserByEmail(email)
    if (user) {
      return {
        actor: anonymousAuditActor,
        target: { type: 'auth_identity', id: user.id, email: user.email },
      }
    }
  }

  return {
    actor: anonymousAuditActor,
    target: {
      type: 'auth_identity',
      id: 'unknown',
      ...(email ? { email } : {}),
    },
  }
}

async function handleAuth(request: Request) {
  const pathname = new URL(request.url).pathname
  const path = authRoutePath(request.url)
  if (
    !authRouteIsExposed(request.method, path) &&
    !oauthRouteIsExposed(request.method, path)
  ) {
    return notFound()
  }

  const throttled = await authRateLimit(request, path)
  if (throttled) return throttled

  const log = useLogger()
  const action = authAction(pathname)
  const body = await readAuthBody(request)

  // Which paths are guarded is the package's decision now, so meet enforces the
  // identical set (ADR 0022). This widens the calendar's coverage: it used to
  // guard only sign-in and sign-up, leaving `forget-password` and the OTP
  // request open — unthrottled recovery is a way to send mail to arbitrary
  // addresses on our sending reputation.
  //
  // `action` stays for the audit log, which names the four events it records
  // rather than every path that carries a challenge.
  const captchaGuarded = captchaIsGuarded(
    request.method,
    pathname.replace(/^.*\/api\/auth/, ''),
  )

  // Skipped entirely when Turnstile is not configured. The client already omits
  // the widget when NEXT_PUBLIC_TURNSTILE_SITE_KEY is absent, and demanding a
  // token it was never asked to produce made sign-in impossible.
  //
  // Logged rather than silent: this removes a bot defence, so a deployment that
  // lost the variable should be discoverable from the logs instead of only from
  // the abuse it invites.
  if (captchaGuarded && !isTurnstileConfigured()) {
    console.warn(
      'Turnstile is not configured (TURNSTILE_SECRET_KEY unset) — CAPTCHA skipped',
      { action },
    )
  }

  if (captchaGuarded && isTurnstileConfigured()) {
    const turnstileToken =
      typeof body?.turnstileToken === 'string' ? body.turnstileToken : ''
    if (!turnstileToken) {
      return NextResponse.json({ error: 'CAPTCHA required' }, { status: 400 })
    }

    let captchaResult: TurnstileVerifyResult
    try {
      captchaResult = await verifyTurnstile(
        turnstileToken,
        pathname.includes('/sign-up') ? 'register' : 'login',
      )
    } catch (error) {
      console.error('CAPTCHA service unavailable', error)
      return NextResponse.json(
        { error: 'CAPTCHA service unavailable' },
        { status: 503 },
      )
    }

    if (!captchaResult.success) {
      const email = typeof body?.email === 'string' ? body.email : undefined
      const subject = await resolveAuthSubject(request, email)
      log.audit?.({
        action: 'captcha.fail',
        actor: anonymousAuditActor,
        target: subject.target,
        outcome: 'failure',
        reason: 'CAPTCHA verification failed',
      })
      return NextResponse.json(
        { error: 'CAPTCHA verification failed' },
        { status: 400 },
      )
    }
  }

  const email = typeof body?.email === 'string' ? body.email : undefined
  let subject = action ? await resolveAuthSubject(request, email) : null
  const response =
    await authHandlers[request.method as keyof typeof authHandlers](request)

  if (action === 'auth.logout' && response.status < 400) {
    const token = sessionTokenFromCookieHeader(request.headers.get('cookie'))
    if (token) await invalidateCachedSession(token)
  }

  if (action) {
    const success = response.status < 400
    if (success && subject?.target.id === 'unknown') {
      subject = await resolveAuthSubject(request, email)
    }

    log.audit?.({
      action,
      actor: subject?.actor ?? anonymousAuditActor,
      target: subject?.target ?? { type: 'auth_identity', id: 'unknown' },
      outcome: success ? 'success' : 'failure',
      reason: success
        ? 'Better Auth request completed'
        : `Better Auth request failed with status ${response.status}`,
    })
  }

  return response
}

export const GET = withEvlog(handleAuth)
export const POST = withEvlog(handleAuth)
