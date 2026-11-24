import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

/** Страховка от «белого экрана»: любая ошибка рендера показывается текстом. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Ошибка приложения:', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-4 px-6">
          <h1 className="text-xl font-bold">Приложение не запустилось</h1>
          <p className="text-sm text-mist-300">
            Покажи это сообщение разработчику — по нему видно, что именно сломалось.
          </p>
          <pre className="overflow-auto rounded-xl border border-amber-300/30 bg-amber-300/10 p-3 text-xs whitespace-pre-wrap text-amber-200">
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-4 font-semibold text-ink-950"
          >
            Обновить страницу
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
