import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { SessionProvider } from './session'
import './styles.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: true,
      staleTime: 15_000,
    },
  },
})

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <HashRouter>
          <App />
        </HashRouter>
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>,
)
