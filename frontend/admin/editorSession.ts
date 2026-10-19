import type { NavigationState } from "./state.ts";
export function createEditorSession() {
    const ui: NavigationState = {
        view: "library",
        screen: "list",
        editor: null,
        itemTab: "metadata",
        locals: new Map(),
        stack: [],
        scroll: new Map(),
        request: 0,
        inventoryRequest: 0,
        issueRequest: 0,
        reviewOrigin: null,
        previewChange: null,
        previewRevision: null,
        pinUrls: new Map(),
        issueLoaded: false,
        comparisonRequest: 0,
        listFocus: null,
        pendingSaves: new Set(),
    };
    return {
        get ui() {
            return ui;
        },
    };
}
