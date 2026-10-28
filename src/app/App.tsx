import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from './components/ui'
import { Acics } from './pages/Acics'

const client = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 } },
})

function Gate() {
  return <Acics />
}

export function App() {
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <Gate />
      </ToastProvider>
    </QueryClientProvider>
  )
}
