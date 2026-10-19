export function createBulkSession() {
    let bulkMatches: HTMLElement[] = [],
        bulkBusy = false;
    const bulkSelection = new Set<string>();
    return {
        get bulkSelection() {
            return bulkSelection;
        },
        get bulkMatches() {
            return bulkMatches;
        },
        set bulkMatches(value: typeof bulkMatches) {
            bulkMatches = value;
        },
        get bulkBusy() {
            return bulkBusy;
        },
        set bulkBusy(value: typeof bulkBusy) {
            bulkBusy = value;
        },
    };
}
