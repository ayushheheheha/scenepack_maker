import { useState } from 'react'
import Home from './pages/Home.jsx'
import Editor from './pages/Editor.jsx'

export default function App() {
  // Phase 2: a single view variable picks the screen. The loaded project is
  // lifted here so it can be handed to the Editor. No router yet.
  const [view, setView] = useState('home')
  const [project, setProject] = useState(null) // parsed project.json, or null
  const [projectPath, setProjectPath] = useState(null) // folder holding project.json

  if (view === 'editor') {
    return (
      <Editor
        project={project}
        projectPath={projectPath}
        setProject={setProject}
        onBack={() => setView('home')}
      />
    )
  }

  return (
    <Home
      project={project}
      projectPath={projectPath}
      setProject={setProject}
      setProjectPath={setProjectPath}
      onOpenEditor={() => setView('editor')}
    />
  )
}
