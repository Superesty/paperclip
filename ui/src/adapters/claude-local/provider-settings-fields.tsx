import { useEffect, useRef, useState } from "react";
import type { CreateConfigValues } from "@paperclipai/adapter-utils";
import type { CompanySecret, EnvBinding } from "@paperclipai/shared";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";

const inputClass =
  "w-full rounded-md border border-border px-2.5 py-1.5 bg-transparent outline-none text-sm font-mono placeholder:text-muted-foreground/40";

const PROVIDER_OPTIONS = [
  { value: "", label: "Anthropic (default)" },
  { value: "minimax", label: "MiniMax" },
  { value: "z", label: "z.ai" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "custom", label: "Custom" },
];

const PROVIDER_CONFIG: Record<string, { apiKeyEnvVar: string; baseUrl?: string }> = {
  "": { apiKeyEnvVar: "ANTHROPIC_API_KEY" },
  minimax: { apiKeyEnvVar: "MINIMAX_API_KEY", baseUrl: "https://api.minimax.chat/v1" },
  z: { apiKeyEnvVar: "ZAI_API_KEY", baseUrl: "https://api.z.ai/api/coding/paas/v4" },
  openrouter: { apiKeyEnvVar: "OPENROUTER_API_KEY", baseUrl: "https://openrouter.ai/api/v1" },
  custom: { apiKeyEnvVar: "" },
};

