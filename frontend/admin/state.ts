import type { ArtistIdentity, Change, MetadataPolicy, Rule } from "./contracts.ts";
import type { Comparison, BulkContext, IssueContext, Issue } from "./responses.ts";
export interface Editor {
    type: "metadata" | "identity" | "rule";
    key: string;
    name: string;
    itemId: string | null | undefined;
    dirty: boolean;
    sequence: number;
    baselineChanged?: boolean;
    issueRepair?: {
        issue: Issue;
        guided: boolean;
        choice: string;
        full: boolean;
    };
}
export interface LocalEdit extends Editor {
    data: MetadataPolicy | ArtistIdentity | Rule;
    raw?: {
        field: string;
        mode: string;
        value: string;
    }[];
    tab: string;
    comparison: Comparison | null;
}
export interface ReviewOrigin {
    screen: string;
    view: string;
    editor: Editor | null;
    tab: string;
    scroll: number;
}
export interface NavigationState {
    view: string;
    screen: string;
    editor: Editor | null;
    itemTab: string;
    locals: Map<string, LocalEdit>;
    stack: (Editor & {
        tab: string;
        scroll: number;
    })[];
    scroll: Map<string, number>;
    request: number;
    inventoryRequest: number;
    issueRequest: number;
    comparisonRequest: number;
    issueLoaded: boolean;
    reviewOrigin: ReviewOrigin | null;
    previewChange: Partial<Change> | null;
    previewRevision: number | null;
    pinUrls: Map<string, Promise<string>>;
    listFocus: {
        view: string;
        element: HTMLElement | null;
        selector?: string;
    } | null;
    pendingSaves: Set<string>;
    bulkReview?: BulkContext | null;
    issueReview?: IssueContext | null;
}
export interface CommandContext {
    screen: string;
    view: string;
    item: string | null;
}
export interface Command {
    button: HTMLButtonElement | null;
    command: string;
    resource: string | null | undefined;
    key: string;
    label: string;
    write: boolean;
    editing: boolean;
    navigation: boolean;
    item: string;
    context: CommandContext;
    anchor: Element | null | undefined;
    itemId: string | null | undefined;
    origin: {
        key?: string;
        view: string;
        issueKey?: string | null;
    };
    confirmed?: boolean;
}
