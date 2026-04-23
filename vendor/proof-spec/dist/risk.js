/**
 * Deterministic risk labeler. Pure function, zero deps. Runners MUST call this
 * on every spec before running `act[]`. Synthesizers do not set risk.
 */
const DESTRUCTIVE_RE = /\b(delete|remove|pay|buy|send|confirm|destroy|cancel|wipe|exfiltrate|purge|erase|trash|charge|deactivate|uninstall)\b/i;
export function computeRisk(act) {
    if (!act || act.length === 0)
        return "low";
    if (act.every((op) => op.op === "read"))
        return "low";
    for (const op of act) {
        if (op.op === "submit")
            return "high";
        if (op.op === "click" && DESTRUCTIVE_RE.test(op.target.name))
            return "high";
    }
    return "medium";
}
//# sourceMappingURL=risk.js.map