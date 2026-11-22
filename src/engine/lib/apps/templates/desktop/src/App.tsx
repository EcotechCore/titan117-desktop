import { useState } from 'react'

import app from '../app.config.json'

export default function App() {
  const [count, setCount] = useState(0)
  return (
    <main className="flex min-h-screen flex-col justify-center gap-6 bg-white px-10 py-12 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <h1 className="text-3xl font-bold tracking-tight">{app.name}</h1>
      <p className="max-w-xl text-base text-gray-600 dark:text-gray-300">{app.description}</p>
      <div>
        <button
          type="button"
          onClick={() => setCount((n) => n + 1)}
          className="rounded-lg bg-brand px-4 py-2 font-medium text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {count ? `Clicked ${count} times` : 'Get started'}
        </button>
      </div>
    </main>
  )
}
