import { parse as parseYaml } from "yaml";

/**
 * Structured, dual-channel bead memory (RFC §9.6.1; design D6). YAML frontmatter
 * + six named Markdown sections. Serialization is canonical and deterministic:
 * `parse → serialize` is byte-identical for any value produced by `serialize`.
 */

export const APPROACH_CHANNELS = ["impl", "test-authoring"] as const;
export type ApproachChannel = (typeof APPROACH_CHANNELS)[number];

export const SLOT_FOCI = ["subject", "predicate", "object"] as const;
export type SlotFocus = (typeof SLOT_FOCI)[number];

export type ApproachEntry = {
  /** Structural identifier from the test-approach taxonomy (e.g. `mock-call-order`) or a free label. */
  approach_label: string;
  /** Iteration range/point this approach spanned, e.g. `1-3` or `7`. */
  attempted_at_iter: string;
  triple_slot_focus: SlotFocus | null;
  summary: string;
  /** Carried for compaction provenance; not all entries reference a single triple. */
  triple_id?: string;
  focal_verdict?: "pass" | "fail";
};

export type VerifierSignal = {
  iter: number;
  decision: "accept" | "reject";
  /** `intent_path[aspect] "subject predicate object"` — the failing/observed triple. */
  triple_id: string;
  polarity: "positive" | "negative";
  focal_verdict: "pass" | "fail";
  support_quality: "ok" | "low_confidence";
  /** Rationale slot-focus (§3.4.1 classifier); preserved by compaction. */
  slot_focus: SlotFocus | null;
  /** The impl/test approach active at this iteration; preserved by compaction. */
  approach_label: string;
  /** Which channel the approach belongs to (impl vs test-authoring), for compaction routing. */
  channel: ApproachChannel;
  evidence_quote: string;
  /** Verbose; dropped by mechanical compaction. */
  rationale?: string;
};

export type BeadMemory = {
  bead_id: string;
  role: string;
  last_iter: number;
  last_compacted_at_iter: number;
  current_diagnosis: string;
  approaches_impl: ApproachEntry[];
  approaches_test_authoring: ApproachEntry[];
  verifier_signals: VerifierSignal[];
  intent_set_in_scope: string[];
  files_being_modified: string[];
};

const NONE = "(none)";

export function emptyBeadMemory(beadId: string, role: string): BeadMemory {
  return {
    bead_id: beadId,
    role,
    last_iter: 0,
    last_compacted_at_iter: 0,
    current_diagnosis: "",
    approaches_impl: [],
    approaches_test_authoring: [],
    verifier_signals: [],
    intent_set_in_scope: [],
    files_being_modified: [],
  };
}

const slot = (focus: SlotFocus | null): string => focus ?? "none";

function serializeApproach(entry: ApproachEntry): string {
  const provenance = entry.triple_id
    ? ` [${entry.triple_id} · ${entry.focal_verdict ?? "?"}]`
    : "";
  return `- [iter ${entry.attempted_at_iter}] ${entry.approach_label} — ${entry.summary}${provenance} Triple-slot focus: ${slot(entry.triple_slot_focus)}.`;
}

function serializeSignal(signal: VerifierSignal): string {
  return `- [iter ${signal.iter}] ${signal.decision} — ${signal.triple_id}. Polarity: ${signal.polarity}. focal_verdict: ${signal.focal_verdict}. support_quality: ${signal.support_quality}. Slot: ${slot(signal.slot_focus)}. Approach: ${signal.approach_label} (${signal.channel}). Evidence: ${signal.evidence_quote}.`;
}

function serializeList<T>(items: T[], render: (item: T) => string): string {
  return items.length === 0 ? NONE : items.map(render).join("\n");
}

/** Canonical, deterministic serialization. */
export function serializeBeadMemory(memory: BeadMemory): string {
  const frontmatter = [
    "---",
    `bead_id: ${memory.bead_id}`,
    `role: ${memory.role}`,
    `last_iter: ${memory.last_iter}`,
    `last_compacted_at_iter: ${memory.last_compacted_at_iter}`,
    "---",
  ].join("\n");

  const sections = [
    `## Current diagnosis\n${memory.current_diagnosis.trim().length === 0 ? NONE : memory.current_diagnosis.trim()}`,
    `## Approaches tried (impl)\n${serializeList(memory.approaches_impl, serializeApproach)}`,
    `## Approaches tried (test-authoring)\n${serializeList(memory.approaches_test_authoring, serializeApproach)}`,
    `## Verifier signals (last 3)\n${serializeList(memory.verifier_signals, serializeSignal)}`,
    `## Intent set in scope\n${serializeList(memory.intent_set_in_scope, (line) => `- ${line}`)}`,
    `## Files being modified\n${serializeList(memory.files_being_modified, (line) => `- ${line}`)}`,
  ];

  return `${frontmatter}\n\n${sections.join("\n\n")}\n`;
}

