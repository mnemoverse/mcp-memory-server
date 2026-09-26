export type ProbeType = "json-field" | "text-regex";
export interface Probe {
  type: ProbeType;
  url: string;
  field?: string;
  regex?: string;
}
export interface Consumer {
  id: string;
  name: string;
  kind: "auto" | "track" | "manual";
  repo: string;
  fix: string;
  probe?: Probe;
}
export interface ProbeResult {
  status: "ok" | "lag" | "unchecked";
  version?: string;
  error?: string;
}
export interface Io {
  getJson(url: string): Promise<unknown>;
  getText(url: string): Promise<string>;
}
export function norm(v: unknown): string;
export function readableVersion(raw: unknown, where: string): string;
export function getPath(obj: unknown, path: string): unknown;
export function loadConsumers(json: unknown): Consumer[];
export function probeVersion(consumer: Consumer, io: Io): Promise<{ version: string }>;
export function waveTitle(version: string): string;
export function waveVersion(title: string): string | null;
export function isWaveIssue(issue: unknown): boolean;
export function atLeast(a: string, b: string): boolean;
export function resultsForWave(results: Record<string, ProbeResult>, waveVersion: string): Record<string, ProbeResult>;
export function renderConsumerLine(consumer: Consumer, version: string, result?: ProbeResult): string;
export function renderWaveBody(args: { version: string; consumers: Consumer[]; results?: Record<string, ProbeResult>; runUrl?: string }): string;
export function applyResults(body: string, consumers: Consumer[], results: Record<string, ProbeResult>): string;
export function allProbedGreen(consumers: Consumer[], results: Record<string, ProbeResult>): boolean;
export function allTicked(body: string, consumers: Consumer[]): boolean;
export function isStale(createdAtIso: string, nowMs: number, days?: number): boolean;
