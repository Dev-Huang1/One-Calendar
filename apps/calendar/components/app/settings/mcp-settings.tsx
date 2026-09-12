'use client'

import { useEffect, useMemo, useState } from 'react'
import useSWR, { type SWRConfiguration } from 'swr'
import { fetchJson } from '@/lib/fetch-json'
import { removeById } from '@/lib/array-mutations'
import { toast } from 'sonner'
import { Button } from '@zntr/ui/button'
import { Switch } from '@zntr/ui/switch'
import { Label } from '@zntr/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@zntr/ui/dialog'
import { Input } from '@zntr/ui/input'
import { Checkbox } from '@zntr/ui/checkbox'
import { Badge } from '@zntr/ui/badge'
import { Spinner } from '@zntr/ui/spinner'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@zntr/ui/tooltip'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@zntr/ui/empty'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
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

import {
  Key,
  Globe,
  ClipboardCopy,
  Trash2,
  Plus,
  Check,
  X,
  Eye,
  EyeOff,
  MoreHorizontal,
  SlidersHorizontal,
  ScrollText,
  Plug,
  Search,
} from 'lucide-react'
import { translations, useLanguage } from '@zntr/i18n/calendar'
import { cn } from '@zntr/utils'
import { ALL_SCOPES, MCP_SCOPE_GROUPS } from '@/lib/mcp/types'

const READ_ONLY_SCOPES = ALL_SCOPES.filter((s) => s.endsWith(':read'))

const MCP_KEYS = {
  settings: '/api/mcp/settings',
  apiKeys: '/api/mcp/api-keys',
  authorizedApps: '/api/mcp/authorized-apps',
  auditLogs: (page: number, filters: AuditFilters, search: string) => {
    const params = new URLSearchParams({ page: String(page), limit: '20' })
    if (filters.entryType !== 'all') params.set('entryType', filters.entryType)
    if (filters.mutationsOnly) params.set('mutationsOnly', 'true')
    if (filters.failuresOnly) params.set('failuresOnly', 'true')
    if (filters.toolName !== 'all') params.set('toolName', filters.toolName)
    if (filters.window !== 'all') params.set('window', filters.window)
    if (search) params.set('search', search)
    return `/api/mcp/audit-logs?${params.toString()}`
  },
} as const

function useMcpQuery<T>(key: string, config?: SWRConfiguration<T>) {
  return useSWR<T>(key, (k) => fetchJson<T>(k as string), config)
}

/**
 * The translation table for the active language.
 *
 * Each block in this file is its own component (they own independent SWR
 * queries), so rather than thread `t` down as a prop from `MCPSettings` every
 * one of them reads it here. This whole surface — the master switch, the API
 * keys, the OAuth consent list, the audit log — used to be hardcoded English
 * while the settings dialog around it was translated into 35 languages.
 */
function useMcpTranslations() {
  const [language] = useLanguage()
  return translations[language]
}

/** Substitutes `{name}`-style placeholders in a translated string. */
const fill = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce(
    (out, [key, value]) => out.replace(`{${key}}`, String(value)),
    template,
  )

interface ApiKey {
  id: string
  name: string
  keyPrefix: string
  scopes: string[]
  isActive: boolean
  lastUsedAt: string | null
  createdAt: string
}

interface AuthorizedApp {
  id: string
  clientId: string
  clientName: string
  scopes: string[]
  resources: string[]
  createdAt: string
}

type AuditEntryType = 'request' | 'tool_call'

interface AuditLog {
  id: string
  authType: string
  action: string
  entryType: AuditEntryType
  toolName: string | null
  resourceType: string | null
  resourceId: string | null
  isMutation: boolean
  changes: {
    fields?: string[]
    apply_to?: string
    emailCount?: number
    exdateCount?: number
    rruleChanged?: boolean
  } | null
  durationMs: number | null
  success: boolean
  errorMessage: string | null
  createdAt: string
}

type AuditWindow = 'all' | '1h' | '24h' | '7d' | '30d'

