export function needsTailscaleHttps(issue: unknown) {
  const code = issue instanceof Error && 'code' in issue ? issue.code : issue
  return code === 'TAILSCALE_HTTPS_REQUIRED'
}
