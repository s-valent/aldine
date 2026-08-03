/**
 * Assertions that actually fail the run. console.assert only prints — a CI
 * job using it goes green on broken assertions, which is how these tests
 * passed for weeks without asserting anything.
 */
export function check(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

/** Key-order-insensitive stringify — Postgres JSONB does not preserve order. */
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    // undefined-valued keys are absent in JSON semantics (JSON.stringify drops them)
    const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/** Deep-equality via stable JSON — good enough for plain data rows. */
export function eq(actual, expected, msg) {
  const a = stable(actual);
  const e = stable(expected);
  if (a !== e) throw new Error(`${msg}: expected ${e}, got ${a}`);
}

export async function throws(fn, msgPart, msg) {
  try {
    await fn();
  } catch (err) {
    check(String(err.message).includes(msgPart), `${msg}: error "${err.message}" should contain "${msgPart}"`);
    return;
  }
  throw new Error(`${msg}: expected an error containing "${msgPart}", got none`);
}
