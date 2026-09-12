import { betterAuth, type BetterAuthPlugin } from 'better-auth'
import { createAuthMiddleware } from 'better-auth/api'
import { twoFactor, emailOTP } from 'better-auth/plugins'
import { jwt } from 'better-auth/plugins'
import { sentinel } from '@better-auth/infra'
import { cimd } from '@better-auth/cimd'
import { mcp } from '@better-auth/mcp'
import {
  oauthDeviceAuthorization,
  oauthProviderAuthServerMetadata as providerAuthServerMetadata,
} from '@better-auth/oauth-provider'
import { fetchCimdResource } from './cimd-fetch'
import { createDrizzleAdapter } from './adapter'
import type {
  CreateAuthOptions,
  EmailOTPOptions,
  EnabledPlugins,
  McpOAuthOptions,
  PluginOptions,
  SentinelOptions,
  TwoFactorOptions,
} from './types'

export { requireMcpAuth } from '@better-auth/mcp'

export function oauthProviderAuthServerMetadata(
  auth: ReturnType<typeof betterAuth>,
) {
  return providerAuthServerMetadata(
    auth as unknown as Parameters<typeof providerAuthServerMetadata>[0],
  )
}

export function createMcpOAuthPlugins(oauth: McpOAuthOptions) {
  return [
    {
      id: 'mcp-native-registration',
      hooks: {
        before: [
          {
            matcher: (ctx) => ctx.path === '/oauth2/register',
            handler: createAuthMiddleware(async (ctx) => {
              const body = ctx.body
              // MCP CLIs commonly omit the OIDC application_type. Infer it only
              // for public clients with exact HTTP loopback callbacks; the
              // provider still validates every URI, PKCE and token exchange.
              if (
                body?.application_type !== undefined ||
                body?.token_endpoint_auth_method !== 'none' ||
                !Array.isArray(body?.redirect_uris) ||
                body.redirect_uris.length === 0 ||
                !body.redirect_uris.every(
                  (uri: unknown) =>
                    typeof uri === 'string' &&
                    /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(
                      uri,
                    ),
                )
              )
                return
              return {
                context: {
                  ...ctx,
                  body: { ...body, application_type: 'native' },
                },
              }
            }),
          },
        ],
      },
    } satisfies BetterAuthPlugin,
    jwt(),
    mcp({
      resource: oauth.resource,
      loginPage: oauth.loginPage,
      consentPage: oauth.consentPage,
      scopes: oauth.scopes,
      accessTokenExpiresIn: oauth.accessTokenExpiresIn ?? 15 * 60,
      refreshTokenExpiresIn: oauth.refreshTokenExpiresIn ?? 90 * 24 * 60 * 60,
      refreshTokenReuseInterval: 0,
      grantTypes: ['authorization_code', 'refresh_token'],
      allowPublicClientPrelogin: true,
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      clientRegistrationRequirePKCE: true,
      clientRegistrationDefaultScopes: oauth.scopes,
      clientRegistrationAllowedScopes: oauth.scopes,
      storeClientSecret: 'hashed',
      storeTokens: 'hashed',
    }),
    oauthDeviceAuthorization({
      verificationUri: oauth.verificationUri,
      expiresIn: '5m',
      interval: '5s',
    }),
    cimd({
      fetchClientMetadataResource: fetchCimdResource,
      metadataProfile: 'mcp-2026-07-28',
      metadataRevalidationInterval: '60m',
      metadataFetchPolicy: {
        minimumFetchInterval: '1s',
        maximumConcurrentFetches: 16,
        maximumConcurrentFetchesPerOrigin: 4,
        maximumFetchesPerMinute: 120,
        maximumFetchesPerOriginPerMinute: 30,
      },
      maxCacheEntries: 1000,
    }),
  ]
}

function resolveTwoFactorPlugin(options: PluginOptions) {
  const value = options.twoFactor
  if (value === undefined || value === false) return null
  const defaults: TwoFactorOptions = { issuer: 'App' }
  const merged = value === true ? defaults : { ...defaults, ...value }
  return () => twoFactor(merged)
}