interface AuditFilters {
  entryType: AuditEntryType | 'all'
  mutationsOnly: boolean
  failuresOnly: boolean
  toolName: string
  window: AuditWindow
}

const DEFAULT_AUDIT_FILTERS: AuditFilters = {
  entryType: 'all',
  mutationsOnly: false,
  failuresOnly: false,
  toolName: 'all',
  window: 'all',
}

function endpointUrl(): string {
  return typeof window !== 'undefined'
    ? `${window.location.origin}/api/mcp`
    : '/api/mcp'
}

type McpTranslations = ReturnType<typeof useMcpTranslations>

async function copyToClipboard(
  value: string,
  message: string,
  failure: string,
) {
  try {
    await navigator.clipboard.writeText(value)
    toast.success(message)
  } catch {
    toast.error(failure)
  }
}

/**
 * Both the relative buckets and the absolute fallback are localised: the
 * fallback previously called `toLocaleDateString()` with no argument, which
 * follows the BROWSER's locale rather than the language chosen in settings —
 * so a user who set Norwegian in a US-configured browser saw an American date.
 */
function formatRelative(
  iso: string | null,
  t: McpTranslations,
  language: string,
): string | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  const diff = Date.now() - then
  const minutes = Math.round(diff / 60000)
  if (minutes < 1) return t.relativeJustNow
  if (minutes < 60) return fill(t.relativeMinutesAgo, { n: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return fill(t.relativeHoursAgo, { n: hours })
  const days = Math.round(hours / 24)
  if (days < 30) return fill(t.relativeDaysAgo, { n: days })
  return new Date(iso).toLocaleDateString(language)
}

/**
 * Section shell: a titled block with an optional right-aligned action. Replaces
 * the previous stack of full Cards, which gave every group the same visual
 * weight and made the page read as an undifferentiated list of boxes.
 */
function Section({
  icon: Icon,
  title,
  description,
  action,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-muted/40">
            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-medium leading-6">{title}</h3>
            {description ? (
              <p className="text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  )
}

/** Compact scope summary: "Events, Settings +2" rather than 12 raw badges. */
function ScopeSummary({ scopes }: { scopes: string[] }) {
  const t = useMcpTranslations()
  const groups = useMemo(() => {
    const names: string[] = []
    for (const group of MCP_SCOPE_GROUPS) {
      const owned = group.scopes.filter((s) => scopes.includes(s))
      if (owned.length === 0) continue
      const writable = owned.some((s) => s.endsWith(':write'))
      names.push(
        writable
          ? fill(t.mcpScopeWritable, { name: group.label })
          : group.label,
      )
    }
    return names
  }, [scopes, t])

  if (groups.length === 0) {
    return (
      <span className="text-xs text-muted-foreground">
        {t.mcpScopeNoAccess}
      </span>
    )
  }

  const shown = groups.slice(0, 3)
  const extra = groups.length - shown.length
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((name) => (
        <Badge key={name} variant="secondary" className="font-normal">
          {name}
        </Badge>
      ))}
      {extra > 0 ? (
        <Badge variant="outline" className="font-normal">
          +{extra}
        </Badge>
      ) : null}
    </div>
  )
}

/**
 * Grouped scope picker with read/write columns and bulk presets, so granting
 * "read everything" is one click instead of six.
 */
function ScopePicker({
  value,
  onChange,
}: {
  value: string[]
  onChange: (next: string[]) => void
}) {
  const toggle = (scope: string) => {
    onChange(
      value.includes(scope)
        ? value.filter((s) => s !== scope)
        : [...value, scope],
    )
  }

  const t = useMcpTranslations()
  const allSelected = ALL_SCOPES.every((s) => value.includes(s))

  return (
    <div className="space-y-2.5">
      {/*
        `flex-wrap` and a truncating label. This row is a label plus two preset
        buttons whose text triples in length once translated ("Read only" →
        "Vain luku" is short, but "Select all" → "Изберете ги сите"), and in a
        `max-w-lg` dialog the presets were pushed past the edge.
      */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label className="min-w-0 truncate text-xs font-medium">
          {t.mcpPermissions}
        </Label>
        <div className="flex flex-wrap items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => onChange([...READ_ONLY_SCOPES])}
          >
            {t.mcpPermissionsReadOnly}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => onChange(allSelected ? [] : [...ALL_SCOPES])}
          >
            {allSelected ? t.mcpPermissionsClear : t.mcpPermissionsSelectAll}
          </Button>
        </div>
      </div>

      <div className="divide-y rounded-md border">
        {MCP_SCOPE_GROUPS.map((group) => {
          const readScope = group.scopes.find((s) => s.endsWith(':read'))
          const writeScope = group.scopes.find((s) => s.endsWith(':write'))
          return (
            <div
              key={group.resource}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm">{group.label}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {group.description}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {readScope ? (
                  <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-xs">
                    <Checkbox
                      checked={value.includes(readScope)}
                      onCheckedChange={() => toggle(readScope)}
                      aria-label={fill(t.mcpPermissionReadFor, {
                        name: group.label,
                      })}
                    />
                    {t.mcpPermissionRead}
                  </label>
                ) : null}
                {writeScope ? (
                  <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-xs">
                    <Checkbox
                      checked={value.includes(writeScope)}
                      onCheckedChange={() => toggle(writeScope)}
                      aria-label={fill(t.mcpPermissionWriteFor, {
                        name: group.label,
                      })}
                    />
                    {t.mcpPermissionWrite}
                  </label>
                ) : (
                  // Spacer aligning the read column when a group has no write
                  // scope. `min-w-` because "Write" is "Skriving"/"Kirjoita"
                  // elsewhere, and a hard 3.25rem misaligned those columns.
                  <span className="min-w-[3.25rem]" aria-hidden />
                )}
              </div>
            </div>
          )
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        {fill(t.mcpPermissionsGranted, {
          granted: value.length,
          total: ALL_SCOPES.length,
        })}
      </p>
    </div>
  )
}

function SectionSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-14 animate-pulse rounded-md bg-muted/50" />
      ))}
    </div>
  )
}