function isValidUrl(value: string): boolean {
  if (!value) return true; // empty is ok
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export interface ProviderSettingsFieldsProps {
  values: CreateConfigValues;
  set: (patch: Partial<CreateConfigValues>) => void;
  envBindingsValue: Record<string, EnvBinding>;
  onEnvBindingsChange: (env: Record<string, EnvBinding> | undefined) => void;
  availableSecrets: CompanySecret[];
  onCreateSecret: (name: string, value: string) => Promise<CompanySecret>;
}

type Row = {
  key: string;
  source: "plain" | "secret";
  plainValue: string;
  secretId: string;
};

function toRows(rec: Record<string, EnvBinding> | null | undefined): Row[] {
  if (!rec || typeof rec !== "object") {
    return [{ key: "", source: "plain", plainValue: "", secretId: "" }];
  }
  const entries = Object.entries(rec).map(([k, binding]) => {
    if (typeof binding === "string") {
      return { key: k, source: "plain" as const, plainValue: binding, secretId: "" };
    }
    if (typeof binding === "object" && binding !== null && "type" in binding && (binding as { type?: unknown }).type === "secret_ref") {
      const recBinding = binding as { secretId?: unknown };
      return { key: k, source: "secret" as const, plainValue: "", secretId: typeof recBinding.secretId === "string" ? recBinding.secretId : "" };
    }
    if (typeof binding === "object" && binding !== null && "type" in binding && (binding as { type?: unknown }).type === "plain") {
      const recBinding = binding as { value?: unknown };
      return { key: k, source: "plain" as const, plainValue: typeof recBinding.value === "string" ? recBinding.value : "", secretId: "" };
    }
    return { key: k, source: "plain" as const, plainValue: "", secretId: "" };
  });
  return [...entries, { key: "", source: "plain", plainValue: "", secretId: "" }];
}

function EnvVarEditor({
  value,
  secrets,
  onCreateSecret,
  onChange,
}: {
  value: Record<string, EnvBinding>;
  secrets: CompanySecret[];
  onCreateSecret: (name: string, value: string) => Promise<CompanySecret>;
  onChange: (env: Record<string, EnvBinding> | undefined) => void;
}) {
  const [rows, setRows] = useState<Row[]>(() => toRows(value));
  const [sealError, setSealError] = useState<string | null>(null);
  const valueRef = useRef(value);
  const emittingRef = useRef(false);

  useEffect(() => {
    if (emittingRef.current) {
      emittingRef.current = false;
      valueRef.current = value;
      return;
    }
    if (value !== valueRef.current) {
      valueRef.current = value;
      setRows(toRows(value));
    }
  }, [value]);

  function emit(nextRows: Row[]) {
    const rec: Record<string, EnvBinding> = {};
    for (const row of nextRows) {
      const k = row.key.trim();
      if (!k) continue;
      if (row.source === "secret") {
        if (row.secretId) {
          rec[k] = { type: "secret_ref", secretId: row.secretId, version: "latest" as const };
        } else {
          rec[k] = { type: "plain", value: row.plainValue };
        }
      } else {
        rec[k] = { type: "plain", value: row.plainValue };
      }
    }
    emittingRef.current = true;
    onChange(Object.keys(rec).length > 0 ? rec : undefined);
  }

  function updateRow(i: number, patch: Partial<Row>) {
    const withPatch = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    if (
      withPatch[withPatch.length - 1].key ||
      withPatch[withPatch.length - 1].plainValue ||
      withPatch[withPatch.length - 1].secretId
    ) {
      withPatch.push({ key: "", source: "plain", plainValue: "", secretId: "" });
    }
    setRows(withPatch);
    emit(withPatch);
  }

  function removeRow(i: number) {
    const next = rows.filter((_, idx) => idx !== i);
    if (
      next.length === 0 ||
      next[next.length - 1].key ||
      next[next.length - 1].plainValue ||
      next[next.length - 1].secretId
    ) {
      next.push({ key: "", source: "plain", plainValue: "", secretId: "" });
    }
    setRows(next);
    emit(next);
  }

  function defaultSecretName(key: string): string {
    return key
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64);
  }

  async function sealRow(i: number) {
    const row = rows[i];
    if (!row) return;
    const key = row.key.trim();
    const plain = row.plainValue;
    if (!key || plain.length === 0) return;

    const suggested = defaultSecretName(key) || "secret";
    const name = window.prompt("Secret name", suggested)?.trim();
    if (!name) return;

    try {
      setSealError(null);
      const created = await onCreateSecret(name, plain);
      updateRow(i, {
        source: "secret",
        secretId: created.id,
      });
    } catch (err) {
      setSealError(err instanceof Error ? err.message : "Failed to create secret");
    }
  }

  return (
    <div className="space-y-1.5">
      {rows.map((row, i) => {
        const isTrailing =
          i === rows.length - 1 &&
          !row.key &&
          !row.plainValue &&
          !row.secretId;
        return (
          <div key={i} className="flex items-center gap-1.5">
            <input
              className={cn(inputClass, "flex-[2]")}
              placeholder="KEY"
              value={row.key}
              onChange={(e) => updateRow(i, { key: e.target.value })}
            />
            <select
              className={cn(inputClass, "flex-[1] bg-background")}
              value={row.source}
              onChange={(e) =>
                updateRow(i, {
                  source: e.target.value === "secret" ? "secret" : "plain",
                  ...(e.target.value === "plain" ? { secretId: "" } : {}),
                })
              }
            >
              <option value="plain">Plain</option>
              <option value="secret">Secret</option>
            </select>
            {row.source === "secret" ? (
              <>
                <select
                  className={cn(inputClass, "flex-[3] bg-background")}
                  value={row.secretId}
                  onChange={(e) => updateRow(i, { secretId: e.target.value })}
                >
                  <option value="">Select secret...</option>
                  {secrets.map((secret) => (
                    <option key={secret.id} value={secret.id}>
                      {secret.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="inline-flex items-center rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent/50 transition-colors shrink-0"
                  onClick={() => sealRow(i)}
                  disabled={!row.key.trim() || !row.plainValue}
                  title="Create secret from current plain value"
                >
                  New
                </button>
              </>
            ) : (
              <>
                <input
                  className={cn(inputClass, "flex-[3]")}
                  placeholder="value"
                  value={row.plainValue}
                  onChange={(e) => updateRow(i, { plainValue: e.target.value })}
                />
                <button
                  type="button"
                  className="inline-flex items-center rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent/50 transition-colors shrink-0"
                  onClick={() => sealRow(i)}
                  disabled={!row.key.trim() || !row.plainValue}
                  title="Store value as secret and replace with reference"
                >
                  Seal
                </button>
              </>
            )}
            {!isTrailing ? (
              <button
                type="button"
                className="shrink-0 p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                onClick={() => removeRow(i)}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : (
              <div className="w-[26px] shrink-0" />
            )}
          </div>
        );
      })}
      {sealError && <p className="text-[11px] text-destructive">{sealError}</p>}
      <p className="text-[11px] text-muted-foreground/60">
        PAPERCLIP_* variables are injected automatically at runtime.
      </p>
    </div>
  );
}

export function ProviderSettingsFields({
  values,
  set,
  envBindingsValue,
  onEnvBindingsChange,
  availableSecrets,
  onCreateSecret,
}: ProviderSettingsFieldsProps) {
  const cloudProviderPresetId = (values as unknown as Record<string, unknown>).cloudProviderPresetId as string | undefined;
  const customBaseUrl = (values as unknown as Record<string, unknown>).customBaseUrl as string | undefined;

  const currentProvider = cloudProviderPresetId ?? "";
  const providerConfig = PROVIDER_CONFIG[currentProvider];
  const showCustomBaseUrl = currentProvider === "custom";
  const urlError = showCustomBaseUrl && customBaseUrl && !isValidUrl(customBaseUrl)
    ? "Must be a valid HTTP or HTTPS URL"
    : null;

  function handleProviderChange(newProvider: string) {
    const config = PROVIDER_CONFIG[newProvider] ?? {};
    const updates: Partial<CreateConfigValues> = { cloudProviderPresetId: newProvider };

    // Set base URL from config if available
    if (config.baseUrl) {
      updates.customBaseUrl = config.baseUrl;
    }

    set(updates);

    // Pre-fill envBindings with API key env var if empty
    if (config.apiKeyEnvVar && Object.keys(envBindingsValue).length === 0) {
      onEnvBindingsChange({ [config.apiKeyEnvVar]: { type: "plain" as const, value: "" } });
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-foreground">Provider</label>
        <select
          className={cn(inputClass, "bg-background")}
          value={currentProvider}
          onChange={(e) => handleProviderChange(e.target.value)}
        >
          {PROVIDER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {showCustomBaseUrl && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">Custom Base URL</label>
          <input
            type="text"
            className={cn(inputClass, urlError && "border-destructive")}
            placeholder="https://api.example.com/v1"
            value={customBaseUrl ?? ""}
            onChange={(e) => set({ customBaseUrl: e.target.value })}
          />
          {urlError && (
            <p className="text-[11px] text-destructive">{urlError}</p>
          )}
        </div>
      )}

      {providerConfig?.apiKeyEnvVar && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">API Key</label>
          <div className="flex items-center gap-1.5">
            <input
              className={cn(inputClass, "flex-[2]", "!bg-muted/20")}
              value={providerConfig.apiKeyEnvVar}
              readOnly
            />
            <span className="text-xs text-muted-foreground">=</span>
            <input
              className={cn(inputClass, "flex-[3]")}
              placeholder="Enter API key value"
              value={(envBindingsValue[providerConfig.apiKeyEnvVar] as { value?: string } | undefined)?.value ?? ""}
              onChange={(e) => onEnvBindingsChange({
                ...envBindingsValue,
                [providerConfig.apiKeyEnvVar]: { type: "plain", value: e.target.value }
              })}
            />
            <button
              type="button"
              className="inline-flex items-center rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent/50 transition-colors shrink-0"
              disabled={!envBindingsValue[providerConfig.apiKeyEnvVar]}
              title="Store value as secret"
              onClick={async () => {
                const current = envBindingsValue[providerConfig.apiKeyEnvVar] as { value?: string } | undefined;
                if (!current?.value) return;
                const suggested = providerConfig.apiKeyEnvVar.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64) || "secret";
                const name = window.prompt("Secret name", suggested)?.trim();
                if (!name) return;
                try {
                  const created = await onCreateSecret(name, current.value);
                  onEnvBindingsChange({
                    ...envBindingsValue,
                    [providerConfig.apiKeyEnvVar]: { type: "secret_ref", secretId: created.id, version: "latest" as const }
                  });
                } catch (err) {
                  console.error("Failed to create secret:", err);
                }
              }}
            >
              Seal
            </button>
          </div>
        </div>
      )}

      {!providerConfig?.apiKeyEnvVar && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">Environment Bindings</label>
          <EnvVarEditor
            value={envBindingsValue}
            secrets={availableSecrets}
            onCreateSecret={onCreateSecret}
            onChange={onEnvBindingsChange}
          />
        </div>
      )}
    </div>
  );
}
