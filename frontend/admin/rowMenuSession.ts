export function createRowMenuSession() {
    let rowMenuTrigger: HTMLButtonElement | null = null,
        rowMenuCommands: HTMLButtonElement[] = [];
    return {
        get rowMenuTrigger() {
            return rowMenuTrigger;
        },
        set rowMenuTrigger(value: typeof rowMenuTrigger) {
            rowMenuTrigger = value;
        },
        get rowMenuCommands() {
            return rowMenuCommands;
        },
        set rowMenuCommands(value: typeof rowMenuCommands) {
            rowMenuCommands = value;
        },
    };
}