// ---- parsing ---------------------------------------------------------------

const APPROACH_RE =
  /^- \[iter (.+?)\] (.+?) — (.+?)(?: \[(.+?) · (.+?)\])? Triple-slot focus: (subject|predicate|object|none)\.$/;
const SIGNAL_RE =
  /^- \[iter (\d+)\] (accept|reject) — (.+?)\. Polarity: (positive|negative)\. focal_verdict: (pass|fail)\. support_quality: (ok|low_confidence)\. Slot: (subject|predicate|object|none)\. Approach: (.+?) \((impl|test-authoring)\)\. Evidence: (.*)\.$/;

function splitSections(body: string): Map<string, string> {
  const out = new Map<string, string>();
  let current: string | null = null;
  let buffer: string[] = [];
  const flush = (): void => {
    if (current !== null) out.set(current, buffer.join("\n").trim());
  };
  for (const line of body.split("\n")) {
    const heading = line.match(/^## (.+)$/);
    if (heading) {
      flush();
      current = heading[1];
      buffer = [];
    } else if (current !== null) {
      buffer.push(line);
    }
  }
  flush();
  return out;
}

function parseListSection(section: string | undefined): string[] {
  if (!section || section.trim() === NONE || section.trim() === "") return [];
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim());
}

function parseApproaches(section: string | undefined): ApproachEntry[] {
  if (!section || section.trim() === NONE) return [];
  const entries: ApproachEntry[] = [];
  for (const line of section.split("\n").map((l) => l.trim())) {
    const m = line.match(APPROACH_RE);
    if (!m) continue;
    entries.push({
      attempted_at_iter: m[1],
      approach_label: m[2],
      summary: m[3],
      triple_id: m[4] || undefined,
      focal_verdict: (m[5] as "pass" | "fail") || undefined,
      triple_slot_focus: m[6] === "none" ? null : (m[6] as SlotFocus),
    });
  }
  return entries;
}

function parseSignals(section: string | undefined): VerifierSignal[] {
  if (!section || section.trim() === NONE) return [];
  const signals: VerifierSignal[] = [];
  for (const line of section.split("\n").map((l) => l.trim())) {
    const m = line.match(SIGNAL_RE);
    if (!m) continue;
    signals.push({
      iter: Number(m[1]),
      decision: m[2] as "accept" | "reject",
      triple_id: m[3],
      polarity: m[4] as "positive" | "negative",
      focal_verdict: m[5] as "pass" | "fail",
      support_quality: m[6] as "ok" | "low_confidence",
      slot_focus: m[7] === "none" ? null : (m[7] as SlotFocus),
      approach_label: m[8],
      channel: m[9] as ApproachChannel,
      evidence_quote: m[10],
    });
  }
  return signals;
}

export function parseBeadMemory(raw: string): BeadMemory {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  const frontmatter = fmMatch ? (parseYaml(fmMatch[1]) as Record<string, unknown>) : {};
  const body = fmMatch ? raw.slice(fmMatch[0].length) : raw;
  const sections = splitSections(body);

  const diagnosisRaw = sections.get("Current diagnosis") ?? "";
  return {
    bead_id: String(frontmatter.bead_id ?? ""),
    role: String(frontmatter.role ?? ""),
    last_iter: Number(frontmatter.last_iter ?? 0),
    last_compacted_at_iter: Number(frontmatter.last_compacted_at_iter ?? 0),
    current_diagnosis: diagnosisRaw.trim() === NONE ? "" : diagnosisRaw,
    approaches_impl: parseApproaches(sections.get("Approaches tried (impl)")),
    approaches_test_authoring: parseApproaches(sections.get("Approaches tried (test-authoring)")),
    verifier_signals: parseSignals(sections.get("Verifier signals (last 3)")),
    intent_set_in_scope: parseListSection(sections.get("Intent set in scope")),
    files_being_modified: parseListSection(sections.get("Files being modified")),
  };
}

/** Append an approach to the named channel (impl vs test-authoring), per §3.4 dual-channel. */
export function recordApproach(memory: BeadMemory, channel: ApproachChannel, entry: ApproachEntry): BeadMemory {
  if (channel === "impl") {
    return { ...memory, approaches_impl: [...memory.approaches_impl, entry] };
  }
  return { ...memory, approaches_test_authoring: [...memory.approaches_test_authoring, entry] };
}