export default function MCPSettings() {
  const t = useMcpTranslations()

  // `rounded-lg border p-4` matches the import/export and build-info panels, so
  // switching settings tabs no longer changes the visual container.
  return (
    <div className="w-full space-y-4">
      <div className="w-full space-y-6 rounded-lg border p-4">
        <div>
          <h2 className="text-base font-semibold">{t.settingsMcp}</h2>
          <p className="text-sm text-muted-foreground">{t.settingsMcpDesc}</p>
        </div>
        <MCPConnection />
      </div>

      <div className="w-full rounded-lg border p-4">
        <MCPApiKeys />
      </div>

      <div className="w-full rounded-lg border p-4">
        <MCPOAuthApps />
      </div>

      <div className="w-full rounded-lg border p-4">
        <MCPAuditLogs />
      </div>
    </div>
  )
}

/**
 * Connection block: the master switch and the endpoint live together because
 * they are one decision ("is MCP on, and where do agents point"). Previously
 * these were three separate Cards including a static "Quick Start" list.
 */
function MCPConnection() {
  const t = useMcpTranslations()
  const { data, isLoading, mutate } = useMcpQuery<{
    settings?: { enabled?: boolean }
  }>(MCP_KEYS.settings)
  const enabled = data?.settings?.enabled ?? true
  const url = endpointUrl()

  const toggleMcp = async (value: boolean) => {
    const prev = data?.settings
    mutate({ settings: { enabled: value } }, { revalidate: false })
    try {
      await fetchJson(MCP_KEYS.settings, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: value }),
      })
    } catch {
      if (prev !== undefined) {
        mutate({ settings: prev }, { revalidate: false })
      } else {
        mutate()
      }
      toast.error(t.mcpUpdateSettingsFailed)
    }
  }

  return (
    <Section
      icon={Plug}
      title={t.mcpConnection}
      description={t.mcpConnectionDesc}
      action={
        isLoading ? (
          <Spinner className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <div className="flex items-center gap-2">
            {/*
              `truncate` with a `max-w`: this label sits in `Section`'s
              `shrink-0` action slot, so a long word ("Deaktivert",
              "Оневозможено") widened the slot and squeezed the section title
              beside it instead of yielding.
            */}
            <span
              className={cn(
                'max-w-[8rem] truncate text-xs',
                enabled ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {enabled ? t.mcpEnabled : t.mcpDisabled}
            </span>
            <Switch
              checked={enabled}
              onCheckedChange={toggleMcp}
              aria-label={t.mcpEnableLabel}
            />
          </div>
        )
      }
    >
      <div
        className={cn(
          'rounded-md border p-3 transition-opacity',
          !enabled && 'opacity-60',
        )}
      >
        <div className="flex min-w-0 items-center justify-between gap-2">
          <Label className="min-w-0 truncate text-xs text-muted-foreground">
            {t.mcpServerEndpoint}
          </Label>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 gap-1.5 px-2 text-xs"
            onClick={() =>
              copyToClipboard(url, t.mcpEndpointCopied, t.copyFailed)
            }
          >
            <ClipboardCopy className="h-3.5 w-3.5 shrink-0" />
            {t.copy}
          </Button>
        </div>
        <code className="mt-1 block break-all font-mono text-sm">{url}</code>
        {/*
          One sentence, not prose with a `<span className="font-medium">` in the
          middle. "Bearer" is the literal scheme name, so emphasising it meant
          the sentence had to be split into two translatable fragments around a
          fixed English word — which is exactly the shape that produces
          ungrammatical output in languages that order the clause differently.
        */}
        <p className="mt-2 text-xs text-muted-foreground">
          {t.mcpAuthenticateHint}
        </p>
      </div>
    </Section>
  )
}

function MCPApiKeys() {
  const t = useMcpTranslations()
  const [language] = useLanguage()
  const [showCreate, setShowCreate] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [newKeyScopes, setNewKeyScopes] = useState<string[]>(['events:read'])
  const [isCreating, setIsCreating] = useState(false)
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [revealCreatedKey, setRevealCreatedKey] = useState(false)
  const [editingKey, setEditingKey] = useState<ApiKey | null>(null)
  const [editingScopes, setEditingScopes] = useState<string[]>([])
  const [isSavingScopes, setIsSavingScopes] = useState(false)
  const [deletingKey, setDeletingKey] = useState<ApiKey | null>(null)
  const [isDeletingKey, setIsDeletingKey] = useState(false)

  const { data, isLoading, mutate } = useMcpQuery<{ keys: ApiKey[] }>(
    MCP_KEYS.apiKeys,
  )
  const keys = data?.keys ?? []

  const resetCreateForm = () => {
    setNewKeyName('')
    setNewKeyScopes(['events:read'])
  }

  const createKey = async () => {
    if (!newKeyName.trim() || newKeyScopes.length === 0) return
    setIsCreating(true)
    try {
      const res = await fetchJson<{ key: string }>(MCP_KEYS.apiKeys, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName.trim(), scopes: newKeyScopes }),
      })
      setCreatedKey(res.key)
      setRevealCreatedKey(false)
      setShowCreate(false)
      resetCreateForm()
      mutate()
    } catch {
      toast.error(t.mcpCreateKeyFailed)
    } finally {
      setIsCreating(false)
    }
  }

  const deleteKey = async () => {
    if (!deletingKey) return
    setIsDeletingKey(true)
    const prev = data?.keys ?? []
    mutate({ keys: removeById(prev, deletingKey.id) }, { revalidate: false })
    try {
      await fetchJson(MCP_KEYS.apiKeys, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deletingKey.id }),
      })
      toast.success(t.mcpApiKeyDeleted)
    } catch {
      mutate({ keys: prev }, { revalidate: false })
      toast.error(t.mcpDeleteKeyFailed)
    }
    setDeletingKey(null)
    setIsDeletingKey(false)
  }

  const saveScopes = async () => {
    if (!editingKey) return
    setIsSavingScopes(true)
    try {
      await fetchJson(MCP_KEYS.apiKeys, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingKey.id, scopes: editingScopes }),
      })
      toast.success(t.mcpPermissionsUpdated)
      setEditingKey(null)
      mutate()
    } catch {
      toast.error(t.mcpUpdatePermissionsFailed)
    } finally {
      setIsSavingScopes(false)
    }
  }

  return (
    <Section
      icon={Key}
      title={t.mcpApiKeys}
      description={t.mcpApiKeysDesc}
      action={
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="mr-1 h-4 w-4 shrink-0" />
          <span className="truncate">{t.mcpNewKey}</span>
        </Button>
      }
    >
      {isLoading ? (
        <SectionSkeleton />
      ) : keys.length === 0 ? (
        <Empty className="border border-dashed py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Key />
            </EmptyMedia>
            <EmptyTitle>{t.mcpNoApiKeys}</EmptyTitle>
            <EmptyDescription>{t.mcpNoApiKeysDesc}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="mr-1 h-4 w-4 shrink-0" />
              <span className="truncate">{t.mcpCreateFirstKey}</span>
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <ul className="divide-y rounded-md border">
          {keys.map((key) => {
            const lastUsed = formatRelative(key.lastUsedAt, t, language)
            return (
              <li
                key={key.id}
                className="flex items-center justify-between gap-3 px-3 py-2.5"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {key.name}
                    </span>
                    {!key.isActive ? (
                      <Badge
                        variant="outline"
                        className="shrink-0 whitespace-nowrap font-normal"
                      >
                        {t.mcpKeyInactive}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <code className="font-mono">{key.keyPrefix}…</code>
                    <span aria-hidden>·</span>
                    <span>
                      {lastUsed
                        ? fill(t.mcpKeyUsed, { when: lastUsed })
                        : t.mcpKeyNeverUsed}
                    </span>
                  </div>
                  <ScopeSummary scopes={key.scopes} />
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      aria-label={fill(t.mcpManageKey, { name: key.name })}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => {
                        setEditingKey(key)
                        setEditingScopes(key.scopes)
                      }}
                    >
                      <SlidersHorizontal className="mr-2 h-4 w-4 shrink-0" />
                      {t.mcpEditPermissions}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={() => setDeletingKey(key)}
                    >
                      <Trash2 className="mr-2 h-4 w-4 shrink-0" />
                      {t.mcpDeleteKey}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            )
          })}
        </ul>
      )}

      {/* Create */}
      <Dialog
        open={showCreate}
        onOpenChange={(open) => {
          setShowCreate(open)
          if (!open) resetCreateForm()
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t.mcpNewApiKeyTitle}</DialogTitle>
            <DialogDescription>{t.mcpNewApiKeyDesc}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="mcp-key-name">{t.mcpKeyNameLabel}</Label>
              <Input
                id="mcp-key-name"
                placeholder={t.mcpKeyNamePlaceholder}
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                autoFocus
              />
            </div>
            <ScopePicker value={newKeyScopes} onChange={setNewKeyScopes} />
            <Button
              className="w-full"
              onClick={createKey}
              disabled={
                isCreating || !newKeyName.trim() || newKeyScopes.length === 0
              }
            >
              {isCreating ? t.mcpCreatingKey : t.mcpCreateKey}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Created — one-time reveal */}
      <Dialog
        open={!!createdKey}
        onOpenChange={(open) => {
          if (!open) {
            setCreatedKey(null)
            setRevealCreatedKey(false)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.mcpKeyCreatedTitle}</DialogTitle>
            <DialogDescription>{t.mcpKeyCreatedDesc}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2">
              <code className="flex-1 break-all font-mono text-xs">
                {revealCreatedKey
                  ? createdKey
                  : `${createdKey?.slice(0, 12) ?? ''}${'•'.repeat(16)}`}
              </code>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                aria-label={revealCreatedKey ? t.mcpHideKey : t.mcpRevealKey}
                onClick={() => setRevealCreatedKey((v) => !v)}
              >
                {revealCreatedKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                aria-label={t.mcpCopyKey}
                onClick={() =>
                  createdKey &&
                  copyToClipboard(createdKey, t.mcpApiKeyCopied, t.copyFailed)
                }
              >
                <ClipboardCopy className="h-4 w-4" />
              </Button>
            </div>
            <Button
              className="w-full"
              onClick={() => {
                setCreatedKey(null)
                setRevealCreatedKey(false)
              }}
            >
              {t.mcpDone}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit permissions */}
      <Dialog
        open={!!editingKey}
        onOpenChange={(open) => {
          if (!open) setEditingKey(null)
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t.mcpPermissions}</DialogTitle>
            <DialogDescription>{editingKey?.name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <ScopePicker value={editingScopes} onChange={setEditingScopes} />
            <Button
              className="w-full"
              onClick={saveScopes}
              disabled={isSavingScopes}
            >
              {isSavingScopes ? t.mcpSavingPermissions : t.mcpSavePermissions}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <AlertDialog
        open={!!deletingKey}
        onOpenChange={(open) => {
          if (!open) setDeletingKey(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.mcpDeleteKeyTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {fill(t.mcpDeleteKeyDesc, { name: deletingKey?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => {
                e.preventDefault()
                void deleteKey()
              }}
              disabled={isDeletingKey}
            >
              {isDeletingKey ? t.mcpDeletingKey : t.mcpDeleteKey}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  )
}

function MCPOAuthApps() {
  const t = useMcpTranslations()
  const [language] = useLanguage()
  const [revoking, setRevoking] = useState<AuthorizedApp | null>(null)
  const [isRevoking, setIsRevoking] = useState(false)

  const { data, isLoading, mutate } = useMcpQuery<{ apps: AuthorizedApp[] }>(
    MCP_KEYS.authorizedApps,
  )
  const apps = data?.apps ?? []

  const revokeApp = async () => {
    if (!revoking) return
    setIsRevoking(true)
    const prev = data?.apps ?? []
    mutate({ apps: removeById(prev, revoking.id) }, { revalidate: false })
    try {
      await fetchJson(MCP_KEYS.authorizedApps, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: revoking.id }),
      })
      toast.success(t.mcpAccessRevoked)
    } catch {
      mutate({ apps: prev }, { revalidate: false })
      toast.error(t.mcpRevokeAccessFailed)
    }
    setRevoking(null)
    setIsRevoking(false)
  }

  return (
    <Section
      icon={Globe}
      title={t.mcpConnectedApps}
      description={t.mcpConnectedAppsDesc}
    >
      {isLoading ? (
        <SectionSkeleton rows={1} />
      ) : apps.length === 0 ? (
        <Empty className="border border-dashed py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Globe />
            </EmptyMedia>
            <EmptyTitle>{t.mcpNoConnectedApps}</EmptyTitle>
            <EmptyDescription>{t.mcpNoConnectedAppsDesc}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="divide-y rounded-md border">
          {apps.map((app) => (
            <li
              key={app.id}
              className="flex items-center justify-between gap-3 px-3 py-2.5"
            >
              <div className="min-w-0 space-y-1">
                <span className="truncate text-sm font-medium">
                  {app.clientName}
                </span>
                {/*
                  `toLocaleDateString(language)`, not the bare call: with no
                  argument this followed the browser's locale rather than the
                  language chosen in settings.
                */}
                <p className="text-xs text-muted-foreground">
                  {fill(t.mcpAppAuthorizedOn, {
                    date: new Date(app.createdAt).toLocaleDateString(language),
                  })}
                </p>
                <ScopeSummary scopes={app.scopes} />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => setRevoking(app)}
              >
                {t.mcpRevoke}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog
        open={!!revoking}
        onOpenChange={(open) => {
          if (!open) setRevoking(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.mcpRevokeTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {fill(t.mcpRevokeDesc, { name: revoking?.clientName ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => {
                e.preventDefault()
                void revokeApp()
              }}
              disabled={isRevoking}
            >
              {isRevoking ? t.mcpRevoking : t.mcpRevokeAccess}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  )
}

function AuditChangeSummary({ log }: { log: AuditLog }) {
  const t = useMcpTranslations()
  const changes = log.changes
  if (!changes) return null
  const bits: string[] = []
  if (changes.fields?.length) bits.push(changes.fields.join(', '))
  if (changes.apply_to) {
    bits.push(fill(t.mcpLogChangeScope, { scope: changes.apply_to }))
  }
  if (typeof changes.emailCount === 'number') {
    bits.push(fill(t.mcpLogChangeParticipants, { n: changes.emailCount }))
  }
  if (typeof changes.exdateCount === 'number') {
    bits.push(fill(t.mcpLogChangeExclusions, { n: changes.exdateCount }))
  }
  if (changes.rruleChanged) bits.push(t.mcpLogChangeRepeatRule)
  if (bits.length === 0) return null
  return (
    <p className="mt-0.5 text-xs text-muted-foreground">
      {t.mcpLogChanged}{' '}
      <span className="text-foreground">{bits.join(' · ')}</span>
    </p>
  )
}

const AUDIT_WINDOWS: AuditWindow[] = ['all', '1h', '24h', '7d', '30d']

function MCPAuditLogs() {
  const t = useMcpTranslations()
  const [language] = useLanguage()
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState<AuditFilters>(DEFAULT_AUDIT_FILTERS)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')

  // Debounce the search box so typing does not fire a request per keystroke.
  useEffect(() => {
    const handle = setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(handle)
  }, [searchInput])

  // Any filter change invalidates the current offset.
  const updateFilters = (patch: Partial<AuditFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }))
    setPage(1)
  }

  const { data, isLoading } = useMcpQuery<{
    logs: AuditLog[]
    toolNames?: string[]
    pagination?: { totalPages: number }
  }>(MCP_KEYS.auditLogs(page, filters, search), { keepPreviousData: true })
  const logs = data?.logs ?? []
  const toolNames = data?.toolNames ?? []
  const totalPages = data?.pagination?.totalPages ?? 1
  const windowLabels: Record<AuditWindow, string> = {
    all: t.mcpFilterWindowAll,
    '1h': t.mcpFilterWindow1h,
    '24h': t.mcpFilterWindow24h,
    '7d': t.mcpFilterWindow7d,
    '30d': t.mcpFilterWindow30d,
  }
  const filtersActive =
    filters.entryType !== 'all' ||
    filters.mutationsOnly ||
    filters.failuresOnly ||
    filters.toolName !== 'all' ||
    filters.window !== 'all' ||
    search !== ''

  return (
    <Section
      icon={ScrollText}
      title={t.mcpActivity}
      description={t.mcpActivityDesc}
      action={
        totalPages > 1 ? (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              {t.mcpPrevPage}
            </Button>
            <span className="px-1 text-xs text-muted-foreground">
              {page}/{totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              {t.mcpNextPage}
            </Button>
          </div>
        ) : null
      }
    >
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t.mcpFilterSearchPlaceholder}
              className="h-8 pl-8 text-xs"
              aria-label={t.mcpFilterSearchPlaceholder}
            />
            {searchInput ? (
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setSearchInput('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={t.mcpPermissionsClear}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{t.mcpPermissionsClear}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : null}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant={filtersActive ? 'secondary' : 'outline'}
                size="sm"
                className="h-8 text-xs"
              >
                <SlidersHorizontal className="size-3.5" />
                {t.mcpFilters}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-64 max-w-[calc(100vw-2rem)]"
            >
              <DropdownMenuLabel>{t.mcpFilters}</DropdownMenuLabel>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  {windowLabels[filters.window]}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={filters.window}
                    onValueChange={(value) =>
                      updateFilters({ window: value as AuditWindow })
                    }
                  >
                    {AUDIT_WINDOWS.map((window) => (
                      <DropdownMenuRadioItem key={window} value={window}>
                        {windowLabels[window]}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  {filters.entryType === 'all'
                    ? t.mcpFilterAllEntries
                    : filters.entryType === 'tool_call'
                      ? t.mcpFilterToolCalls
                      : t.mcpFilterRequests}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={filters.entryType}
                    onValueChange={(value) =>
                      updateFilters({
                        entryType: value as AuditFilters['entryType'],
                      })
                    }
                  >
                    <DropdownMenuRadioItem value="all">
                      {t.mcpFilterAllEntries}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="tool_call">
                      {t.mcpFilterToolCalls}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="request">
                      {t.mcpFilterRequests}
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  {filters.toolName === 'all'
                    ? t.mcpFilterAllTools
                    : filters.toolName}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-64 overflow-y-auto">
                  <DropdownMenuRadioGroup
                    value={filters.toolName}
                    onValueChange={(value) =>
                      updateFilters({ toolName: value })
                    }
                  >
                    <DropdownMenuRadioItem value="all">
                      {t.mcpFilterAllTools}
                    </DropdownMenuRadioItem>
                    {Array.from(
                      new Set([
                        ...toolNames,
                        ...(filters.toolName === 'all'
                          ? []
                          : [filters.toolName]),
                      ]),
                    ).map((name) => (
                      <DropdownMenuRadioItem key={name} value={name}>
                        {name}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={filters.mutationsOnly}
                onCheckedChange={(checked) =>
                  updateFilters({ mutationsOnly: checked })
                }
                onSelect={(event) => event.preventDefault()}
              >
                {t.mcpFilterDataChanges}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={filters.failuresOnly}
                onCheckedChange={(checked) =>
                  updateFilters({ failuresOnly: checked })
                }
                onSelect={(event) => event.preventDefault()}
              >
                {t.mcpFilterFailures}
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {filtersActive ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => {
                setFilters(DEFAULT_AUDIT_FILTERS)
                setSearchInput('')
                setSearch('')
                setPage(1)
              }}
            >
              {t.mcpPermissionsClear}
            </Button>
          ) : null}
        </div>
      </div>

      {isLoading ? (
        <SectionSkeleton rows={3} />
      ) : logs.length === 0 ? (
        <Empty className="border border-dashed py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ScrollText />
            </EmptyMedia>
            <EmptyTitle>
              {filtersActive ? t.mcpNoMatchingActivity : t.mcpNoActivityYet}
            </EmptyTitle>
            <EmptyDescription>
              {filtersActive
                ? t.mcpNoMatchingActivityDesc
                : t.mcpNoActivityYetDesc}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="divide-y rounded-md border">
          {logs.map((log) => (
            <li key={log.id} className="flex items-start gap-2.5 px-3 py-2">
              <span
                className={cn(
                  'mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full',
                  log.success
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400'
                    : 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400',
                )}
                aria-label={log.success ? t.mcpLogSucceeded : t.mcpLogFailed}
              >
                {log.success ? (
                  <Check className="h-2.5 w-2.5" />
                ) : (
                  <X className="h-2.5 w-2.5" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono text-xs">
                    {log.toolName ?? log.action}
                  </span>
                  {log.isMutation ? (
                    <Badge
                      variant="secondary"
                      className="h-4 shrink-0 px-1 py-0 text-[10px] font-normal"
                    >
                      {t.mcpLogWriteBadge}
                    </Badge>
                  ) : null}
                  {log.resourceType ? (
                    <span className="text-xs text-muted-foreground">
                      {log.resourceType}
                      {log.resourceId ? `:${log.resourceId.slice(0, 8)}` : ''}
                    </span>
                  ) : null}
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {formatRelative(log.createdAt, t, language)}
                  </span>
                </div>
                <AuditChangeSummary log={log} />
                {log.errorMessage ? (
                  <p className="mt-0.5 truncate text-xs text-destructive">
                    {log.errorMessage}
                  </p>
                ) : null}
                <span className="text-xs text-muted-foreground">
                  {fill(t.mcpLogVia, { authType: log.authType })}
                  {typeof log.durationMs === 'number'
                    ? ` · ${log.durationMs}ms`
                    : ''}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
