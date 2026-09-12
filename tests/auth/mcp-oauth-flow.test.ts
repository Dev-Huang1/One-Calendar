// @vitest-environment node
import { createHash, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { betterAuth } from 'better-auth'
import { verifyJwsAccessToken } from '@better-auth/core/oauth2'
import { memoryAdapter } from '@better-auth/memory-adapter'
import { createMcpOAuthPlugins } from '@zntr/auth/server'
import { authSchema } from '@zntr/auth/schema'

const ORIGIN = 'https://calendar.example'
const ISSUER = `${ORIGIN}/api/auth`
const RESOURCE = `${ORIGIN}/api/mcp`

function cookieHeader(response: Response): string {
  const values = (
    response.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie?.() ?? [response.headers.get('set-cookie') ?? '']
  return values
    .filter(Boolean)
    .map((value) => value.split(';', 1)[0])
    .join('; ')
}

function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('origin', ORIGIN)
  return new Request(`${ORIGIN}${path}`, { ...init, headers })
}

describe('MCP OAuth provider integration', () => {
  it.each([
    'http://localhost:4567/callback',
    'http://127.0.0.1:4567/callback',
    'http://[::1]:4567/callback',
  ])(
    'completes DCR without application_type and PKCE for %s',
    async (redirectUri) => {
      const memory = Object.fromEntries(
        Object.keys(authSchema).map((model) => [model, []]),
      )
      const auth = betterAuth({
        baseURL: ORIGIN,
        secret: 'test-secret-long-enough-for-mcp-oauth-integration',
        database: memoryAdapter(memory),
        emailAndPassword: { enabled: true },
        trustedOrigins: [ORIGIN],
        plugins: createMcpOAuthPlugins({
          resource: RESOURCE,
          loginPage: '/oauth/sign-in',
          consentPage: '/oauth/consent',
          verificationUri: '/oauth/device',
          scopes: ['offline_access', 'events:read', 'events:write'],
        }),
      })

      const registration = await auth.handler(
        request('/api/auth/oauth2/register', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            client_name: 'Integration CLI',
            redirect_uris: [redirectUri],
            token_endpoint_auth_method: 'none',
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            scope: 'events:read offline_access',
          }),
        }),
      )
      const registered = (await registration.json()) as {
        client_id: string
        error_description?: string
      }
      expect(registration.status, registered.error_description).toBe(201)

      const signup = await auth.handler(
        request('/api/auth/sign-up/email', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Ada',
            email: 'ada@example.com',
            password: 'correct horse battery staple',
          }),
        }),
      )
      expect(signup.status).toBe(200)
      const cookie = cookieHeader(signup)
      expect(cookie).toContain('session_token')

      const verifier = randomBytes(32).toString('base64url')
      const challenge = createHash('sha256')
        .update(verifier)
        .digest('base64url')
      const authorizeUrl = new URL('/api/auth/oauth2/authorize', ORIGIN)
      authorizeUrl.search = new URLSearchParams({
        response_type: 'code',
        client_id: registered.client_id,
        redirect_uri: redirectUri,
        scope: 'events:read offline_access',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        resource: RESOURCE,
        state: 'integration-state',
      }).toString()

      const authorization = await auth.handler(
        new Request(authorizeUrl, { headers: { cookie, origin: ORIGIN } }),
      )
      expect(authorization.status).toBe(302)
      const consentLocation = authorization.headers.get('location') ?? ''
      expect(consentLocation).toContain('/oauth/consent?')
      const oauthQuery = new URL(consentLocation, ORIGIN).search.slice(1)

      const consent = await auth.handler(
        request('/api/auth/oauth2/consent', {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify({ accept: true, oauth_query: oauthQuery }),
        }),
      )
      expect(consent.status).toBe(200)
      const consentBody = (await consent.json()) as {
        url?: string
        redirect_uri?: string
      }
      const callback = new URL(
        consentBody.url ?? consentBody.redirect_uri ?? '',
        ORIGIN,
      )
      expect(callback.searchParams.get('state')).toBe('integration-state')
      expect(`${callback.origin}${callback.pathname}`).toBe(redirectUri)
      const code = callback.searchParams.get('code')
      expect(code).toBeTruthy()

      const tokenBody = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: registered.client_id,
        redirect_uri: redirectUri,
        code: code!,
        code_verifier: verifier,
        resource: RESOURCE,
      })
      const token = await auth.handler(
        request('/api/auth/oauth2/token', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: tokenBody,
        }),
      )
      expect(token.status).toBe(200)
      const tokens = (await token.json()) as {
        access_token: string
        refresh_token: string
      }
      expect(tokens.refresh_token).toBeTruthy()

      const jwks = await auth.handler(request('/api/auth/jwks'))
      const claims = await verifyJwsAccessToken(tokens.access_token, {
        jwksFetch: async () => jwks.json(),
        verifyOptions: { issuer: ISSUER, audience: RESOURCE },
      })
      expect(claims.scope).toBe('events:read offline_access')

      const refreshBody = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: registered.client_id,
        refresh_token: tokens.refresh_token,
        resource: RESOURCE,
      })
      const refreshed = await auth.handler(
        request('/api/auth/oauth2/token', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: refreshBody,
        }),
      )
      expect(refreshed.status).toBe(200)

      const replay = await auth.handler(
        request('/api/auth/oauth2/token', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: refreshBody,
        }),
      )
      expect(replay.status).toBe(400)

      const codeReplay = await auth.handler(
        request('/api/auth/oauth2/token', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: tokenBody,
        }),
      )
      expect(codeReplay.status).toBe(400)
    },
  )
})
