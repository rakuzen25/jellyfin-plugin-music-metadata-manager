import type { Document, View, FieldDefinition } from "./contracts.ts";
export function createDocumentState() {
    let doc: Document;
    let fieldDefinitions: FieldDefinition[] = [];
    let editingId: string | null = null,
        reviewToken: string | null = null,
        reviewEpoch = 0;
    let found: View[] = [],
        identityEditingId: string | null = null;
    let identityRecords: {
        artists: {
            id: string;
            name: string;
        }[];
        persons: {
            id: string;
            name: string;
        }[];
    } | null = null;
    let unresolvedRows: {
        credit: string;
        role: string;
        items: {
            id: string;
            name: string;
            path: string;
        }[];
    }[] = [];
    return {
        get doc() {
            return doc;
        },
        set doc(value: typeof doc) {
            doc = value;
        },
        get fieldDefinitions() {
            return fieldDefinitions;
        },
        set fieldDefinitions(value: typeof fieldDefinitions) {
            fieldDefinitions = value;
        },
        get editingId() {
            return editingId;
        },
        set editingId(value: typeof editingId) {
            editingId = value;
        },
        get reviewToken() {
            return reviewToken;
        },
        set reviewToken(value: typeof reviewToken) {
            reviewToken = value;
        },
        get reviewEpoch() {
            return reviewEpoch;
        },
        set reviewEpoch(value: typeof reviewEpoch) {
            reviewEpoch = value;
        },
        get found() {
            return found;
        },
        set found(value: typeof found) {
            found = value;
        },
        get identityEditingId() {
            return identityEditingId;
        },
        set identityEditingId(value: typeof identityEditingId) {
            identityEditingId = value;
        },
        get identityRecords() {
            return identityRecords;
        },
        set identityRecords(value: typeof identityRecords) {
            identityRecords = value;
        },
        get unresolvedRows() {
            return unresolvedRows;
        },
        set unresolvedRows(value: typeof unresolvedRows) {
            unresolvedRows = value;
        },
    };
}
