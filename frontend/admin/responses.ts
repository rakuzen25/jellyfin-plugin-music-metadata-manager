import type { FieldDefinition, Row, CleanupOutcome, ArtistIdentity, Rule } from "./contracts.ts";
import type {
    ApplicationReport,
    Dependencies,
    Document,
    HistoryEntry,
    ImageDecision,
    InventoryEntry,
    JsonValue,
    JournalRecord,
    ManagedRecord,
    MetadataPolicy,
    SourceSnapshot,
    View,
} from "./contracts.ts";
export interface NativeRecord {
    match?: string | null;
    id: string;
    name: string;
    path?: string;
    kind?: string;
}
export interface IdentityRecords {
    artists: NativeRecord[];
    persons: NativeRecord[];
}
export interface Status {
    revision: number;
    active: number;
    drafts: number;
    identities: number;
    identityDrafts: number;
    managedItems: number;
    metadataPolicies: number;
    policyDrafts: number;
    managedRecords: number;
    pending: number;
    refreshPending: number;
    reports: ApplicationReport[];
    unmatchedRules: string[];
    history: HistoryEntry[];
    identityStatus: {
        id: string;
        preferredName: string;
        errors: string[];
    }[];
    recreatedRecords: {
        key: string;
        value: string;
    }[];
}
export interface ManagerDetails {
    linkedOnly?: boolean;
    IsLocked?: boolean;
    id: string;
    name: string;
    kind: string;
    path: string;
    stored: Record<string, JsonValue>;
    effective: Record<string, JsonValue>;
    policy: MetadataPolicy;
    policies: MetadataPolicy[];
    drafts: MetadataPolicy[];
    dependencies: Dependencies;
    providerCandidates: {
        key: string;
        recordId: string;
        confirmed: boolean;
    }[];
    providers: {
        name: string;
        key: string | null;
    }[];
    locks: string[];
    isLocked: boolean;
    original: ManagedRecord | null;
    correctionOriginal: JournalRecord | null;
    images: {
        type: string;
        path: string;
    }[];
    history: HistoryEntry[];
    refreshBehavior: string;
}
export interface Comparison {
    itemId: string;
    snapshot: SourceSnapshot;
    images: {
        url: string;
        type: string;
        providerName: string;
        width: number;
        height: number;
    }[];
    notes: string[];
}
export type ApiResult<P extends string> = P extends "manager/fields"
    ? FieldDefinition[]
    : P extends "preview"
      ? ReviewPreview
      : P extends "activate"
        ? ActivationResult
        : P extends "identities/names"
          ? AliasSuggestion[]
          : P extends `identities/suggestions?${string}`
            ? {
                  suggestions: AliasSuggestion[];
              }
            : P extends "rules" | "export"
              ? Document
              : P extends "status"
                ? Status
                : P extends "manager/issues"
                  ? {
                        revision: number;
                        items: Issue[];
                        archivedReports: ApplicationReport[];
                    }
                  : P extends "libraries"
                    ? {
                          id: string;
                          name: string;
                          paths: string[];
                      }[]
                    : P extends "identities/records"
                      ? IdentityRecords
                      : P extends `items?${string}`
                        ? View[]
                        : P extends `manager/inventory?${string}`
                          ? {
                                total: number;
                                start: number;
                                limit: number;
                                items: InventoryEntry[];
                                view: string;
                            }
                          : P extends `manager/items/${string}/dependencies?${string}`
                            ? Dependencies
                            : P extends `manager/items/${string}/tracks`
                              ? {
                                    albumId: string;
                                    total: number;
                                    items: (NativeRecord & {
                                        artists: string[];
                                        discNumber: number | null;
                                        trackNumber: number | null;
                                        managed: boolean;
                                    })[];
                                }
                              : P extends `manager/items/${string}/images/${string}` | "manager/images/cache"
                                ? ImageDecision
                                : P extends `manager/items/${string}`
                                  ? ManagerDetails
                                  : P extends "manager/compare"
                                    ? Comparison
                                    : P extends "apply"
                                      ? {
                                            queued: number;
                                        }
                                      : P extends `manager/navigation?${string}`
                                        ? {
                                              items: Record<string, NativeRecord | null>;
                                              rules: Record<string, NativeRecord | null>;
                                              paths: Record<string, NativeRecord | null>;
                                          }
                                        : P extends "manager/errors/acknowledge"
                                          ? {
                                                acknowledged: string[];
                                            }
                                          : unknown;
