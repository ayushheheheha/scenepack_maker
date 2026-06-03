import { useState } from 'react'
import Home from './pages/Home.jsx'
import Editor from './pages/Editor.jsx'

export default function App() {
  // Phase 1: a single state variable picks the view. No router yet —
  // navigation between Home and Editor is wired up in a later phase.
  const [view] = useState('home')

  return view === 'editor' ? <Editor /> : <Home />
}
