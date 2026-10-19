// Public JSON shapes mirrored from the plugin-owned Core contracts.
export type JsonValue =
    | null
    | boolean
    | number
    | string
    | JsonValue[]
    | {
          [key: string]: JsonValue;
      };
export interface JournalRecord {
    id: string;
    path: string;
    original: Record<string, JsonValue>;
    applied: Record<string, JsonValue>;
    ruleIds: string[];
}
export interface Journal {
    identityNames: Record<string, string>;
    metadata: Record<string, ManagedRecord>;
    history: HistoryEntry[];
    restores: Record<string, RestoreValues>;
    deletedRecords: Record<string, string>;
    reports: ApplicationReport[];
    schemaVersion: number;
    items: Record<string, JournalRecord>;
    refreshPending: string[];
    acknowledgedErrors: string[];
    errors: string[];
}
export interface Change {
    metadataEdits: MetadataPolicy[];
    activatePolicies: string[];
    disablePolicies: string[];
    deletePolicies: string[];
    relinquish: Relinquish[];
    cleanupIds: string[];
    identityEdits: ArtistIdentity[];
    activateIdentities: string[];
    disableIdentities: string[];
    deleteIdentities: string[];
    edits: Rule[];
    activateIds: string[];
    disableIds: string[];
    deleteIds: string[];
}
export interface Activation {
    token: string;
}
export interface Row {
    id: string;
    path: string;
    kind: string;
    locked: boolean;
    ruleIds: string[];
    before: Record<string, JsonValue>;
    after: Record<string, JsonValue>;
    changedFields: string[];
    releasedFields: string[];
}
export interface Preview {
    token: string;
    revision: number;
    restoration: unknown[];
    metadata: unknown[];
    cleanup: unknown[];
    identities: unknown[];
    items: Row[];
    unmatchedRules: string[];
    warnings: string[];
}
export interface ManagedRecord {
    id: string;
    original: Record<string, JsonValue>;
    applied: Record<string, JsonValue>;
    originalImages: Record<string, ImageDecision>;
    appliedImages: Record<string, ImageDecision>;
}
export interface RestoreValues {
    fields: Record<string, JsonValue>;
    images: Record<string, ImageDecision>;
}
export interface Relinquish {
    itemId: string;
    fields: string[];
    images: string[];
    restoreOriginal: boolean;
}
export interface ApplicationReport {
    id: string;
    message: string;
    createdAt: string | null;
    itemId: string | null;
    archivedAt: string | null;
}
export interface ReportAcknowledgment {
    ids: string[];
}
export interface DraftTarget {
    kind: string;
    id: string;
}
export interface DraftDiscard {
    expectedRevision: number;
    targets: DraftTarget[];
}
export interface CompareRequest {
    itemId: string;
    provider: string;
    key: string;
    recordId: string;
    confirm: boolean;
}
export interface ImageCacheRequest {
    itemId: string;
    snapshotId: string;
    url: string;
    type: string;
}
export interface HistoryEntry {
    time: string;
    revision: number;
    itemId: string;
    operation: string;
    fields: string[];
}
export interface IssueEntry {
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
    context: unknown | null;
    causeCode: string;
    guidance: unknown | null;
}
export interface CleanupOutcome {
    id: string;
    outcome: string;
    reason: string | null;
    recoveryPath: string | null;
}
export interface NavigationPath {
    key: string;
    path: string;
    kind: string;
}
export interface InventoryRecord {
    id: string;
    name: string;
    kind: string;
    path: string | null;
    representative: boolean;
}
export interface InventoryEntry {
    id: string;
    name: string;
    kind: string;
    path: string | null;
    library: string;
    managed: boolean;
    identityId: string | null;
    aliases: string[];
    records: InventoryRecord[];
    missingBinding: boolean;
}
export interface MusicUse {
    id: string;
    name: string;
    path: string;
    library: string;
    roles: string[];
}
export interface Dependencies {
    id: string;
    name: string;
    path: string;
    kind: string;
    music: MusicUse[];
    nonMusic: MusicUse[];
    descendants: number;
    linkedReferences: number;
    userData: number;
    bindings: string[];
    policies: string[];
    missingScope: string[];
    classification: string;
    canEdit: boolean;
    canDelete: boolean;
    metadataPaths: string[];
}
export interface MusicRecordEvidence {
    nativeType: string;
    path: string;
    reason: string;
    observedAt: string;
}
export interface ArtistIdentity {
    id: string;
    preferredName: string;
    aliases: string[];
    libraries: string[];
    artistId: string;
    personId: string;
    artistIds: string[];
    personIds: string[];
    musicBrainzId?: string | null;
}
export interface FieldDecision {
    mode: string;
    value?: JsonValue;
    provenance?: string;
    snapshotId?: string | null;
    sourceField?: string | null;
}
export interface SourceBinding {
    provider: string;
    key: string;
    recordId: string;
    confirmedAt: string;
}
export interface SourceSnapshot {
    id: string;
    binding: SourceBinding;
    retrievedAt: string;
    offered: Record<string, JsonValue>;
    configured: Record<string, JsonValue>;
    provenance: string;
}
export interface ImageDecision {
    mode: string;
    hash?: string | null;
    mime?: string | null;
    snapshotId?: string | null;
    sourceUrl?: string | null;
}
export interface MetadataPolicy {
    id: string;
    label: string;
    itemId: string;
    identityId: string | null;
    libraries: string[];
    fields: Record<string, FieldDecision>;
    images: Record<string, ImageDecision>;
    bindings: SourceBinding[];
    snapshots: SourceSnapshot[];
}
export interface RefreshWork {
    id: string;
    refresh: boolean;
}
export interface Fields {
    decisions?: Record<string, FieldDecision>;
    title?: string | null;
    album?: string | null;
    artists?: string[] | null;
    albumArtists?: string[] | null;
    discNumber?: number | null;
    trackNumber?: number | null;
}
export interface Rule {
    metadata?: MetadataPolicy | null;
    id: string;
    label: string;
    kind: string;
    path: string;
    credit: string;
    names: string[];
    role: string;
    libraries: string[];
    fields: Fields;
    trackDefaults: Fields;
}
export interface Document {
    schemaVersion: number;
    revision: number;
    active: Rule[];
    drafts: Rule[];
    policies: MetadataPolicy[];
    policyDrafts: MetadataPolicy[];
    identities: ArtistIdentity[];
    identityDrafts: ArtistIdentity[];
}
export interface View {
    id: string;
    path: string;
    kind: string;
    library: string;
    albumPath: string;
    libraryPaths: string[];
    locked: boolean;
    titleLocked: boolean;
    values: Record<string, JsonValue>;
}