export interface IdentityPreview {
    id: string;
    name: string;
    aliases: string[];
    favoritePolicy: string;
    bindings: {
        id: string;
        name: string;
        type: string;
    }[];
    affectedItems: {
        id: string;
        path: string;
    }[];
}
export interface MetadataPreview {
    identityId?: string | null;
    id: string;
    name: string;
    policyId: string;
    error?: string;
    scrobblingRelevant: boolean;
    before: Record<string, JsonValue>;
    after: Record<string, JsonValue>;
    images: Record<string, ImageDecision>;
    storedImages: Record<string, { path: string; hash: string | null }[]>;
    locks: string[];
}
export interface RestorationPreview {
    id: string;
    name: string;
    operation: string;
    before: Record<string, JsonValue>;
    after: Record<string, JsonValue>;
    fields: string[];
}
export interface ReviewPreview {
    token: string;
    revision: number;
    warnings: string[];
    unmatchedRules: string[];
    items: Row[];
    identities: IdentityPreview[];
    metadata: MetadataPreview[];
    restoration: RestorationPreview[];
    cleanup: CleanupPreview[];
}
export interface ActivationResult {
    queued: number;
    cleanupResults: CleanupOutcome[];
    revision: number;
}
export interface IssueEvidence extends Partial<Dependencies> {
    message?: string;
    credit?: string;
    role?: string;
    library?: string;
    items?: NativeRecord[];
    candidates?: NativeRecord[];
    missing?: string[];
    identity?: ArtistIdentity;
    identities?: {
        id: string;
        name: string;
        match: string | null;
    }[];
}
export interface Issue {
    key: string;
    type: string;
    status: string;
    name: string;
    reason: string;
    canRepair: boolean;
    canDelete: boolean;
    canAcknowledge: boolean;
    itemId: string | null;
    identityId: string | null;
    causeCode: string;
    context: Partial<Rule & ArtistIdentity & ApplicationReport & Dependencies> & {
        credit?: string;
        role?: string;
        library?: string;
    };
    guidance: {
        group: string;
        summary: string;
        action: string;
        path: string | null;
        evidence: IssueEvidence | null;
    };
}
export interface IssueContext {
    action: string;
    eligible: Issue[];
    skipped: Issue[];
}
export interface BulkEntry {
    key: string;
    kind: string;
    id: string;
    live: boolean;
    draft: boolean;
    name: string;
}
export interface BulkContext {
    action: string;
    eligible: BulkEntry[];
    skipped: BulkEntry[];
}
export interface RepairQueue {
    tasks: {
        key: string;
        issues: Issue[];
    }[];
    index: number;
    staged: Map<
        string,
        {
            field: "edits" | "identityEdits" | "metadataEdits";
            data: Rule | ArtistIdentity | MetadataPolicy;
            keys: string[];
            localKey: string;
            sequence: number;
        }
    >;
    skipped: Issue[];
}
export interface IssueVerification {
    context: IssueContext;
    result: Partial<ActivationResult>;
    started: number;
    rows: {
        issue: Issue;
        state: string;
        reason?: string | null;
        recoveryPath?: string | null;
    }[];
}
export interface AliasSuggestion {
    locale?: string;
    name: string;
    source: string;
    artists?: NativeRecord[];
    persons?: NativeRecord[];
}
export interface CleanupPreview {
    id: string;
    name: string;
    dependencies: Dependencies;
    files: { path: string; hash: string }[];
}
