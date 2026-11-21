import site from '../site.config.json'
import { Button } from './components/Button'

export default function App() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-4xl font-bold tracking-tight">{site.title}</h1>
      <p className="text-lg text-gray-600">{site.description}</p>
      <div>
        <Button>Get started</Button>
      </div>
    </main>
  )
}
