export function createChangesSession() {
    let changeStart = 0;
    return {
        get changeStart() {
            return changeStart;
        },
        set changeStart(value: typeof changeStart) {
            changeStart = value;
        },
    };
}
