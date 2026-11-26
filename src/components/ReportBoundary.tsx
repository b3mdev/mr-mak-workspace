import { Component, type ReactNode } from 'react'
import { tNow } from '../lib/i18n/translate'

// A failed lazy import or renderer must not unmount the Workspace navigation.
export default class ReportBoundary extends Component<{
  children: ReactNode
  onHome: () => void
}, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return <div className="report-error" role="alert">
      <strong>{tNow('report.boundaryTitle')}</strong>
      <p>{tNow('report.boundaryBody')}</p>
      <div className="report-error-actions">
        <button onClick={() => window.location.reload()}>{tNow('report.reloadPage')}</button>
        <button onClick={this.props.onHome}>{tNow('report.backToWorkspace')}</button>
      </div>
      <details><summary>{tNow('report.errorDetails')}</summary><pre>{this.state.error.message || String(this.state.error)}</pre></details>
    </div>
  }
}