function resolveSentinelPlugin(options: PluginOptions) {
  const value = options.sentinel
  if (value === undefined || value === false) return null
  const defaults: SentinelOptions = {
    apiKey: undefined,
    security: {
      credentialStuffing: { enabled: true },
      compromisedPassword: { enabled: true },
      botBlocking: { action: 'challenge' },
      emailValidation: { enabled: true },
    },
  }
  const merged =
    value === true
      ? defaults
      : {
          ...defaults,
          ...value,
          security: {
            ...defaults.security,
            ...value.security,
          },
        }
  return () => sentinel(merged)
}

function resolveEmailOTPPlugin(options: PluginOptions) {
  const value = options.emailOTP
  if (value === undefined || value === false) return null
  const defaults: EmailOTPOptions = { changeEmail: { enabled: true } }
  const merged = value === true ? defaults : { ...defaults, ...value }
  return (sendVerificationOTP?: any) =>
    emailOTP({ ...merged, sendVerificationOTP })
}

export function createAuth(options: CreateAuthOptions): {
  auth: ReturnType<typeof betterAuth>
  enabledPlugins: EnabledPlugins
} {
  const {
    db,
    baseURL,
    trustedOrigins,
    advanced,
    emailCallbacks,
    plugins = {},
    password,
    secret,
    disableCsrfCheck,
    isDev = false,
  } = options

  const adapter = createDrizzleAdapter(db, { provider: 'pg' })

  const resolvedPlugins: any[] = []
  const enabledPlugins: EnabledPlugins = {}

  const twoFactorFn = resolveTwoFactorPlugin(plugins)
  if (twoFactorFn) {
    resolvedPlugins.push(twoFactorFn())
    enabledPlugins.twoFactor = true
  }

  const sentinelFn = resolveSentinelPlugin(plugins)
  if (sentinelFn) {
    resolvedPlugins.push(sentinelFn())
    enabledPlugins.sentinel = true
  }

  const emailOTPFn = resolveEmailOTPPlugin(plugins)
  if (emailOTPFn) {
    if (!emailCallbacks.sendVerificationOTP && isDev) {
      console.warn(
        '[createAuth] emailOTP plugin is enabled but emailCallbacks.sendVerificationOTP is not provided. OTPs will be logged to console instead of sent via email.',
      )
    }
    resolvedPlugins.push(emailOTPFn(emailCallbacks.sendVerificationOTP))
    enabledPlugins.emailOTP = true
  }

  if (plugins.mcpOAuth) {
    resolvedPlugins.push(...createMcpOAuthPlugins(plugins.mcpOAuth))
    enabledPlugins.mcpOAuth = true
  }

  /**
   * Whether the OTP plugin has taken ownership of email verification.
   *
   * The plugin implements `overrideDefaultEmailVerification` from its `init`,
   * by returning its own `emailVerification.sendVerificationEmail`. Plugin
   * options are folded in with `defu(options, pluginOptions)`, and defu keeps
   * the value already present — so a top-level `sendVerificationEmail` wins and
   * the override is silently discarded. Signing up then sent the link, while
   * other paths reached the plugin's OTP: two verification emails for one
   * account, which is what was reported.
   */
  const otpOwnsVerification =
    enabledPlugins.emailOTP &&
    typeof plugins.emailOTP === 'object' &&
    plugins.emailOTP.overrideDefaultEmailVerification === true

  const authConfig: any = {
    database: adapter,
    secret,
    disableCsrfCheck,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      password,
      sendResetPassword: emailCallbacks.sendResetPassword,
    },
    emailVerification: {
      // Omitted when the OTP plugin owns verification, so its override is not
      // outbid by defu. `sendChangeEmailVerification` stays either way: it is a
      // different flow, and the plugin's changeEmail OTP is requested
      // explicitly rather than through this callback.
      ...(otpOwnsVerification
        ? {}
        : { sendVerificationEmail: emailCallbacks.sendVerificationEmail }),
      ...(emailCallbacks.sendChangeEmailVerification
        ? {
            sendChangeEmailVerification:
              emailCallbacks.sendChangeEmailVerification,
          }
        : {}),
    },
    plugins: resolvedPlugins,
    trustedOrigins,
  }

  if (baseURL) {
    authConfig.baseURL = baseURL
  }

  // Omitted entirely when unset: Better Auth's defaults are correct for a
  // single-origin deployment, and passing an empty `advanced` block would
  // still be a config the library has to interpret.
  if (advanced) {
    authConfig.advanced = advanced
  }

  return {
    auth: betterAuth(authConfig),
    enabledPlugins,
  }
}
