export const nonnegative = value => Number.isFinite(value) && value >= 0 ? value : null;
export const tokens = value => Number.isSafeInteger(value) ? nonnegative(value) : null;
export const date = value => Number.isFinite(value) && value > 0 && value <= 8.64e15 ? value : null;
export const seconds = value => typeof value === 'number' ? date(value * 1000) : null;

export function statusUsage(data, at) {
  const input = tokens(data.context_window?.total_input_tokens);
  const output = tokens(data.context_window?.total_output_tokens);
  const total = !data.session_id || input === null || output === null ? null : tokens(input + output);
  const quotas = [];
  if (data.product === 'antigravity') {
    for (const [key, bucket] of Object.entries(data.quota || {}).slice(0, 50)) {
      if (!/^[\w.-]{1,80}$/.test(key) || bucket?.disabled) continue;
      const fraction = nonnegative(bucket?.remaining_fraction);
      const remaining = nonnegative(bucket?.remaining_amount);
      const percent = fraction !== null && fraction <= 1 ? (1 - fraction) * 100 : null;
      const resetAfter = nonnegative(bucket?.reset_in_seconds);
      const resetsAt = date(Date.parse(bucket?.reset_time)) ?? (resetAfter === null ? null : date(at + resetAfter * 1000));
      if (percent !== null || remaining !== null || resetsAt !== null) quotas.push({ key, label: key, minutes: null, percent, remaining, resetsAt });
    }
  } else {
    for (const [key, minutes] of [['five_hour', 300], ['seven_day', 10080], ['spend_limit', null]]) {
      const limit = data.rate_limits?.[key];
      const percent = nonnegative(limit?.used_percentage);
      const resetsAt = seconds(limit?.resets_at);
      if (percent !== null || resetsAt !== null) quotas.push({ key, minutes, label: null, percent, remaining: null, resetsAt });
    }
  }
  return { total, quotas };
}
